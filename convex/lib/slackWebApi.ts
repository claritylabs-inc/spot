"use node";

import { createHash } from "node:crypto";
import dayjs from "dayjs";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import {
  resolveSlackInstallation,
  SlackCredentialRefreshInProgressError,
} from "./slackCredentials";
import { isSlackMockMode } from "./slackConfig";

const SLACK_API_BASE_URL = "https://slack.com/api";
const REQUEST_TIMEOUT_MS = 20_000;
const REFRESH_WAIT_MS = 1_000;
const REFRESH_WAIT_ATTEMPTS = 15;
const MAX_THREAD_CONTEXT_MESSAGES = 100;
const MAX_THREAD_CONTEXT_MESSAGE_CHARS = 4_000;
const MOCK_BOT_USER_ID = "U-SPOT";

export type SlackBlock = Record<string, unknown>;

export type SlackOutboundAttachment = {
  fileId: Id<"_storage">;
  filename: string;
  contentType: string;
};

export type SlackSendResult = {
  messageId?: string;
  attachmentFailures: Array<{ filename: string; error: string }>;
};

export type SlackChannel = {
  id: string;
  name: string;
  isMember: boolean;
  isPrivate: boolean;
  isShared: boolean;
};

export type SlackReconcileChannel =
  | {
      id: string;
      ok: true;
      name?: string;
      isArchived: boolean;
      isMember: boolean;
      isPrivate: boolean;
      isShared: boolean;
      isExtShared: boolean;
      isOrgShared: boolean;
    }
  | { id: string; ok: false; errorCode: string; retryable: boolean };

export type SlackActor = {
  teamId: string;
  userId: string;
  displayName?: string;
  email?: string;
  isBot: boolean;
  botUserId?: string;
};

export type SlackThreadContextMessage = {
  messageTs: string;
  senderUserId?: string;
  senderName?: string;
  content: string;
};

type SlackInstallation = {
  teamId: string;
  botToken: string;
  botUserId?: string;
};
type SlackResponse = { ok?: boolean; error?: string; not_in_channel?: boolean };
type SlackChannelPayload = {
  id?: string;
  name?: string;
  is_archived?: boolean;
  is_member?: boolean;
  is_private?: boolean;
  is_shared?: boolean;
  is_ext_shared?: boolean;
  is_org_shared?: boolean;
};
type SlackFile = {
  id?: string;
  name?: string;
  title?: string;
  shares?: Record<string, Record<string, Array<{ ts?: string }>>>;
};
type SlackThreadMessage = {
  type?: string;
  ts?: string;
  user?: string;
  text?: string;
  username?: string;
  bot_profile?: { name?: string };
  files?: SlackFile[];
};

const DEFINITIVE_SLACK_ERRORS = new Set([
  "account_inactive",
  "channel_not_found",
  "invalid_auth",
  "is_archived",
  "missing_scope",
  "not_allowed_token_type",
  "not_authed",
  "org_login_required",
  "not_in_channel",
  "token_expired",
  "token_revoked",
]);

export class SlackProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "SlackProviderError";
  }
}

// Sender names are resolved through users.info and reused briefly for thread
// context; the cache never holds credentials.
const actorCache = new Map<string, { actor: SlackActor; expiresAt: number }>();
// Mock channel state is process-local, matching the retired mock worker.
const mockJoinedChannelIds = new Set<string>();
const mockLeftChannelIds = new Set<string>();
const mockCurrentChannelsByTeam = new Map<string, SlackChannel>();

async function readSlackApiResponse<T extends SlackResponse>(
  method: string,
  response: Response,
): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T;
  if (method === "conversations.leave" && payload.not_in_channel === true) {
    return payload;
  }
  if (!response.ok || !payload.ok) {
    const retryAfter = response.headers.get("retry-after");
    const code = payload.error ?? `http_${response.status}`;
    throw new SlackProviderError(
      `${code}${retryAfter ? `; retry after ${retryAfter}s` : ""}`,
      code,
      response.status >= 500 || !DEFINITIVE_SLACK_ERRORS.has(code),
    );
  }
  return payload;
}

