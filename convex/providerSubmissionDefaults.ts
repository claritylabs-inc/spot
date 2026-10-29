import dayjs from "dayjs";
import { v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  assertExternalBrokerIdentity,
  normalizeBrokerLineOfBusinessCodes,
} from "./lib/brokerProfileValidation";
import { assertNoOperatorImpersonation } from "./lib/clientFiles";
import {
  requireOperator,
  requireOperatorForUser,
  writeOperatorAudit,
} from "./lib/operatorIdentity";
import {
  providerSubmissionAttachmentValidator,
  providerSubmissionFormValidator,
  providerSubmissionSaveArgs,
} from "./lib/providerSubmissionDefaultFields";
import { teamTargetProblem } from "./lib/teamEmailStore";

const MAX_DEFAULTS = 200;
const MAX_FORMS = 20;
const MAX_FORM_BYTES = 30 * 1024 * 1024;
const _saveArgsValidator = v.object(providerSubmissionSaveArgs);
type SaveArgs = Infer<typeof _saveArgsValidator>;
type Attachment = Infer<typeof providerSubmissionAttachmentValidator>;
type Form = Infer<typeof providerSubmissionFormValidator>;
type Ctx = QueryCtx | MutationCtx;

async function requireProvider(ctx: Ctx, brokerOrgId: Id<"organizations">) {
  const provider = await ctx.db.get(brokerOrgId);
  if (
    !provider ||
    provider.deletedAt !== undefined ||
    provider.type !== "broker"
  )
    throw new Error("Provider not found");
  assertExternalBrokerIdentity(provider);
  return provider;
}

function boundedText(value: string, max: number, label: string) {
  const clean = value.trim();
  if (clean.length > max) throw new Error(`${label} exceeds ${max} characters`);
  return clean;
}

function cleanFields(args: SaveArgs) {
  const codes = normalizeBrokerLineOfBusinessCodes([args.coverageCode]);
  if (codes.length !== 1) throw new Error("Select one coverage line");
  if (args.requirements.length > 40)
    throw new Error("Use at most 40 minimum-information questions");
  const requirements = args.requirements.map((requirement) => {
    const question = boundedText(requirement.question, 1000, "Question");
    if (!question)
      throw new Error("Each information requirement needs a question");
    return {
      question,
      guidance: boundedText(requirement.guidance, 4000, "Answer guidance"),
    };
  });
  const instructions = boundedText(
    args.instructions,
    16000,
    "Submission instructions",
  );
  if (JSON.stringify({ instructions, requirements }).length > 100000)
    throw new Error("Submission defaults exceed the 100,000-character limit");
  return { coverageCode: codes[0], instructions, requirements };
}

async function requireSource(
  ctx: Ctx,
  threadId: Id<"teamEmailThreads">,
  messageId?: Id<"teamEmailMessages">,
) {
  const thread = await ctx.db.get(threadId);
  if (
    !thread ||
    thread.deletedAt !== undefined ||
    (await teamTargetProblem(ctx, thread))
  )
    throw new Error("Source conversation is unavailable");
  if (!messageId) return null;
  const message = await ctx.db.get(messageId);
  if (!message || message.threadId !== thread._id)
    throw new Error("Source message does not belong to this conversation");
  return message;
}

