"use node";

import type { ModelMessage } from "ai";
import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import {
  buildAgentAttachmentParts,
  MAX_AGENT_ATTACHMENT_TEXT_CHARS,
  modelMessagesHaveRichInput,
} from "../lib/agentAttachmentContext";
import {
  CompanyInformationExtractionSchema,
  companyInformationExtractionSystemPrompt,
  sanitizeCompanyInformationExtraction,
} from "../lib/companyInformationExtraction";
import { generateObjectForOrg } from "../lib/models";

const MAX_EMAIL_THREAD_TEXT_CHARS = 160_000;
const extractClientFileRef = makeFunctionReference<
  "action",
  { clientFileId: Id<"clientFiles"> }
>("actions/companyInformationExtraction:extractClientFile");
const extractEmailThreadRef = makeFunctionReference<
  "action",
  { emailThreadId: Id<"procurementEmailThreads"> }
>("actions/companyInformationExtraction:extractProcurementEmailThread");

type ClaimStatus = {
  status: "complete" | "running" | "failed" | "inactive";
};

type ClientFileClaim =
  | ClaimStatus
  | {
      status: "claimed";
      source: {
        orgId: Id<"organizations">;
        organizationName: string;
        sourceKind: "client_file";
        sourceRef: string;
        sourceFingerprint: string;
        requestId?: Id<"procurementRequests">;
        observedAt: number;
        file: {
          fileId: Id<"_storage">;
          filename: string;
          contentType: string;
          size: number;
        };
      };
    };

type EmailThreadClaim =
  | ClaimStatus
  | {
      status: "claimed";
      source: {
        orgId: Id<"organizations">;
        organizationName: string;
        sourceKind: "procurement_email_thread";
        sourceRef: string;
        sourceFingerprint: string;
        requestTitle: string;
        messages: Array<{
          subject: string;
          fromName?: string;
          fromEmail: string;
          toAddresses: string[];
          ccAddresses: string[];
          currentText: string;
          forwarded?: unknown;
          receivedAt: number;
        }>;
      };
    };

const claimClientFileRef = makeFunctionReference<
  "mutation",
  { clientFileId: Id<"clientFiles"> },
  ClientFileClaim
>("companyInformation:claimClientFileInternal");
const claimEmailThreadRef = makeFunctionReference<
  "mutation",
  { emailThreadId: Id<"procurementEmailThreads"> },
  EmailThreadClaim
>("companyInformation:claimEmailThreadInternal");

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function hasReadableAttachmentContent(
  parts: Awaited<ReturnType<typeof buildAgentAttachmentParts>>["parts"],
) {
  return parts.some(
    (part) =>
      part.type === "image" ||
      part.type === "file" ||
      (part.type === "text" &&
        !/\b(unavailable|unsupported|omitted|no readable text)\b/i.test(
          part.text,
        )),
  );
}

function mailbox(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as { address?: unknown; name?: unknown };
  const address =
    typeof record.address === "string" ? record.address.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (name && address) return `${name} <${address}>`;
  return address || name;
}

function mailboxList(value: unknown) {
  return Array.isArray(value)
    ? value.map(mailbox).filter(Boolean).join(", ")
    : "";
}

