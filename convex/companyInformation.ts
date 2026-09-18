import { scheduleCompanyResearch } from "./companyResearch";
import dayjs from "dayjs";
import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";

import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  COMPANY_INFORMATION_EXTRACTION_VERSION,
  companyInformationOrganizationFactValidator,
  type CompanyInformationExtraction,
} from "./lib/companyInformationExtraction";
import { reconcileExtractedCompanyFacts } from "./orgWiki";

const EXTRACTION_LEASE_MS = 2 * 60 * 1_000;
const MAX_EXTRACTION_ATTEMPTS = 3;
const MAX_ACTIVE_EXTRACTIONS_PER_ORG = 500;
const extractClientFileRef = makeFunctionReference<
  "action",
  { clientFileId: Id<"clientFiles"> }
>("actions/companyInformationExtraction:extractClientFile");
const extractEmailThreadRef = makeFunctionReference<
  "action",
  { emailThreadId: Id<"procurementEmailThreads"> }
>("actions/companyInformationExtraction:extractProcurementEmailThread");

type ResolvedSourceBase = {
  orgId: Id<"organizations">;
  organizationName: string;
  sourceRef: string;
  sourceFingerprint: string;
  actorUserId: Id<"users">;
  requestId?: Id<"procurementRequests">;
  observedAt: number;
};

type ResolvedSource = ResolvedSourceBase &
  (
    | {
        sourceKind: "client_file";
        clientFileId: Id<"clientFiles">;
      }
    | {
        sourceKind: "procurement_email_thread";
        emailThreadId: Id<"procurementEmailThreads">;
      }
  );

function isActiveSource(value: { archivedAt?: number; deletedAt?: number }) {
  return !value.archivedAt && !value.deletedAt;
}

async function fallbackOperatorUserId(ctx: QueryCtx | MutationCtx) {
  const profile = await ctx.db
    .query("operatorProfiles")
    .filter((q) => q.eq(q.field("status"), "active"))
    .first();
  return profile?.userId;
}

async function resolveClientFileSource(
  ctx: QueryCtx | MutationCtx,
  clientFileId: Id<"clientFiles">,
) {
  const file = await ctx.db.get(clientFileId);
  if (!file || !isActiveSource(file)) return null;
  const organization = await ctx.db.get(file.orgId);
  if (
    !organization ||
    organization.deletedAt !== undefined ||
    organization.type !== "client"
  )
    return null;

  const fileItems = await ctx.db
    .query("procurementFileItems")
    .withIndex("file", (index) => index.eq("clientFileId", clientFileId))
    .order("desc")
    .take(50);
  const emailFileItem = fileItems.find((item) => item.sourceEmailMessageId);
  let requestId = fileItems[0]?.requestId;
  let actorUserId = file.uploadedByUserId;
  let observedAt = file.createdAt;
  if (file.uploadedBySide === "procurement_email") {
    if (!emailFileItem?.sourceEmailMessageId) return null;
    const message = await ctx.db.get(emailFileItem.sourceEmailMessageId);
    const thread = message ? await ctx.db.get(message.threadId) : null;
    if (!message || !thread || !isActiveSource(thread)) return null;
    const request = await ctx.db.get(thread.requestId);
    if (!request || request.clientOrgId !== file.orgId) return null;
    requestId = request._id;
    actorUserId = request.updatedByUserId ?? request.createdByUserId;
    observedAt = message.receivedAt;
  }
  actorUserId ??= await fallbackOperatorUserId(ctx);
  if (!actorUserId) return null;

  return {
    orgId: file.orgId,
    organizationName: organization.name,
    sourceKind: "client_file" as const,
    clientFileId: file._id,
    sourceRef: `client-file:${file._id}`,
    sourceFingerprint: `${COMPANY_INFORMATION_EXTRACTION_VERSION}:client-file:${file._id}:${file.fileId}:${requestId ?? "unscoped"}`,
    actorUserId,
    requestId,
    observedAt,
    file: {
      fileId: file.fileId,
      filename: file.originalName,
      contentType: file.contentType,
      size: file.size,
    },
  };
}