async function validateAttachment(ctx: Ctx, attachment: Attachment) {
  if (Boolean(attachment.clientFileId) === Boolean(attachment.storageId))
    throw new Error("Select one attachment from the source message");
  const message = await requireSource(
    ctx,
    attachment.threadId,
    attachment.messageId,
  );
  if (!message) throw new Error("Source message is unavailable");
  let sourceStorageId: Id<"_storage">;
  let name: string;
  let contentType: string;
  if (attachment.clientFileId) {
    if (!message.clientFileIds.includes(attachment.clientFileId))
      throw new Error("This file is not attached to the source message");
    const file = await ctx.db.get(attachment.clientFileId);
    if (
      !file ||
      file.archivedAt !== undefined ||
      file.deletedAt !== undefined ||
      file.orgId !== message.clientOrgId
    )
      throw new Error("Source attachment is unavailable");
    sourceStorageId = file.fileId;
    name = file.name;
    contentType = file.contentType;
  } else {
    const file = message.unfiledAttachments?.find(
      (candidate) => candidate.storageId === attachment.storageId,
    );
    if (!file)
      throw new Error("This file is not attached to the source message");
    sourceStorageId = file.storageId;
    name = file.name;
    contentType = file.contentType;
  }
  const metadata = await ctx.db.system.get("_storage", sourceStorageId);
  if (!metadata) throw new Error("Source attachment bytes are unavailable");
  if (metadata.size > MAX_FORM_BYTES)
    throw new Error("Application documents must be at most 30 MB");
  return {
    sourceStorageId,
    name: boundedText(name, 500, "Document name") || "Application document",
    contentType: boundedText(contentType, 200, "Document content type"),
    size: metadata.size,
    sha256: metadata.sha256,
    sourceThreadId: attachment.threadId,
    sourceMessageId: attachment.messageId,
    ...(attachment.clientFileId
      ? { sourceClientFileId: attachment.clientFileId }
      : {}),
  };
}

async function existingDefault(ctx: Ctx, args: SaveArgs) {
  const fields = cleanFields(args);
  const existing = await ctx.db
    .query("providerSubmissionDefaults")
    .withIndex("by_brokerOrgId_and_coverageCode", (q) =>
      q
        .eq("brokerOrgId", args.brokerOrgId)
        .eq("coverageCode", fields.coverageCode),
    )
    .unique();
  if (
    existing
      ? existing.revision !== args.expectedRevision
      : (args.expectedRevision ?? 0) !== 0
  )
    throw new Error(
      "These submission defaults changed. Reload before saving again.",
    );
  return { fields, existing };
}

/** Internal callers must supply their actor; all paths recheck the active operator. */
export async function listProviderSubmissionDefaults(
  ctx: Ctx,
  brokerOrgId: Id<"organizations">,
  operatorUserId?: Id<"users">,
) {
  if (operatorUserId) await requireOperatorForUser(ctx, operatorUserId);
  else await requireOperator(ctx);
  await requireProvider(ctx, brokerOrgId);
  const rows = await ctx.db
    .query("providerSubmissionDefaults")
    .withIndex("by_brokerOrgId_and_coverageCode", (q) =>
      q.eq("brokerOrgId", brokerOrgId),
    )
    .paginate({
      cursor: null,
      numItems: MAX_DEFAULTS,
      maximumBytesRead: 1_000_000,
    });
  return {
    defaults: await Promise.all(
      rows.page.map(async (row) => ({
        ...row,
        forms: await Promise.all(
          row.forms.map(async (form) => ({
            ...form,
            url: await ctx.storage.getUrl(form.storageId),
          })),
        ),
      })),
    ),
    bounded: !rows.isDone,
  };
}

export const list = query({
  args: { brokerOrgId: v.id("organizations") },
  handler: async (ctx, { brokerOrgId }) => {
    return await listProviderSubmissionDefaults(ctx, brokerOrgId);
  },
});

