import dayjs from "dayjs";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  assertNoOperatorImpersonation,
  normalizeClientFileSha256,
} from "./lib/clientFiles";
import { requireOperatorForUser } from "./lib/operatorIdentity";
import { createOperatorUploadByUser } from "./policies";
import { actionConfirmationFingerprint } from "./lib/actionConfirmationFingerprint";

const sourceArgs = {
  operatorUserId: v.id("users"),
  threadId: v.id("operatorAgentThreads"),
  orgId: v.id("organizations"),
  attachmentFileIds: v.optional(v.array(v.string())),
  clientFileIds: v.optional(v.array(v.string())),
};

export type OperatorPolicySource = {
  fileId: Id<"_storage">;
  fileName: string;
  fileSha256: string;
  size: number;
};

export function operatorPolicySourceFingerprint(files: OperatorPolicySource[]) {
  return actionConfirmationFingerprint({
    toolName: "import_policy_files_sources",
    toolVersion: 1,
    input: files,
  });
}

export async function resolveOperatorPolicySources(
  ctx: QueryCtx | MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    threadId: Id<"operatorAgentThreads">;
    orgId: Id<"organizations">;
    attachmentFileIds?: string[];
    clientFileIds?: string[];
  },
): Promise<OperatorPolicySource[]> {
  await requireOperatorForUser(ctx, args.operatorUserId);
  await assertNoOperatorImpersonation(ctx, args.operatorUserId);
  const [thread, client] = await Promise.all([
    ctx.db.get(args.threadId),
    ctx.db.get(args.orgId),
  ]);
  if (
    !thread ||
    (thread.ownerUserId !== args.operatorUserId &&
      thread.visibility !== "shared")
  )
    throw new Error("Operator conversation not found");
  if (!client || client.type !== "client") throw new Error("Client not found");
  const count =
    (args.attachmentFileIds?.length ?? 0) + (args.clientFileIds?.length ?? 0);
  if (count < 1 || count > 10)
    throw new Error("Select between one and ten PDF files");
  const sources: Array<{ fileId: Id<"_storage">; fileName: string }> = [];
  for (const reference of args.attachmentFileIds ?? []) {
    const fileId = ctx.db.system.normalizeId("_storage", reference);
    const attachment = fileId
      ? await ctx.db
          .query("operatorAgentAttachments")
          .withIndex("thread_file", (q) =>
            q.eq("threadId", args.threadId).eq("fileId", fileId),
          )
          .first()
      : null;
    if (!attachment)
      throw new Error(
        "Policy attachment must belong to this operator conversation",
      );
    sources.push({ fileId: attachment.fileId, fileName: attachment.filename });
  }
  for (const reference of args.clientFileIds ?? []) {
    const id = ctx.db.normalizeId("clientFiles", reference);
    const file = id ? await ctx.db.get(id) : null;
    if (!file || file.orgId !== args.orgId || file.archivedAt || file.deletedAt)
      throw new Error(
        "Policy source must be an active file belonging to the selected client",
      );
    sources.push({ fileId: file.fileId, fileName: file.name });
  }
  if (new Set(sources.map((file) => file.fileId)).size !== sources.length)
    throw new Error("The same PDF was selected more than once");
  const result: OperatorPolicySource[] = [];
  let size = 0;
  for (const file of sources) {
    const metadata = await ctx.db.system.get("_storage", file.fileId);
    if (!metadata || !file.fileName.toLowerCase().endsWith(".pdf"))
      throw new Error("Policy imports require available PDF files");
    size += metadata.size;
    if (metadata.size > 25 * 1024 * 1024 || size > 50 * 1024 * 1024)
      throw new Error(
        "Policy imports support 25 MB per PDF and 50 MB in total",
      );
    result.push({
      ...file,
      size: metadata.size,
      fileSha256: normalizeClientFileSha256(metadata.sha256),
    });
  }
  return result;
}

export const getSourcesInternal = internalQuery({
  args: sourceArgs,
  handler: resolveOperatorPolicySources,
});

export const commitInternal = internalMutation({
  args: {
    ...sourceArgs,
    confirmationId: v.id("operatorAgentConfirmations"),
    mode: v.union(v.literal("combined"), v.literal("separate")),
    mergedFileId: v.optional(v.id("_storage")),
    mergedFileName: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{
      policyId: Id<"policies">;
      fileName: string;
      status: "queued" | "duplicate";
    }>
  > => {
    const files = await resolveOperatorPolicySources(ctx, args);
    const confirmation = await ctx.db.get(args.confirmationId);
    if (
      !confirmation ||
      confirmation.status !== "completed" ||
      confirmation.operatorUserId !== args.operatorUserId ||
      confirmation.threadId !== args.threadId ||
      confirmation.payload.toolName !== "import_policy_files" ||
      confirmation.payload.sourceFingerprint !==
        (await operatorPolicySourceFingerprint(files))
    )
      throw new Error(
        "Policy sources changed since confirmation; request a fresh import approval",
      );
    const confirmedInput = JSON.parse(confirmation.payload.input) as {
      orgId: string;
      mode: string;
    };
    const run = await ctx.db.get(confirmation.payload.runId);
    if (
      confirmedInput.orgId !== args.orgId ||
      confirmedInput.mode !== args.mode ||
      !run ||
      run.status !== "running" ||
      run.cancellationRequestedAt
    )
      throw new Error("Policy import confirmation is no longer active");
    const combined = args.mode === "combined" && files.length > 1;
    if (
      combined &&
      (!args.mergedFileId ||
        !(await ctx.db.system.get("_storage", args.mergedFileId)))
    )
      throw new Error("Merged PDF is unavailable");
    const groups =
      args.mode === "combined" ? [files] : files.map((file) => [file]);
    const results: Array<{
      policyId: Id<"policies">;
      fileName: string;
      status: "queued" | "duplicate";
    }> = [];
    for (const group of groups) {
      const fileId = combined ? args.mergedFileId! : group[0].fileId;
      const fileName = combined
        ? (args.mergedFileName ?? "combined-policy.pdf")
        : group[0].fileName;
      const hashes = group.map((file) => file.fileSha256);
      let duplicate: Id<"policies"> | undefined;
      for await (const policy of ctx.db
        .query("policies")
        .withIndex("organization", (q) => q.eq("orgId", args.orgId))) {
        if (
          !policy.deletedAt &&
          hashes.every((hash) => policy.uploadFileSha256s?.includes(hash))
        ) {
          duplicate = policy._id;
          break;
        }
      }
      if (duplicate) {
        results.push({ policyId: duplicate, fileName, status: "duplicate" });
        continue;
      }
      const policyId = await createOperatorUploadByUser(
        ctx,
        args.operatorUserId,
        {
          clientOrgId: args.orgId,
          fileId,
          fileName,
          uploadFileSha256s: hashes,
          documentType: "policy",
        },
      );
      const policyFileId = await ctx.db.insert("policyFiles", {
        policyId,
        fileId,
        fileName,
        fileType: "unknown",
        orgId: args.orgId,
        createdAt: dayjs().valueOf(),
      });
      await ctx.db.patch(policyId, {
        files: [
          { fileId, fileName, fileType: "unknown", status: "extracting" },
        ],
        reconciliationStatus: "pending",
      });
      await ctx.scheduler.runAfter(
        0,
        internal.actions.policyExtraction.startPolicyExtractionFromUpload,
        {
          policyId,
          fileId,
          fileName,
          policyFileId,
          orgId: args.orgId,
          userId: args.operatorUserId,
        },
      );
      results.push({ policyId, fileName, status: "queued" });
    }
    return results;
  },
});