function forwardedEmailText(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const email = (value as { email?: unknown }).email;
  if (!email || typeof email !== "object" || Array.isArray(email)) return "";
  const record = email as Record<string, unknown>;
  return [
    "Forwarded email context (untrusted):",
    mailbox(record.from) ? `From: ${mailbox(record.from)}` : "",
    mailboxList(record.to) ? `To: ${mailboxList(record.to)}` : "",
    mailboxList(record.cc) ? `Cc: ${mailboxList(record.cc)}` : "",
    typeof record.subject === "string" ? `Subject: ${record.subject}` : "",
    typeof record.date === "string" ? `Date: ${record.date}` : "",
    typeof record.body === "string" ? record.body : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function emailThreadText(
  requestTitle: string,
  messages: Array<{
    subject: string;
    fromName?: string;
    fromEmail: string;
    toAddresses: string[];
    ccAddresses: string[];
    currentText: string;
    forwarded?: unknown;
    receivedAt: number;
  }>,
) {
  const blocks = messages.map((message, index) =>
    [
      `Message ${index + 1}`,
      `Subject: ${message.subject}`,
      `From: ${message.fromName ? `${message.fromName} <${message.fromEmail}>` : message.fromEmail}`,
      message.toAddresses.length > 0
        ? `To: ${message.toAddresses.join(", ")}`
        : "",
      message.ccAddresses.length > 0
        ? `Cc: ${message.ccAddresses.join(", ")}`
        : "",
      `Received at: ${message.receivedAt}`,
      "Current message text:",
      message.currentText,
      forwardedEmailText(message.forwarded),
    ]
      .filter(Boolean)
      .join("\n"),
  );
  const text = [`Procurement request: ${requestTitle}`, ...blocks].join(
    "\n\n---\n\n",
  );
  return text.slice(-MAX_EMAIL_THREAD_TEXT_CHARS);
}

async function recordFailure(
  ctx: ActionCtx,
  args: {
    sourceRef: string;
    sourceFingerprint: string;
    error: unknown;
    retry: (delayMs: number) => Promise<unknown>;
  },
) {
  const result = await ctx.runMutation(internal.companyInformation.failInternal, {
    sourceRef: args.sourceRef,
    sourceFingerprint: args.sourceFingerprint,
    error: errorMessage(args.error),
  });
  if (result.retry) {
    await args.retry(Math.min(30_000, 5_000 * 2 ** (result.attempt - 1)));
  }
}

export const extractClientFile = internalAction({
  args: { clientFileId: v.id("clientFiles") },
  handler: async (ctx, args): Promise<{ status: string }> => {
    const claim = await ctx.runMutation(claimClientFileRef, args);
    if (claim.status !== "claimed") return claim;
    const { source } = claim;
    try {
      const context = await buildAgentAttachmentParts(ctx, [source.file], {
        includeRichParts: true,
        remainingTextChars: { value: MAX_AGENT_ATTACHMENT_TEXT_CHARS },
      });
      const parts = context.parts;
      if (!hasReadableAttachmentContent(parts)) {
        throw new Error("No readable file content was available for extraction");
      }
      const messages: ModelMessage[] = [
        {
          role: "user",
          content: [
            ...parts,
            {
              type: "text",
              text: [
                `Target company: ${source.organizationName}`,
                source.requestId
                  ? `This document is linked to procurement request ${source.requestId}.`
                  : "This document is not linked to a specific procurement request.",
                "Extract only information supported by this document.",
              ].join("\n"),
            },
          ],
        },
      ];
      const task = modelMessagesHaveRichInput(messages)
        ? "chat_vision"
        : "document_extraction";
      const result = await generateObjectForOrg(
        ctx,
        source.orgId,
        task,
        {
          schema: CompanyInformationExtractionSchema,
          system: companyInformationExtractionSystemPrompt({
            organizationName: source.organizationName,
            sourceKind: "document",
          }),
          messages,
          maxOutputTokens: 4_000,
        },
        {
          taskKind: "company_information_document_extraction",
          allowFallback: false,
        },
      );
      const extraction = sanitizeCompanyInformationExtraction(result.object);
      return await ctx.runMutation(
        internal.companyInformation.completeClientFileInternal,
        {
          clientFileId: args.clientFileId,
          sourceFingerprint: source.sourceFingerprint,
          ...extraction,
        },
      );
    } catch (error) {
      await recordFailure(ctx, {
        sourceRef: source.sourceRef,
        sourceFingerprint: source.sourceFingerprint,
        error,
        retry: async (delayMs) =>
          await ctx.scheduler.runAfter(
            delayMs,
            extractClientFileRef,
            args,
          ),
      });
      return { status: "failed" as const };
    }
  },
});

export const extractProcurementEmailThread = internalAction({
  args: { emailThreadId: v.id("procurementEmailThreads") },
  handler: async (ctx, args): Promise<{ status: string }> => {
    const claim = await ctx.runMutation(claimEmailThreadRef, args);
    if (claim.status !== "claimed") return claim;
    const { source } = claim;
    try {
      const result = await generateObjectForOrg(
        ctx,
        source.orgId,
        "email_extraction",
        {
          schema: CompanyInformationExtractionSchema,
          system: companyInformationExtractionSystemPrompt({
            organizationName: source.organizationName,
            sourceKind: "forwarded_email_thread",
          }),
          prompt: emailThreadText(source.requestTitle, source.messages),
          maxOutputTokens: 4_000,
        },
        {
          taskKind: "company_information_email_extraction",
          allowFallback: false,
        },
      );
      const extraction = sanitizeCompanyInformationExtraction(result.object);
      return await ctx.runMutation(
        internal.companyInformation.completeEmailThreadInternal,
        {
          emailThreadId: args.emailThreadId,
          sourceFingerprint: source.sourceFingerprint,
          ...extraction,
        },
      );
    } catch (error) {
      await recordFailure(ctx, {
        sourceRef: source.sourceRef,
        sourceFingerprint: source.sourceFingerprint,
        error,
        retry: async (delayMs) =>
          await ctx.scheduler.runAfter(
            delayMs,
            extractEmailThreadRef,
            args,
          ),
      });
      return { status: "failed" as const };
    }
  },
});
