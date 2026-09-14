import dayjs from "dayjs";
import { readWorkflowNotes, saveWorkflowNotes, validateDeliveryNotes } from "./certificateNotes";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  assertCanReadPolicies,
  getOrgAccess,
  type OrgAccess,
} from "./lib/access";
import {
  certificateHolderDisplayBlock,
  holderSnapshot,
  type CertificateHolderAddressInput,
} from "./lib/certificateIdentity";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "./lib/userFacingErrors";

const jobStatusValidator = v.union(
  v.literal("review_required"),
  v.literal("blocked_missing_contact"),
  v.literal("sending"),
  v.literal("sent"),
  v.literal("cancelled"),
  v.literal("failed"),
);

const jobKindValidator = v.union(
  v.literal("renewal_reissue"),
  v.literal("manual_review"),
);

function assertCertificateWorkspace(access: OrgAccess) {
  assertCanReadPolicies(access);
  if (access.accessType === "connected_client") {
    throwUserFacingError(
      userFacingErrorCodes.readOnlyAccess,
      "Connected organization access is read-only. Ask the vendor to manage this certificate workflow.",
    );
  }
}

async function nextVersionNumber(
  ctx: MutationCtx,
  certificateId: Id<"policyCertificates">,
) {
  const latest = await ctx.db
    .query("certificateVersions")
    .withIndex("certificate_version", (q) =>
      q.eq("certificateId", certificateId),
    )
    .order("desc")
    .first();
  return (latest?.versionNumber ?? 0) + 1;
}

async function createWorkflowJob(
  ctx: MutationCtx,
  args: {
    orgId: Id<"organizations">;
    brokerOrgId?: Id<"organizations">;
    certificateId: Id<"policyCertificates">;
    holderId: Id<"certificateHolders">;
    policyId: Id<"policies">;
    policyVersionId?: Id<"policyVersions">;
    kind: "renewal_reissue" | "manual_review";
    idempotencyKey: string;
    reason?: string;
    recipientName?: string;
    recipientEmail?: string;
    recipientPhone?: string;
    createdByUserId?: Id<"users">;
  },
) {
  const existing = await ctx.db
    .query("certificateWorkflowJobs")
    .withIndex("idempotency", (q) =>
      q.eq("idempotencyKey", args.idempotencyKey),
    )
    .first();
  if (existing)
    return { jobId: existing._id, created: false, status: existing.status };
  const now = dayjs().valueOf();
  const holder = await ctx.db.get(args.holderId);
  const versionId = await ctx.db.insert("certificateVersions", {
    orgId: args.orgId,
    certificateId: args.certificateId,
    holderId: args.holderId,
    policyId: args.policyId,
    policyVersionId: args.policyVersionId,
    versionNumber: await nextVersionNumber(ctx, args.certificateId),
    status: "draft",
    certificateHolder: holder
      ? certificateHolderDisplayBlock({
          displayName: holder.displayName,
          contactName: holder.contactName,
          email: holder.email,
          phone: holder.phone,
          address: holder.address as CertificateHolderAddressInput | undefined,
        })
      : args.recipientName,
    certificateHolderName: holder?.displayName ?? args.recipientName,
    holderSnapshot: holder
      ? holderSnapshot({
          displayName: holder.displayName,
          contactName: holder.contactName,
          email: holder.email,
          phone: holder.phone,
          address: holder.address as CertificateHolderAddressInput | undefined,
        })
      : undefined,
    source: "agent",
    createdByUserId: args.createdByUserId,
    createdAt: now,
    updatedAt: now,
  });
  const status = args.recipientEmail
    ? "review_required"
    : "blocked_missing_contact";
  const jobId = await ctx.db.insert("certificateWorkflowJobs", {
    orgId: args.orgId,
    brokerOrgId: args.brokerOrgId,
    certificateId: args.certificateId,
    certificateVersionId: versionId,
    holderId: args.holderId,
    policyId: args.policyId,
    policyVersionId: args.policyVersionId,
    kind: args.kind,
    status,
    idempotencyKey: args.idempotencyKey,
    reason: args.reason,
    recipientName: args.recipientName ?? holder?.displayName,
    recipientEmail: args.recipientEmail,
    recipientPhone: args.recipientPhone,
    createdByUserId: args.createdByUserId,
    createdAt: now,
    updatedAt: now,
  });
  return { jobId, created: true, status };
}

export const createRenewalJobsForPolicyInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    policyId: v.id("policies"),
    policyVersionId: v.optional(v.id("policyVersions")),
    createdByUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    if (!org) throw new Error("Organization not found");
    const settings =
      org.type === "client"
        ? await ctx.db
            .query("certificateWorkflowSettings")
            .withIndex("client", (q) => q.eq("clientOrgId", args.orgId))
            .first()
        : null;
    if (settings?.renewalReissueEnabled === false)
      return { created: 0, jobs: [] };
    const certificates = await ctx.db
      .query("policyCertificates")
      .withIndex("policy_status", (q) =>
        q.eq("policyId", args.policyId).eq("status", "active"),
      )
      .collect();
    const jobs = [];
    for (const certificate of certificates) {
      if (!certificate.latestIssuedVersionId) continue;
      const holder = await ctx.db.get(certificate.holderId);
      if (!holder) continue;
      const job = await createWorkflowJob(ctx, {
        orgId: args.orgId,
        brokerOrgId: undefined,
        certificateId: certificate._id,
        holderId: certificate.holderId,
        policyId: args.policyId,
        policyVersionId: args.policyVersionId,
        kind: "renewal_reissue",
        idempotencyKey: `renewal_reissue:${String(args.policyVersionId ?? args.policyId)}:${String(certificate._id)}`,
        reason:
          "Policy renewal requires certificate review for the current holder.",
        recipientName: holder.displayName,
        recipientEmail: holder.email,
        recipientPhone: holder.phone,
        createdByUserId: args.createdByUserId,
      });
      if (job.created) jobs.push(job);
    }
    return { created: jobs.length, jobs };
  },
});

