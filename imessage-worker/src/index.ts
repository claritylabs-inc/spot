import http from "node:http";
import {
  Spectrum,
  app as appCard,
  attachment,
  contact,
  markdown,
  type Message,
  type Space,
  type SpectrumInstance,
} from "spectrum-ts";
import { imessage, nativeContactCard } from "@spectrum-ts/imessage";
import { terminal } from "@spectrum-ts/terminal";
import {
  reportImessageDeliveryEvent,
  sendToConvex,
  isImessageConvexTimeout,
  type ImessageAppCard,
  type ImessageChannelRole,
  type ImessageDeliveryFailure,
  type ImessageResponseAttachment,
} from "./convex.js";
import {
  isE164Phone,
  parseTerminalIdentityCommand,
  terminalIdentityLabel,
} from "./terminalIdentity.js";
import { imessagePlainText } from "./outboundText.js";
import {
  deliverImessageResponse,
  splitImessageResponse,
} from "./responseDelivery.js";
import { readInboundAttachment } from "./voiceAttachment.js";
import {
  normalizeInboundTurn,
  isInboundTransportMessage,
  type InboundRecoveryClient,
} from "./inboundNormalization.js";
import { resolveContactCardPhone } from "./contactCard.js";

function imessageMarkdown(value: string) {
  return markdown(value);
}

type MiniAppLayout = {
  caption?: string;
  subcaption?: string;
  trailingCaption?: string;
  trailingSubcaption?: string;
  image?: Uint8Array;
  imageTitle?: string;
  imageSubtitle?: string;
  summary?: string;
};

type CustomizedMiniAppMessage = {
  appName: string;
  appStoreId?: number;
  extensionBundleId: string;
  layout: MiniAppLayout;
  teamId: string;
  url: string;
};

type AdvancedImessageClient = InboundRecoveryClient & {
  attachments?: {
    upload(input: {
      data: Buffer;
      fileName: string;
    }): Promise<{ attachment: { guid: string } }>;
  };
  chats?: {
    get(chatGuid: string): Promise<{
      displayName?: string;
      isGroup?: boolean;
      participants?: readonly { address: string }[];
    }>;
    create(
      addresses: string[],
      options?: {
        message?: string;
        clientMessageId?: string;
      },
    ): Promise<{
      chat: {
        guid: string;
        displayName?: string;
        isGroup?: boolean;
        participants?: readonly { address: string }[];
      };
    }>;
  };
  groups?: {
    leave(chatGuid: string): Promise<void>;
    setDisplayName(
      chatGuid: string,
      displayName: string,
      options?: {
        clientMessageId?: string;
      },
    ): Promise<unknown>;
  };
  messages?: {
    sendAttachment(
      chatGuid: string,
      attachmentGuid: string,
      options?: Record<string, unknown>,
    ): Promise<unknown>;
    sendCustomizedMiniApp(
      chatGuid: string,
      message: CustomizedMiniAppMessage,
      options?: Record<string, unknown>,
    ): Promise<unknown>;
    sendText(
      chatGuid: string,
      text: string,
      options?: Record<string, unknown>,
    ): Promise<unknown>;
  };
};

type AttachmentDownload =
  | { buffer: Buffer }
  | { failure: ImessageDeliveryFailure };

// ── Config ──────────────────────────────────────────────────────────────────

const CHANNEL_ROLE = (
  process.env.IMESSAGE_CHANNEL_ROLE?.trim() || "customer"
) as ImessageChannelRole;
if (CHANNEL_ROLE !== "customer" && CHANNEL_ROLE !== "operator") {
  console.error("IMESSAGE_CHANNEL_ROLE must be customer or operator");
  process.exit(1);
}
const OPERATOR_CHANNEL = CHANNEL_ROLE === "operator";
const PROJECT_ID = OPERATOR_CHANNEL
  ? process.env.OPERATOR_PHOTON_PROJECT_ID
  : process.env.PHOTON_PROJECT_ID;
const PROJECT_SECRET = OPERATOR_CHANNEL
  ? process.env.OPERATOR_PHOTON_PROJECT_SECRET
  : process.env.PHOTON_PROJECT_SECRET;
const CONVEX_SITE_URL = process.env.CONVEX_SITE_URL;
const WORKER_SECRET = OPERATOR_CHANNEL
  ? (process.env.OPERATOR_IMESSAGE_WORKER_SECRET ?? "")
  : (process.env.IMESSAGE_WORKER_SECRET ?? "");
const SPOT_ENV =
  process.env.SPOT_ENV ?? process.env.RAILWAY_ENVIRONMENT_NAME ?? "local";
const IMESSAGE_ENABLED = OPERATOR_CHANNEL
  ? process.env.OPERATOR_IMESSAGE_ENABLED === "true"
  : process.env.IMESSAGE_ENABLED === "true";
const SPECTRUM_PROVIDER = process.env.SPECTRUM_PROVIDER;
const USE_TERMINAL =
  SPECTRUM_PROVIDER === "terminal" ||
  (!IMESSAGE_ENABLED && SPECTRUM_PROVIDER !== "imessage");
