import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const PROPOSAL_EXTRACTION_MAX_ATTEMPTS = 3;
const MAX_ATTEMPTS = PROPOSAL_EXTRACTION_MAX_ATTEMPTS;

function matchesActiveLease(
  job: {
    status: string;
    leaseId?: string;
    extractionFingerprint: string;
  },
  args: { leaseId: string; extractionFingerprint?: string },
) {
  return (
    job.status === "running" &&
    job.leaseId === args.leaseId &&
    (!args.extractionFingerprint ||
      job.extractionFingerprint === args.extractionFingerprint)
  );
}

export const claimExternalJobInternal = internalMutation({
  args: {
    leaseId: v.string(),
    leaseExpiresAt: v.number(),
    workerId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    let job = await ctx.db
      .query("procurementProposalExtractionJobs")
      .withIndex("status", (q) => q.eq("status", "pending"))
      .first();
    if (!job) {
      const running = await ctx.db
        .query("procurementProposalExtractionJobs")
        .withIndex("status", (q) => q.eq("status", "running"))
        .take(50);
      for (const exhausted of running.filter(
        (candidate) =>
          (candidate.leaseExpiresAt ?? Number.MAX_SAFE_INTEGER) <= now &&
          candidate.attempts >= MAX_ATTEMPTS,
      )) {
        await ctx.db.patch(exhausted._id, {
          status: "failed",
          leaseId: undefined,
          leaseExpiresAt: undefined,
          lastError:
            "Proposal extraction lease expired after the maximum attempts",
          updatedAt: now,
        });
        const proposal = await ctx.db.get(exhausted.proposalId);
        if (
          proposal?.status === "extracting" &&
          proposal.extractionFingerprint === exhausted.extractionFingerprint
        ) {
          await ctx.db.patch(proposal._id, { status: "draft", updatedAt: now });
        }
      }
      job =
        running.find(
          (candidate) =>
            (candidate.leaseExpiresAt ?? Number.MAX_SAFE_INTEGER) <= now &&
            candidate.attempts < MAX_ATTEMPTS,
        ) ?? null;
    }
    if (!job) return null;

    const proposal = await ctx.db.get(job.proposalId);
    const client = await ctx.db.get(job.clientOrgId);
    const broker = proposal ? await ctx.db.get(proposal.brokerOrgId) : null;
    if (client?.deletedAt !== undefined || broker?.deletedAt !== undefined) {
      await ctx.db.patch(job._id, {
        status: "failed",
        leaseId: undefined,
        leaseExpiresAt: undefined,
        lastError: "Organization deleted",
        updatedAt: now,
      });
      return null;
    }
    if (
      !proposal ||
      proposal.extractionFingerprint !== job.extractionFingerprint ||
      !["extracting", "draft"].includes(proposal.status)
    ) {
      await ctx.db.patch(job._id, {
        status: "failed",
        leaseId: undefined,
        leaseExpiresAt: undefined,
        lastError: "Proposal extraction job is stale",
        updatedAt: now,
      });
      return null;
    }
    const documents = await ctx.db
      .query("procurementProposalDocuments")
      .withIndex("proposal", (q) => q.eq("proposalId", job.proposalId))
      .collect();
    if (documents.length === 0) {
      await ctx.db.patch(job._id, {
        status: "failed",
        lastError: "Proposal has no documents",
        updatedAt: now,
      });
      return null;
    }

    await ctx.db.patch(job._id, {
      status: "running",
      attempts: job.attempts + 1,
      leaseId: args.leaseId,
      leaseExpiresAt: args.leaseExpiresAt,
      workerId: args.workerId,
      lastError: undefined,
      updatedAt: now,
    });
    return { job, documents };
  },
});

export const heartbeatExternalJobInternal = internalMutation({
  args: {
    jobId: v.id("procurementProposalExtractionJobs"),
    leaseId: v.string(),
    leaseExpiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || !matchesActiveLease(job, args)) return false;
    await ctx.db.patch(job._id, {
      leaseExpiresAt: args.leaseExpiresAt,
      updatedAt: dayjs().valueOf(),
    });
    return true;
  },
});

