import dayjs from "dayjs";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  normalizeAgentAttachmentContentType,
  normalizeAgentAttachmentFilename,
} from "./agentAttachmentLimits";
import { buildClientFileName } from "./clientFileNames";
import {
  requireOperator,
  requireOperatorForUser,
  writeOperatorAudit,
} from "./operatorIdentity";
import { throwUserFacingError, userFacingErrorCodes } from "./userFacingErrors";
import { scheduleClientFileCompanyInformation } from "../companyInformation";

export function normalizeClientFileSha256(value: string) {
  const trimmed = value.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
  try {
    const binary = atob(trimmed);
    let hex = "";
    for (let index = 0; index < binary.length; index += 1)
      hex += binary.charCodeAt(index).toString(16).padStart(2, "0");
    if (hex.length === 64) return hex;
  } catch {
    // Retain a stable normalized value for storage providers using another form.
  }
  return trimmed.toLowerCase();
}

export async function findReusableClientFileByContent(
  ctx: QueryCtx | MutationCtx,
  args: {
    orgId: Id<"organizations">;
    sha256: string;
    policyId?: Id<"policies">;
  },
): Promise<Doc<"clientFiles"> | null> {
  const matches = await ctx.db
    .query("clientFiles")
    .withIndex("content", (query) =>
      query.eq("orgId", args.orgId).eq("sha256", args.sha256),
    )
    .take(100);
  return (
    matches.find(
      (file) =>
        !file.archivedAt &&
        !file.deletedAt &&
        (!args.policyId || !file.policyId || file.policyId === args.policyId),
    ) ?? null
  );
}

export async function repointOperatorAttachmentBlob(
  ctx: MutationCtx,
  previousFileId: Id<"_storage">,
  canonicalFileId: Id<"_storage">,
) {
  const attachments = await ctx.db
    .query("operatorAgentAttachments")
    .withIndex("file", (query) => query.eq("fileId", previousFileId))
    .collect();
  for (const attachment of attachments)
    await ctx.db.patch(attachment._id, { fileId: canonicalFileId });
  for (const messageId of new Set(attachments.map((row) => row.messageId))) {
    const message = await ctx.db.get(messageId);
    if (!message?.attachments) continue;
    await ctx.db.patch(message._id, {
      attachments: message.attachments.map((attachment) =>
        attachment.fileId === previousFileId
          ? { ...attachment, fileId: canonicalFileId }
          : attachment,
      ),
    });
  }
  await ctx.storage.delete(previousFileId);
}

type ClientFilePatch = {
  name?: string;
  clientVisible?: boolean;
  policyId?: Id<"policies">;
  nameSource?: "operator" | "agent";
  nameStatus?: "ready";
  nameInferenceError?: undefined;
  updatedAt: number;
};

export async function requireClientOrganization(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
) {
  const organization = await ctx.db.get(orgId);
  if (
    !organization ||
    organization.deletedAt !== undefined ||
    organization.type !== "client"
  ) {
    throw new Error("Client organization not found");
  }
  return organization;
}

export async function assertNoOperatorImpersonation(
  ctx: QueryCtx | MutationCtx,
  operatorUserId: Id<"users">,
) {
  const active = await ctx.db
    .query("operatorImpersonationSessions")
    .withIndex("operator_status", (index) =>
      index.eq("operatorUserId", operatorUserId).eq("status", "active"),
    )
    .first();
  if (active) {
    throwUserFacingError(userFacingErrorCodes.impersonationReadOnly);
  }
}

export async function requireDirectOperatorClientWrite(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
) {
  const operator = await requireOperator(ctx);
  await assertNoOperatorImpersonation(ctx, operator.userId);
  const organization = await requireClientOrganization(ctx, orgId);
  return { operator, organization };
}

export async function requirePolicyForClient(
  ctx: QueryCtx | MutationCtx,
  policyId: Id<"policies"> | undefined,
  orgId: Id<"organizations">,
) {
  if (!policyId) return null;
  const policy = await ctx.db.get(policyId);
  if (!policy || policy.orgId !== orgId || policy.deletedAt) {
    throw new Error("Policy is not an active policy for this client");
  }
  return policy;
}