const TRANSPORT = USE_TERMINAL ? "terminal" : "imessage";
const TERMINAL_FROM_PHONE =
  (OPERATOR_CHANNEL
    ? process.env.OPERATOR_IMESSAGE_TERMINAL_FROM_PHONE
    : process.env.IMESSAGE_TERMINAL_FROM_PHONE) ??
  process.env.DEV_IMESSAGE_FROM_PHONE ??
  "";
const TERMINAL_SPACE_ID =
  (OPERATOR_CHANNEL
    ? process.env.OPERATOR_IMESSAGE_TERMINAL_SPACE_ID
    : process.env.IMESSAGE_TERMINAL_SPACE_ID) ?? "chat-1";
const TERMINAL_IDENTITIES = {
  broker: process.env.IMESSAGE_TERMINAL_BROKER_PHONE ?? TERMINAL_FROM_PHONE,
  client: process.env.IMESSAGE_TERMINAL_CLIENT_PHONE ?? "+12025550102",
  public: process.env.IMESSAGE_TERMINAL_PUBLIC_PHONE ?? "+12025550199",
};
const SEND_IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const TYPING_REFRESH_MS = 4_000;
const CONTACT_CARD_NAME = "Spot";
const CONTACT_CARD_EMAIL =
  process.env.SPOT_AGENT_EMAIL ?? "agent@spot.insure";
const CONTACT_CARD_PHONE = resolveContactCardPhone();
const CONTACT_CARD_URL = "https://spot.insure";
const CONTACT_CARD_NOTE =
  "Spot is an insurance intelligence assistant from Tools for Enlightenment for policies, certificates, renewals, and broker follow-ups.";
const SPECTRUM_MINI_APP = {
  appName: "Spectrum",
  extensionBundleId: "codes.photon.Spectrum.MessagesExtension",
  teamId: "P8XT6232SL",
  appStoreId: 6777616651,
} satisfies Omit<CustomizedMiniAppMessage, "layout" | "url">;
const sendIdempotencyKeys = new Map<
  string,
  { status: "sending" | "sent"; expiresAt: number }
>();

if (TRANSPORT === "imessage" && !IMESSAGE_ENABLED) {
  console.error(
    `${OPERATOR_CHANNEL ? "OPERATOR_IMESSAGE_ENABLED" : "IMESSAGE_ENABLED"} must be true before connecting to Photon iMessage`,
  );
  process.exit(1);
}
if (TRANSPORT === "imessage" && (!PROJECT_ID || !PROJECT_SECRET)) {
  console.error(
    OPERATOR_CHANNEL
      ? "OPERATOR_PHOTON_PROJECT_ID and OPERATOR_PHOTON_PROJECT_SECRET are required"
      : "PHOTON_PROJECT_ID and PHOTON_PROJECT_SECRET are required",
  );
  process.exit(1);
}
if (!CONVEX_SITE_URL) {
  console.error("CONVEX_SITE_URL is required");
  process.exit(1);
}
if (!WORKER_SECRET) {
  console.error(
    OPERATOR_CHANNEL
      ? "OPERATOR_IMESSAGE_WORKER_SECRET is required"
      : "IMESSAGE_WORKER_SECRET is required",
  );
  process.exit(1);
}
if (TRANSPORT === "terminal" && !TERMINAL_FROM_PHONE) {
  console.error(
    `${OPERATOR_CHANNEL ? "OPERATOR_IMESSAGE_TERMINAL_FROM_PHONE" : "IMESSAGE_TERMINAL_FROM_PHONE"} is required for terminal mode so Convex can route to a Spot user`,
  );
  process.exit(1);
}
if (
  TRANSPORT === "terminal" &&
  (OPERATOR_CHANNEL
    ? !isE164Phone(TERMINAL_FROM_PHONE)
    : Object.values(TERMINAL_IDENTITIES).some((phone) => !isE164Phone(phone)))
) {
  console.error(
    "Spectrum terminal identities must use valid E.164 phone numbers",
  );
  process.exit(1);
}

function imessageProcessingFallbackMessage(err: unknown): string {
  if (isImessageConvexTimeout(err)) {
    return "I'm still working on that. If I don't follow up here, check Spot for the draft.";
  }
  return "Sorry, something went wrong. Please try again.";
}

function pruneSendIdempotencyKeys() {
  const now = Date.now();
  for (const [key, value] of sendIdempotencyKeys.entries()) {
    if (value.expiresAt <= now) {
      sendIdempotencyKeys.delete(key);
    }
  }
}

function claimSendIdempotencyKey(clientMessageId?: string) {
  if (!clientMessageId) return true;
  pruneSendIdempotencyKeys();
  if (sendIdempotencyKeys.has(clientMessageId)) return false;
  sendIdempotencyKeys.set(clientMessageId, {
    status: "sending",
    expiresAt: Date.now() + SEND_IDEMPOTENCY_TTL_MS,
  });
  return true;
}

function completeSendIdempotencyKey(clientMessageId?: string) {
  if (!clientMessageId) return;
  sendIdempotencyKeys.set(clientMessageId, {
    status: "sent",
    expiresAt: Date.now() + SEND_IDEMPOTENCY_TTL_MS,
  });
}

