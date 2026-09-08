import { imessage } from "@spectrum-ts/imessage";
import { terminal } from "@spectrum-ts/terminal";
import type { ImessageAttachment } from "./convex.js";
import type { InboundAttachmentContent } from "./attachmentPolicy.js";

export function isInboundTransportMessage(
  transport: "terminal" | "imessage",
  message: unknown,
) {
  return transport === "terminal" ? terminal.is(message) : imessage.is(message);
}

type SpectrumAttachmentContent = InboundAttachmentContent & {
  type: "attachment";
  id?: string;
};

type RawAttachmentInfo = {
  guid: string;
  fileName: string;
  mimeType: string;
};

type RawMessage = {
  content: {
    text?: string;
    attachments: readonly RawAttachmentInfo[];
  };
};

type DownloadChunk =
  | { type: "header" }
  | { type: "primaryChunk"; data: Uint8Array }
  | { type: "companionChunk"; data: Uint8Array };

export type InboundRecoveryClient = {
  messages?: { get(guid: string): Promise<RawMessage> };
  attachments?: {
    downloadStream(guid: string): AsyncIterable<DownloadChunk>;
  };
};

type NormalizedInboundTurn = {
  sourceMessageId?: string;
  messageText: string;
  attachments: ImessageAttachment[];
  recoveryFailure?: {
    stage: "raw_message" | "attachment_download";
    sourceMessageId?: string;
    error: string;
  };
};

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function collectSpectrumParts(message: unknown) {
  const texts: string[] = [];
  const attachments: Array<{
    key: string;
    content: SpectrumAttachmentContent;
  }> = [];
  const sourceIds: string[] = [];
  let hasAttachmentPart = false;

  const visit = (value: unknown) => {
    const item = objectRecord(value);
    const content = objectRecord(item?.content);
    if (!item || !content) return;
    if (typeof item.id === "string") sourceIds.push(item.id);
    if (content.type === "text") {
      if (typeof content.text === "string" && content.text.trim()) {
        texts.push(content.text.trim());
      }
      return;
    }
    if (content.type === "attachment") {
      hasAttachmentPart = true;
    }
    if (
      content.type === "attachment" &&
      typeof content.mimeType === "string" &&
      typeof content.read === "function"
    ) {
      const attachmentContent = content as SpectrumAttachmentContent;
      attachments.push({
        key:
          attachmentContent.id ??
          `${attachmentContent.name ?? "attachment"}:${attachmentContent.mimeType}`,
        content: attachmentContent,
      });
      return;
    }
    if (content.type === "group" && Array.isArray(content.items)) {
      for (const child of content.items) visit(child);
    }
  };
  visit(message);
  const rootMessage = objectRecord(message);
  return {
    text: texts.join("\n"),
    attachments,
    hasAttachmentPart,
    sourceMessageId:
      typeof rootMessage?.id === "string" ? rootMessage.id : sourceIds[0],
  };
}

async function readRawAttachment(
  client: InboundRecoveryClient,
  attachment: RawAttachmentInfo,
  readAttachment: (
    content: InboundAttachmentContent,
  ) => Promise<ImessageAttachment>,
) {
  if (!client.attachments?.downloadStream) {
    throw new Error("Photon attachment download is unavailable");
  }
  const chunks: Uint8Array[] = [];
  for await (const chunk of client.attachments.downloadStream(
    attachment.guid,
  )) {
    if (chunk.type === "primaryChunk") chunks.push(chunk.data);
  }
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  if (bytes.length === 0)
    throw new Error("Photon returned an empty attachment");
  return readAttachment({
    name: attachment.fileName,
    mimeType: attachment.mimeType,
    read: async () => bytes,
  });
}

/**
 * Collapses Spectrum text, attachment, and group events into one logical turn.
 * Photon raw-message recovery is authoritative when an attachment event only
 * exposes one bubble from a text-plus-attachment send.
 */
export async function normalizeInboundTurn(args: {
  message: unknown;
  recoverFromPhoton: boolean;
  client?: InboundRecoveryClient;
  readAttachment: (
    content: InboundAttachmentContent,
  ) => Promise<ImessageAttachment>;
}): Promise<NormalizedInboundTurn> {
  const spectrum = collectSpectrumParts(args.message);
  let messageText = spectrum.text;
  let recoveryFailure: NormalizedInboundTurn["recoveryFailure"];
  const normalizedAttachments: ImessageAttachment[] = [];
  const attachmentKeys = new Set<string>();

  if (
    args.recoverFromPhoton &&
    spectrum.hasAttachmentPart &&
    spectrum.sourceMessageId &&
    args.client?.messages?.get
  ) {
    try {
      const rawMessage = await args.client.messages.get(
        spectrum.sourceMessageId,
      );
      messageText = rawMessage.content.text?.trim() || messageText;
      for (const attachment of rawMessage.content.attachments) {
        if (attachmentKeys.has(attachment.guid)) continue;
        try {
          const normalizedAttachment = await readRawAttachment(
            args.client,
            attachment,
            args.readAttachment,
          );
          normalizedAttachments.push(normalizedAttachment);
          attachmentKeys.add(attachment.guid);
          attachmentKeys.add(`${attachment.fileName}:${attachment.mimeType}`);
        } catch (error) {
          recoveryFailure = {
            stage: "attachment_download",
            sourceMessageId: spectrum.sourceMessageId,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
    } catch (error) {
      recoveryFailure = {
        stage: "raw_message",
        sourceMessageId: spectrum.sourceMessageId,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  for (const attachment of spectrum.attachments) {
    const fallbackKey = `${attachment.content.name ?? "attachment"}:${attachment.content.mimeType}`;
    if (attachmentKeys.has(attachment.key) || attachmentKeys.has(fallbackKey)) {
      continue;
    }
    attachmentKeys.add(attachment.key);
    attachmentKeys.add(fallbackKey);
    normalizedAttachments.push(await args.readAttachment(attachment.content));
  }

  return {
    sourceMessageId: spectrum.sourceMessageId,
    messageText: messageText.trim() || "(attachment)",
    attachments: normalizedAttachments,
    recoveryFailure,
  };
}