export async function updateClientFileByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    clientFileId: Id<"clientFiles">;
    name?: string;
    clientVisible?: boolean;
    policyId?: Id<"policies"> | null;
    source: "operator" | "agent";
  },
) {
  await requireOperatorForUser(ctx, args.operatorUserId);
  await assertNoOperatorImpersonation(ctx, args.operatorUserId);
  const file = await ctx.db.get(args.clientFileId);
  if (!file || file.archivedAt || file.deletedAt) {
    throw new Error("Client file not found");
  }
  const organization = await requireClientOrganization(ctx, file.orgId);
  if (
    args.name === undefined &&
    args.clientVisible === undefined &&
    args.policyId === undefined
  ) {
    throw new Error("At least one client file field is required");
  }
  const policy =
    args.policyId === undefined || args.policyId === null
      ? null
      : await requirePolicyForClient(ctx, args.policyId, file.orgId);
  const now = dayjs().valueOf();
  const patch: ClientFilePatch = { updatedAt: now };
  if (args.name !== undefined) {
    patch.name = buildClientFileName(args.name, file.originalName);
    patch.nameSource = args.source;
    patch.nameStatus = "ready";
    patch.nameInferenceError = undefined;
  }
  if (args.clientVisible !== undefined) {
    patch.clientVisible = args.clientVisible;
  }
  if (args.policyId !== undefined) {
    patch.policyId = policy?._id;
  }
  await ctx.db.patch(file._id, patch);
  await writeOperatorAudit(ctx, {
    operatorUserId: args.operatorUserId,
    type: "setup_write",
    targetOrgId: file.orgId,
    summary: `Updated ${patch.name ?? file.name} for ${organization.name}`,
    metadata: {
      domain: "client_files",
      clientFileId: file._id,
      source: args.source,
      fields: Object.keys(patch).filter((field) => field !== "updatedAt"),
    },
  });
  return {
    clientFileId: file._id,
    name: patch.name ?? file.name,
    clientVisible: patch.clientVisible ?? file.clientVisible,
    policyId:
      args.policyId === undefined ? file.policyId : (policy?._id ?? null),
  };
}