function releaseSendIdempotencyKey(clientMessageId?: string) {
  if (!clientMessageId) return;
  const existing = sendIdempotencyKeys.get(clientMessageId);
  if (existing?.status === "sending") {
    sendIdempotencyKeys.delete(clientMessageId);
  }
}

function parseHttpPort(configuredPort: string): number {
  const port = Number(configuredPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error(`Invalid HTTP port: ${configuredPort}`);
    process.exit(1);
  }
  return port;
}

function getHttpPorts(): number[] {
  const primaryPort = parseHttpPort(
    process.env.PORT ?? process.env.WORKER_HTTP_PORT ?? "3001",
  );
  if (!process.env.RAILWAY_ENVIRONMENT) return [primaryPort];

  const publicDomainPort = parseHttpPort(
    process.env.WORKER_HTTP_PORT ?? "3001",
  );
  return [...new Set([primaryPort, publicDomainPort])];
}

function readStringField(
  value: unknown,
  fieldNames: string[],
): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const fieldName of fieldNames) {
    const field = record[fieldName];
    if (typeof field === "string" && field.trim().length > 0) {
      return field;
    }
    if (typeof field === "number" && Number.isFinite(field)) {
      return String(field);
    }
  }
  return undefined;
}

function readTimestamp(
  value: unknown,
  fieldNames: string[],
): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const fieldName of fieldNames) {
    const field = record[fieldName];
    if (typeof field === "number" && Number.isFinite(field)) {
      return field < 10_000_000_000 ? field * 1000 : field;
    }
    if (typeof field === "string") {
      const parsed = Date.parse(field);
      if (Number.isFinite(parsed)) return parsed;
    }
    if (field instanceof Date) {
      return field.getTime();
    }
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function allAttachmentsFailed(
  attachments: ImessageResponseAttachment[] | undefined,
  error: string,
): ImessageDeliveryFailure[] {
  return (attachments ?? []).map((att) => ({
    filename: att.filename,
    error,
  }));
}

function withAttachmentFailures<T extends Record<string, unknown>>(
  body: T,
  failures: ImessageDeliveryFailure[],
): T & { attachmentFailures?: ImessageDeliveryFailure[] } {
  return failures.length > 0 ? { ...body, attachmentFailures: failures } : body;
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: Record<string, unknown>,
  attachmentFailures: ImessageDeliveryFailure[] = [],
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(withAttachmentFailures(body, attachmentFailures)));
}

function completeSendWithJson(
  res: http.ServerResponse,
  clientMessageId: string | undefined,
  body: Record<string, unknown>,
  attachmentFailures: ImessageDeliveryFailure[] = [],
): void {
  sendJson(res, 200, body, attachmentFailures);
  completeSendIdempotencyKey(clientMessageId);
}

async function downloadOutboundAttachment(
  att: ImessageResponseAttachment,
): Promise<AttachmentDownload> {
  try {
    const res = await fetch(att.url);
    if (!res.ok) {
      console.warn(
        `[spot-imessage] Failed to download attachment ${att.filename}: ${res.status}`,
      );
      return {
        failure: {
          filename: att.filename,
          error: `Download failed with status ${res.status}`,
        },
      };
    }
    return { buffer: Buffer.from(await res.arrayBuffer()) };
  } catch (err) {
    console.warn(
      `[spot-imessage] Failed to download attachment ${att.filename}:`,
      err,
    );
    return {
      failure: {
        filename: att.filename,
        error: errorMessage(err),
      },
    };
  }
}