async function resolveEmailThreadSource(
  ctx: QueryCtx | MutationCtx,
  emailThreadId: Id<"procurementEmailThreads">,
) {
  const thread = await ctx.db.get(emailThreadId);
  if (!thread || !isActiveSource(thread)) return null;
  const [organization, request, messagesDescending] = await Promise.all([
    ctx.db.get(thread.clientOrgId),
    ctx.db.get(thread.requestId),
    ctx.db
      .query("procurementEmailMessages")
      .withIndex("thread", (index) => index.eq("threadId", thread._id))
      .order("desc")
      .take(50),
  ]);
  if (
    !organization ||
    organization.type !== "client" ||
    !request ||
    request.clientOrgId !== thread.clientOrgId ||
    messagesDescending.length === 0
  ) {
    return null;
  }
  const messages = messagesDescending.reverse();
  return {
    orgId: thread.clientOrgId,
    organizationName: organization.name,
    sourceKind: "procurement_email_thread" as const,
    emailThreadId: thread._id,
    sourceRef: `procurement-email-thread:${thread._id}`,
    sourceFingerprint: `${COMPANY_INFORMATION_EXTRACTION_VERSION}:procurement-email-thread:${thread._id}:${thread.requestId}:${thread.messageCount}:${thread.updatedAt}`,
    actorUserId: request.updatedByUserId ?? request.createdByUserId,
    requestId: request._id,
    observedAt: thread.latestMessageAt,
    requestTitle: request.title,
    messages: messages.map((message) => ({
      subject: message.subject,
      fromName: message.fromName,
      fromEmail: message.fromEmail,
      toAddresses: message.toAddresses,
      ccAddresses: message.ccAddresses,
      currentText: message.currentText,
      forwarded: message.forwarded,
      receivedAt: message.receivedAt,
    })),
  };
}

async function extractionBySource(
  ctx: QueryCtx | MutationCtx,
  sourceRef: string,
) {
  return await ctx.db
    .query("companyInformationExtractions")
    .withIndex("source", (index) => index.eq("sourceRef", sourceRef))
    .unique();
}

async function reconcileCompanyInformation(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
) {
  const rows = await ctx.db
    .query("companyInformationExtractions")
    .withIndex("organization", (index) => index.eq("orgId", orgId))
    .order("desc")
    .take(MAX_ACTIVE_EXTRACTIONS_PER_ORG);
  const applied = rows.filter((row) => row.appliedFingerprint);
  const org = await ctx.db.get(orgId);

  await reconcileExtractedCompanyFacts(ctx, {
    orgId,
    source: "extraction",
    facts: [
      ...(org?.companyResearch?.facts ?? []).map((fact) => ({
        ...fact,
        content: `${fact.content} [Source](${fact.sourceRef})`,
      })),
      ...applied.flatMap((row) =>
        (row.organizationFacts ?? []).map((fact) => ({
          // Rows stored before the wiki gained sections held one flat fact list.
          key: fact.section ?? "profile",
          sourceRef: row.sourceRef,
          content: fact.content,
        })),
      ),
    ],
  });
}

async function removeExtraction(
  ctx: MutationCtx,
  extraction: Doc<"companyInformationExtractions"> | null,
) {
  if (!extraction) return false;
  await ctx.db.delete(extraction._id);
  await reconcileCompanyInformation(ctx, extraction.orgId);
  return true;
}

