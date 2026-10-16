"use node";

import {
  Spectrum,
  app as appCard,
  attachment,
  contact,
  markdown,
  type Message,
  type Space,
} from "@spectrum-ts/core";
import { imessage, nativeContactCard } from "@spectrum-ts/imessage";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
// The transport's pure modules stay in imessage-worker/src until the Railway
// services are deleted: those services build only their own directory, so the
// modules cannot move into convex/ while the worker remains the rollback path.
import {
  isVoiceMemoContent,
  normalizeAttachmentMimeType,
  readInboundAttachmentWith,
  type InboundAttachmentContent,
} from "../../imessage-worker/src/attachmentPolicy";
import { resolveContactCardPhone } from "../../imessage-worker/src/contactCard";
import type {
  ImessageAppCard,
  ImessageAttachment,
  ImessageDeliveryFailure,
  ImessageResponseAttachment,
} from "../../imessage-worker/src/convex";
import type { InboundRecoveryClient } from "../../imessage-worker/src/inboundNormalization";
import { imessagePlainText } from "../../imessage-worker/src/outboundText";
import {
  deliverImessageResponse,
  splitImessageResponse,
} from "../../imessage-worker/src/responseDelivery";
import {
  getSpectrumCredentials,
  type ImessageChannelRole,
} from "./imessageConfig";
import { normalizeInboundImessageSender } from "./imessageIngress";
import {
  decideReplyThreading,
  threadingCandidates,
} from "./imessageReplyThreading";
import { ensureM4aWithWasmFfmpeg } from "./imessageVoice";
import { signSpectrumWebhook } from "./spectrumWebhookSignature";

const TYPING_REFRESH_MS = 4_000;
const WEBHOOK_DELIVERY_TIMEOUT_MS = 15_000;
const RAW_MESSAGE_LOOKUP_PAGE_SIZE = 25;
const RECENT_THREADING_PAGE_SIZE = 20;
const CONTACT_CARD_NAME = "Spot";
const CONTACT_CARD_URL = "https://spot.insure";
const CONTACT_CARD_NOTE =
  "Spot is an insurance intelligence assistant from Tools for Enlightenment for policies, certificates, renewals, and broker follow-ups.";