async function saveDefault(ctx: MutationCtx, args: SaveArgs, form?: Form) {
  const operator = await requireOperator(ctx);
  await assertNoOperatorImpersonation(ctx, operator.userId);
  const provider = await requireProvider(ctx, args.brokerOrgId);
  const { fields, existing } = await existingDefault(ctx, args);
  if (args.sourceMessageId && !args.sourceThreadId)
    throw new Error("A source message needs its conversation");
  if (args.sourceThreadId)
    await requireSource(ctx, args.sourceThreadId, args.sourceMessageId);
  if (!existing) {
    const current = await ctx.db
      .query("providerSubmissionDefaults")
      .withIndex("by_brokerOrgId_and_coverageCode", (q) =>
        q.eq("brokerOrgId", provider._id),
      )
      .take(MAX_DEFAULTS);
    if (current.length >= MAX_DEFAULTS)
      throw new Error(
        "This provider already has 200 coverage submission defaults",
      );
  }
  const forms = existing?.forms ?? [];
  if (form) {
    if (forms.length >= MAX_FORMS)
      throw new Error("Use at most 20 application documents per coverage line");
    forms.push(form);
  }
  const now = dayjs().valueOf();
  const values = {
    ...fields,
    forms,
    sourceThreadId: args.sourceThreadId ?? existing?.sourceThreadId,
    sourceMessageId: args.sourceThreadId
      ? args.sourceMessageId
      : existing?.sourceMessageId,
    revision: (existing?.revision ?? 0) + 1,
    updatedAt: now,
    updatedByUserId: operator.userId,
  };
  const defaultId = existing
    ? (await ctx.db.patch(existing._id, values), existing._id)
    : await ctx.db.insert("providerSubmissionDefaults", {
        brokerOrgId: provider._id,
        ...values,
        createdAt: now,
      });
  await writeOperatorAudit(ctx, {
    operatorUserId: operator.userId,
    type: "setup_write",
    targetOrgId: provider._id,
    summary: `Saved ${fields.coverageCode} submission defaults for ${provider.name}`,
    metadata: {
      defaultId,
      revision: values.revision,
      documentAdded: Boolean(form),
    },
  });
  return { defaultId, revision: values.revision };
}

export const save = mutation({
  args: providerSubmissionSaveArgs,
  handler: async (ctx, args) => await saveDefault(ctx, args),
});

export const attachmentInputInternal = internalQuery({
  args: {
    ...providerSubmissionSaveArgs,
    attachment: providerSubmissionAttachmentValidator,
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await assertNoOperatorImpersonation(ctx, operator.userId);
    await requireProvider(ctx, args.brokerOrgId);
    const { existing } = await existingDefault(ctx, args);
    const source = await validateAttachment(ctx, args.attachment);
    const duplicate = existing?.forms.find(
      (form) =>
        form.sourceMessageId === source.sourceMessageId &&
        form.sourceStorageId === source.sourceStorageId,
    );
    if (!duplicate && (existing?.forms.length ?? 0) >= MAX_FORMS)
      throw new Error("Use at most 20 application documents per coverage line");
    return { ...source, duplicate: Boolean(duplicate) };
  },
});

export const saveAttachmentInternal = internalMutation({
  args: {
    ...providerSubmissionSaveArgs,
    attachment: providerSubmissionAttachmentValidator,
    copiedStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, { attachment, copiedStorageId, ...args }) => {
    const operator = await requireOperator(ctx);
    await assertNoOperatorImpersonation(ctx, operator.userId);
    await requireProvider(ctx, args.brokerOrgId);
    const { existing } = await existingDefault(ctx, args);
    const source = await validateAttachment(ctx, attachment);
    const duplicate = existing?.forms.some(
      (form) =>
        form.sourceMessageId === source.sourceMessageId &&
        form.sourceStorageId === source.sourceStorageId,
    );
    if (duplicate) {
      if (copiedStorageId) await ctx.storage.delete(copiedStorageId);
      return await saveDefault(ctx, args);
    }
    if (!copiedStorageId)
      throw new Error("Application document copy is unavailable");
    const copied = await ctx.db.system.get("_storage", copiedStorageId);
    if (
      !copied ||
      copied.sha256 !== source.sha256 ||
      copied.size !== source.size
    )
      throw new Error("Source attachment changed. Select it again.");
    const { sha256: _sha256, ...formSource } = source;
    return await saveDefault(ctx, args, {
      ...formSource,
      storageId: copiedStorageId,
      addedAt: dayjs().valueOf(),
    });
  },
});

