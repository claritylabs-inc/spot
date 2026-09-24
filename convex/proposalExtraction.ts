import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const PROPOSAL_EXTRACTION_MAX_ATTEMPTS = 3;
const MAX_ATTEMPTS = PROPOSAL_EXTRACTION_MAX_ATTEMPTS;

function nowMs(): number {
  return dayjs().valueOf();
}

/**
 * Acquires (or reclaims) the run lease for one proposal extraction job, like
 * the policy pipeline's `pipelineAcquireLease`. A live, unexpired lease
 * belongs to an in-flight advance chain and blocks a concurrent/duplicate
 * caller (e.g. a watchdog firing after the normal chain already continued).
 * Reclaiming an expired lease counts against `PROPOSAL_EXTRACTION_MAX_ATTEMPTS`;
 * a fresh "pending" job does not.
 */
export const acquireLeaseInternal = internalMutation({
  args: {
    jobId: v.id("procurementProposalExtractionJobs"),
    leaseId: v.string(),
    leaseExpiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status === "complete" || job.status === "failed")
      return null;
    const now = nowMs();
    // A dangling lease is one left behind by a chain that didn't release it
    // cleanly (a crash mid-tick), as opposed to the normal gap between one
    // tick's clean release and the next scheduled tick's acquire (which
    // leaves no leaseId at all). Only a dangling, expired lease counts as a
    // reclaim against PROPOSAL_EXTRACTION_MAX_ATTEMPTS.
    const hasDanglingLease = job.status === "running" && job.leaseId !== undefined;
    if (hasDanglingLease && (job.leaseExpiresAt ?? 0) > now) {
      // A live advance chain (or its watchdog) already holds this lease.
      return null;
    }
    const isReclaim = hasDanglingLease;
    if (isReclaim && job.attempts >= MAX_ATTEMPTS) {
      await ctx.db.patch(job._id, {
        status: "failed",
        leaseId: undefined,
        leaseExpiresAt: undefined,
        checkpoint: undefined,
        lastError: "Proposal extraction lease expired after the maximum attempts",
        updatedAt: now,
      });
      const proposal = await ctx.db.get(job.proposalId);
      if (
        proposal?.status === "extracting" &&
        proposal.extractionFingerprint === job.extractionFingerprint
      ) {
        await ctx.db.patch(proposal._id, { status: "draft", updatedAt: now });
      }
      return null;
    }
    await ctx.db.patch(job._id, {
      status: "running",
      leaseId: args.leaseId,
      leaseExpiresAt: args.leaseExpiresAt,
      attempts: isReclaim ? job.attempts + 1 : job.attempts,
      lastError: undefined,
      updatedAt: now,
    });
    return {
      checkpoint: job.checkpoint as unknown,
      proposalId: job.proposalId,
      clientOrgId: job.clientOrgId,
      extractionFingerprint: job.extractionFingerprint,
    };
  },
});

/** Saves checkpoint state and releases the lease so the next tick can run. */
export const saveCheckpointForLeaseInternal = internalMutation({
  args: {
    jobId: v.id("procurementProposalExtractionJobs"),
    leaseId: v.string(),
    state: v.any(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.leaseId !== args.leaseId) return false;
    await ctx.db.patch(job._id, {
      checkpoint: { state: args.state, createdAt: nowMs() },
      leaseId: undefined,
      leaseExpiresAt: undefined,
      updatedAt: nowMs(),
    });
    return true;
  },
});

export const recordLogInternal = internalMutation({
  args: {
    jobId: v.id("procurementProposalExtractionJobs"),
    message: v.string(),
    phase: v.optional(v.string()),
    level: v.optional(
      v.union(v.literal("info"), v.literal("warn"), v.literal("error")),
    ),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return false;
    await ctx.db.insert("procurementProposalExtractionArtifacts", {
      proposalId: job.proposalId,
      jobId: job._id,
      kind: "log",
      value: {
        timestamp: nowMs(),
        message: args.message.slice(0, 2000),
        phase: args.phase,
        level: args.level ?? "info",
      },
      createdAt: nowMs(),
    });
    return true;
  },
});

export const failJobInternal = internalMutation({
  args: {
    jobId: v.id("procurementProposalExtractionJobs"),
    leaseId: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.leaseId !== args.leaseId) return false;
    const now = nowMs();
    await ctx.db.patch(job._id, {
      status: "failed",
      leaseId: undefined,
      leaseExpiresAt: undefined,
      checkpoint: undefined,
      lastError: args.error.slice(0, 4000),
      updatedAt: now,
    });
    const proposal = await ctx.db.get(job.proposalId);
    if (proposal) {
      const client = await ctx.db.get(proposal.clientOrgId);
      const broker = await ctx.db.get(proposal.brokerOrgId);
      if (client?.deletedAt !== undefined || broker?.deletedAt !== undefined)
        return false;
    }
    if (
      proposal?.status === "extracting" &&
      proposal.extractionFingerprint === job.extractionFingerprint
    ) {
      await ctx.db.patch(proposal._id, { status: "draft", updatedAt: now });
    }
    return true;
  },
});

