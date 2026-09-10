"use node";

import type { ModelMessage } from "ai";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { buildPrivateAgentHistoryMetadata } from "./agentMessageHistory";
import {
  AgentAttachmentLimitError,
  MAX_AGENT_ATTACHMENT_FILES,
  accountRouterAttachment,
  assertAgentAttachmentLimits,
} from "./agentAttachmentLimits";
import {
  MAX_IMESSAGE_AUDIO_BYTES,
  isImessageAudioAttachment,
  normalizeImessageAttachmentMimeType,
  type RawImessageAttachment,
  type StoredImessageAttachmentRecord,
} from "./imessageIngress";
import { tryBuildParsedPdfText } from "./liteparsePreprocessor";
import {
  transcribeAudioForOperatorTask,
  transcribeAudioForOrg,
  transcribeAudioForPublicTask,
} from "./models";

export type ImessageHistoryMessage = {
  _id: string;
  _creationTime: number;
  status?: string;
  role: "user" | "agent" | "system";
  content: string;
  userName?: string;
  responseMessageId?: string;
  routerRequestId?: string;
  feedbackPromptedAt?: number;
  messageKind?: "conversation" | "workflow_status" | "channel_sync";
  toolArtifacts?: Array<{ type: string; data: unknown }>;
  usedTools?: string[];
  attachments?: Array<{ filename: string }>;
  referencedPolicyIds?: Id<"policies">[];
};

type ImessageContentPart =
  | { type: "text"; text: string }
  | { type: "file"; data: string; mediaType: string }
  | { type: "image"; image: string; mediaType: string };

const VOICE_MEMO_TRANSCRIPTION_PROMPT =
  "This voice memo is addressed to Spot, an insurance intelligence assistant. Preserve names, email addresses, policy numbers, dates, insurance terminology, and explicit user instructions verbatim.";

const IMESSAGE_VOICE_TRANSCRIPTION_FAILED_MESSAGE =
  "I couldn't transcribe that voice memo. Please try sending it again or send the request as text.";

export type ImessageInboundScope =
  | { kind: "organization"; orgId: Id<"organizations"> }
  | { kind: "operator" }
  | { kind: "public" };

export type PreparedInboundImessageTurn = {
  messageText: string;
  hasVoiceMemos: boolean;
  transcripts: Array<{ filename: string; text: string }>;
  failures: Array<{ filename: string; error: string }>;
  nonAudioAttachments: RawImessageAttachment[];
  failureResponse?: string;
};

function explicitImessageText(messageText: string): string {
  const trimmed = messageText.trim();
  return trimmed === "(attachment)" ? "" : trimmed;
}

export async function prepareInboundImessageTurn(
  ctx: ActionCtx,
  args: {
    scope: ImessageInboundScope;
    messageText: string;
    attachments?: RawImessageAttachment[];
  },
): Promise<PreparedInboundImessageTurn> {
  if ((args.attachments?.length ?? 0) > MAX_AGENT_ATTACHMENT_FILES) {
    throw new AgentAttachmentLimitError(
      `iMessage messages may include at most ${MAX_AGENT_ATTACHMENT_FILES} attachments`,
    );
  }
  const voiceMemos = (args.attachments ?? []).filter(isImessageAudioAttachment);
  const nonAudioAttachments = (args.attachments ?? []).filter(
    (attachment) => !isImessageAudioAttachment(attachment),
  );
  if (voiceMemos.length === 0) {
    return {
      messageText: args.messageText,
      hasVoiceMemos: false,
      transcripts: [],
      failures: [],
      nonAudioAttachments,
    };
  }

  const transcripts: PreparedInboundImessageTurn["transcripts"] = [];
  const failures: PreparedInboundImessageTurn["failures"] = [];
  for (const voiceMemo of voiceMemos) {
    const filename = voiceMemo.name.trim() || "voice-memo.m4a";
    const data = Buffer.from(voiceMemo.data, "base64");
    if (data.byteLength === 0) {
      failures.push({ filename, error: "The voice memo was empty." });
      continue;
    }
    if (data.byteLength > MAX_IMESSAGE_AUDIO_BYTES) {
      failures.push({
        filename,
        error: "The voice memo exceeded the 12 MiB attachment limit.",
      });
      continue;
    }

    try {
      const input = {
        data,
        filename,
        mediaType: normalizeImessageAttachmentMimeType(voiceMemo.mimeType),
        prompt: VOICE_MEMO_TRANSCRIPTION_PROMPT,
      };
      const result =
        args.scope.kind === "organization"
          ? await transcribeAudioForOrg(ctx, args.scope.orgId, input)
          : args.scope.kind === "operator"
            ? await transcribeAudioForOperatorTask(ctx, input)
            : await transcribeAudioForPublicTask(ctx, input);
      transcripts.push({ filename, text: result.text });
      console.log("[imessage] Voice memo transcribed", {
        audience: args.scope.kind,
        filename,
        model: result.route.model,
        routeSource: result.routeSource,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[imessage] Voice memo transcription failed", {
        filename,
        error: message,
      });
      failures.push({ filename, error: message });
    }
  }

  const messageParts = [explicitImessageText(args.messageText)];
  messageParts.push(
    ...transcripts.map(
      (transcript) =>
        `[Voice memo transcript: ${transcript.filename}]\n${transcript.text}`,
    ),
  );

  return {
    messageText: messageParts.filter(Boolean).join("\n\n") || args.messageText,
    hasVoiceMemos: true,
    transcripts,
    failures,
    nonAudioAttachments,
    failureResponse:
      transcripts.length === 0
        ? IMESSAGE_VOICE_TRANSCRIPTION_FAILED_MESSAGE
        : undefined,
  };
}