async function sendOutboundAttachments(
  space: Space,
  attachments?: ImessageResponseAttachment[],
): Promise<ImessageDeliveryFailure[]> {
  const failures: ImessageDeliveryFailure[] = [];
  for (const att of attachments ?? []) {
    const download = await downloadOutboundAttachment(att);
    if ("failure" in download) {
      failures.push(download.failure);
      continue;
    }

    try {
      await space.send(
        attachment(download.buffer, {
          name: att.filename,
          mimeType: att.mimeType,
        }),
      );
    } catch (err) {
      console.warn(
        `[spot-imessage] Failed to send attachment ${att.filename}:`,
        err,
      );
      failures.push({
        filename: att.filename,
        error: errorMessage(err),
      });
    }
  }
  return failures;
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

function fallbackMiniAppLayout(card: ImessageAppCard): MiniAppLayout {
  const caption = card.title?.trim() || "Spot";
  const subcaption = card.subtitle?.trim() || undefined;
  return {
    caption,
    subcaption,
    summary: card.summary?.trim() || caption,
  };
}

async function buildSpectrumMiniApp(
  card: ImessageAppCard,
): Promise<CustomizedMiniAppMessage> {
  try {
    const content = await appCard(card.url).build();
    if (content.type === "app") {
      return {
        ...SPECTRUM_MINI_APP,
        url: await content.url(),
        layout: await content.layout(),
      };
    }
  } catch (err) {
    console.warn(
      `[spot-imessage] Failed to build app card layout ${card.url}:`,
      err,
    );
  }
  return {
    ...SPECTRUM_MINI_APP,
    url: card.url,
    layout: fallbackMiniAppLayout(card),
  };
}

async function sendResponseText(
  space: Space,
  message: Message,
  responseText: string,
) {
  const segments = splitImessageResponse(responseText);
  const delivery = await deliverImessageResponse({
    segments,
    replyAll: async (replySegments) => {
      const contents = replySegments.map(imessageMarkdown);
      if (contents.length === 0) return 0;
      if (contents.length === 1) {
        return (await message.reply(contents[0])) ? 1 : 0;
      }
      const replies = await message.reply(
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
    console.warn("[spot-imessage] Threaded response delivery was incomplete", {
      deliveredSegments: delivery.deliveredSegments,
      expectedSegments: delivery.expectedSegments,
      error: delivery.error,
    });
  }
}

async function sendSpotContactCard(space: Space): Promise<void> {
  if (TRANSPORT === "imessage") {
    try {
      await space.send(nativeContactCard());
      return;
    } catch (err) {
      console.warn(
        "[spot-imessage] Native contact card send failed; falling back to vCard:",
        err,
      );
    }
  }

  const phones = CONTACT_CARD_PHONE
    ? [{ value: CONTACT_CARD_PHONE, type: "mobile" as const }]
    : undefined;
  await space.send(
    contact({
      name: { formatted: CONTACT_CARD_NAME },
      org: {
        name: "Tools for Enlightenment",
        title: "Insurance intelligence assistant",
      },
      phones,
      emails: [{ value: CONTACT_CARD_EMAIL, type: "work" }],
      urls: [CONTACT_CARD_URL],
      note: CONTACT_CARD_NOTE,
    }),
  );
}

async function withTypingIndicator<T>(
  space: Space,
  fn: () => Promise<T>,
): Promise<T> {
  let stopped = false;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let activeRefresh: Promise<void> | undefined;

  const refresh = async (): Promise<void> => {
    if (stopped) return;
    try {
      await Promise.resolve(space.startTyping());
    } catch (err) {
      console.warn("[spot-imessage] Failed to refresh typing indicator:", err);
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
    await Promise.resolve(space.stopTyping()).catch((err) => {
      console.warn("[spot-imessage] Failed to stop typing indicator:", err);
    });
  }
}

async function sendOutboundAppCards(
  space: Space,
  appCards?: ImessageAppCard[],
) {
  for (const card of appCards ?? []) {
    if (!card.url) continue;
    const content = appCard(card.url);
    try {
      await space.send(content);
    } catch (err) {
      console.warn(
        `[spot-imessage] Failed to send app card ${card.url}:`,
        err,
      );
      await space.send(imessageMarkdown(appCardFallbackText(card)));
    }
  }
}

async function sendAttachmentsThroughClient(
  client: AdvancedImessageClient,
  chatGuid: string,
  attachments?: ImessageResponseAttachment[],
  clientMessageId?: string,
): Promise<ImessageDeliveryFailure[]> {
  const failures: ImessageDeliveryFailure[] = [];
  if (!attachments?.length) return failures;
  if (!client.attachments?.upload || !client.messages?.sendAttachment) {
    console.warn(
      "[spot-imessage] Attachment send by chat GUID is not available",
    );
    return allAttachmentsFailed(
      attachments,
      "Attachment send by chat GUID is not available",
    );
  }

  for (const [index, att] of attachments.entries()) {
    const download = await downloadOutboundAttachment(att);
    if ("failure" in download) {
      failures.push(download.failure);
      continue;
    }

    try {
      const uploaded = await client.attachments.upload({
        data: download.buffer,
        fileName: att.filename,
      });
      await client.messages.sendAttachment(chatGuid, uploaded.attachment.guid, {
        clientMessageId: clientMessageId
          ? `${clientMessageId}:attachment:${index}`
          : undefined,
      });
    } catch (err) {
      console.warn(
        `[spot-imessage] Failed to send attachment ${att.filename}:`,
        err,
      );
      failures.push({
        filename: att.filename,
        error: errorMessage(err),
      });
    }
  }
  return failures;
}

async function sendAppCardsThroughClient(
  client: AdvancedImessageClient,
  chatGuid: string,
  appCards?: ImessageAppCard[],
  clientMessageId?: string,
) {
  if (!appCards?.length) return;
  if (!client.messages?.sendCustomizedMiniApp) {
    console.warn(
      "[spot-imessage] Mini app send by chat GUID is not available",
    );
    if (!client.messages?.sendText) return;
    for (const [index, card] of appCards.entries()) {
      if (!card.url) continue;
      await client.messages.sendText(
        chatGuid,
        imessagePlainText(appCardFallbackText(card)),
        {
          clientMessageId: clientMessageId
            ? `${clientMessageId}:app-card:${index}`
            : undefined,
        },
      );
    }
    return;
  }

  for (const [index, card] of appCards.entries()) {
    if (!card.url) continue;
    try {
      await client.messages.sendCustomizedMiniApp(
        chatGuid,
        await buildSpectrumMiniApp(card),
        {
          clientMessageId: clientMessageId
            ? `${clientMessageId}:app-card:${index}`
            : undefined,
        },
      );
    } catch (err) {
      console.warn(
        `[spot-imessage] Failed to send mini app card ${card.url}:`,
        err,
      );
      if (!client.messages.sendText) continue;
      await client.messages.sendText(
        chatGuid,
        imessagePlainText(appCardFallbackText(card)),
        {
          clientMessageId: clientMessageId
            ? `${clientMessageId}:app-card-fallback:${index}`
            : undefined,
        },
      );
    }
  }
}

async function sendByChatGuid(params: {
  app: SpectrumInstance;
  chatGuid: string;
  message: string;
  attachments?: ImessageResponseAttachment[];
  appCards?: ImessageAppCard[];
  clientMessageId?: string;
}): Promise<{
  sent: boolean;
  attachmentFailures: ImessageDeliveryFailure[];
}> {
  if (TRANSPORT !== "imessage") {
    return { sent: false, attachmentFailures: [] };
  }
  const client = getAdvancedImessageClient(params.app);
  if (!client?.messages?.sendText) {
    return { sent: false, attachmentFailures: [] };
  }

  try {
    await client.messages.sendText(
      params.chatGuid,
      imessagePlainText(params.message),
      {
        clientMessageId: params.clientMessageId,
      },
    );
    await sendAppCardsThroughClient(
      client,
      params.chatGuid,
      params.appCards,
      params.clientMessageId,
    );
    const attachmentFailures = await sendAttachmentsThroughClient(
      client,
      params.chatGuid,
      params.attachments,
      params.clientMessageId,
    );
    return { sent: true, attachmentFailures };
  } catch (err) {
    console.warn(
      `[spot-imessage] Failed to send by chat GUID ${params.chatGuid}:`,
      err,
    );
    return { sent: false, attachmentFailures: [] };
  }
}

function normalizePhone(raw: string): string {
  if (raw.includes("@")) return raw.trim().toLowerCase();
  const cleaned = raw.replace(/[^+\d]/g, "");
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}

function deterministicTerminalGroupGuid(participants: string[]): string {
  const key = participants.map(normalizePhone).sort().join(",");
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  return `terminal-group-${Math.abs(hash)}`;
}

function getAdvancedImessageClient(
  app: SpectrumInstance,
  space?: Space,
): AdvancedImessageClient | undefined {
  const runtime = app.__internal.platforms.get("iMessage");
  const client = runtime?.client;
  if (!client) return undefined;
  if (Array.isArray(client)) {
    const phone = readStringField(space, ["phone"]);
    const entry =
      client.find((candidate: unknown) => {
        const record = candidate as Record<string, unknown>;
        return typeof record.phone === "string" && record.phone === phone;
      }) ?? client[0];
    const record = entry as Record<string, unknown> | undefined;
    return record?.client as AdvancedImessageClient | undefined;
  }
  return client as AdvancedImessageClient;
}

async function getChatSnapshot(app: SpectrumInstance, space: Space) {
  const chatGuid = readStringField(space, ["id"]);
  if (!chatGuid || TRANSPORT !== "imessage") {
    return {
      chatGuid,
      isGroup: readStringField(space, ["type"]) === "group",
      participants: [] as Array<{ address: string }>,
      participantsUnavailable: false,
    };
  }

  const fallbackIsGroup = readStringField(space, ["type"]) === "group";
  try {
    const client = getAdvancedImessageClient(app, space);
    const chat = await client?.chats?.get(chatGuid);
    if (!chat) {
      return {
        chatGuid,
        isGroup: fallbackIsGroup,
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
  } catch (err) {
    console.warn(
      `[spot-imessage] Failed to fetch chat snapshot for ${chatGuid}:`,
      err,
    );
    return {
      chatGuid,
      isGroup: fallbackIsGroup,
      participants: [] as Array<{ address: string }>,
      participantsUnavailable: fallbackIsGroup,
    };
  }
}

async function startSpectrum(): Promise<SpectrumInstance> {
  if (TRANSPORT === "terminal") {
    return await Spectrum({
      providers: [
        terminal.config({
          commands: [
            { name: "/whoami", description: "Show the configured test phone" },
            ...(OPERATOR_CHANNEL
              ? []
              : [
                  {
                    name: "/as",
                    description:
                      "Switch sender: /as broker, /as client, or /as public",
                  },
                ]),
          ],
        }),
      ],
    });
  }

  return await Spectrum({
    projectId: PROJECT_ID!,
    projectSecret: PROJECT_SECRET!,
    providers: [imessage.config()],
  });
}

// ── Start ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `[spot-imessage] Connecting to Spectrum ${TRANSPORT} provider...`,
  );

  const app = await startSpectrum();
  let terminalFromPhone = TERMINAL_FROM_PHONE;
  const activeSpacesByPhone = new Map<string, Space>();
  const activeSpacesByChatGuid = new Map<string, Space>();

  console.log("[spot-imessage] Connected. Waiting for messages...");

  // ── Outbound HTTP server ──────────────────────────────────────────────────
  // POST /send { toPhone, message } — sends proactive text via the active
  // Spectrum provider. For an active inbound exchange, this reuses the same
  // space so follow-up messages stay in the same iMessage conversation as
  // final responses and attachments. Otherwise it falls back to a proactive send.
  // Protected by the same IMESSAGE_WORKER_SECRET used for inbound verification.
  const httpPorts = getHttpPorts();
  const handleHttpRequest = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ) => {
    const requestUrl = new URL(
      req.url ?? "/",
      `http://${req.headers.host ?? "localhost"}`,
    );

    if (req.method === "GET" && requestUrl.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        service: "spot-imessage-worker",
        channelRole: CHANNEL_ROLE,
        spotEnv: SPOT_ENV,
        transport: TRANSPORT,
        imessageEnabled: IMESSAGE_ENABLED,
        convexSiteConfigured: Boolean(CONVEX_SITE_URL),
        workerSecretConfigured: Boolean(WORKER_SECRET),
        photonConfigured: Boolean(PROJECT_ID && PROJECT_SECRET),
        railwayEnvironment: process.env.RAILWAY_ENVIRONMENT_NAME,
        gitSha: process.env.RAILWAY_GIT_COMMIT_SHA,
        gitBranch: process.env.RAILWAY_GIT_BRANCH,
        httpPorts,
      });
      return;
    }

    if (req.method !== "POST" || requestUrl.pathname !== "/send") {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    const authHeader = req.headers["authorization"] ?? "";
    if (WORKER_SECRET && authHeader !== `Bearer ${WORKER_SECRET}`) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }

    const body = await new Promise<string>((resolve, reject) => {
      let data = "";
      req.on("data", (chunk: Buffer | string) => {
        data += chunk.toString();
      });
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });

    let payload: {
      toPhone?: string;
      chatGuid?: string;
      participants?: string[];
      message?: string;
      title?: string;
      clientMessageId?: string;
      attachments?: ImessageResponseAttachment[];
      appCards?: ImessageAppCard[];
    };
    try {
      payload = JSON.parse(body);
    } catch {
      sendJson(res, 400, { error: "Invalid JSON" });
      return;
    }

    const messageText =
      payload.message?.trim() ||
      (payload.appCards?.length
        ? "Spot shared a link."
        : payload.attachments?.length
          ? "Spot shared attachment(s)."
          : "");
    if (
      (!payload.toPhone &&
        !payload.chatGuid &&
        !payload.participants?.length) ||
      !messageText
    ) {
      sendJson(res, 400, {
        error:
          "toPhone, chatGuid, or participants and message/appCards/attachments are required",
      });
      return;
    }

    if (!claimSendIdempotencyKey(payload.clientMessageId)) {
      sendJson(res, 200, { ok: true, duplicate: true });
      return;
    }

    try {
      if (payload.participants?.length) {
        const participants = [
          ...new Set(payload.participants.map(normalizePhone).filter(Boolean)),
        ];
        if (participants.length < 2) {
          releaseSendIdempotencyKey(payload.clientMessageId);
          sendJson(res, 400, {
            error: "At least two participants are required for a group chat",
          });
          return;
        }

        if (TRANSPORT === "terminal" && !OPERATOR_CHANNEL) {
          const terminalClient = terminal(app);
          const space = await terminalClient.space.get(TERMINAL_SPACE_ID);
          await space.send(
            imessageMarkdown(
              `[new group: ${participants.join(", ")}] ${messageText}`,
            ),
          );
          await sendOutboundAppCards(space, payload.appCards);
          const attachmentFailures = await sendOutboundAttachments(
            space,
            payload.attachments,
          );
          const chatGuid = deterministicTerminalGroupGuid(participants);
          completeSendWithJson(
            res,
            payload.clientMessageId,
            {
              ok: true,
              chatGuid,
              isGroup: true,
              participants: participants.map((address) => ({ address })),
            },
            attachmentFailures,
          );
          return;
        }

        const imessageClient = getAdvancedImessageClient(app);
        if (!imessageClient?.chats?.create) {
          releaseSendIdempotencyKey(payload.clientMessageId);
          sendJson(res, 501, {
            error: "iMessage group creation is not available",
          });
          return;
        }

        const created = await imessageClient.chats.create(participants, {
          message: imessagePlainText(messageText),
          clientMessageId: payload.clientMessageId,
        });
        if (payload.appCards?.length) {
          console.warn(
            "[spot-imessage] App cards are not available during new group creation",
          );
        }
        if (payload.attachments?.length) {
          console.warn(
            "[spot-imessage] Attachment send is not available during new group creation",
          );
        }
        const attachmentFailures = allAttachmentsFailed(
          payload.attachments,
          "Attachment send is not available during new group creation",
        );
        const chatGuid = created.chat.guid;
        if (payload.title?.trim() && imessageClient.groups?.setDisplayName) {
          await imessageClient.groups.setDisplayName(
            chatGuid,
            payload.title.trim(),
            {
              clientMessageId: payload.clientMessageId
                ? `${payload.clientMessageId}:title`
                : undefined,
            },
          );
        }
        const returnedParticipants = created.chat.participants?.length
          ? created.chat.participants.map((participant) => ({
              address: normalizePhone(participant.address),
            }))
          : participants.map((address) => ({ address }));
        completeSendWithJson(
          res,
          payload.clientMessageId,
          {
            ok: true,
            chatGuid,
            isGroup: true,
            participants: returnedParticipants,
          },
          attachmentFailures,
        );
        return;
      }

      const activeChatSpace = payload.chatGuid
        ? activeSpacesByChatGuid.get(payload.chatGuid)
        : undefined;
      if (activeChatSpace) {
        await activeChatSpace.send(imessageMarkdown(messageText));
        await sendOutboundAppCards(activeChatSpace, payload.appCards);
        const attachmentFailures = await sendOutboundAttachments(
          activeChatSpace,
          payload.attachments,
        );
        completeSendWithJson(
          res,
          payload.clientMessageId,
          { ok: true },
          attachmentFailures,
        );
        return;
      }

      if (payload.chatGuid) {
        const sentByChatGuid = await sendByChatGuid({
          app,
          chatGuid: payload.chatGuid,
          message: messageText,
          attachments: payload.attachments,
          appCards: payload.appCards,
          clientMessageId: payload.clientMessageId,
        });
        if (sentByChatGuid.sent) {
          completeSendWithJson(
            res,
            payload.clientMessageId,
            { ok: true },
            sentByChatGuid.attachmentFailures,
          );
          return;
        }
      }

      if (!payload.toPhone) {
        releaseSendIdempotencyKey(payload.clientMessageId);
        sendJson(res, 404, { error: "No active chat space" });
        return;
      }

      const toPhone = normalizePhone(payload.toPhone);
      const activeSpace = activeSpacesByPhone.get(toPhone);
      if (activeSpace) {
        await activeSpace.send(imessageMarkdown(messageText));
        await sendOutboundAppCards(activeSpace, payload.appCards);
        const attachmentFailures = await sendOutboundAttachments(
          activeSpace,
          payload.attachments,
        );
        completeSendWithJson(
          res,
          payload.clientMessageId,
          { ok: true },
          attachmentFailures,
        );
        return;
      }

      if (TRANSPORT === "terminal") {
        const terminalClient = terminal(app);
        const space = await terminalClient.space.get(TERMINAL_SPACE_ID);
        await space.send(imessageMarkdown(messageText));
        await sendOutboundAppCards(space, payload.appCards);
        const attachmentFailures = await sendOutboundAttachments(
          space,
          payload.attachments,
        );
        completeSendWithJson(
          res,
          payload.clientMessageId,
          { ok: true },
          attachmentFailures,
        );
        return;
      }

      const imessageClient = imessage(app);
      const user = await imessageClient.user(payload.toPhone);
      const space = await imessageClient.space.create(user);
      await space.send(imessageMarkdown(messageText));
      await sendOutboundAppCards(space, payload.appCards);
      const attachmentFailures = await sendOutboundAttachments(
        space,
        payload.attachments,
      );
      completeSendWithJson(
        res,
        payload.clientMessageId,
        { ok: true },
        attachmentFailures,
      );
    } catch (err) {
      releaseSendIdempotencyKey(payload.clientMessageId);
      console.error("[spot-imessage] Failed to send outbound message:", err);
      sendJson(res, 500, { error: "Failed to send message" });
    }
  };

  const httpServers = httpPorts.map((port) => ({
    port,
    server: http.createServer(handleHttpRequest),
  }));
  for (const { port, server } of httpServers) {
    server.listen(port, () => {
      console.log(
        `[spot-imessage] Outbound HTTP server listening on port ${port}`,
      );
    });
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log("[spot-imessage] Shutting down...");
    for (const { server } of httpServers) {
      server.close();
    }
    await app.stop();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  for await (const [space, message] of app.messages) {
    if (!isInboundTransportMessage(TRANSPORT, message)) continue;

    const rawSenderId = message.sender?.id;
    if (!rawSenderId) {
      console.warn("[spot-imessage] Ignoring inbound message without sender");
      continue;
    }
    const senderId =
      TRANSPORT === "terminal" ? terminalFromPhone || rawSenderId : rawSenderId;
    const fromPhone = normalizePhone(senderId);
    activeSpacesByPhone.set(fromPhone, space);
    const chatSnapshot = await getChatSnapshot(app, space);
    console.log("[spot-imessage] Received inbound message", {
      fromPhone,
      chatGuid: chatSnapshot.chatGuid,
      isGroup: chatSnapshot.isGroup,
      platform: message.platform,
      contentType: message.content.type,
    });
    if (chatSnapshot.chatGuid) {
      activeSpacesByChatGuid.set(chatSnapshot.chatGuid, space);
    }
    const sourceMessageId = readStringField(message, [
      "id",
      "messageId",
      "guid",
      "externalId",
      "eventId",
    ]);
    const receivedAt =
      readTimestamp(message, [
        "timestamp",
        "createdAt",
        "sentAt",
        "receivedAt",
        "date",
      ]) ?? Date.now();

    // Ignore events that cannot contribute to one logical user turn.
    if (
      message.content.type !== "text" &&
      message.content.type !== "attachment" &&
      message.content.type !== "group"
    ) {
      continue;
    }

    // Process asynchronously so the typing indicator runs while we wait
    void (async () => {
      try {
        const normalizedTurn = await normalizeInboundTurn({
          message,
          recoverFromPhoton: TRANSPORT === "imessage",
          client: getAdvancedImessageClient(app, space),
          readAttachment: readInboundAttachment,
        });
        const messageText = normalizedTurn.messageText;
        const logicalSourceMessageId =
          normalizedTurn.sourceMessageId ?? sourceMessageId;
        if (normalizedTurn.recoveryFailure) {
          console.warn("[spot-imessage] Inbound recovery degraded", {
            sourceMessageId: logicalSourceMessageId,
            stage: normalizedTurn.recoveryFailure.stage,
            error: normalizedTurn.recoveryFailure.error,
            fallbackAttachmentCount: normalizedTurn.attachments.length,
          });
        }
        console.log("[spot-imessage] Inbound turn normalized", {
          sourceMessageId: logicalSourceMessageId,
          hasText: messageText !== "(attachment)",
          attachmentCount: normalizedTurn.attachments.length,
          recoveryFailed: Boolean(normalizedTurn.recoveryFailure),
        });
        if (TRANSPORT === "terminal") {
          const identityCommand = parseTerminalIdentityCommand(
            messageText,
            TERMINAL_IDENTITIES,
          );
          if (identityCommand?.kind === "whoami") {
            const label = terminalIdentityLabel(
              terminalFromPhone,
              TERMINAL_IDENTITIES,
            );
            await space.send(
              `Terminal identity: ${label} (${terminalFromPhone})`,
            );
            return;
          }
          if (identityCommand?.kind === "error") {
            await space.send(identityCommand.message);
            return;
          }
          if (identityCommand?.kind === "switch") {
            terminalFromPhone = identityCommand.phone;
            await space.send(
              `Switched terminal identity to ${identityCommand.label} (${identityCommand.phone}). Your next message will use this sender.`,
            );
            return;
          }
        }

        const result = await withTypingIndicator(space, async () => {
          return await sendToConvex(CONVEX_SITE_URL!, WORKER_SECRET, CHANNEL_ROLE, {
            fromPhone,
            messageText,
            chatGuid: chatSnapshot.chatGuid,
            isGroup: chatSnapshot.isGroup,
            chatTitle: chatSnapshot.chatTitle,
            participantsUnavailable: chatSnapshot.participantsUnavailable,
            participants: [
              ...chatSnapshot.participants,
              ...(chatSnapshot.participants.some(
                (p) => normalizePhone(p.address) === fromPhone,
              )
                ? []
                : [{ address: fromPhone }]),
            ],
            sourceMessageId: logicalSourceMessageId,
            receivedAt,
            recoveryFailure: normalizedTurn.recoveryFailure
              ? {
                  stage: normalizedTurn.recoveryFailure.stage,
                  error: normalizedTurn.recoveryFailure.error,
                }
              : undefined,
            attachments:
              normalizedTurn.attachments.length > 0
                ? normalizedTurn.attachments
                : undefined,
          });
        });

        // Send the text response after the typing indicator is fully stopped.
        if (result.response) {
          await sendResponseText(space, message, result.response);
        }

        if (CHANNEL_ROLE === "customer" && result.sendContactCard) {
          try {
            await sendSpotContactCard(space);
          } catch (err) {
            console.warn(
              "[spot-imessage] Contact card delivery failed; continuing with response:",
              err,
            );
          }
        }

        await sendOutboundAppCards(space, result.appCards);

        // Send any file attachments (e.g. COI PDFs)
        const attachmentFailures = await sendOutboundAttachments(
          space,
          result.attachments,
        );
        if (
          attachmentFailures.length > 0 &&
          result.threadMessageId &&
          CONVEX_SITE_URL
        ) {
          await reportImessageDeliveryEvent(
            CONVEX_SITE_URL,
            WORKER_SECRET,
            CHANNEL_ROLE,
            {
              threadMessageId: result.threadMessageId,
              attachmentFailures,
            },
          );
        }

        if (result.leaveGroup && result.chatGuid && TRANSPORT === "imessage") {
          try {
            const client = getAdvancedImessageClient(app, space);
            await client?.groups?.leave(result.chatGuid);
            activeSpacesByChatGuid.delete(result.chatGuid);
          } catch (err) {
            console.warn(
              `[spot-imessage] Failed to leave group ${result.chatGuid}:`,
              err,
            );
          }
        }
      } catch (err) {
        console.error("[spot-imessage] Error processing message:", err);
        // Attempt to send a fallback message
        try {
          await space.send(imessageProcessingFallbackMessage(err));
        } catch {
          // Ignore secondary errors
        }
      }
    })();
  }
}

main().catch((err) => {
  console.error("[spot-imessage] Fatal error:", err);
  process.exit(1);
});
