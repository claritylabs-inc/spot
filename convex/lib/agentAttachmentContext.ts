"use node";

import type { ModelMessage } from "ai";
import JSZip from "jszip";
import mammoth from "mammoth";

import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  AgentAttachmentLimitError,
  MAX_AGENT_ATTACHMENT_AGGREGATE_BYTES,
  MAX_AGENT_ATTACHMENT_BYTES,
  accountRouterAttachment,
  assertAgentAttachmentLimits,
} from "./agentAttachmentLimits";
import {
  preparePdfTextWithPdfJs,
  tryBuildParsedPdfText,
} from "./liteparsePreprocessor";
import {
  isUnsupportedSpreadsheetAttachment,
  isXlsxSpreadsheetAttachment,
  spreadsheetBufferToText,
} from "./spreadsheetText";

export type AgentAttachment = {
  filename: string;
  contentType: string;
  size: number;
  fileId?: Id<"_storage">;
};

export type AgentAttachmentContentPart =
  | { type: "text"; text: string }
  | {
      type: "image";
      image: string | URL;
      mediaType: string;
      providerOptions?: { spot: { routerAssetSizeBytes: number } };
    }
  | {
      type: "file";
      data: string | URL;
      mediaType: string;
      filename?: string;
      providerOptions?: { spot: { routerAssetSizeBytes: number } };
    };

export { MAX_AGENT_ATTACHMENT_TEXT_CHARS } from "./agentAttachmentLimits";

export type AgentAttachmentRouterBudget = {
  rich: { count: number; bytes: number };
};

export function createAgentAttachmentRouterBudget(): AgentAttachmentRouterBudget {
  return {
    rich: { count: 0, bytes: 0 },
  };
}

function isTextLikeAttachment(filename: string, contentType: string) {
  const lowerName = filename.toLowerCase();
  const type = contentType.toLowerCase();
  return (
    type.startsWith("text/") ||
    type.includes("csv") ||
    type.includes("json") ||
    type.includes("xml") ||
    lowerName.endsWith(".csv") ||
    lowerName.endsWith(".tsv") ||
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".md") ||
    lowerName.endsWith(".markdown") ||
    lowerName.endsWith(".json") ||
    lowerName.endsWith(".xml")
  );
}

function isPdfAttachment(filename: string, contentType: string) {
  return (
    contentType.toLowerCase().includes("pdf") ||
    filename.toLowerCase().endsWith(".pdf")
  );
}

function isImageAttachment(filename: string, contentType: string) {
  const lowerName = filename.toLowerCase();
  const type = contentType.toLowerCase();
  return (
    type === "image/jpeg" ||
    type === "image/png" ||
    type === "image/gif" ||
    type === "image/webp" ||
    lowerName.endsWith(".jpg") ||
    lowerName.endsWith(".jpeg") ||
    lowerName.endsWith(".png") ||
    lowerName.endsWith(".gif") ||
    lowerName.endsWith(".webp")
  );
}

function isDocxAttachment(filename: string, contentType: string) {
  const lowerName = filename.toLowerCase();
  const type = contentType.toLowerCase();
  return type.includes("wordprocessingml") || lowerName.endsWith(".docx");
}

function isPresentationAttachment(filename: string, contentType: string) {
  const lowerName = filename.toLowerCase();
  const type = contentType.toLowerCase();
  return type.includes("presentationml") || lowerName.endsWith(".pptx");
}

const OFFICE_ARCHIVE_MAX_ENTRIES = 2_000;
const OFFICE_ARCHIVE_MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
const OFFICE_ARCHIVE_MAX_ENTRY_BYTES = 12 * 1024 * 1024;

