"use node";

import dayjs from "dayjs";
import { NoWriteInputError } from "../lib/noWriteInputError";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import type { AgentScope } from "../lib/agentScope";
import { buildAgentToolExecutors } from "../lib/agentToolExecutors";
import { readStoredAgentFile } from "../lib/storedAgentFile";
import { runOperatorWebRetrieval } from "../lib/webRetrieval";
import { fetchPublicUrl } from "../lib/fetchPublicUrl";
import { parseOperatorAgentToolInput } from "../lib/operatorAgentToolRegistry";
import { mergePdfsFromUrls, mergedFileName } from "../lib/mergePdfs";
import { fillPdfForm, renderPdfFormFields } from "../lib/pdfFormFill";
import {
  findPdfFormField,
  pdfFormFieldBox,
  pdfFormFieldValue,
} from "../lib/pdfFormFields";
import {
  OPERATOR_EMAIL_TOOL_NAMES,
  runOperatorEmailTool,
} from "../lib/operatorEmailTools";

// Keeps ten bulk-read files within one tool result.
const BULK_FILE_TEXT_CHARS = 8_000;
// Default per-file text shrinks with the batch so every file fits the bounded
// tool output; an explicit maxChars still applies to each file.
const BULK_FILE_TEXT_BUDGET = 20_000;
const BULK_FILE_MIN_TEXT_CHARS = 1_000;
// Keeps a long form's field report within one tool result.
const MAX_REPORTED_FORM_FIELDS = 150;

const operatorChannelValidator = v.union(
  v.literal("chat"),
  v.literal("slack"),
  v.literal("imessage"),
  v.literal("email"),
  v.literal("mcp"),
);

type Attachment = {
  fileId: Id<"_storage">;
  filename: string;
  contentType: string;
  size: number;
};

const RICH_POLICY_TOOLS = new Set([
  "lookup_policy",
  "compare_coverages",
  "lookup_policy_section",
  "attach_policy_document",
  "confirm_policy_fact",
  "lookup_compliance_requirements",
]);