export const assertExternalCompletionInternal = internalQuery({
  args: {
    jobId: v.id("procurementProposalExtractionJobs"),
    proposalId: v.id("procurementProposals"),
    leaseId: v.string(),
    extractionFingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    const proposal = await ctx.db.get(args.proposalId);
    if (proposal) {
      const client = await ctx.db.get(proposal.clientOrgId);
      const broker = await ctx.db.get(proposal.brokerOrgId);
      if (client?.deletedAt !== undefined || broker?.deletedAt !== undefined)
        return null;
    }
    if (
      !job ||
      job.proposalId !== args.proposalId ||
      !matchesActiveLease(job, args) ||
      proposal?.extractionFingerprint !== args.extractionFingerprint ||
      proposal.status !== "extracting"
    ) {
      return null;
    }
    const documents = await ctx.db
      .query("procurementProposalDocuments")
      .withIndex("proposal", (q) => q.eq("proposalId", args.proposalId))
      .collect();
    return { job, proposal, documents };
  },
});

export const recordLogInternal = internalMutation({
  args: {
    jobId: v.id("procurementProposalExtractionJobs"),
    leaseId: v.string(),
    message: v.string(),
    phase: v.optional(v.string()),
    level: v.optional(
      v.union(v.literal("info"), v.literal("warn"), v.literal("error")),
    ),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || !matchesActiveLease(job, args)) return false;
    await ctx.db.insert("procurementProposalExtractionArtifacts", {
      proposalId: job.proposalId,
      jobId: job._id,
      kind: "log",
      value: {
        timestamp: dayjs().valueOf(),
        message: args.message.slice(0, 2000),
        phase: args.phase,
        level: args.level ?? "info",
      },
      createdAt: dayjs().valueOf(),
    });
    return true;
  },
});

export const failExternalJobInternal = internalMutation({
  args: {
    jobId: v.id("procurementProposalExtractionJobs"),
    proposalId: v.id("procurementProposals"),
    leaseId: v.string(),
    extractionFingerprint: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (
      !job ||
      job.proposalId !== args.proposalId ||
      !matchesActiveLease(job, args)
    )
      return false;
    const now = dayjs().valueOf();
    await ctx.db.patch(job._id, {
      status: "failed",
      leaseId: undefined,
      leaseExpiresAt: undefined,
      lastError: args.error.slice(0, 4000),
      updatedAt: now,
    });
    const proposal = await ctx.db.get(args.proposalId);
    if (proposal) {
      const client = await ctx.db.get(proposal.clientOrgId);
      const broker = await ctx.db.get(proposal.brokerOrgId);
      if (client?.deletedAt !== undefined || broker?.deletedAt !== undefined)
        return false;
    }
    if (
      proposal?.status === "extracting" &&
      proposal.extractionFingerprint === args.extractionFingerprint
    ) {
      await ctx.db.patch(proposal._id, { status: "draft", updatedAt: now });
    }
    return true;
  },
});

export const completeExternalJobInternal = internalMutation({
  args: {
    jobId: v.id("procurementProposalExtractionJobs"),
    proposalId: v.id("procurementProposals"),
    leaseId: v.string(),
    extractionFingerprint: v.string(),
    completionPayloadStorageId: v.id("_storage"),
    extractedOffer: v.any(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    const proposal = await ctx.db.get(args.proposalId);
    if (proposal) {
      const client = await ctx.db.get(proposal.clientOrgId);
      const broker = await ctx.db.get(proposal.brokerOrgId);
      if (client?.deletedAt !== undefined || broker?.deletedAt !== undefined)
        return false;
    }
    if (
      !job ||
      job.proposalId !== args.proposalId ||
      !matchesActiveLease(job, args) ||
      proposal?.status !== "extracting" ||
      proposal.extractionFingerprint !== args.extractionFingerprint
    )
      return false;
    const now = dayjs().valueOf();
    await ctx.db.patch(job._id, {
      status: "complete",
      leaseId: undefined,
      leaseExpiresAt: undefined,
      completionPayloadStorageId: args.completionPayloadStorageId,
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