// Apple message GUIDs (optionally a `p:<n>/` part id). Spectrum webhook ids
// are opaque and may not be GUIDs, in which case threaded replies are skipped.
const IMESSAGE_GUID =
  /^(?:p:\d+\/)?[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/i;

type RawMessage = {
  guid: string;
  isFromMe?: boolean;
  isSystemMessage?: boolean;
  reaction?: unknown;
  dateCreated?: Date;
  content: {
    text?: string;
    attachments: readonly {
      guid: string;
      fileName: string;
      mimeType: string;
    }[];
  };
};

type AdvancedImessageClient = {
  attachments?: InboundRecoveryClient["attachments"];
  chats?: {
    get(chatGuid: string): Promise<{
      displayName?: string;
      isGroup?: boolean;
      participants?: readonly { address: string }[];
    }>;
    create(
      addresses: string[],
      options?: { message?: string; clientMessageId?: string },
    ): Promise<{
      chat: { guid: string; participants?: readonly { address: string }[] };
    }>;
  };
  groups?: {
    leave(chatGuid: string): Promise<void>;
    setDisplayName(
      chatGuid: string,
      displayName: string,
      options?: { clientMessageId?: string },
    ): Promise<unknown>;
  };
  messages?: {
    get(guid: string): Promise<RawMessage>;
    listInChat?(
      chatGuid: string,
      options?: { isFromMe?: boolean; pageSize?: number },
    ): Promise<{ messages: readonly RawMessage[] }>;
  };
};

export type SpectrumSendRequest = {
  toPhone?: string;
  chatGuid?: string;
  participants?: string[];
  message?: string;
  title?: string;
  clientMessageId?: string;
  attachments?: ImessageResponseAttachment[];
  appCards?: ImessageAppCard[];
};

export type SpectrumSendResult = {
  ok: boolean;
  error?: string;
  duplicate?: boolean;
  chatGuid?: string;
  isGroup?: boolean;
  participants?: Array<{ address: string }>;
  attachmentFailures: ImessageDeliveryFailure[];
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function createSpectrumApp(role: ImessageChannelRole) {
  const credentials = getSpectrumCredentials(role);
  if (!credentials) {
    throw new Error(
      role === "operator"
        ? "OPERATOR_PHOTON_PROJECT_ID, OPERATOR_PHOTON_PROJECT_SECRET, and OPERATOR_SPECTRUM_WEBHOOK_SECRET are required"
        : "PHOTON_PROJECT_ID, PHOTON_PROJECT_SECRET, and SPECTRUM_WEBHOOK_SECRET are required",
    );
  }
  const app = await Spectrum({
    projectId: credentials.projectId,
    projectSecret: credentials.projectSecret,
    providers: [imessage.config()],
    webhookSecret: credentials.webhookSecret,
    options: { logLevel: "warn" },
  });
  return { app, webhookSecret: credentials.webhookSecret };
}

export type SpectrumApp = Awaited<ReturnType<typeof createSpectrumApp>>["app"];

/**
 * Runs `fn` against a request-scoped Spectrum instance. Webhook handling never
 * opens the message stream; `stop()` closes the gRPC clients, token renewal
 * timer, and the process signal handlers Spectrum installs.
 */
export async function withSpectrumApp<T>(
  role: ImessageChannelRole,
  fn: (app: SpectrumApp, webhookSecret: string) => Promise<T>,
): Promise<T> {
  const { app, webhookSecret } = await createSpectrumApp(role);
  try {
    return await fn(app, webhookSecret);
  } finally {
    await app.stop().catch((error) => {
      console.warn("[imessage-spectrum] Failed to stop Spectrum:", error);
    });
  }
}

/**
 * Deserializes a verified webhook body into the live `[space, message]` pair.
 * The HTTP action already verified Photon's signature and replay window, so
 * the body is re-stamped here to keep the SDK's own window from measuring the
 * scheduler hop.
 */
export async function resolveWebhookTurn(
  app: SpectrumApp,
  webhookSecret: string,
  body: Uint8Array<ArrayBuffer>,
): Promise<{ space: Space; message: Message } | null> {
  let deliver: (turn: { space: Space; message: Message }) => void = () => {};
  const delivered = new Promise<{ space: Space; message: Message }>(
    (resolve) => {
      deliver = resolve;
    },
  );
  const result = await app.webhook(
    { body, headers: await signSpectrumWebhook(webhookSecret, body) },
    (space, message) => deliver({ space, message }),
  );
  if (result.status !== 200) {
    console.error("[imessage-webhook] Spectrum rejected the delivery", {
      status: result.status,
      body: new TextDecoder().decode(result.body),
    });
    return null;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), WEBHOOK_DELIVERY_TIMEOUT_MS);
  });
  try {
    return await Promise.race([delivered, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

function readStringField(value: unknown, fieldName: string) {
  if (!value || typeof value !== "object") return undefined;
  const field = (value as Record<string, unknown>)[fieldName];
  return typeof field === "string" && field.trim() ? field : undefined;
}

export function getAdvancedImessageClient(
  app: SpectrumApp,
  space?: Space,
): AdvancedImessageClient | undefined {
  const client = app.__internal.platforms.get("iMessage")?.client;
  if (!client) return undefined;
  if (Array.isArray(client)) {
    const phone = readStringField(space, "phone");
    const entry = (client.find(
      (candidate: { phone?: unknown }) => candidate.phone === phone,
    ) ?? client[0]) as { client?: AdvancedImessageClient } | undefined;
    return entry?.client;
  }
  return client as AdvancedImessageClient;
}

export async function getChatSnapshot(app: SpectrumApp, space: Space) {
  const chatGuid = space.id;
  const fallbackIsGroup = readStringField(space, "type") === "group";
  try {
    const chat = await getAdvancedImessageClient(app, space)?.chats?.get(
      chatGuid,
    );
    if (!chat) {
      return {
        chatGuid,
        isGroup: fallbackIsGroup,
        chatTitle: undefined as string | undefined,
        participants: [] as Array<{ address: string }>,
        participantsUnavailable: fallbackIsGroup,
      };
    }
    const participants = (chat.participants ?? []).map((participant) => ({
      address: participant.address,
    }));
    return {
      chatGuid,
      isGroup: chat.isGroup === true,
      chatTitle: chat.displayName,
      participants,
      participantsUnavailable:
        chat.isGroup === true && participants.length === 0,
    };
  } catch (error) {
    console.warn(
      `[imessage-spectrum] Failed to fetch chat snapshot for ${chatGuid}:`,
      error,
    );
    return {
      chatGuid,
      isGroup: fallbackIsGroup,
      chatTitle: undefined as string | undefined,
      participants: [] as Array<{ address: string }>,
      participantsUnavailable: fallbackIsGroup,
    };
  }
}

function collectAttachmentIds(message: Message): string[] {
  const ids: string[] = [];
  const visit = (item: { content: Message["content"] }) => {
    if (item.content.type === "attachment" && item.content.id) {
      ids.push(item.content.id);
    } else if (item.content.type === "group") {
      for (const child of item.content.items) visit(child);
    }
  };
  visit(message);
  return ids;
}

/**
 * Recovery client for `normalizeInboundTurn`. Webhook message ids are opaque,
 * so when `messages.get(id)` misses, the raw message is found in the chat by
 * the provider-native attachment GUIDs the payload does carry. The resolved
 * Apple GUID is reported so the reply can still be threaded.
 */
export function webhookRecoveryClient(
  app: SpectrumApp,
  space: Space,
  message: Message,
  onResolved: (guid: string) => void,
): InboundRecoveryClient | undefined {
  const client = getAdvancedImessageClient(app, space);
  if (!client?.messages?.get) return undefined;
  const messages = client.messages;
  const attachmentIds = new Set(collectAttachmentIds(message));
  return {
    attachments: client.attachments,
    messages: {
      get: async (id) => {
        try {
          const raw = await messages.get(id);
          onResolved(raw.guid);
          return raw;
        } catch (error) {
          if (attachmentIds.size === 0 || !messages.listInChat) throw error;
          const page = await messages.listInChat(space.id, {
            isFromMe: false,
            pageSize: RAW_MESSAGE_LOOKUP_PAGE_SIZE,
          });
          const raw = page.messages.find((candidate) =>
            candidate.content.attachments.some((item) =>
              attachmentIds.has(item.guid),
            ),
          );
          if (!raw) throw error;
          onResolved(raw.guid);
          return raw;
        }
      },
    },
  };
}

/**
 * Converts voice memos to m4a like the worker, using the bundled ffmpeg. If
 * transcoding fails, the memo is forwarded unchanged and the inbound handler
 * reports the transcription failure to the sender.
 */
export async function readWebhookAttachment(
  content: InboundAttachmentContent,
): Promise<ImessageAttachment> {
  try {
    return await readInboundAttachmentWith(ensureM4aWithWasmFfmpeg, content);
  } catch (error) {
    if (!isVoiceMemoContent(content)) throw error;
    console.warn("[imessage-webhook] Voice memo transcoding unavailable", {
      name: content.name,
      mimeType: content.mimeType,
      error: errorMessage(error),
    });
    return {
      data: Buffer.from(await content.read()).toString("base64"),
      mimeType: normalizeAttachmentMimeType(content.mimeType),
      name: content.name?.trim() || "voice-memo",
    };
  }
}

export async function withTypingIndicator<T>(
  space: Space,
  fn: () => Promise<T>,
): Promise<T> {
  let stopped = false;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let activeRefresh: Promise<void> | undefined;

  const refresh = async (): Promise<void> => {
    if (stopped) return;
    try {
      await space.startTyping();
    } catch (error) {
      console.warn(
        "[imessage-spectrum] Failed to refresh typing indicator:",
        error,
      );
    } finally {
      if (!stopped) {
        refreshTimer = setTimeout(() => {
          activeRefresh = refresh();
        }, TYPING_REFRESH_MS);
      }
    }
  };

  activeRefresh = refresh();
  try {
    return await fn();
  } finally {
    stopped = true;
    if (refreshTimer) clearTimeout(refreshTimer);
    await activeRefresh;
    await space.stopTyping().catch((error) => {
      console.warn(
        "[imessage-spectrum] Failed to stop typing indicator:",
        error,
      );
    });
  }
}

export async function resolveReplyTarget(args: {
  ctx: ActionCtx;
  app: SpectrumApp;
  space: Space;
  message: Message;
  recoveredGuid: string | undefined;
  incomingText: string;
  replyText: string;
}): Promise<Message | undefined> {
  const { space, message } = args;
  const inboundGuid = IMESSAGE_GUID.test(message.id)
    ? message.id
    : args.recoveredGuid;
  const getTarget = async (guid: string | undefined) =>
    guid ? await space.getMessage(guid).catch(() => undefined) : undefined;

  // Jev decides whether to thread and which earlier message to answer.
  const messages = getAdvancedImessageClient(args.app, space)?.messages;
  const page = await messages?.listInChat?.(space.id, {
    pageSize: RECENT_THREADING_PAGE_SIZE,
  }).catch(() => undefined);
  const candidates = threadingCandidates(page?.messages ?? []);
  const decision = await decideReplyThreading(args.ctx, {
    incomingText: args.incomingText,
    replyText: args.replyText,
    candidates,
  });
  if (decision.mode === "plain") return undefined;
  if (decision.mode === "thread") {
    const target = await getTarget(decision.guid);
    if (target) return target;
  }
  return await getTarget(inboundGuid);
}

/** Threads the reply to the source message when it has an Apple GUID. */
export async function sendResponseText(
  space: Space,
  replyTarget: Message | undefined,
  responseText: string,
) {
  const delivery = await deliverImessageResponse({
    segments: splitImessageResponse(responseText),
    replyAll: async (replySegments) => {
      const contents = replySegments.map((segment) => markdown(segment));
      if (!replyTarget || contents.length === 0) return 0;
      if (contents.length === 1) {
        return (await replyTarget.reply(contents[0])) ? 1 : 0;
      }
      const replies = await replyTarget.reply(
        contents[0],
        contents[1],
        ...contents.slice(2),
      );
      return replies.length;
    },
    sendChat: async (segment) => {
      await space.send(imessagePlainText(segment));
    },
    canFallbackAfterReplyError: (error) =>
      errorMessage(error).includes("enable_data_detection"),
  });
  if (!delivery.complete) {
    console.warn(
      "[imessage-spectrum] Threaded response delivery was incomplete",
      {
        deliveredSegments: delivery.deliveredSegments,
        expectedSegments: delivery.expectedSegments,
        error: delivery.error,
      },
    );
  }
}

export async function sendSpotContactCard(space: Space): Promise<void> {
  try {
    await space.send(nativeContactCard());
    return;
  } catch (error) {
    console.warn(
      "[imessage-spectrum] Native contact card send failed; falling back to vCard:",
      error,
    );
  }
  const phone = resolveContactCardPhone();
  await space.send(
    contact({
      name: { formatted: CONTACT_CARD_NAME },
      org: {
        name: "Tools for Enlightenment",
        title: "Insurance intelligence assistant",
      },
      phones: phone ? [{ value: phone, type: "mobile" }] : undefined,
      emails: [
        {
          value: (
            process.env.SPOT_AGENT_EMAIL ?? "agent@agent.spot.insure"
          ).replace(/@spot\.insure$/i, "@agent.spot.insure"),
          type: "work",
        },
      ],
      urls: [CONTACT_CARD_URL],
      note: CONTACT_CARD_NOTE,
    }),
  );
}

function appCardFallbackText(card: ImessageAppCard) {
  const intro =
    card.summary ?? [card.title, card.subtitle].filter(Boolean).join(" - ");
  return [intro, card.url]
    .filter(
      (part): part is string =>
        typeof part === "string" && part.trim().length > 0,
    )
    .join("\n");
}

export async function sendOutboundAppCards(
  space: Space,
  appCards?: ImessageAppCard[],
) {
  for (const card of appCards ?? []) {
    if (!card.url) continue;
    try {
      await space.send(appCard(card.url));
    } catch (error) {
      console.warn(
        `[imessage-spectrum] Failed to send app card ${card.url}:`,
        error,
      );
      await space.send(markdown(appCardFallbackText(card)));
    }
  }
}

export async function sendOutboundAttachments(
  space: Space,
  attachments?: ImessageResponseAttachment[],
): Promise<ImessageDeliveryFailure[]> {
  const failures: ImessageDeliveryFailure[] = [];
  for (const att of attachments ?? []) {
    let data: Buffer;
    try {
      const response = await fetch(att.url);
      if (!response.ok) {
        failures.push({
          filename: att.filename,
          error: `Download failed with status ${response.status}`,
        });
        continue;
      }
      data = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      failures.push({ filename: att.filename, error: errorMessage(error) });
      continue;
    }
    try {
      await space.send(
        attachment(data, { name: att.filename, mimeType: att.mimeType }),
      );
    } catch (error) {
      console.warn(
        `[imessage-spectrum] Failed to send attachment ${att.filename}:`,
        error,
      );
      failures.push({ filename: att.filename, error: errorMessage(error) });
    }
  }
  return failures;
}

export async function leaveImessageGroup(
  app: SpectrumApp,
  space: Space,
  chatGuid: string,
) {
  try {
    await getAdvancedImessageClient(app, space)?.groups?.leave(chatGuid);
  } catch (error) {
    console.warn(
      `[imessage-spectrum] Failed to leave group ${chatGuid}:`,
      error,
    );
  }
}

async function sendToSpace(
  space: Space,
  messageText: string,
  request: SpectrumSendRequest,
): Promise<ImessageDeliveryFailure[]> {
  await space.send(markdown(messageText));
  await sendOutboundAppCards(space, request.appCards);
  return await sendOutboundAttachments(space, request.attachments);
}

async function createGroup(
  app: SpectrumApp,
  participants: string[],
  messageText: string,
  request: SpectrumSendRequest,
): Promise<SpectrumSendResult> {
  const client = getAdvancedImessageClient(app);
  if (!client?.chats?.create) {
    return {
      ok: false,
      error: "iMessage group creation is not available",
      attachmentFailures: [],
    };
  }
  const created = await client.chats.create(participants, {
    message: imessagePlainText(messageText),
    clientMessageId: request.clientMessageId,
  });
  const chatGuid = created.chat.guid;
  if (request.title?.trim() && client.groups?.setDisplayName) {
    await client.groups.setDisplayName(chatGuid, request.title.trim(), {
      clientMessageId: request.clientMessageId
        ? `${request.clientMessageId}:title`
        : undefined,
    });
  }
  return {
    ok: true,
    chatGuid,
    isGroup: true,
    participants: created.chat.participants?.length
      ? created.chat.participants.map((participant) => ({
          address: normalizeInboundImessageSender(participant.address),
        }))
      : participants.map((address) => ({ address })),
    attachmentFailures: (request.attachments ?? []).map((att) => ({
      filename: att.filename,
      error: "Attachment send is not available during new group creation",
    })),
  };
}

/**
 * Convex replacement for the worker's `POST /send`: group creation by
 * participants, an existing chat by GUID, or a direct chat by phone. A repeated
 * `clientMessageId` within ten minutes is acknowledged as a duplicate.
 */
export async function sendImessageViaSpectrum(
  ctx: ActionCtx,
  role: ImessageChannelRole,
  request: SpectrumSendRequest,
): Promise<SpectrumSendResult> {
  const messageText =
    request.message?.trim() ||
    (request.appCards?.length
      ? "Spot shared a link."
      : request.attachments?.length
        ? "Spot shared attachment(s)."
        : "");
  if (
    (!request.toPhone && !request.chatGuid && !request.participants?.length) ||
    !messageText
  ) {
    return {
      ok: false,
      error:
        "toPhone, chatGuid, or participants and message/appCards/attachments are required",
      attachmentFailures: [],
    };
  }
  const participants = [
    ...new Set(
      (request.participants ?? []).map(normalizeInboundImessageSender),
    ),
  ];
  if (request.participants?.length && participants.length < 2) {
    return {
      ok: false,
      error: "At least two participants are required for a group chat",
      attachmentFailures: [],
    };
  }

  const clientMessageId = request.clientMessageId;
  if (clientMessageId) {
    const claim = await ctx.runMutation(
      internal.imessageTransportClaims.claimSend,
      { role, clientMessageId },
    );
    if (!claim.claimed) {
      return { ok: true, duplicate: true, attachmentFailures: [] };
    }
  }

  let result: SpectrumSendResult;
  try {
    result = await withSpectrumApp(role, async (app) => {
      if (participants.length > 0) {
        return await createGroup(app, participants, messageText, request);
      }
      const im = imessage(app);
      if (request.chatGuid) {
        try {
          const space = await im.space.get(request.chatGuid);
          return {
            ok: true,
            attachmentFailures: await sendToSpace(space, messageText, request),
          };
        } catch (error) {
          if (!request.toPhone) throw error;
          console.warn(
            `[imessage-spectrum] Failed to send by chat GUID ${request.chatGuid}; retrying by phone:`,
            error,
          );
        }
      }
      const space = await im.space.create(
        await im.user(normalizeInboundImessageSender(request.toPhone!)),
      );
      return {
        ok: true,
        attachmentFailures: await sendToSpace(space, messageText, request),
      };
    });
  } catch (error) {
    console.error(
      "[imessage-spectrum] Failed to send outbound message:",
      error,
    );
    result = {
      ok: false,
      error: "Failed to send message",
      attachmentFailures: [],
    };
  }

  if (clientMessageId) {
    await ctx.runMutation(
      result.ok
        ? internal.imessageTransportClaims.completeSend
        : internal.imessageTransportClaims.releaseSend,
      { role, clientMessageId },
    );
  }
  return result;
}