async function loadBoundedOfficeArchive(buffer: Buffer): Promise<JSZip> {
  const zip = await JSZip.loadAsync(buffer);
  let entryCount = 0;
  let uncompressedBytes = 0;
  zip.forEach((_path, file) => {
    if (file.dir) return;
    entryCount += 1;
    const size = (file as unknown as { _data?: { uncompressedSize?: number } })
      ._data?.uncompressedSize;
    if (!Number.isSafeInteger(size) || size === undefined || size < 0) {
      throw new Error("Office attachment has unverifiable archive metadata");
    }
    if (size > OFFICE_ARCHIVE_MAX_ENTRY_BYTES) {
      throw new Error("Office attachment contains an oversized archive entry");
    }
    uncompressedBytes += size;
  });
  if (entryCount > OFFICE_ARCHIVE_MAX_ENTRIES) {
    throw new Error("Office attachment contains too many archive entries");
  }
  if (uncompressedBytes > OFFICE_ARCHIVE_MAX_UNCOMPRESSED_BYTES) {
    throw new Error("Office attachment expands beyond the model-input limit");
  }
  return zip;
}

async function docxBufferToText(buffer: Buffer): Promise<string> {
  await loadBoundedOfficeArchive(buffer);
  const result = await mammoth.extractRawText({ buffer });
  return result.value.trim();
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

async function pptxBufferToText(buffer: Buffer): Promise<string> {
  const zip = await loadBoundedOfficeArchive(buffer);
  const slidePaths = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
    .sort((a, b) => {
      const aNum = Number(a.match(/slide(\d+)\.xml$/i)?.[1] ?? 0);
      const bNum = Number(b.match(/slide(\d+)\.xml$/i)?.[1] ?? 0);
      return aNum - bNum;
    });
  const slides: string[] = [];
  for (const path of slidePaths) {
    const file = zip.file(path);
    if (!file) continue;
    const xml = await file.async("text");
    const texts = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)]
      .map((match) => decodeXmlEntities(match[1] ?? "").trim())
      .filter(Boolean);
    if (!texts.length) continue;
    const slideNumber =
      path.match(/slide(\d+)\.xml$/i)?.[1] ?? String(slides.length + 1);
    slides.push(`Slide ${slideNumber}\n${texts.join("\n")}`);
  }
  return slides.join("\n\n");
}