export async function createClientFileFromOperatorAttachment(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    threadId: Id<"operatorAgentThreads">;
    orgId: Id<"organizations">;
    attachmentFileId: Id<"_storage">;
    name: string;
    policyId?: Id<"policies">;
  },
) {
  await requireOperatorForUser(ctx, args.operatorUserId);
  await assertNoOperatorImpersonation(ctx, args.operatorUserId);
  const organization = await requireClientOrganization(ctx, args.orgId);
  await requirePolicyForClient(ctx, args.policyId, args.orgId);
  const attachment = await ctx.db
    .query("operatorAgentAttachments")
    .withIndex("thread_file", (index) =>
      index.eq("threadId", args.threadId).eq("fileId", args.attachmentFileId),
    )
    .first();
  if (!attachment || attachment.operatorUserId !== args.operatorUserId) {
    throw new Error("Operator attachment was not found in this thread");
  }
  const existing = await ctx.db
    .query("clientFiles")
    .withIndex("storage", (index) => index.eq("fileId", args.attachmentFileId))
    .first();
  if (existing) {
    if (existing.orgId !== args.orgId) {
      throw new Error(
        "Operator attachment is already filed for another client",
      );
    }
    return {
      clientFileId: existing._id,
      status: "already_filed" as const,
      name: existing.name,
    };
  }
  const metadata = await ctx.db.system.get("_storage", args.attachmentFileId);
  if (!metadata) throw new Error("Operator attachment file is unavailable");
  const now = dayjs().valueOf();
  const sha256 = normalizeClientFileSha256(metadata.sha256);
  const contentMatch = await findReusableClientFileByContent(ctx, {
    orgId: args.orgId,
    sha256,
    policyId: args.policyId,
  });
  if (contentMatch) {
    await repointOperatorAttachmentBlob(
      ctx,
      args.attachmentFileId,
      contentMatch.fileId,
    );
    if (args.policyId && !contentMatch.policyId)
      await ctx.db.patch(contentMatch._id, {
        policyId: args.policyId,
        updatedAt: now,
      });
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "setup_write",
      targetOrgId: args.orgId,
      summary: `Reused ${contentMatch.name} for ${organization.name}`,
      metadata: {
        domain: "client_files",
        source: "operator_agent",
        clientFileId: contentMatch._id,
        policyId: args.policyId ?? contentMatch.policyId,
        clientVisible: false,
        deduplicatedAttachment: true,
      },
    });
    return {
      clientFileId: contentMatch._id,
      status: "already_filed" as const,
      name: contentMatch.name,
    };
  }
  const originalName = normalizeAgentAttachmentFilename(attachment.filename);
  const name = buildClientFileName(args.name, originalName);
  const clientFileId = await ctx.db.insert("clientFiles", {
    orgId: args.orgId,
    fileId: args.attachmentFileId,
    name,
    originalName,
    contentType: normalizeAgentAttachmentContentType(attachment.contentType),
    size: metadata.size,
    sha256,
    clientVisible: false,
    policyId: args.policyId,
    uploadedByUserId: args.operatorUserId,
    uploadedBySide: "operator",
    nameSource: "agent",
    nameStatus: "ready",
    createdAt: now,
    updatedAt: now,
  });
  await scheduleClientFileCompanyInformation(ctx, clientFileId);
  await writeOperatorAudit(ctx, {
    operatorUserId: args.operatorUserId,
    type: "setup_write",
    targetOrgId: args.orgId,
    summary: `Filed ${name} for ${organization.name}`,
    metadata: {
      domain: "client_files",
      source: "operator_agent",
      clientFileId,
      policyId: args.policyId,
      clientVisible: false,
    },
  });
  return { clientFileId, status: "filed" as const, name };
}

export async function createClientFileFromProcurementEmail(
  ctx: MutationCtx,
  args: {
    orgId: Id<"organizations">;
    fileId: Id<"_storage">;
    originalName: string;
    contentType: string;
    size: number;
  },
) {
  await requireClientOrganization(ctx, args.orgId);
  const existing = await ctx.db
    .query("clientFiles")
    .withIndex("storage", (index) => index.eq("fileId", args.fileId))
    .first();
  if (existing) {
    if (existing.orgId !== args.orgId) {
      throw new Error(
        "Procurement attachment is already filed for another client",
      );
    }
    return {
      clientFileId: existing._id,
      created: false as const,
      expectedUpdatedAt: existing.updatedAt,
    };
  }

  const metadata = await ctx.db.system.get("_storage", args.fileId);
  if (!metadata) throw new Error("Procurement attachment is unavailable");
  const sha256 = normalizeClientFileSha256(metadata.sha256);
  const contentMatch = await findReusableClientFileByContent(ctx, {
    orgId: args.orgId,
    sha256,
  });
  if (contentMatch) {
    await ctx.storage.delete(args.fileId);
    return {
      clientFileId: contentMatch._id,
      created: false as const,
      expectedUpdatedAt: contentMatch.updatedAt,
    };
  }

  const originalName = normalizeAgentAttachmentFilename(args.originalName);
  const contentType = normalizeAgentAttachmentContentType(args.contentType);
  const now = dayjs().valueOf();
  const clientFileId = await ctx.db.insert("clientFiles", {
    orgId: args.orgId,
    fileId: args.fileId,
    name: buildClientFileName(originalName, originalName),
    originalName,
    contentType,
    size: metadata.size,
    sha256,
    clientVisible: false,
    uploadedBySide: "procurement_email",
    nameSource: "original",
    nameStatus: "pending",
    createdAt: now,
    updatedAt: now,
  });
  return { clientFileId, created: true as const, expectedUpdatedAt: now };
}