async function claimSource(ctx: MutationCtx, source: ResolvedSource) {
  const existing = await extractionBySource(ctx, source.sourceRef);
  const now = dayjs().valueOf();
  const sameFingerprint =
    existing?.sourceFingerprint === source.sourceFingerprint;
  if (
    existing?.appliedFingerprint === source.sourceFingerprint &&
    existing.status === "completed"
  ) {
    return { status: "complete" as const };
  }
  if (
    sameFingerprint &&
    existing?.status === "running" &&
    (existing.leaseExpiresAt ?? 0) > now
  ) {
    return { status: "running" as const };
  }
  if (
    sameFingerprint &&
    existing?.status === "failed" &&
    existing.attempts >= MAX_EXTRACTION_ATTEMPTS
  ) {
    return { status: "failed" as const };
  }

  const attempts = sameFingerprint ? (existing?.attempts ?? 0) + 1 : 1;
  const patch = {
    orgId: source.orgId,
    sourceKind: source.sourceKind,
    sourceRef: source.sourceRef,
    clientFileId:
      source.sourceKind === "client_file" ? source.clientFileId : undefined,
    procurementEmailThreadId:
      source.sourceKind === "procurement_email_thread"
        ? source.emailThreadId
        : undefined,
    requestId: source.requestId,
    actorUserId: source.actorUserId,
    sourceFingerprint: source.sourceFingerprint,
    extractionVersion: COMPANY_INFORMATION_EXTRACTION_VERSION,
    status: "running" as const,
    attempts,
    leaseExpiresAt: now + EXTRACTION_LEASE_MS,
    observedAt: source.observedAt,
    lastError: undefined,
    updatedAt: now,
  };
  if (existing) {
    await ctx.db.patch(existing._id, patch);
  } else {
    await ctx.db.insert("companyInformationExtractions", {
      ...patch,
      createdAt: now,
    });
  }
  return { status: "claimed" as const };
}

export const claimClientFileInternal = internalMutation({
  args: { clientFileId: v.id("clientFiles") },
  handler: async (ctx, args) => {
    const source = await resolveClientFileSource(ctx, args.clientFileId);
    if (!source) {
      const extraction = await ctx.db
        .query("companyInformationExtractions")
        .withIndex("file", (index) =>
          index.eq("clientFileId", args.clientFileId),
        )
        .unique();
      await removeExtraction(ctx, extraction);
      return { status: "inactive" as const };
    }
    const claim = await claimSource(ctx, source);
    return claim.status === "claimed" ? { ...claim, source } : claim;
  },
});

export const claimEmailThreadInternal = internalMutation({
  args: { emailThreadId: v.id("procurementEmailThreads") },
  handler: async (ctx, args) => {
    const source = await resolveEmailThreadSource(ctx, args.emailThreadId);
    if (!source) {
      const extraction = await ctx.db
        .query("companyInformationExtractions")
        .withIndex("email", (index) =>
          index.eq("procurementEmailThreadId", args.emailThreadId),
        )
        .unique();
      await removeExtraction(ctx, extraction);
      return { status: "inactive" as const };
    }
    const claim = await claimSource(ctx, source);
    return claim.status === "claimed" ? { ...claim, source } : claim;
  },
});

async function completeSource(
  ctx: MutationCtx,
  args:
    | {
        sourceKind: "client_file";
        clientFileId: Id<"clientFiles">;
        sourceFingerprint: string;
        extraction: CompanyInformationExtraction;
      }
    | {
        sourceKind: "procurement_email_thread";
        emailThreadId: Id<"procurementEmailThreads">;
        sourceFingerprint: string;
        extraction: CompanyInformationExtraction;
      },
) {
  const source =
    args.sourceKind === "client_file"
      ? await resolveClientFileSource(ctx, args.clientFileId)
      : await resolveEmailThreadSource(ctx, args.emailThreadId);
  if (!source || source.sourceFingerprint !== args.sourceFingerprint) {
    if (source) {
      if (source.sourceKind === "client_file") {
        await ctx.scheduler.runAfter(0, extractClientFileRef, {
          clientFileId: source.clientFileId,
        });
      } else {
        await ctx.scheduler.runAfter(0, extractEmailThreadRef, {
          emailThreadId: source.emailThreadId,
        });
      }
    }
    return { status: "stale" as const };
  }
  const row = await extractionBySource(ctx, source.sourceRef);
  if (!row || row.sourceFingerprint !== args.sourceFingerprint) {
    return { status: "stale" as const };
  }
  const now = dayjs().valueOf();
  await ctx.db.patch(row._id, {
    profile: undefined,
    organizationFacts: args.extraction.organizationFacts,
    appliedFingerprint: args.sourceFingerprint,
    status: "completed",
    leaseExpiresAt: undefined,
    lastError: undefined,
    updatedAt: now,
  });
  await reconcileCompanyInformation(ctx, row.orgId);
  await scheduleCompanyResearch(ctx, row.orgId);
  return { status: "completed" as const };
}