function inferredImageMediaType(filename: string, contentType: string) {
  if (contentType.startsWith("image/")) return contentType;
  const lowerName = filename.toLowerCase();
  if (lowerName.endsWith(".png")) return "image/png";
  if (lowerName.endsWith(".gif")) return "image/gif";
  if (lowerName.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function boundedTextPart(args: {
  filename: string;
  label: string;
  endLabel: string;
  text: string;
  truncationLabel: string;
  remainingTextChars: { value: number };
}): AgentAttachmentContentPart | null {
  const text = args.text.trim();
  const remaining = args.remainingTextChars.value;
  if (!text) {
    return {
      type: "text",
      text: `--- ${args.label}: ${args.filename} ---\nNo readable text was extracted from this file.\n--- ${args.endLabel} ---`,
    };
  }
  if (remaining <= 0) {
    return {
      type: "text",
      text: `--- ${args.label}: ${args.filename} ---\nThis file was omitted because the shared attachment text budget was exhausted.\n--- ${args.endLabel} ---`,
    };
  }
  const clipped = text.length > remaining ? text.slice(0, remaining) : text;
  args.remainingTextChars.value -= clipped.length;
  const suffix =
    clipped.length < text.length ? `\n--- ${args.truncationLabel} ---` : "";
  return {
    type: "text",
    text: `--- ${args.label}: ${args.filename} ---\n${clipped}${suffix}\n--- ${args.endLabel} ---`,
  };
}

export function modelMessagesHaveRichInput(history: ModelMessage[]) {
  return history.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some(
        (part) => part.type === "image" || part.type === "file",
      ),
  );
}

export async function buildAgentAttachmentParts(
  ctx: {
    storage: Pick<ActionCtx["storage"], "get" | "getUrl">;
  },
  attachments: AgentAttachment[],
  options: {
    includeRichParts: boolean;
    remainingTextChars: { value: number };
    routerBudget?: AgentAttachmentRouterBudget;
  },
): Promise<{ parts: AgentAttachmentContentPart[]; names: string[] }> {
  const parts: AgentAttachmentContentPart[] = [];
  const names: string[] = [];
  const storedAttachments = attachments.filter(
    (attachment): attachment is AgentAttachment & { fileId: Id<"_storage"> } =>
      Boolean(attachment.fileId),
  );
  assertAgentAttachmentLimits(storedAttachments);
  let actualAggregateBytes = 0;
  const routerBudget =
    options.routerBudget ?? createAgentAttachmentRouterBudget();
  const spotEnvironment = process.env.SPOT_ENV?.trim().toLowerCase() ?? "local";
  const preferStoredReferences =
    spotEnvironment === "dev" || spotEnvironment === "production";

  for (const attachment of storedAttachments) {
    try {
      const blob = await ctx.storage.get(attachment.fileId);
      if (!blob) {
        parts.push({
          type: "text",
          text: `--- Attachment unavailable: ${attachment.filename} ---\nThe stored file is no longer available.\n--- End unavailable attachment ---`,
        });
        names.push(attachment.filename);
        continue;
      }
      actualAggregateBytes += blob.size;
      if (blob.size > MAX_AGENT_ATTACHMENT_BYTES) {
        throw new AgentAttachmentLimitError(
          `${attachment.filename} exceeds the 25 MiB attachment intake limit`,
        );
      }
      if (actualAggregateBytes > MAX_AGENT_ATTACHMENT_AGGREGATE_BYTES) {
        throw new AgentAttachmentLimitError(
          "Attachments exceed the 50 MiB aggregate intake limit",
        );
      }
      const buffer = Buffer.from(await blob.arrayBuffer());

      if (isPdfAttachment(attachment.filename, attachment.contentType)) {
        if (!options.includeRichParts) continue;
        let parsedPdfText = await tryBuildParsedPdfText({
          pdfBytes: buffer,
          documentId: attachment.fileId,
          sourceKind: "attachment",
          timeoutMs: 20_000,
        });
        let parserLabel = "LiteParse text";
        if (!parsedPdfText) {
          try {
            const fallback = await preparePdfTextWithPdfJs({
              pdfBytes: buffer,
              documentId: attachment.fileId,
              sourceKind: "attachment",
            });
            parsedPdfText = fallback.text.trim() || null;
            parserLabel = "PDF.js text";
          } catch (error) {
            console.warn(
              `[agent-attachment] PDF text fallback failed for ${attachment.filename}`,
              error,
            );
          }
        }
        if (parsedPdfText) {
          const part = boundedTextPart({
            filename: attachment.filename,
            label: `PDF attachment (${parserLabel})`,
            endLabel: "End PDF attachment",
            text: parsedPdfText,
            truncationLabel: "PDF attachment truncated for context",
            remainingTextChars: options.remainingTextChars,
          });
          if (part) parts.push(part);
        } else {
          accountRouterAttachment(routerBudget.rich, {
            filename: attachment.filename,
            size: blob.size,
          });
          const referenceUrl = preferStoredReferences
            ? await ctx.storage.getUrl(attachment.fileId)
            : null;
          if (preferStoredReferences && !referenceUrl)
            throw new Error("Stored attachment URL is unavailable");
          parts.push({
            type: "text",
            text: `--- PDF attachment: ${attachment.filename} ---`,
          });
          parts.push({
            type: "file",
            data: referenceUrl
              ? new URL(referenceUrl)
              : buffer.toString("base64"),
            mediaType: "application/pdf",
            filename: attachment.filename,
            ...(referenceUrl
              ? {
                  providerOptions: {
                    spot: { routerAssetSizeBytes: blob.size },
                  },
                }
              : {}),
          });
        }
        names.push(attachment.filename);
      } else if (
        isImageAttachment(attachment.filename, attachment.contentType)
      ) {
        if (!options.includeRichParts) continue;
        accountRouterAttachment(routerBudget.rich, {
          filename: attachment.filename,
          size: blob.size,
        });
        const referenceUrl = preferStoredReferences
          ? await ctx.storage.getUrl(attachment.fileId)
          : null;
        if (preferStoredReferences && !referenceUrl)
          throw new Error("Stored attachment URL is unavailable");
        parts.push({
          type: "text",
          text: `--- Image attachment: ${attachment.filename} ---`,
        });
        parts.push({
          type: "image",
          image: referenceUrl
            ? new URL(referenceUrl)
            : buffer.toString("base64"),
          mediaType: inferredImageMediaType(
            attachment.filename,
            attachment.contentType,
          ),
          ...(referenceUrl
            ? {
                providerOptions: {
                  spot: { routerAssetSizeBytes: blob.size },
                },
              }
            : {}),
        });
        names.push(attachment.filename);
      } else if (
        isXlsxSpreadsheetAttachment(attachment.filename, attachment.contentType)
      ) {
        await loadBoundedOfficeArchive(buffer);
        const part = boundedTextPart({
          filename: attachment.filename,
          label: "Spreadsheet attachment",
          endLabel: "End spreadsheet attachment",
          text: await spreadsheetBufferToText(buffer),
          truncationLabel: "Spreadsheet attachment truncated for context",
          remainingTextChars: options.remainingTextChars,
        });
        if (part) parts.push(part);
        names.push(attachment.filename);
      } else if (
        isUnsupportedSpreadsheetAttachment(
          attachment.filename,
          attachment.contentType,
        )
      ) {
        parts.push({
          type: "text",
          text: `--- Unsupported spreadsheet attachment: ${attachment.filename} ---\nThis spreadsheet was not read. Spot currently reads .xlsx and text-based CSV/TSV attachments; ask for .xlsx, .csv, or .tsv instead.\n--- End unsupported spreadsheet attachment ---`,
        });
        names.push(attachment.filename);
      } else if (
        isDocxAttachment(attachment.filename, attachment.contentType)
      ) {
        const part = boundedTextPart({
          filename: attachment.filename,
          label: "DOCX attachment",
          endLabel: "End DOCX attachment",
          text: await docxBufferToText(buffer),
          truncationLabel: "DOCX attachment truncated for context",
          remainingTextChars: options.remainingTextChars,
        });
        if (part) parts.push(part);
        names.push(attachment.filename);
      } else if (
        isPresentationAttachment(attachment.filename, attachment.contentType)
      ) {
        const part = boundedTextPart({
          filename: attachment.filename,
          label: "PPTX attachment",
          endLabel: "End PPTX attachment",
          text: await pptxBufferToText(buffer),
          truncationLabel: "PPTX attachment truncated for context",
          remainingTextChars: options.remainingTextChars,
        });
        if (part) parts.push(part);
        names.push(attachment.filename);
      } else if (
        isTextLikeAttachment(attachment.filename, attachment.contentType)
      ) {
        const part = boundedTextPart({
          filename: attachment.filename,
          label: "Attachment",
          endLabel: "End attachment",
          text: buffer.toString("utf8"),
          truncationLabel: "Attachment truncated for context",
          remainingTextChars: options.remainingTextChars,
        });
        if (part) parts.push(part);
        names.push(attachment.filename);
      } else {
        parts.push({
          type: "text",
          text: `--- Unsupported attachment: ${attachment.filename} ---\nThis file type could not be read. Use PDF, image, XLSX, CSV/TSV, text, JSON/XML, DOCX, or PPTX.\n--- End unsupported attachment ---`,
        });
        names.push(attachment.filename);
      }
    } catch (error) {
      if (error instanceof AgentAttachmentLimitError) throw error;
      console.warn(
        `[agent-attachment] Failed to read ${attachment.filename}`,
        error,
      );
      parts.push({
        type: "text",
        text: `--- Attachment unavailable: ${attachment.filename} ---\nThe file could not be read for this turn.\n--- End unavailable attachment ---`,
      });
      names.push(attachment.filename);
    }
  }

  return { parts, names };
}
