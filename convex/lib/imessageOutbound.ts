"use node";

import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import {
  getImessageWorkerUrl,
  isImessageWebhookTransportEnabled,
} from "./imessageConfig";

export type ImessageOutboundAttachment = {
  url: string;
  filename: string;
  mimeType: string;
};

export type ImessageOutboundAppCard = {
  url: string;
  title?: string;
  subtitle?: string;
  summary?: string;
};

type ImessageAttachmentFailure = {
  filename: string;
  error?: string;
};

type ImessageSendResult = {
  ok: boolean;
  attachmentFailures: ImessageAttachmentFailure[];
};

export type StoredThreadAttachment = {
  filename: string;
  contentType: string;
  size: number;
  fileId?: Id<"_storage">;
};

export type ImessageOutboundRoute = {
  toPhone?: string;
  chatGuid?: string;
};

export type ImessageThreadRouteSource = {
  originChannel?: "chat" | "email" | "imessage" | "slack";
  threadPhone?: string;
  imessageChatGuid?: string;
  imessageIsGroup?: boolean;
};

const MAX_MIRRORED_TEXT_LENGTH = 1800;

export function getImessageOutboundRoute(
  thread: ImessageThreadRouteSource | null | undefined,
): ImessageOutboundRoute | null {
  if (!thread || thread.originChannel !== "imessage") return null;
  if (thread.imessageChatGuid) {
    return {
      chatGuid: thread.imessageChatGuid,
      toPhone: thread.imessageIsGroup ? undefined : thread.threadPhone,
    };
  }
  if (thread.threadPhone) return { toPhone: thread.threadPhone };
  return null;
}

