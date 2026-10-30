import dayjs from "dayjs";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { assertNoOperatorImpersonation } from "./lib/clientFiles";
import { NoWriteInputError } from "./lib/noWriteInputError";
import {
  getActiveOperatorProfile,
  requireOperator,
} from "./lib/operatorIdentity";
import {
  pdfFormFieldValidator,
  pdfFormModeValidator,
} from "./lib/pdfFormFields";
import { parsePdfFormSourceId } from "./lib/pdfFormSource";
import { commitPdfFormEdit, fillForVersionFile } from "./pdfFormFill";

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

/** The stored file behind a PDF panel source, when it can be a filled form. */
async function sourceFileId(ctx: QueryCtx, source: string) {
  const parsed = parsePdfFormSourceId(source);
  if (parsed?.kind === "operatorAttachment")
    return ctx.db.system.normalizeId("_storage", parsed.fileId);
  if (parsed?.kind === "clientFile") {
    const id = ctx.db.normalizeId("clientFiles", parsed.clientFileId);
    const file = id ? await ctx.db.get(id) : null;
    return file && !file.deletedAt ? file.fileId : null;
  }
  return null;
}

/**
 * The filled form open in the PDF panel, from any of its versions. Editing
 * always starts from the latest version's fields over the original.
 */
export const getForDocument = query({
  args: { source: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      fillId: v.id("pdfFormFills"),
      version: v.number(),
      isLatest: v.boolean(),
      mode: pdfFormModeValidator,
      originalUrl: v.union(v.string(), v.null()),
      fields: v.array(pdfFormFieldValidator),
    }),
  ),
  handler: async (ctx, { source }) => {
    // Clients open the same files in their library; editing is operator-only.
    if (!(await getActiveOperatorProfile(ctx))) return null;
    const fileId = await sourceFileId(ctx, source);
    const fill = fileId ? await fillForVersionFile(ctx, fileId) : null;
    if (!fill) return null;
    return {
      fillId: fill._id,
      version: fill.version,
      isLatest: fill.outputFileId === fileId,
      mode: fill.mode,
      originalUrl: await ctx.storage.getUrl(fill.sourceFileId),
      fields: fill.fields,
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
    const { operator } = await editableFill(ctx, args);
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

    // Swap the agent's attachment so the conversation carries the latest version.
    const attachment = {
      fileId: args.fileId,
      filename: committed.filename,
      contentType: "application/pdf",
      size: metadata.size,
    };
    const now = dayjs().valueOf();
    for await (const row of ctx.db
      .query("operatorAgentAttachments")
      .withIndex("file", (q) => q.eq("fileId", committed.previousFileId))) {
      const message = await ctx.db.get(row.messageId);
      if (
        message?.role !== "agent" ||
        !message.attachments?.some(
          (entry) => entry.fileId === committed.previousFileId,
        )
      )
        continue;
      await ctx.db.insert("operatorAgentAttachments", {
        ...attachment,
        operatorUserId: operator.userId,
        threadId: message.threadId,
        messageId: message._id,
        createdAt: now,
      });
      await ctx.db.patch(message._id, {
        attachments: message.attachments.map((entry) =>
          entry.fileId === committed.previousFileId ? attachment : entry,
        ),
        updatedAt: now,
      });
    }
    return {
      version: committed.version,
      filename: committed.filename,
      clientFileId: committed.clientFileId ?? null,
    };
  },
});

export const discardUncommittedFileInternal = internalMutation({
  args: { fileId: v.id("_storage") },
  handler: async (ctx, { fileId }) => {
    // A lost mutation response may follow a successful commit, even if a newer
    // edit has already superseded it. Every committed version must keep its bytes.
    const committed = await ctx.db
      .query("pdfFormFillVersions")
      .withIndex("by_fileId", (q) => q.eq("fileId", fileId))
      .first();
    if (!committed) await ctx.storage.delete(fileId);
    return null;
  },
});