export const completeJobInternal = internalMutation({
  args: {
    jobId: v.id("procurementProposalExtractionJobs"),
    leaseId: v.string(),
    extractedOffer: v.any(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.leaseId !== args.leaseId) return false;
    const proposal = await ctx.db.get(job.proposalId);
    if (proposal) {
      const client = await ctx.db.get(proposal.clientOrgId);
      const broker = await ctx.db.get(proposal.brokerOrgId);
      if (client?.deletedAt !== undefined || broker?.deletedAt !== undefined)
        return false;
    }
    if (
      !proposal ||
      proposal.status !== "extracting" ||
      proposal.extractionFingerprint !== job.extractionFingerprint
    )
      return false;
    const now = nowMs();
    await ctx.db.patch(job._id, {
      status: "complete",
      leaseId: undefined,
      leaseExpiresAt: undefined,
      checkpoint: undefined,
      lastError: undefined,
      updatedAt: now,
    });
    await ctx.db.patch(proposal._id, {
      status: "review_ready",
      extractedOffer: args.extractedOffer,
      updatedAt: now,
    });
    return true;
  },
});

/** Lists a proposal's documents in filing order, for a fresh advance run. */
export const listDocumentsInternal = internalQuery({
  args: { proposalId: v.id("procurementProposals") },
  handler: async (ctx, args) =>
    ctx.db
      .query("procurementProposalDocuments")
      .withIndex("proposal", (q) => q.eq("proposalId", args.proposalId))
      .collect(),
});

/**
 * Saves one pipeline artifact (parsed source, section result, quote terms).
 * Large payloads pass `blob` (stored in file storage); small ones pass
 * `value` inline, mirroring `policies.pipelineSaveArtifact` for policies.
 */
export const saveArtifactInternal = internalMutation({
  args: {
    jobId: v.id("procurementProposalExtractionJobs"),
    proposalId: v.id("procurementProposals"),
    proposalDocumentId: v.id("procurementProposalDocuments"),
    kind: v.string(),
    value: v.optional(v.any()),
    storageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("procurementProposalExtractionArtifacts", {
      proposalId: args.proposalId,
      jobId: args.jobId,
      proposalDocumentId: args.proposalDocumentId,
      kind: args.kind,
      value: args.value,
      storageId: args.storageId,
      createdAt: nowMs(),
    });
    return null;
  },
});

/** Lists artifacts for one job/document/kind, oldest first. */
export const listArtifactsInternal = internalQuery({
  args: {
    jobId: v.id("procurementProposalExtractionJobs"),
    proposalDocumentId: v.id("procurementProposalDocuments"),
    kind: v.string(),
  },
  handler: async (ctx, args) =>
    ctx.db
      .query("procurementProposalExtractionArtifacts")
      .withIndex("job_document_kind", (q) =>
        q
          .eq("jobId", args.jobId)
          .eq("proposalDocumentId", args.proposalDocumentId)
          .eq("kind", args.kind),
      )
      .collect(),
});

/**
 * Finds jobs whose advance chain appears to have died: a "pending" job never
 * picked up (its initial scheduled advance was lost), or a "running" job
 * whose lease has been expired well past the watchdog's own reclaim window.
 * Safety net for `crons.ts`'s stale sweep; normal recovery goes through the
 * per-lease watchdog scheduled by `advance` itself.
 */
export const listStaleJobsInternal = internalQuery({
  args: { olderThanMs: v.number(), limit: v.number() },
  handler: async (ctx, args) => {
    const cutoff = nowMs() - args.olderThanMs;
    const pending = await ctx.db
      .query("procurementProposalExtractionJobs")
      .withIndex("status", (q) =>
        q.eq("status", "pending").lt("updatedAt", cutoff),
      )
      .take(args.limit);
    const runningCandidates = await ctx.db
      .query("procurementProposalExtractionJobs")
      .withIndex("status", (q) => q.eq("status", "running"))
      .order("asc")
      .take(args.limit * 4);
    const running = runningCandidates
      .filter((job) => (job.leaseExpiresAt ?? 0) < cutoff)
      .slice(0, args.limit);
    return [...pending, ...running];
  },
});