export const completeClientFileInternal = internalMutation({
  args: {
    clientFileId: v.id("clientFiles"),
    sourceFingerprint: v.string(),
    organizationFacts: v.array(companyInformationOrganizationFactValidator),
  },
  handler: async (ctx, args) =>
    await completeSource(ctx, {
      sourceKind: "client_file",
      clientFileId: args.clientFileId,
      sourceFingerprint: args.sourceFingerprint,
      extraction: {
        organizationFacts: args.organizationFacts,
      },
    }),
});

export const completeEmailThreadInternal = internalMutation({
  args: {
    emailThreadId: v.id("procurementEmailThreads"),
    sourceFingerprint: v.string(),
    organizationFacts: v.array(companyInformationOrganizationFactValidator),
  },
  handler: async (ctx, args) =>
    await completeSource(ctx, {
      sourceKind: "procurement_email_thread",
      emailThreadId: args.emailThreadId,
      sourceFingerprint: args.sourceFingerprint,
      extraction: {
        organizationFacts: args.organizationFacts,
      },
    }),
});

async function failSource(
  ctx: MutationCtx,
  args: {
    sourceRef: string;
    sourceFingerprint: string;
    error: string;
  },
) {
  const row = await extractionBySource(ctx, args.sourceRef);
  if (!row || row.sourceFingerprint !== args.sourceFingerprint) {
    return { retry: false as const };
  }
  await ctx.db.patch(row._id, {
    status: "failed",
    leaseExpiresAt: undefined,
    lastError: args.error.slice(0, 1_000),
    updatedAt: dayjs().valueOf(),
  });
  return {
    retry: row.attempts < MAX_EXTRACTION_ATTEMPTS,
    attempt: row.attempts,
  };
}

export const failInternal = internalMutation({
  args: {
    sourceRef: v.string(),
    sourceFingerprint: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => await failSource(ctx, args),
});

export async function removeClientFileCompanyInformation(
  ctx: MutationCtx,
  clientFileId: Id<"clientFiles">,
) {
  const extraction = await ctx.db
    .query("companyInformationExtractions")
    .withIndex("file", (index) => index.eq("clientFileId", clientFileId))
    .unique();
  return await removeExtraction(ctx, extraction);
}

export async function removeEmailThreadCompanyInformation(
  ctx: MutationCtx,
  emailThreadId: Id<"procurementEmailThreads">,
) {
  const thread = await ctx.db.get(emailThreadId);
  const extraction = await ctx.db
    .query("companyInformationExtractions")
    .withIndex("email", (index) =>
      index.eq("procurementEmailThreadId", emailThreadId),
    )
    .unique();
  if (extraction) await ctx.db.delete(extraction._id);

  const messages = await ctx.db
    .query("procurementEmailMessages")
    .withIndex("thread", (index) => index.eq("threadId", emailThreadId))
    .collect();
  for (const clientFileId of new Set(
    messages.flatMap((message) => message.clientFileIds),
  )) {
    const fileExtraction = await ctx.db
      .query("companyInformationExtractions")
      .withIndex("file", (index) => index.eq("clientFileId", clientFileId))
      .unique();
    if (fileExtraction) await ctx.db.delete(fileExtraction._id);
  }
  const orgId = extraction?.orgId ?? thread?.clientOrgId;
  if (orgId) await reconcileCompanyInformation(ctx, orgId);
  return Boolean(extraction || messages.length > 0);
}

export async function scheduleEmailThreadCompanyInformation(
  ctx: MutationCtx,
  emailThreadId: Id<"procurementEmailThreads">,
) {
  await ctx.scheduler.runAfter(0, extractEmailThreadRef, { emailThreadId });
}

export async function scheduleClientFileCompanyInformation(
  ctx: MutationCtx,
  clientFileId: Id<"clientFiles">,
) {
  await ctx.scheduler.runAfter(0, extractClientFileRef, { clientFileId });
}
