import dayjs from "dayjs";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { assertNoOperatorImpersonation } from "./lib/clientFiles";
import { NoWriteInputError } from "./lib/noWriteInputError";
import { requireOperator } from "./lib/operatorIdentity";
import {
  pdfFormFieldValidator,
  pdfFormModeValidator,
} from "./lib/pdfFormFields";
import { requireOperatorThread } from "./operatorAgent";
import { commitPdfFormEdit } from "./pdfFormFill";

const editArgs = {
  fillId: v.id("pdfFormFills"),
  expectedVersion: v.number(),
};

async function editableFill(
  ctx: QueryCtx | MutationCtx,
  args: { fillId: Id<"pdfFormFills">; expectedVersion: number },
) {
  const operator = await requireOperator(ctx);
  await assertNoOperatorImpersonation(ctx, operator.userId);
  const fill = await ctx.db.get(args.fillId);
  if (!fill)
    throw new NoWriteInputError("form_not_found", "Filled form not found");
  await requireOperatorThread(ctx, fill.threadId, operator.userId, {
    anyOperator: true,
  });
  if (
    !Number.isInteger(args.expectedVersion) ||
    fill.version !== args.expectedVersion
  )
    throw new NoWriteInputError(
      "form_version_conflict",
      "This form was saved by someone else. Reload before saving again.",
    );
  return { fill, operator };
}

export const getForAttachment = query({
  args: { fileId: v.id("_storage") },
  returns: v.union(
    v.null(),
    v.object({ isStale: v.literal(true), outputFileId: v.id("_storage") }),
    v.object({
      isStale: v.literal(false),
      fillId: v.id("pdfFormFills"),
      threadId: v.id("operatorAgentThreads"),
      version: v.number(),
      mode: pdfFormModeValidator,
      pageCount: v.number(),
      sourceFilename: v.string(),
      outputFilename: v.string(),
      originalUrl: v.union(v.string(), v.null()),
      outputUrl: v.union(v.string(), v.null()),
      fields: v.array(pdfFormFieldValidator),
      filing: v.object({
        clientName: v.optional(v.string()),
        requestTitle: v.optional(v.string()),
        providerName: v.optional(v.string()),
      }),
      versions: v.array(
        v.object({
          version: v.number(),
          filename: v.string(),
          source: v.union(v.literal("autofill"), v.literal("edit")),
          createdAt: v.number(),
        }),
      ),
    }),
  ),
  handler: async (ctx, { fileId }) => {
    const operator = await requireOperator(ctx);
    const fill = await ctx.db
      .query("pdfFormFills")
      .withIndex("by_outputFileId", (q) => q.eq("outputFileId", fileId))
      .first();
    if (!fill) {
      // Historical attachment rows survive edits and narrow the version lookup
      // to their conversations rather than scanning every saved form.
      const threads = new Set<Id<"operatorAgentThreads">>();
      for await (const attachment of ctx.db
        .query("operatorAgentAttachments")
        .withIndex("file", (q) => q.eq("fileId", fileId))) {
        if (threads.has(attachment.threadId)) continue;
        threads.add(attachment.threadId);
        for await (const candidate of ctx.db
          .query("pdfFormFills")
          .withIndex("by_threadId", (q) =>
            q.eq("threadId", attachment.threadId),
          )) {
          if (candidate.versions.some((version) => version.fileId === fileId)) {
            await requireOperatorThread(
              ctx,
              candidate.threadId,
              operator.userId,
              {
                anyOperator: true,
              },
            );
            return {
              isStale: true as const,
              outputFileId: candidate.outputFileId,
            };
          }
        }
      }
      return null;
    }
    await requireOperatorThread(ctx, fill.threadId, operator.userId, {
      anyOperator: true,
    });
    const [client, request, provider, originalUrl, outputUrl] =
      await Promise.all([
        fill.clientOrgId ? ctx.db.get(fill.clientOrgId) : null,
        fill.requestId ? ctx.db.get(fill.requestId) : null,
        fill.brokerOrgId ? ctx.db.get(fill.brokerOrgId) : null,
        ctx.storage.getUrl(fill.sourceFileId),
        ctx.storage.getUrl(fill.outputFileId),
      ]);
    return {
      isStale: false as const,
      fillId: fill._id,
      threadId: fill.threadId,
      version: fill.version,
      mode: fill.mode,
      pageCount: fill.pageCount,
      sourceFilename: fill.sourceFilename,
      outputFilename: fill.outputFilename,
      originalUrl,
      outputUrl,
      fields: fill.fields,
      filing: {
        ...(client ? { clientName: client.name } : {}),
        ...(request ? { requestTitle: request.title } : {}),
        ...(provider ? { providerName: provider.name } : {}),
      },
      versions: fill.versions.map(
        ({ version, filename, source, createdAt }) => ({
          version,
          filename,
          source,
          createdAt,
        }),
      ),
    };
  },
});

export const getSaveInputInternal = internalQuery({
  args: editArgs,
  handler: async (ctx, args) => {
    const { fill } = await editableFill(ctx, args);
    return {
      sourceFileId: fill.sourceFileId,
      pageCount: fill.pageCount,
      mode: fill.mode,
      fields: fill.fields,
    };
  },
});

export const commitEditsInternal = internalMutation({
  args: {
    ...editArgs,
    fields: v.array(pdfFormFieldValidator),
    fileId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const { fill, operator } = await editableFill(ctx, args);
    let message: Doc<"operatorAgentMessages"> | null = null;
    for await (const attachment of ctx.db
      .query("operatorAgentAttachments")
      .withIndex("thread_file", (q) =>
        q.eq("threadId", fill.threadId).eq("fileId", fill.outputFileId),
      )) {
      const candidate = await ctx.db.get(attachment.messageId);
      if (
        candidate?.threadId === fill.threadId &&
        candidate.role === "agent" &&
        candidate.attachments?.some(
          (entry) => entry.fileId === fill.outputFileId,
        )
      ) {
        message = candidate;
        break;
      }
    }
    if (!message)
      throw new NoWriteInputError(
        "form_attachment_not_found",
        "The filled form is no longer attached to its conversation.",
      );
    const metadata = await ctx.db.system.get("_storage", args.fileId);
    if (!metadata || metadata.contentType !== "application/pdf")
      throw new NoWriteInputError(
        "form_file_unavailable",
        "The edited PDF is unavailable.",
      );

    const committed = await commitPdfFormEdit(ctx, {
      ...args,
      operatorUserId: operator.userId,
    });
    const attachment = {
      fileId: args.fileId,
      filename: committed.filename,
      contentType: "application/pdf",
      size: metadata.size,
    };
    const now = dayjs().valueOf();
    await ctx.db.insert("operatorAgentAttachments", {
      ...attachment,
      operatorUserId: operator.userId,
      threadId: committed.threadId,
      messageId: message._id,
      createdAt: now,
    });
    await ctx.db.patch(message._id, {
      attachments: message.attachments!.map((entry) =>
        entry.fileId === committed.previousFileId ? attachment : entry,
      ),
      updatedAt: now,
    });
    return { version: committed.version, filename: committed.filename };
  },
});

export const discardUncommittedFileInternal = internalMutation({
  args: { fillId: v.id("pdfFormFills"), fileId: v.id("_storage") },
  handler: async (ctx, { fillId, fileId }) => {
    const fill = await ctx.db.get(fillId);
    // A lost mutation response may follow a successful commit, even if a newer
    // edit has already superseded it. Every committed version must keep its bytes.
    if (!fill?.versions.some((version) => version.fileId === fileId))
      await ctx.storage.delete(fileId);
    return null;
  },
});