export const runInternal = internalAction({
  args: {
    operatorUserId: v.id("users"),
    threadId: v.id("operatorAgentThreads"),
    toolName: v.string(),
    input: v.any(),
    channel: operatorChannelValidator,
    confirmationId: v.optional(v.id("operatorAgentConfirmations")),
    messageId: v.optional(v.id("operatorAgentMessages")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    result: unknown;
    attachments?: Attachment[];
  }> => {
    await ctx.runQuery(internal.operator.requireOperatorForUserInternal, {
      userId: args.operatorUserId,
    });

    if (OPERATOR_EMAIL_TOOL_NAMES.has(args.toolName)) {
      return {
        result: await runOperatorEmailTool(ctx, {
          operatorUserId: args.operatorUserId,
          threadId: args.threadId,
          toolName: args.toolName,
          input: args.input as Record<string, unknown>,
          messageId: args.messageId,
          confirmationId: args.confirmationId,
        }),
      };
    }

    if (args.toolName === "web_search") {
      const input = parseOperatorAgentToolInput("web_search", args.input);
      return { result: await runOperatorWebRetrieval(ctx, input) };
    }

    if (args.toolName === "fetch_url") {
      const input = parseOperatorAgentToolInput("fetch_url", args.input);
      return {
        result: await fetchPublicUrl(
          String(input.url),
          typeof input.maxChars === "number" ? input.maxChars : undefined,
        ),
      };
    }

    if (args.toolName === "import_policy_files") {
      if (!args.confirmationId)
        throw new Error("Policy import confirmation is required");
      const input = parseOperatorAgentToolInput(
        "import_policy_files",
        args.input,
      );
      const sourceArgs = {
        operatorUserId: args.operatorUserId,
        threadId: args.threadId,
        orgId: input.orgId as Id<"organizations">,
        attachmentFileIds: input.attachmentFileIds as string[] | undefined,
        clientFileIds: input.clientFileIds as string[] | undefined,
      };
      const files = await ctx.runQuery(
        internal.operatorPolicyImports.getSourcesInternal,
        sourceArgs,
      );
      for (const file of files) {
        const blob = await ctx.storage.get(file.fileId);
        if (!blob || !(await blob.slice(0, 1024).text()).includes("%PDF-"))
          throw new NoWriteInputError(
            "invalid_file_type",
            `${file.fileName} is not a PDF. Select a PDF source before requesting a new approval.`,
          );
      }
      let mergedFileId: Id<"_storage"> | undefined;
      let mergedName: string | undefined;
      if (input.mode === "combined" && files.length > 1) {
        const urls = await Promise.all(
          files.map(async (file) => {
            const url = await ctx.storage.getUrl(file.fileId);
            if (!url)
              throw new NoWriteInputError(
                "source_unavailable",
                "Policy PDF is unavailable. Refresh the source file before requesting a new approval.",
              );
            return url;
          }),
        );
        const bytes = await mergePdfsFromUrls(urls);
        mergedFileId = await ctx.storage.store(
          new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
        );
        mergedName = mergedFileName(files[0].fileName, files.length);
      }
      let committed = false;
      try {
        const policies = await ctx.runMutation(
          internal.operatorPolicyImports.commitInternal,
          {
            ...sourceArgs,
            confirmationId: args.confirmationId,
            mode: input.mode as "combined" | "separate",
            mergedFileId,
            mergedFileName: mergedName,
          },
        );
        committed = true;
        if (
          mergedFileId &&
          policies.every((policy) => policy.status === "duplicate")
        )
          await ctx.storage.delete(mergedFileId);
        return {
          result: {
            status: "imported",
            policies,
            message:
              "New policies are queued for extraction; existing policies were reused.",
          },
        };
      } finally {
        if (mergedFileId && !committed) await ctx.storage.delete(mergedFileId);
      }
    }

    if (args.toolName === "fill_pdf_form") {
      const input = parseOperatorAgentToolInput("fill_pdf_form", args.input);
      const source = await ctx.runQuery(internal.pdfFormFill.getSourceInternal, {
        operatorUserId: args.operatorUserId,
        threadId: args.threadId,
        source: String(input.source),
        ...(input.orgId ? { orgId: String(input.orgId) } : {}),
        ...(input.procurementRequestId
          ? { procurementRequestId: String(input.procurementRequestId) }
          : {}),
        ...(input.brokerOrgId ? { brokerOrgId: String(input.brokerOrgId) } : {}),
      });
      const blob = await ctx.storage.get(source.fileId);
      const pdfBytes = blob ? new Uint8Array(await blob.arrayBuffer()) : null;
      if (!pdfBytes || !new TextDecoder().decode(pdfBytes.slice(0, 1024)).includes("%PDF-"))
        throw new NoWriteInputError(
          "invalid_file_type",
          `${source.filename} is not a readable PDF.`,
        );
      // Every operator viewing this form watches the fill live in the PDF panel.
      const runId = await ctx.runMutation(internal.pdfFormFill.startRunInternal, {
        operatorUserId: args.operatorUserId,
        threadId: args.threadId,
        sourceFileId: source.fileId,
        sourceFilename: source.filename,
        ...(source.client ? { clientOrgId: source.client.orgId } : {}),
      });
      let filled;
      let fileId;
      let recorded;
      try {
        filled = await fillPdfForm(ctx, {
          pdfBytes,
          filename: source.filename,
          orgId: source.client?.orgId,
          client: source.client,
          answers: (input.answers ?? []) as Array<{ field: string; value: string }>,
          instructions: input.instructions as string | undefined,
          traceId: `pdf-form:${args.threadId}:${source.fileId}`,
          onProgress: async (progress) => {
            await ctx.runMutation(internal.pdfFormFill.progressRunInternal, {
              runId,
              stage: progress.stage,
              fields: progress.fields,
              ...(progress.total !== undefined ? { total: progress.total } : {}),
            });
          },
        });
        fileId = await ctx.storage.store(
          new Blob([new Uint8Array(filled.pdfBytes)], { type: "application/pdf" }),
        );
        recorded = await ctx.runMutation(internal.pdfFormFill.recordFillInternal, {
          operatorUserId: args.operatorUserId,
          threadId: args.threadId,
          sourceFileId: source.fileId,
          sourceFilename: source.filename,
          outputFileId: fileId,
          pageCount: filled.pageCount,
          fields: filled.fields,
          ...source.filing,
        });
      } finally {
        await ctx.runMutation(internal.pdfFormFill.finishRunInternal, {
          runId,
          ...(recorded && fileId
            ? { fillId: recorded.fillId, outputFileId: fileId }
            : {}),
        });
      }
      const filename = recorded.filename;
      const answered = filled.fields.filter((field) => field.value);
      const placed = answered.filter((field) => pdfFormFieldBox(field));
      const report = (fields: typeof filled.fields) =>
        fields
          .slice(0, MAX_REPORTED_FORM_FIELDS)
          .map(({ page, label, value, basis }) => ({ page, field: label, value, basis }));
      return {
        result: {
          status: "filled",
          attachmentFileId: fileId,
          filename,
          client: source.client
            ? { orgId: source.client.orgId, name: source.client.name }
            : null,
          filedUnder: {
            clientFileId: recorded.clientFileId ?? null,
            procurementRequest: source.request,
            provider: source.provider,
            procurementFileItemId: recorded.fileItemId ?? null,
            version: recorded.version,
          },
          pageCount: filled.pageCount,
          pagesRead: filled.pagesRead,
          filledCount: placed.length,
          filled: report(placed),
          unplaced: report(answered.filter((field) => !pdfFormFieldBox(field))),
          blank: filled.blank.slice(0, MAX_REPORTED_FORM_FIELDS),
          truncated:
            Math.max(answered.length, filled.blank.length) >
            MAX_REPORTED_FORM_FIELDS,
          editing:
            "To correct or add values (the operator may send a screenshot), call edit_pdf_form with the field labels above; each edit files a new version under the same client, request and provider.",
        },
        attachments: [
          {
            fileId,
            filename,
            contentType: "application/pdf",
            size: filled.pdfBytes.byteLength,
          },
        ],
      };
    }

    if (args.toolName === "edit_pdf_form") {
      const input = parseOperatorAgentToolInput("edit_pdf_form", args.input) as {
        source: string;
        changes: Array<{ field: string; value: string }>;
      };
      const fill = await ctx.runQuery(internal.pdfFormFill.getFillForEditInternal, {
        operatorUserId: args.operatorUserId,
        source: input.source,
      });
      const fields = [...fill.fields];
      const changed: Array<{ field: string; value: string; placed: boolean }> = [];
      const problems: string[] = [];
      for (const change of input.changes) {
        const match = findPdfFormField(fields, change.field);
        if ("candidates" in match) {
          problems.push(
            match.candidates.length
              ? `"${change.field}" matches several fields: ${match.candidates.join("; ")}`
              : `No field is labelled "${change.field}"`,
          );
          continue;
        }
        const value = pdfFormFieldValue(match.field, change.value);
        fields[fields.indexOf(match.field)] = { ...match.field, value, basis: "operator" };
        changed.push({
          field: match.field.label,
          value,
          placed: Boolean(pdfFormFieldBox(match.field)),
        });
      }
      if (problems.length)
        throw new NoWriteInputError(
          "unknown_form_fields",
          `Nothing was saved. ${problems.join(". ")}. Use the labels fill_pdf_form reported.`,
        );
      const blob = await ctx.storage.get(fill.sourceFileId);
      if (!blob)
        throw new NoWriteInputError(
          "form_source_unavailable",
          "The original PDF is unavailable.",
        );
      const rendered = await renderPdfFormFields(
        new Uint8Array(await blob.arrayBuffer()),
        fields,
      );
      const fileId = await ctx.storage.store(
        new Blob([new Uint8Array(rendered)], { type: "application/pdf" }),
      );
      let committed;
      try {
        committed = await ctx.runMutation(internal.pdfFormFill.commitEditInternal, {
          operatorUserId: args.operatorUserId,
          fillId: fill.fillId,
          expectedVersion: fill.version,
          fields,
          fileId,
        });
      } catch (error) {
        await ctx.storage.delete(fileId);
        throw error;
      }
      return {
        result: {
          status: "edited",
          attachmentFileId: fileId,
          filename: committed.filename,
          version: committed.version,
          changed,
          ...(changed.some((change) => !change.placed)
            ? {
                notShown:
                  "Some changed fields were never placed on the page, so they do not appear in the PDF; refill with those values in answers.",
              }
            : {}),
        },
        attachments: [
          {
            fileId,
            filename: committed.filename,
            contentType: "application/pdf",
            size: rendered.byteLength,
          },
        ],
      };
    }

    if (RICH_POLICY_TOOLS.has(args.toolName)) {
      const input = args.input as Record<string, unknown>;
      const orgId = input.orgId as Id<"organizations">;
      const organization = await ctx.runQuery(internal.orgs.getInternal, {
        id: orgId,
      });
      if (!organization || organization.type !== "client") {
        throw new Error(
          "Client organization not found. Use an exact client organization ID from search_organizations; a provider ID is not valid here.",
        );
      }
      if (args.toolName === "confirm_policy_fact") {
        const policyId = input.policyId as Id<"policies">;
        const policyAccess = await ctx.runQuery(
          internal.operator.requireOperatorPolicyWriteForUserInternal,
          { userId: args.operatorUserId, policyId },
        );
        if (policyAccess.orgId !== orgId) throw new Error("Policy not found");
      }
      const surface = args.channel === "mcp" ? "mcp" : "web";
      const scope: AgentScope = {
        mode: "client",
        surface,
        primaryOrgId: orgId,
        readOrgIds: [orgId],
        writableOrgIds: [orgId],
        orgs: [
          {
            orgId,
            name: organization.name,
            type: "client",
            isPrimary: true,
            canWrite: true,
          },
        ],
        brokerInternal: false,
      };
      const attachments: Attachment[] = [];
      const executors = buildAgentToolExecutors(ctx, {
        surface,
        orgId,
        userId: args.operatorUserId,
        scope,
        readOrgIds: [orgId],
        writableOrgIds: [orgId],
        canWrite: true,
        onResponseAttachment: (attachment) => {
          if (!attachment.fileId) return;
          attachments.push({
            fileId: attachment.fileId,
            filename: attachment.filename,
            contentType: attachment.contentType,
            size: attachment.size,
          });
        },
      });
      const executor = executors[args.toolName as keyof typeof executors];
      if (!executor || typeof executor.execute !== "function") {
        throw new Error(`Unsupported operator action tool: ${args.toolName}`);
      }
      const { orgId: _orgId, ...toolInput } = input;
      const result = await executor.execute(toolInput as never, {
        toolCallId: `operator:${args.toolName}`,
        messages: [],
      });
      return { result, attachments };
    }

    if (
      args.toolName === "read_client_file" &&
      Array.isArray((args.input as Record<string, unknown>).clientFileIds)
    ) {
      const input = args.input as {
        clientFileIds: string[];
        maxChars?: number;
      };
      const maxChars =
        input.maxChars ??
        Math.min(
          BULK_FILE_TEXT_CHARS,
          Math.max(
            BULK_FILE_MIN_TEXT_CHARS,
            Math.floor(BULK_FILE_TEXT_BUDGET / input.clientFileIds.length),
          ),
        );
      const items = [];
      const notFound: string[] = [];
      for (const clientFileId of input.clientFileIds) {
        const file = await ctx
          .runQuery(internal.clientFiles.getForOperatorInternal, {
            operatorUserId: args.operatorUserId,
            clientFileId: clientFileId as Id<"clientFiles">,
          })
          // A malformed ID fails argument validation like a missing file.
          .catch(() => null);
        if (!file) {
          notFound.push(clientFileId);
          continue;
        }
        const content = await readStoredAgentFile(ctx, {
          fileId: file.fileId,
          filename: file.name,
          contentType: file.contentType,
          size: file.size,
        });
        const text =
          "text" in content && typeof content.text === "string"
            ? content.text
            : undefined;
        items.push({
          clientFileId: file.clientFileId,
          orgId: file.orgId,
          ...content,
          text: text?.slice(0, maxChars),
          truncated: Boolean(text && text.length > maxChars),
        });
      }
      return { result: { items, notFound } };
    }

    if (
      args.toolName === "read_client_file" ||
      args.toolName === "attach_client_file"
    ) {
      const input = args.input as Record<string, unknown>;
      const file = await ctx.runQuery(
        internal.clientFiles.getForOperatorInternal,
        {
          operatorUserId: args.operatorUserId,
          clientFileId: input.clientFileId as Id<"clientFiles">,
        },
      );
      if (!file) throw new Error("Client file not found");
      if (args.toolName === "attach_client_file") {
        return {
          result: {
            status: "attached",
            clientFileId: file.clientFileId,
            name: file.name,
          },
          attachments: [
            {
              fileId: file.fileId,
              filename: file.name,
              contentType: file.contentType,
              size: file.size,
            },
          ],
        };
      }
      return {
        result: await readStoredAgentFile(ctx, {
          fileId: file.fileId,
          filename: file.name,
          contentType: file.contentType,
          size: file.size,
        }),
      };
    }

    if (args.toolName === "search_thread_history") {
      const input = args.input as Record<string, unknown>;
      const limit = typeof input.limit === "number" ? input.limit : 5;
      const dayStart = (date: unknown) =>
        typeof date === "string" ? dayjs(`${date}T00:00:00Z`).valueOf() : undefined;
      const fromTime = dayStart(input.dateFrom);
      const lastDay = dayStart(input.dateTo);
      const toTime = lastDay === undefined ? undefined : lastDay + 24 * 60 * 60 * 1000;
      const matches: unknown[] = [];
      let cursor = typeof input.cursor === "string" ? input.cursor : undefined;
      let more = true;
      // A date range filters inside each page, so keep paging until the page
      // is filled or the search is exhausted (bounded attempts).
      for (let attempt = 0; attempt < 5 && more && matches.length < limit; attempt++) {
        const page = await ctx.runQuery(
          internal.operatorAgent.searchThreadHistoryInternal,
          {
            operatorUserId: args.operatorUserId,
            threadId: args.threadId,
            query: String(input.query),
            limit: limit - matches.length,
            cursor,
            fromTime,
            toTime,
          },
        );
        matches.push(...page.matches);
        cursor = page.nextCursor ?? undefined;
        more = page.nextCursor !== null;
      }
      return {
        result: { matches, nextCursor: more ? (cursor ?? null) : null, bounded: more },
      };
    }

    if (args.toolName === "read_thread_attachment") {
      const input = args.input as Record<string, unknown>;
      const attachment = await ctx.runQuery(
        internal.operatorAgent.getThreadAttachmentInternal,
        {
          operatorUserId: args.operatorUserId,
          threadId: args.threadId,
          messageId: input.messageId as Id<"operatorAgentMessages">,
          filename: String(input.filename),
        },
      );
      if (!attachment)
        throw new Error(
          "Operator thread attachment not found. Use the exact messageId and filename returned by search_thread_history.",
        );
      return { result: await readStoredAgentFile(ctx, attachment) };
    }

    throw new Error(`Unsupported operator rich action tool: ${args.toolName}`);
  },
});
