"use node";

import type { ModelMessage } from "ai";
import mammoth from "mammoth";

import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { tryBuildParsedPdfText } from "./liteparsePreprocessor";
import { generateAgentTextForOrg, generatedTextFromResult } from "./models";
import {
  isXlsxSpreadsheetAttachment,
  spreadsheetBufferToText,
} from "./spreadsheetText";
import type { AgentToolSurface } from "./agentMessageHistory";
import { MAX_ROUTER_ATTACHMENT_BYTES } from "./agentAttachmentLimits";

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENT_TEXT_CHARS = 80_000;

function isTextAttachment(filename: string, contentType: string) {
  const lower = filename.toLowerCase();
  return (
    contentType.startsWith("text/") ||
    contentType === "application/json" ||
    contentType === "application/xml" ||
    lower.endsWith(".md") ||
    lower.endsWith(".csv") ||
    lower.endsWith(".tsv") ||
    lower.endsWith(".json") ||
    lower.endsWith(".xml")
  );
}

function clipText(text: string) {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_ATTACHMENT_TEXT_CHARS) {
    return { text: trimmed, truncated: false };
  }
  return {
    text: trimmed.slice(0, MAX_ATTACHMENT_TEXT_CHARS),
    truncated: true,
  };
}

async function readBoundedResponseBuffer(response: Response) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_ATTACHMENT_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

async function describeStoredImage(
  ctx: ActionCtx,
  args: {
    orgId: Id<"organizations">;
    surface: AgentToolSurface;
    threadId: Id<"threads">;
    messageId: Id<"threadMessages">;
    contentType: string;
  },
  image: string | URL,
  size?: number,
): Promise<string> {
  const messages: ModelMessage[] = [
    {
      role: "user",
      content: [
        {
          type: "image",
          image,
          mediaType: args.contentType,
          ...(size
            ? {
                providerOptions: {
                  spot: { routerAssetSizeBytes: size },
                },
              }
            : {}),
        },
        {
          type: "text",
          text: "Describe the information visible in this older conversation attachment. Transcribe material text, names, dates, identifiers, and user annotations. Do not infer policy facts that are not visible.",
        },
      ],
    },
  ];
  const result = await generateAgentTextForOrg(
    ctx,
    args.orgId,
    "chat_vision",
    { maxOutputTokens: 1_200, messages },
    {
      taskKind: "query_attachment",
      sessionKey: String(args.threadId),
      trace: {
        traceId: `${String(args.messageId)}:thread-attachment`,
        parentRequestId: String(args.messageId),
        label: "convex.readThreadAttachment",
        phase: "query_attachment",
        channel: args.surface,
      },
    },
  );
  return generatedTextFromResult(result);
}

export async function readStoredThreadAttachment(
  ctx: ActionCtx,
  args: {
    orgId: Id<"organizations">;
    surface: AgentToolSurface;
    threadId: Id<"threads">;
    messageId: Id<"threadMessages">;
    filename: string;
    contentType: string;
    size: number;
    url: string;
  },
) {
  if (args.size > MAX_ATTACHMENT_BYTES) {
    return {
      status: "unavailable" as const,
      filename: args.filename,
      message:
        "That attachment is too large to reopen in conversation history.",
    };
  }
  const isImage = args.contentType.startsWith("image/");
  if (isImage && args.size > MAX_ROUTER_ATTACHMENT_BYTES) {
    return {
      status: "unavailable" as const,
      filename: args.filename,
      message:
        "That image is too large to reopen in conversation history. Ask the user to upload a resized copy.",
    };
  }

  const preferStoredReference =
    process.env.SPOT_ENV === "dev" || process.env.SPOT_ENV === "production";
  if (isImage && preferStoredReference) {
    const extracted = await describeStoredImage(
      ctx,
      args,
      new URL(args.url),
      args.size,
    );
    if (!extracted.trim()) {
      return {
        status: "unavailable" as const,
        filename: args.filename,
        message: "No readable content could be recovered from that attachment.",
      };
    }
    const clipped = clipText(extracted);
    return {
      status: "ok" as const,
      filename: args.filename,
      contentType: args.contentType,
      text: clipped.text,
      truncated: clipped.truncated,
    };
  }

  const response = await fetch(args.url);
  if (!response.ok) {
    return {
      status: "unavailable" as const,
      filename: args.filename,
      message: "The stored attachment could not be downloaded.",
    };
  }
  const buffer = await readBoundedResponseBuffer(response);
  if (!buffer) {
    return {
      status: "unavailable" as const,
      filename: args.filename,
      message:
        "That attachment is too large to reopen in conversation history.",
    };
  }

  let extracted = "";
  if (
    args.contentType === "application/pdf" ||
    args.filename.toLowerCase().endsWith(".pdf")
  ) {
    extracted =
      (await tryBuildParsedPdfText({
        pdfBytes: buffer,
        documentId: args.filename,
        sourceKind: "attachment",
        timeoutMs: 20_000,
      })) ?? "";
  } else if (
    args.contentType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    args.filename.toLowerCase().endsWith(".docx")
  ) {
    extracted = (await mammoth.extractRawText({ buffer })).value;
  } else if (isXlsxSpreadsheetAttachment(args.filename, args.contentType)) {
    extracted = await spreadsheetBufferToText(buffer);
  } else if (isTextAttachment(args.filename, args.contentType)) {
    extracted = buffer.toString("utf8");
  } else if (isImage) {
    extracted = await describeStoredImage(ctx, args, buffer.toString("base64"));
  } else {
    return {
      status: "unsupported" as const,
      filename: args.filename,
      contentType: args.contentType,
      message:
        "Spot cannot reopen this attachment type from conversation history. Ask the user to upload it again in a supported format.",
    };
  }

  if (!extracted.trim()) {
    return {
      status: "unavailable" as const,
      filename: args.filename,
      message: "No readable content could be recovered from that attachment.",
    };
  }
  const clipped = clipText(extracted);
  return {
    status: "ok" as const,
    filename: args.filename,
    contentType: args.contentType,
    text: clipped.text,
    truncated: clipped.truncated,
  };
}