async function slackApi<T extends SlackResponse>(
  method: string,
  token: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${SLACK_API_BASE_URL}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return await readSlackApiResponse<T>(method, response);
}

async function slackFormApi<T extends SlackResponse>(
  method: string,
  token: string,
  body: Record<string, string | number | boolean>,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const response = await fetch(`${SLACK_API_BASE_URL}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
    },
    body: new URLSearchParams(
      Object.entries(body).map(([key, value]) => [key, String(value)]),
    ),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return await readSlackApiResponse<T>(method, response);
}

function slackClientMessageId(value: string) {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20),
  ].join("-");
}

function slackFileMessageTs(file: SlackFile | undefined, channelId: string) {
  if (!file?.shares) return undefined;
  for (const scope of ["private", "public"]) {
    const timestamp = file.shares[scope]?.[channelId]?.find(
      (message) => message.ts,
    )?.ts;
    if (timestamp) return timestamp;
  }
  return undefined;
}

function normalizeChannel(
  channel: SlackChannelPayload,
  isMember = channel.is_member === true,
): SlackChannel | undefined {
  if (!channel.id || !channel.name) return undefined;
  return {
    id: channel.id,
    name: channel.name,
    isMember,
    isPrivate: channel.is_private === true,
    isShared:
      channel.is_shared === true ||
      channel.is_ext_shared === true ||
      channel.is_org_shared === true,
  };
}

function supportChannelName(clientSlug: string) {
  const slug = clientSlug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  if (!slug) throw new Error("A valid client slug is required");
  return `spot-${slug}`;
}

function mockChannels(input: {
  teamId: string;
  currentChannelId?: string;
  currentChannelName?: string;
}) {
  if (input.currentChannelId && input.currentChannelName) {
    mockCurrentChannelsByTeam.set(input.teamId, {
      id: input.currentChannelId,
      name: input.currentChannelName,
      isMember: true,
      isPrivate: true,
      isShared: true,
    });
  }
  const currentChannel = mockCurrentChannelsByTeam.get(input.teamId);
  const general = `mock-${input.teamId}-general`;
  const policies = `mock-${input.teamId}-policies`;
  const channels: SlackChannel[] = [
    ...(currentChannel ? [currentChannel] : []),
    {
      id: general,
      name: "general",
      isMember:
        mockJoinedChannelIds.has(general) && !mockLeftChannelIds.has(general),
      isPrivate: false,
      isShared: false,
    },
    {
      id: policies,
      name: "policy-updates",
      isMember: !mockLeftChannelIds.has(policies),
      isPrivate: false,
      isShared: false,
    },
    ...(input.teamId === "T-CLARITY-FIXTURE"
      ? [
          {
            id: "G-OPERATOR-FIXTURE",
            name: "spot-operators",
            isMember: true,
            isPrivate: true,
            isShared: false,
          },
        ]
      : []),
  ];
  return channels.filter(
    (channel, index) =>
      channels.findIndex((candidate) => candidate.id === channel.id) === index,
  );
}

function mockChannelName(teamId: string, channelId: string) {
  const current = mockCurrentChannelsByTeam.get(teamId);
  return current?.id === channelId ? current.name : channelId.toLowerCase();
}

const clients = new WeakMap<ActionCtx, SlackWebApi>();

/**
 * Direct Slack Web API transport for Convex actions. Every operation resolves
 * the current encrypted installation, refreshing rotating tokens through the
 * shared database lease, and never returns credentials to callers. One client
 * is shared per action invocation so concurrent calls coalesce token lookups.
 */
export function slackWebApi(ctx: ActionCtx): SlackWebApi {
  let client = clients.get(ctx);
  if (!client) {
    client = createSlackWebApi(ctx);
    clients.set(ctx, client);
  }
  return client;
}

function createSlackWebApi(ctx: ActionCtx) {
  const mock = isSlackMockMode();
  const installationsInFlight = new Map<string, Promise<SlackInstallation>>();
  const actorsInFlight = new Map<string, Promise<SlackActor>>();

  async function loadInstallation(teamId: string): Promise<SlackInstallation> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await resolveSlackInstallation(ctx, teamId);
      } catch (error) {
        if (
          error instanceof SlackCredentialRefreshInProgressError &&
          attempt < REFRESH_WAIT_ATTEMPTS
        ) {
          await new Promise((resolve) => setTimeout(resolve, REFRESH_WAIT_MS));
          continue;
        }
        throw new SlackProviderError(
          error instanceof Error
            ? error.message
            : "Slack installation lookup failed",
          "installation_unavailable",
          false,
        );
      }
    }
  }

  async function installation(teamId: string): Promise<SlackInstallation> {
    if (mock) {
      return { teamId, botToken: "mock", botUserId: MOCK_BOT_USER_ID };
    }
    const pending = installationsInFlight.get(teamId);
    if (pending) return await pending;
    const request = loadInstallation(teamId);
    installationsInFlight.set(teamId, request);
    try {
      return await request;
    } finally {
      installationsInFlight.delete(teamId);
    }
  }

  async function uploadFile(args: {
    token: string;
    channelId: string;
    threadTs?: string;
    bytes: Blob;
    filename: string;
    contentType: string;
  }) {
    const upload = await slackFormApi<
      SlackResponse & { upload_url?: string; file_id?: string }
    >("files.getUploadURLExternal", args.token, {
      filename: args.filename,
      length: args.bytes.size,
    });
    if (!upload.upload_url || !upload.file_id) {
      throw new Error("Slack did not return an external file upload URL");
    }
    const uploaded = await fetch(upload.upload_url, {
      method: "POST",
      headers: {
        "Content-Type": args.contentType || "application/octet-stream",
      },
      body: args.bytes,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!uploaded.ok) {
      throw new Error(`Slack file upload failed (${uploaded.status})`);
    }
    const completed = await slackApi<SlackResponse & { files?: SlackFile[] }>(
      "files.completeUploadExternal",
      args.token,
      {
        files: [{ id: upload.file_id, title: args.filename }],
        channel_id: args.channelId,
        ...(args.threadTs ? { thread_ts: args.threadTs } : {}),
      },
    );
    if (args.threadTs) return args.threadTs;
    const completedTs = slackFileMessageTs(
      completed.files?.find((file) => file.id === upload.file_id),
      args.channelId,
    );
    if (completedTs) return completedTs;
    // Completing the external upload is the provider's commit point. Slack can
    // populate file shares asynchronously, so a missing message timestamp here
    // must not turn a successful share into a retry that uploads the file again.
    try {
      const info = await slackFormApi<SlackResponse & { file?: SlackFile }>(
        "files.info",
        args.token,
        { file: upload.file_id },
      );
      return slackFileMessageTs(info.file, args.channelId);
    } catch (error) {
      console.warn("Slack file share metadata is not available yet", error);
      return undefined;
    }
  }

  async function postMessage(
    input: {
      clientMessageId: string;
      teamId: string;
      channelId: string;
      threadTs?: string;
      mrkdwnText: string;
      blocks?: SlackBlock[];
    },
    files: Array<SlackOutboundAttachment & { bytes: Blob }>,
  ): Promise<SlackSendResult> {
    if (mock) {
      return {
        messageId: `mock-${input.clientMessageId}`,
        attachmentFailures: [],
      };
    }

    const { botToken } = await installation(input.teamId);
    let messageId: string | undefined;
    if (input.mrkdwnText.trim() || input.blocks?.length) {
      const sent = await slackApi<SlackResponse & { ts?: string }>(
        "chat.postMessage",
        botToken,
        {
          channel: input.channelId,
          text: input.mrkdwnText,
          ...(input.blocks?.length ? { blocks: input.blocks } : {}),
          mrkdwn: true,
          unfurl_links: false,
          unfurl_media: false,
          client_msg_id: slackClientMessageId(input.clientMessageId),
          ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
        },
      );
      if (!sent.ts) throw new Error("Slack did not return a message timestamp");
      messageId = sent.ts;
    }

    const attachmentFailures: SlackSendResult["attachmentFailures"] = [];
    for (const file of files) {
      try {
        const uploadedTs = await uploadFile({
          token: botToken,
          channelId: input.channelId,
          threadTs: input.threadTs,
          bytes: file.bytes,
          filename: file.filename,
          contentType: file.contentType,
        });
        messageId ??= uploadedTs;
      } catch (error) {
        attachmentFailures.push({
          filename: file.filename,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { messageId, attachmentFailures };
  }

  async function listChannels(input: {
    teamId: string;
    currentChannelId?: string;
    currentChannelName?: string;
  }): Promise<SlackChannel[]> {
    if (!input.teamId.trim()) throw new Error("teamId is required");
    if (mock) return mockChannels(input);
    const { botToken } = await installation(input.teamId);
    const channels: SlackChannel[] = [];
    let cursor: string | undefined;
    do {
      const result = await slackFormApi<
        SlackResponse & {
          channels?: SlackChannelPayload[];
          response_metadata?: { next_cursor?: string };
        }
      >("conversations.list", botToken, {
        types: "public_channel,private_channel",
        exclude_archived: true,
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });
      for (const channel of result.channels ?? []) {
        const normalized = normalizeChannel(channel);
        if (!normalized || channel.is_archived) continue;
        if (
          (normalized.isPrivate || normalized.isShared) &&
          !normalized.isMember
        ) {
          continue;
        }
        channels.push(normalized);
      }
      cursor = result.response_metadata?.next_cursor?.trim() || undefined;
    } while (cursor);
    return channels.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function visibleChannel(teamId: string, channelId: string) {
    if (!teamId.trim() || !channelId.trim()) {
      throw new Error("teamId and channelId are required");
    }
    const channel = (await listChannels({ teamId })).find(
      (candidate) => candidate.id === channelId,
    );
    if (!channel) throw new Error("Slack channel is not visible to Spot");
    return channel;
  }

  async function listConversationMembers(token: string, channelId: string) {
    const memberIds = new Set<string>();
    let cursor: string | undefined;
    do {
      const result = await slackFormApi<
        SlackResponse & {
          members?: string[];
          response_metadata?: { next_cursor?: string };
        }
      >("conversations.members", token, {
        channel: channelId,
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });
      for (const memberId of result.members ?? []) memberIds.add(memberId);
      cursor = result.response_metadata?.next_cursor?.trim() || undefined;
    } while (cursor);
    return memberIds;
  }

  return {
    /**
     * Posts text/blocks and uploads files once per clientMessageId for ten
     * minutes. Attachment failures are returned rather than thrown so callers
     * can keep their own retry ledgers; they also release the claim.
     */
    async sendMessage(input: {
      clientMessageId: string;
      teamId: string;
      channelId: string;
      threadTs?: string;
      mrkdwnText: string;
      blocks?: SlackBlock[];
      attachments?: SlackOutboundAttachment[];
    }): Promise<SlackSendResult> {
      if (!input.clientMessageId || !input.teamId || !input.channelId) {
        throw new Error("clientMessageId, teamId, and channelId are required");
      }
      const attachments = input.attachments ?? [];
      if (
        !input.mrkdwnText.trim() &&
        !input.blocks?.length &&
        attachments.length === 0
      ) {
        throw new Error("A message or attachment is required");
      }
      const files = await Promise.all(
        attachments.map(async (attachment) => ({
          ...attachment,
          bytes: await ctx.storage.get(attachment.fileId),
        })),
      );
      const available = files.flatMap((file) =>
        file.bytes ? [{ ...file, bytes: file.bytes }] : [],
      );
      if (available.length !== files.length) {
        throw new Error("A Slack attachment is unavailable");
      }
      const receipt = { clientMessageId: input.clientMessageId };
      const claim = await ctx.runMutation(
        internal.slackSendReceipts.claim,
        receipt,
      );
      if (!claim.claimed) {
        if ("sending" in claim) {
          throw new Error("Slack is still processing this send");
        }
        return { messageId: claim.messageId, attachmentFailures: [] };
      }
      let result: SlackSendResult;
      try {
        result = await postMessage(input, available);
      } catch (error) {
        await ctx.runMutation(internal.slackSendReceipts.release, receipt);
        throw error;
      }
      if (result.attachmentFailures.length > 0) {
        await ctx.runMutation(internal.slackSendReceipts.release, receipt);
      } else {
        await ctx.runMutation(internal.slackSendReceipts.complete, {
          ...receipt,
          messageId: result.messageId,
        });
      }
      return result;
    },

    async updateMessage(input: {
      teamId: string;
      channelId: string;
      messageTs: string;
      mrkdwnText: string;
      blocks?: SlackBlock[];
    }) {
      if (mock) return { messageId: input.messageTs };
      const { botToken } = await installation(input.teamId);
      const updated = await slackApi<SlackResponse & { ts?: string }>(
        "chat.update",
        botToken,
        {
          channel: input.channelId,
          ts: input.messageTs,
          text: input.mrkdwnText,
          blocks: input.blocks ?? [],
        },
      );
      return { messageId: updated.ts ?? input.messageTs };
    },

    /** Stops a legacy streaming presentation started before reaction-first delivery. */
    async stopStream(input: {
      teamId: string;
      channelId: string;
      messageTs: string;
      markdownText?: string;
      blocks?: SlackBlock[];
    }) {
      if (!input.markdownText?.trim() && !input.blocks?.length) {
        throw new Error("markdownText or blocks are required");
      }
      if (mock) return { messageId: input.messageTs };
      const { botToken } = await installation(input.teamId);
      const stopped = await slackApi<SlackResponse & { ts?: string }>(
        "chat.stopStream",
        botToken,
        {
          channel: input.channelId,
          ts: input.messageTs,
          ...(input.markdownText?.trim()
            ? { markdown_text: input.markdownText }
            : {}),
          ...(input.blocks?.length ? { blocks: input.blocks } : {}),
        },
      );
      return { messageId: stopped.ts ?? input.messageTs };
    },

    async addReaction(input: {
      teamId: string;
      channelId: string;
      messageTs: string;
      name: string;
    }) {
      if (mock) return;
      const { botToken } = await installation(input.teamId);
      try {
        await slackApi("reactions.add", botToken, {
          channel: input.channelId,
          timestamp: input.messageTs,
          name: input.name,
        });
      } catch (error) {
        if (
          !(error instanceof SlackProviderError) ||
          error.code !== "already_reacted"
        ) {
          throw error;
        }
      }
    },

    async removeReaction(input: {
      teamId: string;
      channelId: string;
      messageTs: string;
      name: string;
    }) {
      if (mock) return;
      const { botToken } = await installation(input.teamId);
      try {
        await slackApi("reactions.remove", botToken, {
          channel: input.channelId,
          timestamp: input.messageTs,
          name: input.name,
        });
      } catch (error) {
        if (
          !(error instanceof SlackProviderError) ||
          error.code !== "no_reaction"
        ) {
          throw error;
        }
      }
    },

    async postEphemeral(input: {
      teamId: string;
      channelId: string;
      userId: string;
      threadTs?: string;
      text: string;
    }) {
      if (mock) return { messageId: `mock-ephemeral-${input.userId}` };
      const { botToken } = await installation(input.teamId);
      const sent = await slackApi<SlackResponse & { message_ts?: string }>(
        "chat.postEphemeral",
        botToken,
        {
          channel: input.channelId,
          user: input.userId,
          text: input.text,
          ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
        },
      );
      return { messageId: sent.message_ts };
    },

    async downloadFile(input: { teamId: string; fileId: string }) {
      if (mock) throw new Error("Mock mode has no remote Slack attachments");
      const { botToken } = await installation(input.teamId);
      const info = await slackFormApi<
        SlackResponse & {
          file?: { url_private_download?: string; url_private?: string };
        }
      >("files.info", botToken, { file: input.fileId });
      const url = info.file?.url_private_download ?? info.file?.url_private;
      if (!url) throw new Error("Slack file metadata is unavailable");
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${botToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`Slack file download failed (${response.status})`);
      }
      return {
        bytes: await response.arrayBuffer(),
        contentType:
          response.headers.get("content-type") ?? "application/octet-stream",
      };
    },

    async fetchThreadContext(input: {
      teamId: string;
      channelId: string;
      threadTs: string;
      latestMessageTs: string;
    }): Promise<{ messages: SlackThreadContextMessage[]; truncated: boolean }> {
      if (
        !input.teamId.trim() ||
        !input.channelId.trim() ||
        !input.threadTs.trim() ||
        !input.latestMessageTs.trim()
      ) {
        throw new Error(
          "teamId, channelId, threadTs, and latestMessageTs are required",
        );
      }
      if (mock) return { messages: [], truncated: false };
      const { botToken, botUserId } = await installation(input.teamId);
      const result = await slackFormApi<
        SlackResponse & {
          messages?: SlackThreadMessage[];
          has_more?: boolean;
          response_metadata?: { next_cursor?: string };
        }
      >("conversations.replies", botToken, {
        channel: input.channelId,
        ts: input.threadTs,
        latest: input.latestMessageTs,
        inclusive: true,
        limit: MAX_THREAD_CONTEXT_MESSAGES,
      });
      const messages = (result.messages ?? [])
        .slice(0, MAX_THREAD_CONTEXT_MESSAGES)
        .flatMap((message): SlackThreadContextMessage[] => {
          if (
            message.type !== "message" ||
            !message.ts ||
            message.user === botUserId
          ) {
            return [];
          }
          const filenames = (message.files ?? [])
            .map((file) => file.name?.trim() || file.title?.trim())
            .filter((filename): filename is string => Boolean(filename));
          const content = [
            message.text?.trim() ?? "",
            filenames.length > 0 ? `[Attached ${filenames.join(", ")}]` : "",
          ]
            .filter(Boolean)
            .join("\n")
            .slice(0, MAX_THREAD_CONTEXT_MESSAGE_CHARS);
          if (!content) return [];
          const cachedSenderName = message.user
            ? actorCache.get(`${input.teamId}:${message.user}`)?.actor
                .displayName
            : undefined;
          const senderName =
            message.username || message.bot_profile?.name || cachedSenderName;
          return [
            {
              messageTs: message.ts,
              ...(message.user ? { senderUserId: message.user } : {}),
              ...(senderName ? { senderName } : {}),
              content,
            },
          ];
        });
      return {
        messages,
        truncated:
          result.has_more === true ||
          Boolean(result.response_metadata?.next_cursor?.trim()),
      };
    },

    async resolveActor(input: {
      teamId: string;
      userId: string;
    }): Promise<SlackActor> {
      if (!input.teamId || !input.userId) {
        throw new Error("teamId and userId are required");
      }
      if (mock) {
        return {
          teamId: input.teamId,
          userId: input.userId,
          displayName: input.userId,
          isBot: false,
          botUserId: MOCK_BOT_USER_ID,
        };
      }
      const cacheKey = `${input.teamId}:${input.userId}`;
      const cached = actorCache.get(cacheKey);
      if (cached && cached.expiresAt > dayjs().valueOf()) return cached.actor;
      const pending = actorsInFlight.get(cacheKey);
      if (pending) return await pending;
      const request = (async (): Promise<SlackActor> => {
        const { botToken, botUserId } = await installation(input.teamId);
        const payload = await slackFormApi<
          SlackResponse & {
            user?: {
              id?: string;
              team_id?: string;
              name?: string;
              real_name?: string;
              is_bot?: boolean;
              is_app_user?: boolean;
              profile?: {
                display_name?: string;
                real_name?: string;
                email?: string;
                team?: string;
              };
            };
          }
        >("users.info", botToken, { user: input.userId });
        const user = payload.user;
        const teamId = user?.team_id ?? user?.profile?.team;
        if (!user?.id || !teamId) {
          throw new Error("Slack actor metadata is unavailable");
        }
        const actor: SlackActor = {
          teamId,
          userId: user.id,
          displayName:
            user.profile?.display_name ||
            user.profile?.real_name ||
            user.real_name ||
            user.name,
          email: user.profile?.email,
          isBot: user.is_bot === true || user.is_app_user === true,
          botUserId,
        };
        actorCache.set(cacheKey, {
          actor,
          expiresAt: dayjs().add(5, "minute").valueOf(),
        });
        return actor;
      })();
      actorsInFlight.set(cacheKey, request);
      try {
        return await request;
      } finally {
        actorsInFlight.delete(cacheKey);
      }
    },

    async resolveChannelName(input: {
      teamId: string;
      channelId: string;
      timeoutMs?: number;
    }) {
      if (!input.teamId || !input.channelId) {
        throw new Error("teamId and channelId are required");
      }
      if (mock) return mockChannelName(input.teamId, input.channelId);
      const { botToken } = await installation(input.teamId);
      const result = await slackFormApi<
        SlackResponse & { channel?: SlackChannelPayload }
      >(
        "conversations.info",
        botToken,
        { channel: input.channelId, include_num_members: false },
        input.timeoutMs,
      );
      if (result.channel?.id !== input.channelId || !result.channel.name) {
        throw new Error("Slack channel metadata is unavailable");
      }
      return result.channel.name;
    },

    listChannels,

    /** Creates or reuses the private Clarity-host Slack Connect support channel. */
    async createConnectChannel(input: {
      clientSlug: string;
      inviteEmail: string;
      operatorUserIds?: string[];
      existingChannelId?: string;
      existingChannelName?: string;
    }) {
      if (!input.inviteEmail.trim()) throw new Error("inviteEmail is required");
      const operatorUserIds = Array.from(
        new Set(
          (input.operatorUserIds ?? [])
            .map((userId) => userId.trim())
            .filter(Boolean),
        ),
      ).slice(0, 250);
      if (mock) {
        const name =
          input.existingChannelName ?? supportChannelName(input.clientSlug);
        return {
          channelId: input.existingChannelId ?? `mock-${name}`,
          channelName: name,
          inviteId: "mock-invite" as string | undefined,
          reusedChannel: Boolean(input.existingChannelId),
          operatorInvites: {
            requested: operatorUserIds.length,
            succeeded: true,
            error: undefined as string | undefined,
          },
          supportInvite: {
            succeeded: true,
            pending: true,
            error: undefined as string | undefined,
          },
        };
      }
      const clarityTeamId = process.env.SLACK_CLARITY_TEAM_ID?.trim();
      if (!clarityTeamId) {
        throw new Error("Clarity Slack installation is not configured");
      }
      const { botToken } = await installation(clarityTeamId);
      const desiredName = supportChannelName(input.clientSlug);
      let channelId = input.existingChannelId?.trim();
      let channelName = input.existingChannelName?.trim() || desiredName;
      let reusedChannel = Boolean(channelId);
      if (!channelId) {
        try {
          const created = await slackApi<
            SlackResponse & { channel?: { id?: string; name?: string } }
          >("conversations.create", botToken, {
            name: desiredName,
            is_private: true,
          });
          channelId = created.channel?.id;
          channelName = created.channel?.name ?? desiredName;
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !error.message.startsWith("name_taken")
          ) {
            throw error;
          }
          const existing = (await listChannels({ teamId: clarityTeamId })).find(
            (channel) => channel.name === desiredName,
          );
          if (!existing) throw error;
          channelId = existing.id;
          channelName = existing.name;
          reusedChannel = true;
        }
      }
      if (!channelId) {
        throw new Error("Slack did not return the created channel ID");
      }

      let operatorInviteError: string | undefined;
      if (operatorUserIds.length > 0) {
        try {
          const existingMembers = await listConversationMembers(
            botToken,
            channelId,
          );
          const missingOperatorIds = operatorUserIds.filter(
            (userId) => !existingMembers.has(userId),
          );
          if (missingOperatorIds.length > 0) {
            await slackApi("conversations.invite", botToken, {
              channel: channelId,
              users: missingOperatorIds.join(","),
              force: true,
            });
          }
        } catch (error) {
          operatorInviteError =
            error instanceof Error ? error.message : String(error);
        }
      }

      let inviteId: string | undefined;
      let supportInviteError: string | undefined;
      let supportInvitePending = false;
      try {
        const invited = await slackApi<SlackResponse & { invite_id?: string }>(
          "conversations.inviteShared",
          botToken,
          {
            channel: channelId,
            emails: [input.inviteEmail],
            external_limited: false,
          },
        );
        inviteId = invited.invite_id;
        supportInvitePending = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith("connection_limit_exceeded_pending")) {
          supportInvitePending = true;
        } else {
          supportInviteError = message;
        }
      }
      return {
        channelId,
        channelName,
        inviteId,
        reusedChannel,
        operatorInvites: {
          requested: operatorUserIds.length,
          succeeded: !operatorInviteError,
          error: operatorInviteError,
        },
        supportInvite: {
          succeeded: !supportInviteError,
          pending: supportInvitePending,
          error: supportInviteError,
        },
      };
    },

    async joinPublicChannel(input: { teamId: string; channelId: string }) {
      const channel = await visibleChannel(input.teamId, input.channelId);
      if (channel.isPrivate || channel.isShared) {
        throw new Error(
          "Only public workspace channels can be joined from Spot",
        );
      }
      if (channel.isMember) return channel;
      if (mock) {
        mockJoinedChannelIds.add(channel.id);
        mockLeftChannelIds.delete(channel.id);
        return { ...channel, isMember: true };
      }
      const { botToken } = await installation(input.teamId);
      const result = await slackApi<
        SlackResponse & { channel?: SlackChannelPayload }
      >("conversations.join", botToken, { channel: input.channelId });
      const joined = normalizeChannel(result.channel ?? {}, true);
      if (!joined) throw new Error("Slack did not return the joined channel");
      return joined;
    },

    async leavePublicChannel(input: { teamId: string; channelId: string }) {
      const channel = await visibleChannel(input.teamId, input.channelId);
      if (channel.isPrivate || channel.isShared) {
        throw new Error(
          "Private and Slack Connect channels are managed in Slack",
        );
      }
      if (!channel.isMember) return channel;
      if (mock) {
        mockJoinedChannelIds.delete(channel.id);
        mockLeftChannelIds.add(channel.id);
        return { ...channel, isMember: false };
      }
      const { botToken } = await installation(input.teamId);
      await slackApi("conversations.leave", botToken, {
        channel: input.channelId,
      });
      return { ...channel, isMember: false };
    },

    /** Token-safe auth.test plus bounded conversations.info health probes. */
    async reconcile(input: { teamId: string; channelIds: string[] }) {
      if (!input.teamId.trim()) throw new Error("teamId is required");
      const channelIds = Array.from(
        new Set(input.channelIds.map((id) => id.trim()).filter(Boolean)),
      ).slice(0, 25);
      if (mock) {
        return {
          botUserId: MOCK_BOT_USER_ID as string | undefined,
          channels: channelIds.map(
            (id): SlackReconcileChannel => ({
              id,
              ok: true,
              name: mockChannelName(input.teamId, id),
              isArchived: false,
              isMember: !mockLeftChannelIds.has(id),
              isPrivate: true,
              isShared: true,
              isExtShared: true,
              isOrgShared: false,
            }),
          ),
        };
      }
      const { botToken, botUserId } = await installation(input.teamId);
      const authorization = await slackFormApi<
        SlackResponse & { team_id?: string; user_id?: string }
      >("auth.test", botToken, {});
      if (authorization.team_id && authorization.team_id !== input.teamId) {
        throw new SlackProviderError(
          "auth.test returned a different workspace",
          "workspace_mismatch",
          false,
        );
      }
      const channels = await Promise.all(
        channelIds.map(async (channelId): Promise<SlackReconcileChannel> => {
          try {
            const { channel } = await slackFormApi<
              SlackResponse & { channel?: SlackChannelPayload }
            >("conversations.info", botToken, {
              channel: channelId,
              include_num_members: false,
            });
            return {
              id: channelId,
              ok: true,
              name: channel?.name,
              isArchived: Boolean(channel?.is_archived),
              isMember: Boolean(channel?.is_member),
              isPrivate: Boolean(channel?.is_private),
              isShared: Boolean(channel?.is_shared),
              isExtShared: Boolean(channel?.is_ext_shared),
              isOrgShared: Boolean(channel?.is_org_shared),
            };
          } catch (error) {
            if (!(error instanceof SlackProviderError)) throw error;
            return {
              id: channelId,
              ok: false,
              errorCode: error.code,
              retryable: error.retryable,
            };
          }
        }),
      );
      return { botUserId: authorization.user_id ?? botUserId, channels };
    },
  };
}

export type SlackWebApi = ReturnType<typeof createSlackWebApi>;