export function isImessageStatusCue(message: {
  messageKind?: "conversation" | "workflow_status" | "channel_sync";
}): boolean {
  return message.messageKind === "workflow_status";
}

export function buildRecentImessageTextContext(
  messages: Array<{
    role: string;
    content: string;
    status?: string;
    userName?: string;
    responseMessageId?: string;
    messageKind?: "conversation" | "workflow_status" | "channel_sync";
  }>,
): string {
  return messages
    .filter((msg) => msg.status !== "processing")
    .filter((msg) => !isImessageStatusCue(msg))
    .slice(-8)
    .map((msg) => {
      const speaker = msg.role === "user" ? (msg.userName ?? "User") : "Spot";
      return `${speaker}: ${msg.content}`;
    })
    .join("\n");
}

export function imessageAgentTaskForAttachments(
  attachmentRecords: StoredImessageAttachmentRecord[],
): "chat" | "chat_vision" {
  return attachmentRecords.some(
    (attachment) =>
      Boolean(attachment.buffer) && attachment.contentType.startsWith("image/"),
  )
    ? "chat_vision"
    : "chat";
}

export async function buildImessageModelMessages(args: {
  history: ImessageHistoryMessage[];
  messageText: string;
  currentSpeakerLabel: string;
  attachmentRecords: StoredImessageAttachmentRecord[];
  currentMessageId: Id<"threadMessages">;
}): Promise<ModelMessage[]> {
  const modelMessages: ModelMessage[] = [];

  for (const msg of args.history) {
    if (msg.status === "processing") continue;
    if (msg._id === args.currentMessageId) continue;
    if (isImessageStatusCue(msg)) continue;

    if (msg.role === "user") {
      modelMessages.push({
        role: "user",
        content: msg.userName
          ? `[${msg.userName}]: ${msg.content}`
          : msg.content,
      });
    } else if (msg.role === "agent" && msg.content) {
      const privateHistory = buildPrivateAgentHistoryMetadata({
        toolArtifacts: msg.toolArtifacts,
        usedTools: msg.usedTools,
        attachments: msg.attachments,
      });
      modelMessages.push({
        role: "assistant",
        content: msg.content,
        ...(privateHistory
          ? { providerOptions: { spot: { privateHistory } } }
          : {}),
      });
    }
  }

  modelMessages.push({
    role: "user",
    content: `[${args.currentSpeakerLabel}]: ${args.messageText}`,
  });

  if (args.attachmentRecords.length === 0) {
    return modelMessages;
  }

  assertAgentAttachmentLimits(args.attachmentRecords);

  const lastMsg = modelMessages[modelMessages.length - 1];
  if (lastMsg.role !== "user" || typeof lastMsg.content !== "string") {
    return modelMessages;
  }

  const parts: ImessageContentPart[] = [];
  const richAssets = { count: 0, bytes: 0 };
  for (const attachment of args.attachmentRecords) {
    if (!attachment.buffer) continue;

    if (attachment.contentType === "application/pdf") {
      const parsedPdfText = await tryBuildParsedPdfText({
        pdfBytes: attachment.buffer,
        documentId: attachment.filename,
        sourceKind: "attachment",
        timeoutMs: 20_000,
      });
      if (parsedPdfText) {
        parts.push({
          type: "text",
          text: `--- PDF attachment: ${attachment.filename} (LiteParse text) ---\n${parsedPdfText}\n--- End PDF attachment ---`,
        });
      } else {
        accountRouterAttachment(richAssets, {
          filename: attachment.filename,
          size: attachment.buffer.byteLength,
        });
        parts.push({
          type: "file",
          data: attachment.buffer.toString("base64"),
          mediaType: "application/pdf",
        });
      }
    } else if (attachment.contentType.startsWith("image/")) {
      accountRouterAttachment(richAssets, {
        filename: attachment.filename,
        size: attachment.buffer.byteLength,
      });
      parts.push({
        type: "image",
        image: attachment.buffer.toString("base64"),
        mediaType: attachment.contentType,
      });
    }
  }

  if (parts.length > 0) {
    parts.push({ type: "text", text: lastMsg.content });
    modelMessages[modelMessages.length - 1] = {
      role: "user",
      content: parts,
    };
  }

  return modelMessages;
}
