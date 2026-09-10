"use node";

import { createHash } from "node:crypto";
import dayjs from "dayjs";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  MAX_AGENT_ATTACHMENT_AGGREGATE_BYTES,
  MAX_AGENT_ATTACHMENT_BYTES,
  MAX_AGENT_ATTACHMENT_FILES,
  normalizeAgentAttachmentFilename,
} from "./agentAttachmentLimits";
import { normalizeImessageAddress } from "./imessageGroupResolution";

export type RawImessageParticipant = {
  address: string;
  displayName?: string;
};

export type RawImessageAttachment = {
  data: string;
  mimeType: string;
  name: string;
};

export type StoredImessageAttachmentRecord = {
  filename: string;
  contentType: string;
  size: number;
  fileId?: Id<"_storage">;
  buffer?: Buffer;
};

const SUPPORTED_IMESSAGE_ATTACHMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/json",
  "application/xml",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/tab-separated-values",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "audio/mp4",
  "audio/mp4a-latm",
  "audio/x-m4a",
  "audio/aac",
  "audio/aacp",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
]);

export const MAX_IMESSAGE_AUDIO_BYTES = 12 * 1024 * 1024;

export function normalizeImessageAttachmentMimeType(mimeType: string): string {
  return mimeType.toLowerCase().split(";", 1)[0]?.trim() || "";
}

export function resolveImessageAttachmentMimeType(
  attachment: Pick<RawImessageAttachment, "mimeType" | "name">,
): string {
  const normalized = normalizeImessageAttachmentMimeType(attachment.mimeType);
  if (normalized && normalized !== "application/octet-stream") {
    return normalized;
  }
  const lowerName = attachment.name.toLowerCase();
  if (lowerName.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lowerName.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lowerName.endsWith(".pptx")) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  if (lowerName.endsWith(".csv")) return "text/csv";
  if (lowerName.endsWith(".tsv")) return "text/tab-separated-values";
  if (lowerName.endsWith(".md")) return "text/markdown";
  if (lowerName.endsWith(".json")) return "application/json";
  if (lowerName.endsWith(".xml")) return "application/xml";
  if (lowerName.endsWith(".txt")) return "text/plain";
  if (lowerName.endsWith(".pdf")) return "application/pdf";
  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lowerName.endsWith(".png")) return "image/png";
  if (lowerName.endsWith(".gif")) return "image/gif";
  if (lowerName.endsWith(".webp")) return "image/webp";
  return normalized;
}

export function isImessageAudioAttachment(
  attachment: Pick<RawImessageAttachment, "mimeType">,
): boolean {
  return normalizeImessageAttachmentMimeType(attachment.mimeType).startsWith(
    "audio/",
  );
}

export function normalizeInboundImessageSender(raw: string): string {
  if (raw.includes("@")) return raw.trim().toLowerCase();
  const cleaned = raw.replace(/[^+\d]/g, "");
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}

export function buildFallbackImessageChatGuid(args: {
  fromPhone: string;
  isGroup: boolean;
  participants?: RawImessageParticipant[];
}): string {
  if (!args.isGroup) return args.fromPhone;
  const participantAddresses = new Set<string>();
  participantAddresses.add(normalizeImessageAddress(args.fromPhone));
  for (const participant of args.participants ?? []) {
    const address = normalizeImessageAddress(participant.address);
    if (address) participantAddresses.add(address);
  }
  const rosterKey =
    [...participantAddresses].sort().join("|") || args.fromPhone;
  const rosterHash = createHash("sha256")
    .update(rosterKey)
    .digest("hex")
    .slice(0, 24);
  return `group:${rosterHash}`;
}

export function buildInboundImessageEventKey(args: {
  fromPhone: string;
  chatGuid?: string;
  messageText: string;
  sourceMessageId?: string;
  receivedAt?: number;
  attachments?: RawImessageAttachment[];
}): string {
  const hash = createHash("sha256");
  const scope = args.chatGuid ?? args.fromPhone;
  if (args.sourceMessageId) {
    hash.update(`source:${scope}:${args.sourceMessageId}`);
  } else {
    const minuteBucket = Math.floor(
      (args.receivedAt ?? dayjs().valueOf()) / 60000,
    );
    hash.update(
      `fallback:${scope}:${args.fromPhone}:${minuteBucket}:${args.messageText}`,
    );
    for (const attachment of args.attachments ?? []) {
      hash.update(
        `:${attachment.name}:${attachment.mimeType}:${attachment.data.length}`,
      );
    }
  }
  return hash.digest("hex");
}