/** Copy bytes so removing or refiling a conversation cannot break a reusable form. */
export const saveFromAttachment = action({
  args: {
    ...providerSubmissionSaveArgs,
    attachment: providerSubmissionAttachmentValidator,
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    defaultId: Id<"providerSubmissionDefaults">;
    revision: number;
  }> => {
    const source = await ctx.runQuery(
      internal.providerSubmissionDefaults.attachmentInputInternal,
      args,
    );
    let copiedStorageId: Id<"_storage"> | undefined;
    try {
      if (!source.duplicate) {
        const blob = await ctx.storage.get(source.sourceStorageId);
        if (!blob) throw new Error("Source attachment bytes are unavailable");
        copiedStorageId = await ctx.storage.store(blob);
      }
      return await ctx.runMutation(
        internal.providerSubmissionDefaults.saveAttachmentInternal,
        {
          ...args,
          ...(copiedStorageId ? { copiedStorageId } : {}),
        },
      );
    } catch (error) {
      // A failed action response can follow a committed mutation. Check the
      // record transactionally before cleaning up rather than breaking its form.
      if (copiedStorageId)
        await ctx.runMutation(
          internal.providerSubmissionDefaults.discardAttachmentCopyInternal,
          {
            brokerOrgId: args.brokerOrgId,
            coverageCode: args.coverageCode,
            copiedStorageId,
          },
        );
      throw error;
    }
  },
});

export const discardAttachmentCopyInternal = internalMutation({
  args: {
    brokerOrgId: v.id("organizations"),
    coverageCode: v.string(),
    copiedStorageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const coverageCode = normalizeBrokerLineOfBusinessCodes([
      args.coverageCode,
    ])[0];
    const row = await ctx.db
      .query("providerSubmissionDefaults")
      .withIndex("by_brokerOrgId_and_coverageCode", (q) =>
        q.eq("brokerOrgId", args.brokerOrgId).eq("coverageCode", coverageCode),
      )
      .unique();
    if (!row?.forms.some((form) => form.storageId === args.copiedStorageId))
      await ctx.storage.delete(args.copiedStorageId);
    return null;
  },
});

async function editableDefault(
  ctx: MutationCtx,
  defaultId: Id<"providerSubmissionDefaults">,
  expectedRevision: number,
) {
  const operator = await requireOperator(ctx);
  await assertNoOperatorImpersonation(ctx, operator.userId);
  const row = await ctx.db.get(defaultId);
  if (!row) throw new Error("Submission defaults not found");
  await requireProvider(ctx, row.brokerOrgId);
  if (row.revision !== expectedRevision)
    throw new Error(
      "These submission defaults changed. Reload before removing them.",
    );
  return { row, operator };
}

export const removeForm = mutation({
  args: {
    defaultId: v.id("providerSubmissionDefaults"),
    expectedRevision: v.number(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const { row, operator } = await editableDefault(
      ctx,
      args.defaultId,
      args.expectedRevision,
    );
    const form = row.forms.find(
      (candidate) => candidate.storageId === args.storageId,
    );
    if (!form) throw new Error("Application document not found");
    const revision = row.revision + 1;
    await ctx.db.patch(row._id, {
      forms: row.forms.filter(
        (candidate) => candidate.storageId !== args.storageId,
      ),
      revision,
      updatedAt: dayjs().valueOf(),
      updatedByUserId: operator.userId,
    });
    await ctx.storage.delete(form.storageId);
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      targetOrgId: row.brokerOrgId,
      summary: `Removed an application document from ${row.coverageCode} submission defaults`,
      metadata: { defaultId: row._id, revision },
    });
    return { revision };
  },
});

export const remove = mutation({
  args: {
    defaultId: v.id("providerSubmissionDefaults"),
    expectedRevision: v.number(),
  },
  handler: async (ctx, args) => {
    const { row, operator } = await editableDefault(
      ctx,
      args.defaultId,
      args.expectedRevision,
    );
    await ctx.db.delete(row._id);
    for (const form of row.forms) await ctx.storage.delete(form.storageId);
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      targetOrgId: row.brokerOrgId,
      summary: `Removed ${row.coverageCode} submission defaults`,
      metadata: { defaultId: row._id },
    });
    return null;
  },
});