export function truncateImessageText(text: string): string {
  const normalized = text.trim();
  if (normalized.length <= MAX_MIRRORED_TEXT_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_MIRRORED_TEXT_LENGTH - 1).trimEnd()}...`;
}

export function formatWebChatUserMirrorText(args: {
  userName?: string;
  content: string;
  hasAttachments: boolean;
}): string {
  const sender = args.userName?.trim() || "A user";
  const body = truncateImessageText(args.content);
  if (body) return `${sender} from Spot web chat: ${body}`;
  return args.hasAttachments
    ? `${sender} shared attachment(s) from Spot web chat.`
    : `${sender} sent a message from Spot web chat.`;
}

export function formatWebChatAgentMirrorText(args: {
  content: string;
  hasAttachments: boolean;
}): string {
  const body = truncateImessageText(args.content);
  if (body) return `Spot replied in web chat: ${body}`;
  return args.hasAttachments
    ? "Spot added attachment(s) in web chat."
    : "Spot replied in web chat.";
}

export async function storedAttachmentsToImessageOutbound(
  ctx: ActionCtx,
  attachments: StoredThreadAttachment[] | undefined,
): Promise<ImessageOutboundAttachment[]> {
  const outbound: ImessageOutboundAttachment[] = [];
  for (const attachment of attachments ?? []) {
    if (!attachment.fileId) continue;
    try {
      const url = await ctx.storage.getUrl(attachment.fileId);
      if (!url) continue;
      outbound.push({
        url,
        filename: attachment.filename,
        mimeType: attachment.contentType || "application/octet-stream",
      });
    } catch (error) {
      console.warn(
        `[imessageOutbound] Failed to resolve attachment ${attachment.filename}:`,
        error,
      );
    }
  }
  return outbound;
}

export async function sendOutboundImessage(
  ctx: ActionCtx,
  params: {
    toPhone?: string;
    chatGuid?: string;
    message: string;
    attachments?: ImessageOutboundAttachment[];
    appCards?: ImessageOutboundAppCard[];
    clientMessageId?: string;
    logPrefix?: string;
  },
): Promise<boolean> {
  return (await sendOutboundImessageWithResult(ctx, params)).ok;
}

async function sendOutboundImessageWithResult(
  ctx: ActionCtx,
  params: {
    toPhone?: string;
    chatGuid?: string;
    message: string;
    attachments?: ImessageOutboundAttachment[];
    appCards?: ImessageOutboundAppCard[];
    clientMessageId?: string;
    logPrefix?: string;
  },
): Promise<ImessageSendResult> {
  const webhookTransport = isImessageWebhookTransportEnabled("customer");
  const workerUrl = getImessageWorkerUrl();
  if (!webhookTransport && !workerUrl) {
    return { ok: false, attachmentFailures: [] };
  }
  if (!params.toPhone && !params.chatGuid) {
    return { ok: false, attachmentFailures: [] };
  }

  const attachments =
    params.attachments?.filter((attachment) => attachment.url) ?? [];
  const appCards = params.appCards?.filter((card) => card.url) ?? [];
  const message =
    params.message.trim() ||
    (appCards.length > 0
      ? "Spot shared a link."
        : attachments.length > 0
          ? "Spot shared attachment(s)."
          : "");
  if (!message) return { ok: false, attachmentFailures: [] };

  if (webhookTransport) {
    const { sendImessageViaSpectrum } = await import("./imessageSpectrum");
    const result = await sendImessageViaSpectrum(ctx, "customer", {
      toPhone: params.toPhone,
      chatGuid: params.chatGuid,
      message,
      clientMessageId: params.clientMessageId,
      attachments,
      appCards,
    });
    const prefix = params.logPrefix ?? "imessageOutbound";
    if (!result.ok) {
      console.warn(`[${prefix}] iMessage send failed: ${result.error}`);
    } else if (result.attachmentFailures.length > 0) {
      console.warn(`[${prefix}] iMessage attachment send failed`, {
        attachmentFailures: result.attachmentFailures,
      });
    }
    return { ok: result.ok, attachmentFailures: result.attachmentFailures };
  }

  try {
    const res = await fetch(`${workerUrl}/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.IMESSAGE_WORKER_SECRET ?? ""}`,
      },
      body: JSON.stringify({
        toPhone: params.toPhone,
        chatGuid: params.chatGuid,
        message,
        clientMessageId: params.clientMessageId,
        attachments: attachments.length > 0 ? attachments : undefined,
        appCards: appCards.length > 0 ? appCards : undefined,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const prefix = params.logPrefix ?? "imessageOutbound";
      console.warn(
        `[${prefix}] iMessage send failed ${res.status}: ${body}`,
      );
      return { ok: false, attachmentFailures: [] };
    }
    const body = await res.json().catch(() => null);
    const attachmentFailures = parseAttachmentFailures(body);
    if (attachmentFailures.length > 0) {
      const prefix = params.logPrefix ?? "imessageOutbound";
      console.warn(`[${prefix}] iMessage attachment send failed`, {
        attachmentFailures,
      });
    }
    return { ok: true, attachmentFailures };
  } catch (error) {
    const prefix = params.logPrefix ?? "imessageOutbound";
    console.warn(
      `[${prefix}] iMessage send failed:`,
      error,
    );
    return { ok: false, attachmentFailures: [] };
  }
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseAttachmentFailures(body: unknown): ImessageAttachmentFailure[] {
  const failures = objectRecord(body)?.attachmentFailures;
  if (!Array.isArray(failures)) return [];
  return failures.flatMap((failure) => {
    const record = objectRecord(failure);
    if (!record) return [];
    const filename = record.filename;
    if (typeof filename !== "string" || !filename.trim()) return [];
    const error = record.error;
    const errorText = typeof error === "string" ? error.trim() : "";
    return [
      errorText
        ? { filename: filename.trim(), error: errorText }
        : { filename: filename.trim() },
    ];
  });
}

export async function sendIdempotentOutboundImessage(
  ctx: ActionCtx,
  params: {
    idempotencyKey: string;
    orgId?: Id<"organizations">;
    threadId?: Id<"threads">;
    threadMessageId?: Id<"threadMessages">;
    toPhone?: string;
    chatGuid?: string;
    message: string;
    attachments?: ImessageOutboundAttachment[];
    appCards?: ImessageOutboundAppCard[];
    logPrefix?: string;
  },
): Promise<boolean> {
  const claim = await ctx.runMutation(internal.imessageOutboundSends.claim, {
    idempotencyKey: params.idempotencyKey,
    orgId: params.orgId,
    threadId: params.threadId,
    threadMessageId: params.threadMessageId,
  });
  if (!claim.claimed) return true;

  const result = await sendOutboundImessageWithResult(ctx, {
    toPhone: params.toPhone,
    chatGuid: params.chatGuid,
    message: params.message,
    attachments: params.attachments,
    appCards: params.appCards,
    clientMessageId: params.idempotencyKey,
    logPrefix: params.logPrefix,
  });

  if (result.ok) {
    await ctx.runMutation(internal.imessageOutboundSends.complete, {
      idempotencyKey: params.idempotencyKey,
    });
    if (params.threadMessageId && result.attachmentFailures.length > 0) {
      await ctx.runMutation(
        internal.threads.recordImessageAttachmentDeliveryFailure,
        {
          threadMessageId: params.threadMessageId,
          stage: "worker_delivery",
          failures: result.attachmentFailures,
        },
      );
    }
  } else {
    await ctx.runMutation(internal.imessageOutboundSends.fail, {
      idempotencyKey: params.idempotencyKey,
      error: "Worker send failed or iMessage worker is not configured.",
    });
  }

  return result.ok;
}