export const listForOrg = query({
  args: {
    orgId: v.id("organizations"),
    policyId: v.optional(v.id("policies")),
    status: v.optional(jobStatusValidator),
    kind: v.optional(jobKindValidator),
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.orgId, { allowOperator: true });
    assertCertificateWorkspace(access);
    const rows = args.policyId
      ? await ctx.db
          .query("certificateWorkflowJobs")
          .withIndex("policy", (q) => q.eq("policyId", args.policyId!))
          .order("desc")
          .collect()
      : await ctx.db
          .query("certificateWorkflowJobs")
          .withIndex("organization", (q) => q.eq("orgId", args.orgId))
          .order("desc")
          .collect();
    const enriched = await Promise.all(
      rows
        .filter(
          (row) =>
            row.orgId === args.orgId &&
            (!args.status || row.status === args.status) &&
            (!args.kind || row.kind === args.kind),
        )
        .map(async (row) => {
          const policy = await ctx.db.get(row.policyId);
          if (!policy || policy.deletedAt) return null;
          return {
            ...row,
            ...await readWorkflowNotes(ctx, row, access.accessType === "operator"),
            holder: await ctx.db.get(row.holderId),
            policy,
            certificateVersion: row.certificateVersionId
              ? await ctx.db.get(row.certificateVersionId)
              : null,
          };
        }),
    );
    return enriched.filter((row) => row !== null);
  },
});

export const listForOrgInternal = internalQuery({
  args: {
    orgId: v.id("organizations"),
    policyId: v.optional(v.id("policies")),
    status: v.optional(jobStatusValidator),
    kind: v.optional(jobKindValidator),
  },
  handler: async (ctx, args) => {
    const rows = args.policyId
      ? await ctx.db
          .query("certificateWorkflowJobs")
          .withIndex("policy", (q) => q.eq("policyId", args.policyId!))
          .collect()
      : await ctx.db
          .query("certificateWorkflowJobs")
          .withIndex("organization", (q) => q.eq("orgId", args.orgId))
          .collect();
    const enriched = await Promise.all(
      rows
        .filter(
          (row) =>
            row.orgId === args.orgId &&
            (!args.status || row.status === args.status) &&
            (!args.kind || row.kind === args.kind),
        )
        .sort((left, right) => right.createdAt - left.createdAt)
        .map(async (row) => {
          const policy = await ctx.db.get(row.policyId);
          if (!policy || policy.deletedAt) return null;
          return {
            ...row,
            ...await readWorkflowNotes(ctx, row),
            holder: await ctx.db.get(row.holderId),
            policy,
            certificateVersion: row.certificateVersionId
              ? await ctx.db.get(row.certificateVersionId)
              : null,
          };
        }),
    );
    return enriched.filter((row) => row !== null);
  },
});

export const prepareSendJob = mutation({
  args: { jobId: v.id("certificateWorkflowJobs"), sendNotes: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Certificate workflow job not found");
    const access = await getOrgAccess(ctx, job.orgId, { allowOperator: true });
    assertCertificateWorkspace(access);
    if (args.sendNotes !== undefined) await validateDeliveryNotes(ctx, job, args.sendNotes, access.userId);
    if (job.status !== "review_required")
      throw new Error("Job must be ready for review before sending.");
    if (!job.recipientEmail)
      throw new Error("Recipient email is required before sending.");
    const holder = await ctx.db.get(job.holderId);
    const org = await ctx.db.get(job.orgId);
    const policy = await ctx.db.get(job.policyId);
    if (!holder || !org || !policy)
      throw new Error("Certificate workflow job is missing required records.");
    const now = dayjs().valueOf();
    await ctx.db.patch(args.jobId, {
      status: "sending",
      reviewedByUserId: job.reviewedByUserId ?? access.userId,
      reviewedAt: job.reviewedAt ?? now,
      updatedAt: now,
    });
    return { job, holder, org, policy, userId: access.userId };
  },
});

export const markSentInternal = internalMutation({
  args: {
    jobId: v.id("certificateWorkflowJobs"),
    generatedCertificateVersionId: v.optional(v.id("certificateVersions")),
    sentByUserId: v.optional(v.id("users")),
    sendNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Certificate workflow job not found");
    const now = dayjs().valueOf();
    if (
      job.certificateVersionId &&
      args.generatedCertificateVersionId &&
      job.certificateVersionId !== args.generatedCertificateVersionId
    ) {
      await ctx.db.patch(job.certificateVersionId, {
        status: "void",
        voidedAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.patch(args.jobId, {
      status: "sent",
      certificateVersionId:
        args.generatedCertificateVersionId ?? job.certificateVersionId,
      sentByUserId: args.sentByUserId,
      sentAt: now,
      updatedAt: now,
    });
    if (args.sendNotes !== undefined) await saveWorkflowNotes(ctx, job, { sendNotes: args.sendNotes }, { actorUserId: args.sentByUserId });
    return { status: "sent" };
  },
});

export const markFailedInternal = internalMutation({
  args: {
    jobId: v.id("certificateWorkflowJobs"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      status: "failed",
      lastError: args.error,
      updatedAt: dayjs().valueOf(),
    });
  },
});

export const getInternal = internalQuery({
  args: { jobId: v.id("certificateWorkflowJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    return job ? { ...job, ...await readWorkflowNotes(ctx, job) } : null;
  },
});