export function buildImessageParticipantInputs(args: {
  senderAddress: string;
  participants?: RawImessageParticipant[];
}): Map<string, RawImessageParticipant> {
  const participantInputs = new Map<string, RawImessageParticipant>();
  for (const participant of args.participants ?? []) {
    const address = normalizeImessageAddress(participant.address);
    if (address) {
      participantInputs.set(address, {
        address,
        displayName: participant.displayName,
      });
    }
  }
  if (!participantInputs.has(args.senderAddress)) {
    participantInputs.set(args.senderAddress, { address: args.senderAddress });
  }
  return participantInputs;
}

export async function storeImessageAttachments(
  ctx: { storage: Pick<ActionCtx["storage"], "store" | "delete"> },
  attachments: RawImessageAttachment[] | undefined,
): Promise<StoredImessageAttachmentRecord[]> {
  if ((attachments?.length ?? 0) > MAX_AGENT_ATTACHMENT_FILES) {
    throw new Error(
      `iMessage messages may include at most ${MAX_AGENT_ATTACHMENT_FILES} attachments`,
    );
  }

  const prepared: Array<{
    attachment: RawImessageAttachment;
    filename: string;
    buffer: Buffer;
    mimeType: string;
  }> = [];
  let aggregateSize = 0;
  for (const attachment of attachments ?? []) {
    const filename = normalizeAgentAttachmentFilename(attachment.name);
    const mimeType = resolveImessageAttachmentMimeType(attachment);
    if (!SUPPORTED_IMESSAGE_ATTACHMENT_MIME_TYPES.has(mimeType)) {
      console.warn("[imessage] Ignoring unsupported attachment type", {
        filename,
        mimeType,
      });
      continue;
    }
    const compactData = attachment.data.replace(/\s/g, "");
    const unpaddedData = compactData.replace(/=+$/, "");
    const maximumSize = isImessageAudioAttachment({ mimeType })
      ? MAX_IMESSAGE_AUDIO_BYTES
      : MAX_AGENT_ATTACHMENT_BYTES;
    const maximumEncodedSize = Math.ceil(maximumSize / 3) * 4 + 4;
    if (
      !compactData ||
      compactData.length > maximumEncodedSize ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(compactData) ||
      compactData.length % 4 === 1
    ) {
      throw new Error(
        `iMessage attachment ${attachment.name} is not valid base64`,
      );
    }
    const buffer = Buffer.from(compactData, "base64");
    if (buffer.toString("base64").replace(/=+$/, "") !== unpaddedData) {
      throw new Error(
        `iMessage attachment ${attachment.name} is not valid base64`,
      );
    }
    if (buffer.byteLength > maximumSize) {
      throw new Error(
        `iMessage attachment ${attachment.name} exceeds the ${maximumSize / 1024 / 1024} MB ingestion limit`,
      );
    }
    aggregateSize += buffer.byteLength;
    if (aggregateSize > MAX_AGENT_ATTACHMENT_AGGREGATE_BYTES) {
      throw new Error(
        "iMessage attachments exceed the 50 MB aggregate ingestion limit",
      );
    }
    prepared.push({ attachment, filename, buffer, mimeType });
  }

  const attachmentRecords: StoredImessageAttachmentRecord[] = [];
  try {
    for (const { filename, buffer, mimeType } of prepared) {
      const blob = new Blob([new Uint8Array(buffer)], {
        type: mimeType,
      });
      const fileId = await ctx.storage.store(blob);
      attachmentRecords.push({
        filename,
        contentType: mimeType,
        size: buffer.byteLength,
        fileId,
        buffer,
      });
    }
  } catch (error) {
    await Promise.all(
      attachmentRecords.flatMap((attachment) =>
        attachment.fileId
          ? [ctx.storage.delete(attachment.fileId).catch(() => undefined)]
          : [],
      ),
    );
    throw error;
  }
  return attachmentRecords;
}
