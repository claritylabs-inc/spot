import dayjs from "dayjs";
import { assertExternalBrokerIdentity } from "./lib/brokerProfileValidation";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  requireOperator,
  requireOperatorForUser,
  writeOperatorAudit,
} from "./lib/operatorIdentity";
import { buildProposalMarkdown } from "./lib/proposalMarkdown";
import { audienceIncludes } from "./lib/procurementPacket";
import {
  findReusableClientFileByContent,
  normalizeClientFileSha256,
  repointOperatorAttachmentBlob,
} from "./lib/clientFiles";
import { PROPOSAL_EXTRACTION_MAX_ATTEMPTS } from "./proposalExtraction";

const conclusionValidator = v.union(
  v.literal("meets_requirements"),
  v.literal("has_gaps"),
  v.literal("insufficient_evidence"),
);

/** Proposals that still count toward "one active proposal per outreach". */
const ACTIVE_PROPOSAL_STATUSES = new Set<Doc<"procurementProposals">["status"]>(
  ["draft", "extracting", "review_ready", "reviewed", "selected"],
);

const RECENT_JOB_LIMIT = 5;
const PROPOSAL_UPLOAD_TTL_MS = 30 * 60 * 1_000;
const MAX_PROPOSAL_FILE_BYTES = 50 * 1024 * 1024;

export type ProposalDocumentSource =
  | { kind: "client_file"; clientFileId: Id<"clientFiles"> }
  | { kind: "file_item"; fileItemId: Id<"procurementFileItems"> }
  | {
      kind: "upload";
      fileId: Id<"_storage">;
      fileName: string;
      contentType?: string;
      uploadIntentId?: Id<"clientFileUploadIntents">;
    }
  | {
      kind: "thread_attachment";
      fileId: Id<"_storage">;
      fileName: string;
      contentType?: string;
    };

export const proposalDocumentSourceValidator = v.union(
  v.object({
    kind: v.literal("client_file"),
    clientFileId: v.id("clientFiles"),
  }),
  v.object({
    kind: v.literal("file_item"),
    fileItemId: v.id("procurementFileItems"),
  }),
  v.object({
    kind: v.literal("upload"),
    fileId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.optional(v.string()),
    uploadIntentId: v.optional(v.id("clientFileUploadIntents")),
  }),
);

async function requireProposal(
  ctx: MutationCtx,
  proposalId: Id<"procurementProposals">,
) {
  const proposal = await ctx.db.get(proposalId);
  if (!proposal) throw new Error("Proposal not found");
  return proposal;
}

async function requireDirectOperator(
  ctx: MutationCtx,
  operatorUserId: Id<"users">,
) {
  await requireOperatorForUser(ctx, operatorUserId);
  const impersonation = await ctx.db
    .query("operatorImpersonationSessions")
    .withIndex("operator_status", (q) =>
      q.eq("operatorUserId", operatorUserId).eq("status", "active"),
    )
    .first();
  if (impersonation) throw new Error("IMPERSONATION_READ_ONLY");
}

/** Storage metadata reports a base64 digest; documents store lowercase hex so
 * fingerprints and duplicate checks compare one canonical form. */
export const normalizeSha256 = normalizeClientFileSha256;

async function proposalDocuments(
  ctx: QueryCtx | MutationCtx,
  proposalId: Id<"procurementProposals">,
) {
  return await ctx.db
    .query("procurementProposalDocuments")
    .withIndex("proposal", (q) => q.eq("proposalId", proposalId))
    .collect();
}

function documentFingerprint(
  documents: Array<Pick<Doc<"procurementProposalDocuments">, "_id" | "sha256">>,
) {
  if (!documents.length) throw new Error("Add at least one proposal document");
  return documents
    .sort((a, b) => String(a._id).localeCompare(String(b._id)))
    .map((document) => `${document._id}:${document.sha256}`)
    .join("|");
}

async function assertBrokerOutreach(
  ctx: MutationCtx,
  requestId: Id<"procurementRequests">,
  outreachId: Id<"procurementBrokerOutreaches">,
  brokerOrgId: Id<"organizations"> | undefined,
) {
  const [request, outreach] = await Promise.all([
    ctx.db.get(requestId),
    ctx.db.get(outreachId),
  ]);
  if (!request) throw new Error("Procurement request not found");
  if (!outreach || outreach.requestId !== request._id)
    throw new Error("Outreach does not belong to this request");
  const resolvedBrokerOrgId = brokerOrgId ?? outreach.brokerOrgId;
  if (!resolvedBrokerOrgId)
    throw new Error(
      "Outreach has no broker organization; link one before filing a proposal",
    );
  const broker = await ctx.db.get(resolvedBrokerOrgId);
  if (!broker || broker.type !== "broker")
    throw new Error("Broker organization not found");
  assertExternalBrokerIdentity(broker);
  assertExternalBrokerIdentity({ email: outreach.contactEmail });
  if (outreach.brokerOrgId !== broker._id)
    throw new Error("Proposal broker must match its outreach");
  return { request, outreach, broker };
}

function jobSummary(
  job: Doc<"procurementProposalExtractionJobs">,
  proposal: Pick<Doc<"procurementProposals">, "extractionFingerprint">,
  now: number,
) {
  const leaseExpired =
    job.status === "running" &&
    (job.leaseExpiresAt ?? Number.MAX_SAFE_INTEGER) <= now;
  return {
    jobId: job._id,
    status: job.status,
    stuck: leaseExpired,
    current: job.extractionFingerprint === proposal.extractionFingerprint,
    attempts: job.attempts,
    maxAttempts: PROPOSAL_EXTRACTION_MAX_ATTEMPTS,
    leaseExpiresAt: job.leaseExpiresAt ?? null,
    workerId: job.workerId ?? null,
    lastError: job.lastError ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export type ProposalExtractionJobSummary = ReturnType<typeof jobSummary>;

async function recentJobs(
  ctx: QueryCtx | MutationCtx,
  proposalId: Id<"procurementProposals">,
) {
  return await ctx.db
    .query("procurementProposalExtractionJobs")
    .withIndex("proposal", (q) => q.eq("proposalId", proposalId))
    .order("desc")
    .take(RECENT_JOB_LIMIT);
}

function proposalNextActions(
  proposal: Pick<
    Doc<"procurementProposals">,
    "_id" | "status" | "requestId" | "outreachId"
  >,
  latest: ProposalExtractionJobSummary | null,
  documentCount: number,
) {
  const proposalId = proposal._id;
  const actions: Array<{
    tool: string;
    why: string;
    input: Record<string, unknown>;
  }> = [];
  if (latest?.stuck || latest?.status === "failed") {
    actions.push({
      tool: "retry_procurement_proposal_extraction",
      why: latest.stuck
        ? "The extraction lease expired without completion"
        : `Extraction failed: ${latest.lastError ?? "unknown error"}`,
      input: { procurementProposalId: proposalId },
    });
  } else if (proposal.status === "extracting") {
    actions.push({
      tool: "get_procurement_proposal",
      why: "Extraction is queued or running; poll until review_ready",
      input: { procurementProposalId: proposalId },
    });
  } else if (proposal.status === "draft") {
    actions.push(
      documentCount > 0
        ? {
            tool: "retry_procurement_proposal_extraction",
            why: "Draft has documents but no queued extraction; queue one",
            input: { procurementProposalId: proposalId },
          }
        : {
            // Sources cannot be guessed here, so the hint carries the routing
            // ids and names the argument the caller still has to choose.
            tool: "file_procurement_proposal",
            why: "Draft has no documents; file at least one clientFileId, procurementFileItemId, or attachmentFileId onto this proposal",
            input: {
              procurementRequestId: proposal.requestId,
              procurementOutreachId: proposal.outreachId,
              procurementProposalId: proposalId,
            },
          },
    );
  } else if (proposal.status === "review_ready") {
    actions.push({
      tool: "run_operator_task",
      why: "Generate the packet-bound review, then confirm it with confirm_procurement_proposal_review",
      input: { objective: `Review proposal ${proposalId} against its packet` },
    });
  } else if (proposal.status === "reviewed") {
    actions.push({
      tool: "select_procurement_proposal",
      why: "A staff-confirmed review exists; select it if it meets every requirement",
      input: { procurementProposalId: proposalId },
    });
  }
  return actions;
}

async function proposalDto(
  ctx: QueryCtx,
  proposal: Doc<"procurementProposals">,
) {
  const [documents, reviews, broker, request, sections, jobs] =
    await Promise.all([
      proposalDocuments(ctx, proposal._id),
      ctx.db
        .query("procurementProposalReviews")
        .withIndex("proposal", (q) => q.eq("proposalId", proposal._id))
        .order("desc")
        .collect(),
      ctx.db.get(proposal.brokerOrgId),
      ctx.db.get(proposal.requestId),
      ctx.db
        .query("procurementPacketSections")
        .withIndex("request", (q) => q.eq("requestId", proposal.requestId))
        .collect(),
      recentJobs(ctx, proposal._id),
    ]);
  const documentRows = await Promise.all(
    documents.map(async ({ fileId, ...document }) => ({
      ...document,
      url: await ctx.storage.getUrl(fileId),
    })),
  );
  const packetRevision = request?.packetRevision ?? 0;
  const now = dayjs().valueOf();
  const jobRows = jobs.map((job) => jobSummary(job, proposal, now));
  const latest = jobRows[0] ?? null;
  return {
    ...proposal,
    brokerName: broker?.name,
    documents: documentRows,
    proposalMarkdown: buildProposalMarkdown(proposal.extractedOffer).markdown,
    sectionHeadings: Object.fromEntries(
      sections.map((section) => [section.key, section.heading]),
    ),
    reviews: reviews.map((review) => ({
      ...review,
      stale: (review.packetRevision ?? -1) !== packetRevision,
    })),
    extraction: { latest, jobs: jobRows },
    nextActions: proposalNextActions(proposal, latest, documents.length),
  };
}

export async function listProcurementProposals(
  ctx: QueryCtx,
  requestId: Id<"procurementRequests">,
) {
  const rows = await ctx.db
    .query("procurementProposals")
    .withIndex("request", (q) => q.eq("requestId", requestId))
    .order("desc")
    .collect();
  return await Promise.all(rows.map((row) => proposalDto(ctx, row)));
}

export async function getProcurementProposalDetails(
  ctx: QueryCtx,
  proposalId: Id<"procurementProposals">,
) {
  const proposal = await ctx.db.get(proposalId);
  return proposal ? proposalDto(ctx, proposal) : null;
}

export const list = query({
  args: { requestId: v.id("procurementRequests") },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    return await listProcurementProposals(ctx, args.requestId);
  },
});

export const get = query({
  args: { proposalId: v.id("procurementProposals") },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    return await getProcurementProposalDetails(ctx, args.proposalId);
  },
});

type ResolvedDocument = {
  fileId: Id<"_storage">;
  fileName: string;
  contentType: string;
  size: number;
  sha256: string;
  clientFileId: Id<"clientFiles">;
};

async function storageMetadata(ctx: MutationCtx, fileId: Id<"_storage">) {
  const metadata = await ctx.db.system.get("_storage", fileId);
  if (!metadata) throw new Error("Uploaded file not found");
  return metadata;
}

/** Every proposal document resolves to one canonical client file so the same
 * blob is linked, never copied, and keeps its provenance and visibility. */
async function resolveDocumentSource(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    request: Doc<"procurementRequests">;
    source: ProposalDocumentSource;
  },
): Promise<ResolvedDocument> {
  const { request, source } = args;
  const fromClientFile = async (
    clientFileId: Id<"clientFiles">,
  ): Promise<ResolvedDocument> => {
    const file = await ctx.db.get(clientFileId);
    if (!file || file.deletedAt || file.archivedAt)
      throw new Error(`Client file ${clientFileId} not found`);
    if (file.orgId !== request.clientOrgId)
      throw new Error("Client file does not belong to this request's client");
    const metadata = await storageMetadata(ctx, file.fileId);
    const sha256 = normalizeSha256(metadata.sha256);
    if (file.sha256 !== sha256) await ctx.db.patch(file._id, { sha256 });
    return {
      fileId: file.fileId,
      fileName: file.name,
      contentType: file.contentType,
      size: metadata.size,
      sha256,
      clientFileId: file._id,
    };
  };
  if (source.kind === "client_file") return fromClientFile(source.clientFileId);
  if (source.kind === "file_item") {
    const item = await ctx.db.get(source.fileItemId);
    if (!item || item.requestId !== request._id)
      throw new Error("Procurement file item does not belong to this request");
    if (!item.clientFileId)
      throw new Error(
        `Procurement file item ${item._id} (${item.label}) has no file yet; it is still ${item.status}`,
      );
    return fromClientFile(item.clientFileId);
  }
  const metadata = await storageMetadata(ctx, source.fileId);
  if (metadata.size > MAX_PROPOSAL_FILE_BYTES)
    throw new Error("Proposal files must be 50 MB or smaller");
  const existing = await ctx.db
    .query("clientFiles")
    .withIndex("storage", (q) => q.eq("fileId", source.fileId))
    .first();
  if (existing) {
    if (existing.orgId !== request.clientOrgId)
      throw new Error("Uploaded file is already filed under another client");
    return fromClientFile(existing._id);
  }
  const sha256 = normalizeSha256(metadata.sha256);
  const contentMatch = await findReusableClientFileByContent(ctx, {
    orgId: request.clientOrgId,
    sha256,
  });
  if (contentMatch) {
    if (source.kind === "thread_attachment")
      await repointOperatorAttachmentBlob(
        ctx,
        source.fileId,
        contentMatch.fileId,
      );
    else await ctx.storage.delete(source.fileId);
    return fromClientFile(contentMatch._id);
  }
  const fileName = source.fileName.trim() || "Proposal.pdf";
  const contentType =
    source.contentType?.trim() ||
    metadata.contentType ||
    "application/octet-stream";
  const now = dayjs().valueOf();
  const clientFileId = await ctx.db.insert("clientFiles", {
    orgId: request.clientOrgId,
    fileId: source.fileId,
    name: fileName,
    originalName: fileName,
    contentType,
    size: metadata.size,
    sha256,
    clientVisible: false,
    uploadedByUserId: args.operatorUserId,
    uploadedBySide: "operator",
    nameSource: "operator",
    nameStatus: "ready",
    createdAt: now,
    updatedAt: now,
  });
  return {
    fileId: source.fileId,
    fileName,
    contentType,
    size: metadata.size,
    sha256,
    clientFileId,
  };
}

/** A filed quote shows up in the request's packet files as a received quote
 * for that broker. Quotes never feed the company wiki, so this bypasses the
 * company-information scheduling used for client material. */
async function ensureQuoteFileItem(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    request: Doc<"procurementRequests">;
    outreachId: Id<"procurementBrokerOutreaches">;
    document: ResolvedDocument;
  },
) {
  const now = dayjs().valueOf();
  const linked = await ctx.db
    .query("procurementFileItems")
    .withIndex("file", (q) => q.eq("clientFileId", args.document.clientFileId))
    .collect();
  const existing = linked.find(
    (item) =>
      item.requestId === args.request._id &&
      item.outreachId === args.outreachId &&
      item.purpose === "quote",
  );
  if (existing) return existing._id;
  return await ctx.db.insert("procurementFileItems", {
    requestId: args.request._id,
    clientOrgId: args.request.clientOrgId,
    outreachId: args.outreachId,
    clientFileId: args.document.clientFileId,
    purpose: "quote",
    label: args.document.fileName,
    status: "received",
    brokerRelease: "hidden",
    clientVisible: false,
    createdByUserId: args.operatorUserId,
    updatedByUserId: args.operatorUserId,
    createdAt: now,
    updatedAt: now,
  });
}

async function queueProposalExtraction(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    proposal: Doc<"procurementProposals">;
    /** Requeue even when a completed or failed job exists for this fingerprint. */
    force?: boolean;
  },
) {
  const { proposal } = args;
  const extractionFingerprint = documentFingerprint(
    await proposalDocuments(ctx, proposal._id),
  );
  const now = dayjs().valueOf();
  const existing = await ctx.db
    .query("procurementProposalExtractionJobs")
    .withIndex("fingerprint", (q) =>
      q
        .eq("proposalId", proposal._id)
        .eq("extractionFingerprint", extractionFingerprint),
    )
    .order("desc")
    .first();
  if (existing) {
    const leaseExpired =
      existing.status === "running" &&
      (existing.leaseExpiresAt ?? Number.MAX_SAFE_INTEGER) <= now;
    if (existing.status === "pending")
      return { jobId: existing._id, extractionFingerprint, reused: true };
    if (existing.status === "running" && !leaseExpired)
      return { jobId: existing._id, extractionFingerprint, reused: true };
    if (existing.status === "complete" && !args.force)
      return { jobId: existing._id, extractionFingerprint, reused: true };
    if (leaseExpired)
      await ctx.db.patch(existing._id, {
        status: "failed",
        leaseId: undefined,
        leaseExpiresAt: undefined,
        lastError: "Proposal extraction lease expired; requeued by operator",
        updatedAt: now,
      });
  }
  const jobId = await ctx.db.insert("procurementProposalExtractionJobs", {
    proposalId: proposal._id,
    requestId: proposal.requestId,
    clientOrgId: proposal.clientOrgId,
    extractionFingerprint,
    requestedByUserId: args.operatorUserId,
    status: "pending",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.patch(proposal._id, {
    status: "extracting",
    extractionFingerprint,
    updatedByUserId: args.operatorUserId,
    updatedAt: now,
  });
  return { jobId, extractionFingerprint, reused: false };
}

async function activeProposalsForOutreach(
  ctx: MutationCtx,
  outreachId: Id<"procurementBrokerOutreaches">,
) {
  const rows = await ctx.db
    .query("procurementProposals")
    .withIndex("outreach", (q) => q.eq("outreachId", outreachId))
    .order("desc")
    .collect();
  return rows.filter((row) => ACTIVE_PROPOSAL_STATUSES.has(row.status));
}

export type FileProposalResult = {
  proposalId: Id<"procurementProposals">;
  status: "filed" | "already_filed" | "appended" | "revised";
  proposalStatus: Doc<"procurementProposals">["status"];
  requestId: Id<"procurementRequests">;
  outreachId: Id<"procurementBrokerOutreaches">;
  brokerOrgId: Id<"organizations">;
  supersededProposalId: Id<"procurementProposals"> | null;
  documents: Array<{
    proposalDocumentId: Id<"procurementProposalDocuments">;
    fileName: string;
    sha256: string;
    clientFileId: Id<"clientFiles"> | null;
    fileItemId: Id<"procurementFileItems"> | null;
    added: boolean;
  }>;
  extraction: {
    jobId: Id<"procurementProposalExtractionJobs">;
    extractionFingerprint: string;
    reused: boolean;
  };
  nextActions: ReturnType<typeof proposalNextActions>;
};

/**
 * One command per business intent: "file this quote". Idempotent on
 * request + outreach + document content. Replaying with the same documents
 * converges on the same proposal and job; a draft absorbs new documents; a
 * proposal that already progressed past draft requires an explicit revision.
 * Proposal, documents, file-item associations, and the extraction job are
 * written in one transaction so no empty shell can survive a partial failure.
 */
export async function fileProcurementProposalByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    requestId: Id<"procurementRequests">;
    outreachId: Id<"procurementBrokerOutreaches">;
    brokerOrgId?: Id<"organizations">;
    sources: ProposalDocumentSource[];
    /** Attach to this exact proposal instead of resolving one by outreach. */
    proposalId?: Id<"procurementProposals">;
    supersedesProposalId?: Id<"procurementProposals">;
    sourceEmailThreadId?: Id<"procurementEmailThreads">;
  },
): Promise<FileProposalResult> {
  await requireDirectOperator(ctx, args.operatorUserId);
  const { request, outreach, broker } = await assertBrokerOutreach(
    ctx,
    args.requestId,
    args.outreachId,
    args.brokerOrgId,
  );
  if (args.sources.length === 0)
    throw new Error("Add at least one proposal document");
  const resolved: ResolvedDocument[] = [];
  for (const source of args.sources) {
    const document = await resolveDocumentSource(ctx, {
      operatorUserId: args.operatorUserId,
      request,
      source,
    });
    if (!resolved.some((item) => item.sha256 === document.sha256))
      resolved.push(document);
  }

  const active = await activeProposalsForOutreach(ctx, outreach._id);
  const withDocuments = await Promise.all(
    active.map(async (proposal) => ({
      proposal,
      documents: await proposalDocuments(ctx, proposal._id),
    })),
  );
  const now = dayjs().valueOf();

  let target: Doc<"procurementProposals"> | null = null;
  let status: FileProposalResult["status"] = "filed";
  let supersededProposalId: Id<"procurementProposals"> | null = null;

  if (args.proposalId) {
    const explicit = await requireProposal(ctx, args.proposalId);
    if (explicit.outreachId !== outreach._id)
      throw new Error("Proposal does not belong to this outreach");
    if (!ACTIVE_PROPOSAL_STATUSES.has(explicit.status))
      throw new Error(`Proposal is ${explicit.status}; file a new one instead`);
    target = explicit;
  }

  const converged = withDocuments.find(
    ({ proposal, documents }) =>
      (!target || proposal._id === target._id) &&
      documents.length > 0 &&
      resolved.every((item) =>
        documents.some((document) => document.sha256 === item.sha256),
      ),
  );
  if (converged) {
    target = converged.proposal;
    status = "already_filed";
  } else if (target) {
    if (target.status !== "draft")
      throw new Error(
        `Proposal ${target._id} is ${target.status}; pass supersedesProposalId to file a revision`,
      );
    status = "appended";
  } else if (args.supersedesProposalId) {
    const prior = await requireProposal(ctx, args.supersedesProposalId);
    if (prior.outreachId !== outreach._id)
      throw new Error("Superseded proposal must belong to this outreach");
    const conflicting = active.find((proposal) => proposal._id !== prior._id);
    if (conflicting)
      throw new Error(
        `Outreach already has another active proposal ${conflicting._id}; archive it before filing a revision`,
      );
    if (prior.status === "selected")
      throw new Error(
        "A selected proposal cannot be superseded; select another proposal first",
      );
    if (ACTIVE_PROPOSAL_STATUSES.has(prior.status))
      await ctx.db.patch(prior._id, {
        status: "withdrawn",
        updatedByUserId: args.operatorUserId,
        updatedAt: now,
      });
    supersededProposalId = prior._id;
    status = "revised";
  } else {
    const draft = withDocuments.find(
      ({ proposal }) => proposal.status === "draft",
    );
    if (draft) {
      target = draft.proposal;
      status = draft.documents.length ? "appended" : "filed";
    } else if (active.length) {
      const latest = active[0]!;
      throw new Error(
        `Outreach already has an active proposal ${latest._id} (${latest.status}). Pass supersedesProposalId=${latest._id} to file a revision, or archive it first`,
      );
    }
  }

  if (!target) {
    const proposalId = await ctx.db.insert("procurementProposals", {
      requestId: request._id,
      clientOrgId: request.clientOrgId,
      brokerOrgId: broker._id,
      outreachId: outreach._id,
      supersedesProposalId: supersededProposalId ?? undefined,
      status: "draft",
      createdByUserId: args.operatorUserId,
      updatedByUserId: args.operatorUserId,
      createdAt: now,
      updatedAt: now,
    });
    target = (await ctx.db.get(proposalId))!;
  }

  const existingDocuments = await proposalDocuments(ctx, target._id);
  const documents: FileProposalResult["documents"] = [];
  let added = false;
  for (const item of resolved) {
    const fileItemId = await ensureQuoteFileItem(ctx, {
      operatorUserId: args.operatorUserId,
      request,
      outreachId: outreach._id,
      document: item,
    });
    const present = existingDocuments.find(
      (document) => document.sha256 === item.sha256,
    );
    if (present) {
      if (!present.clientFileId)
        await ctx.db.patch(present._id, { clientFileId: item.clientFileId });
      documents.push({
        proposalDocumentId: present._id,
        fileName: present.fileName,
        sha256: present.sha256,
        clientFileId: item.clientFileId,
        fileItemId,
        added: false,
      });
      continue;
    }
    added = true;
    const proposalDocumentId = await ctx.db.insert(
      "procurementProposalDocuments",
      {
        proposalId: target._id,
        requestId: request._id,
        clientOrgId: request.clientOrgId,
        fileId: item.fileId,
        fileName: item.fileName,
        contentType: item.contentType,
        size: item.size,
        sha256: item.sha256,
        clientFileId: item.clientFileId,
        createdByUserId: args.operatorUserId,
        createdAt: now,
      },
    );
    documents.push({
      proposalDocumentId,
      fileName: item.fileName,
      sha256: item.sha256,
      clientFileId: item.clientFileId,
      fileItemId,
      added: true,
    });
  }
  if (added) {
    await ctx.db.patch(target._id, {
      status: "draft",
      extractionFingerprint: undefined,
      extractedOffer: undefined,
      updatedByUserId: args.operatorUserId,
      updatedAt: now,
    });
    target = (await ctx.db.get(target._id))!;
  }
  if (outreach.status === "request_sent" || outreach.status === "can_handle")
    await ctx.db.patch(outreach._id, {
      status: "quote_received",
      updatedByUserId: args.operatorUserId,
      updatedAt: now,
    });

  const extraction =
    target.status === "draft" || target.status === "extracting"
      ? await queueProposalExtraction(ctx, {
          operatorUserId: args.operatorUserId,
          proposal: target,
        })
      : {
          jobId: (await recentJobs(ctx, target._id))[0]?._id,
          extractionFingerprint: target.extractionFingerprint ?? "",
          reused: true,
        };
  if (!extraction.jobId)
    throw new Error("Proposal has no extraction job to report");
  const final = (await ctx.db.get(target._id))!;
  if (status !== "already_filed")
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "setup_write",
      targetOrgId: request.clientOrgId,
      summary: `Filed ${status === "revised" ? "revised " : ""}proposal from ${broker.name} for ${request.title}`,
      metadata: {
        domain: "procurement",
        requestId: request._id,
        proposalId: final._id,
        outreachId: outreach._id,
        supersededProposalId,
        sourceEmailThreadId: args.sourceEmailThreadId,
        documentCount: documents.length,
        jobId: extraction.jobId,
      },
    });
  const latestJob = (await recentJobs(ctx, final._id))[0];
  return {
    proposalId: final._id,
    status,
    proposalStatus: final.status,
    requestId: request._id,
    outreachId: outreach._id,
    brokerOrgId: broker._id,
    supersededProposalId,
    documents,
    extraction: {
      jobId: extraction.jobId,
      extractionFingerprint: extraction.extractionFingerprint,
      reused: extraction.reused,
    },
    nextActions: proposalNextActions(
      final,
      latestJob ? jobSummary(latestJob, final, now) : null,
      (await proposalDocuments(ctx, final._id)).length,
    ),
  };
}

export async function fileProcurementEmailQuoteByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    emailThreadId: Id<"procurementEmailThreads">;
    outreachId: Id<"procurementBrokerOutreaches">;
    /** Files the whole thread when omitted. Narrow it to skip signature images
     * and logos that arrive as attachments alongside the quote. */
    clientFileIds?: Id<"clientFiles">[];
    supersedesProposalId?: Id<"procurementProposals">;
  },
) {
  await requireDirectOperator(ctx, args.operatorUserId);
  const thread = await ctx.db.get(args.emailThreadId);
  if (!thread || thread.deletedAt || thread.archivedAt)
    throw new Error("Procurement email thread not found");
  const messages = await ctx.db
    .query("procurementEmailMessages")
    .withIndex("thread", (query) => query.eq("threadId", thread._id))
    .collect();
  const clientFileIds = [
    ...new Set(messages.flatMap((message) => message.clientFileIds)),
  ];
  const activeClientFileIds: Id<"clientFiles">[] = [];
  for (const clientFileId of clientFileIds) {
    const file = await ctx.db.get(clientFileId);
    if (
      file &&
      !file.archivedAt &&
      !file.deletedAt &&
      file.orgId === thread.clientOrgId
    )
      activeClientFileIds.push(file._id);
  }
  if (!activeClientFileIds.length)
    throw new Error("This email thread has no active file attachments to file");
  let selectedClientFileIds = activeClientFileIds;
  if (args.clientFileIds?.length) {
    const active = new Set(activeClientFileIds.map(String));
    for (const clientFileId of args.clientFileIds)
      if (!active.has(String(clientFileId)))
        throw new Error(
          `Attachment ${clientFileId} is not an active file on this email thread`,
        );
    selectedClientFileIds = [...new Set(args.clientFileIds)];
  }
  const result = await fileProcurementProposalByOperator(ctx, {
    operatorUserId: args.operatorUserId,
    requestId: thread.requestId,
    outreachId: args.outreachId,
    sources: selectedClientFileIds.map((clientFileId) => ({
      kind: "client_file",
      clientFileId,
    })),
    supersedesProposalId: args.supersedesProposalId,
    sourceEmailThreadId: thread._id,
  });
  return { emailThreadId: thread._id, ...result };
}

export const fileEmailQuote = mutation({
  args: {
    emailThreadId: v.id("procurementEmailThreads"),
    outreachId: v.id("procurementBrokerOutreaches"),
    clientFileIds: v.optional(v.array(v.id("clientFiles"))),
    supersedesProposalId: v.optional(v.id("procurementProposals")),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return await fileProcurementEmailQuoteByOperator(ctx, {
      operatorUserId: operator.userId,
      ...args,
    });
  },
});

export const generateUploadUrl = mutation({
  args: { requestId: v.id("procurementRequests") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await requireDirectOperator(ctx, operator.userId);
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Procurement request not found");
    const now = dayjs().valueOf();
    const expiresAt = now + PROPOSAL_UPLOAD_TTL_MS;
    const uploadIntentId = await ctx.db.insert("clientFileUploadIntents", {
      operatorUserId: operator.userId,
      clientOrgId: request.clientOrgId,
      expiresAt,
      createdAt: now,
    });
    await ctx.scheduler.runAt(
      expiresAt,
      internal.clientFiles.cleanupUploadIntentInternal,
      { uploadIntentId },
    );
    return {
      uploadUrl: await ctx.storage.generateUploadUrl(),
      uploadIntentId,
    };
  },
});

export const registerUpload = mutation({
  args: {
    requestId: v.id("procurementRequests"),
    uploadIntentId: v.id("clientFileUploadIntents"),
    fileId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await requireDirectOperator(ctx, operator.userId);
    const [request, intent, metadata] = await Promise.all([
      ctx.db.get(args.requestId),
      ctx.db.get(args.uploadIntentId),
      ctx.db.system.get("_storage", args.fileId),
    ]);
    if (!request) throw new Error("Procurement request not found");
    if (
      !intent ||
      intent.operatorUserId !== operator.userId ||
      intent.clientOrgId !== request.clientOrgId ||
      intent.expiresAt <= dayjs().valueOf() ||
      (intent.fileId && intent.fileId !== args.fileId)
    )
      throw new Error("Proposal upload intent is invalid or expired");
    if (!metadata) throw new Error("Proposal file was not uploaded");
    if (metadata.size > MAX_PROPOSAL_FILE_BYTES)
      throw new Error("Proposal files must be 50 MB or smaller");
    await ctx.db.patch(intent._id, { fileId: args.fileId });
    return { uploadIntentId: intent._id, fileId: args.fileId };
  },
});

export const file = mutation({
  args: {
    requestId: v.id("procurementRequests"),
    outreachId: v.id("procurementBrokerOutreaches"),
    sources: v.array(proposalDocumentSourceValidator),
    proposalId: v.optional(v.id("procurementProposals")),
    supersedesProposalId: v.optional(v.id("procurementProposals")),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await requireDirectOperator(ctx, operator.userId);
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Procurement request not found");
    const uploadIntents: Id<"clientFileUploadIntents">[] = [];
    for (const source of args.sources) {
      if (source.kind !== "upload") continue;
      if (!source.uploadIntentId)
        throw new Error("Browser proposal uploads require an upload intent");
      const intent = await ctx.db.get(source.uploadIntentId);
      if (
        !intent ||
        intent.operatorUserId !== operator.userId ||
        intent.clientOrgId !== request.clientOrgId ||
        intent.fileId !== source.fileId ||
        intent.expiresAt <= dayjs().valueOf()
      )
        throw new Error("Proposal upload intent is invalid or expired");
      if (uploadIntents.includes(intent._id))
        throw new Error("A proposal upload intent can be used only once");
      uploadIntents.push(intent._id);
    }
    const result = await fileProcurementProposalByOperator(ctx, {
      operatorUserId: operator.userId,
      ...args,
    });
    for (const uploadIntentId of uploadIntents)
      await ctx.db.delete(uploadIntentId);
    return result;
  },
});

export async function archiveProcurementProposalByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    proposalId: Id<"procurementProposals">;
    reason?: string;
  },
) {
  await requireDirectOperator(ctx, args.operatorUserId);
  const proposal = await requireProposal(ctx, args.proposalId);
  if (proposal.status === "selected")
    throw new Error(
      "A selected proposal cannot be archived; select another proposal first",
    );
  const now = dayjs().valueOf();
  const [documents, jobs] = await Promise.all([
    proposalDocuments(ctx, proposal._id),
    recentJobs(ctx, proposal._id),
  ]);
  const request = await ctx.db.get(proposal.requestId);
  const outcome: "deleted" | "archived" | "unchanged" =
    proposal.status === "archived"
      ? "unchanged"
      : proposal.status === "draft" &&
          documents.length === 0 &&
          jobs.length === 0
        ? "deleted"
        : "archived";
  if (outcome === "deleted") {
    await ctx.db.delete(proposal._id);
  } else if (outcome === "archived") {
    for (const job of jobs)
      if (job.status === "pending" || job.status === "running")
        await ctx.db.patch(job._id, {
          status: "failed",
          leaseId: undefined,
          leaseExpiresAt: undefined,
          lastError: "Proposal archived by operator",
          cancelledAt: now,
          updatedAt: now,
        });
    await ctx.db.patch(proposal._id, {
      status: "archived",
      archivedAt: now,
      archivedByUserId: args.operatorUserId,
      archiveReason: args.reason?.trim() || undefined,
      updatedByUserId: args.operatorUserId,
      updatedAt: now,
    });
  }
  if (outcome !== "unchanged")
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "setup_write",
      targetOrgId: proposal.clientOrgId,
      summary: `${outcome === "deleted" ? "Deleted empty draft" : "Archived"} proposal for ${request?.title ?? proposal.requestId}`,
      metadata: {
        domain: "procurement",
        requestId: proposal.requestId,
        proposalId: proposal._id,
        outcome,
        reason: args.reason,
        previousStatus: proposal.status,
      },
    });
  return { proposalId: proposal._id, outcome, previousStatus: proposal.status };
}

export const archive = mutation({
  args: {
    proposalId: v.id("procurementProposals"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return await archiveProcurementProposalByOperator(ctx, {
      operatorUserId: operator.userId,
      ...args,
    });
  },
});

export async function retryProcurementProposalExtractionByOperator(
  ctx: MutationCtx,
  args: { operatorUserId: Id<"users">; proposalId: Id<"procurementProposals"> },
) {
  await requireDirectOperator(ctx, args.operatorUserId);
  const proposal = await requireProposal(ctx, args.proposalId);
  if (!["draft", "extracting", "review_ready"].includes(proposal.status))
    throw new Error(
      `Proposal is ${proposal.status}; only draft, extracting, or review_ready proposals can be re-extracted`,
    );
  const now = dayjs().valueOf();
  const latest = (await recentJobs(ctx, proposal._id))[0];
  if (
    latest?.status === "running" &&
    (latest.leaseExpiresAt ?? Number.MAX_SAFE_INTEGER) > now
  )
    throw new Error(
      `Extraction is still running with a live lease until ${dayjs(latest.leaseExpiresAt).toISOString()}; cancel it first or wait`,
    );
  const result = await queueProposalExtraction(ctx, {
    operatorUserId: args.operatorUserId,
    proposal,
    force: true,
  });
  await writeOperatorAudit(ctx, {
    operatorUserId: args.operatorUserId,
    type: "setup_write",
    targetOrgId: proposal.clientOrgId,
    summary: `Requeued proposal extraction for proposal ${proposal._id}`,
    metadata: {
      domain: "procurement",
      requestId: proposal.requestId,
      proposalId: proposal._id,
      jobId: result.jobId,
      previousJobId: latest?._id,
      previousJobStatus: latest?.status,
      previousError: latest?.lastError,
    },
  });
  return {
    proposalId: proposal._id,
    jobId: result.jobId,
    extractionFingerprint: result.extractionFingerprint,
    reused: result.reused,
    previousJob: latest ? jobSummary(latest, proposal, now) : null,
  };
}

export const retryExtraction = mutation({
  args: { proposalId: v.id("procurementProposals") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return await retryProcurementProposalExtractionByOperator(ctx, {
      operatorUserId: operator.userId,
      ...args,
    });
  },
});

export async function cancelProcurementProposalExtractionByOperator(
  ctx: MutationCtx,
  args: { operatorUserId: Id<"users">; proposalId: Id<"procurementProposals"> },
) {
  await requireDirectOperator(ctx, args.operatorUserId);
  const proposal = await requireProposal(ctx, args.proposalId);
  const now = dayjs().valueOf();
  const jobs = await recentJobs(ctx, proposal._id);
  const cancelled: Id<"procurementProposalExtractionJobs">[] = [];
  for (const job of jobs)
    if (job.status === "pending" || job.status === "running") {
      await ctx.db.patch(job._id, {
        status: "failed",
        leaseId: undefined,
        leaseExpiresAt: undefined,
        lastError: "Cancelled by operator",
        cancelledAt: now,
        updatedAt: now,
      });
      cancelled.push(job._id);
    }
  if (proposal.status === "extracting")
    await ctx.db.patch(proposal._id, {
      status: "draft",
      updatedByUserId: args.operatorUserId,
      updatedAt: now,
    });
  if (cancelled.length)
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "setup_write",
      targetOrgId: proposal.clientOrgId,
      summary: `Cancelled proposal extraction for proposal ${proposal._id}`,
      metadata: {
        domain: "procurement",
        requestId: proposal.requestId,
        proposalId: proposal._id,
        cancelledJobIds: cancelled,
      },
    });
  return { proposalId: proposal._id, cancelledJobIds: cancelled };
}

export const cancelExtraction = mutation({
  args: { proposalId: v.id("procurementProposals") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return await cancelProcurementProposalExtractionByOperator(ctx, {
      operatorUserId: operator.userId,
      ...args,
    });
  },
});

export type ProposalExtractionIssueStatus =
  | "error"
  | "queued"
  | "running"
  | "stuck";

/** Proposal extraction rows for the unified extraction diagnostics. A stuck
 * job is a running job whose worker lease expired without completion. */
export async function listProposalExtractionIssues(
  ctx: QueryCtx | MutationCtx,
  args: {
    orgId?: Id<"organizations">;
    status?: ProposalExtractionIssueStatus;
    limit: number;
  },
) {
  const now = dayjs().valueOf();
  const rawStatuses: Array<"failed" | "pending" | "running"> =
    args.status === "error"
      ? ["failed"]
      : args.status === "queued"
        ? ["pending"]
        : args.status === "running" || args.status === "stuck"
          ? ["running"]
          : ["failed", "pending", "running"];
  const candidateLimit = Math.min(100, args.limit * 5);
  const rows = (
    await Promise.all(
      rawStatuses.map((status) =>
        ctx.db
          .query("procurementProposalExtractionJobs")
          .withIndex("status", (q) => q.eq("status", status))
          .order("desc")
          .take(candidateLimit),
      ),
    )
  )
    .flat()
    .map((job) => {
      const leaseExpired =
        job.status === "running" &&
        (job.leaseExpiresAt ?? Number.MAX_SAFE_INTEGER) <= now;
      const unified: ProposalExtractionIssueStatus =
        job.status === "failed"
          ? "error"
          : job.status === "pending"
            ? "queued"
            : leaseExpired
              ? "stuck"
              : "running";
      return { job, unified };
    })
    .filter(({ unified }) => !args.status || unified === args.status)
    .filter(({ job }) => !args.orgId || job.clientOrgId === args.orgId)
    .sort((left, right) => right.job.updatedAt - left.job.updatedAt);
  const seen = new Set<string>();
  const issues = [];
  let bounded = false;
  for (const { job, unified } of rows) {
    if (issues.length >= args.limit) {
      bounded = true;
      break;
    }
    if (seen.has(String(job.proposalId))) continue;
    seen.add(String(job.proposalId));
    const proposal = await ctx.db.get(job.proposalId);
    // A proposal is only an open issue while it is still live: archiving fails
    // its pending jobs, and a withdrawn proposal has no recovery worth naming.
    if (
      !proposal ||
      proposal.status === "archived" ||
      proposal.status === "withdrawn"
    )
      continue;
    // Only the newest job speaks for the proposal. A completed retry supersedes
    // the failure that preceded it, and a cancelled job is not an error either.
    const latestJob = await ctx.db
      .query("procurementProposalExtractionJobs")
      .withIndex("proposal", (q) => q.eq("proposalId", job.proposalId))
      .order("desc")
      .first();
    if (!latestJob || latestJob._id !== job._id) continue;
    if (job.cancelledAt) continue;
    const [request, organization, broker] = await Promise.all([
      ctx.db.get(job.requestId),
      ctx.db.get(job.clientOrgId),
      ctx.db.get(proposal.brokerOrgId),
    ]);
    issues.push({
      domain: "proposal" as const,
      proposalId: job.proposalId,
      proposalStatus: proposal.status,
      requestId: job.requestId,
      requestTitle: request?.title ?? null,
      orgId: job.clientOrgId,
      orgName: organization?.name ?? null,
      brokerName: broker?.name ?? null,
      jobId: job._id,
      status: unified,
      attempts: job.attempts,
      maxAttempts: PROPOSAL_EXTRACTION_MAX_ATTEMPTS,
      leaseExpiresAt: job.leaseExpiresAt ?? null,
      error: job.lastError ?? null,
      updatedAt: job.updatedAt,
      recovery:
        unified === "error" || unified === "stuck"
          ? ("retry_procurement_proposal_extraction" as const)
          : null,
    });
  }
  return { issues, bounded };
}

export const getReviewInputInternal = internalQuery({
  args: { proposalId: v.id("procurementProposals") },
  handler: async (ctx, args) => {
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal?.extractionFingerprint || !proposal.extractedOffer)
      return null;
    const request = await ctx.db.get(proposal.requestId);
    if (!request) return null;
    const sections = (
      await ctx.db
        .query("procurementPacketSections")
        .withIndex("request", (q) => q.eq("requestId", request._id))
        .collect()
    )
      .filter(
        (section) =>
          audienceIncludes(section.audience, "client") && section.body.trim(),
      )
      .sort((a, b) => a.order - b.order);
    const { markdown, legend } = buildProposalMarkdown(proposal.extractedOffer);
    return {
      proposalId: proposal._id,
      requestId: request._id,
      clientOrgId: request.clientOrgId,
      extractionFingerprint: proposal.extractionFingerprint,
      packetRevision: request.packetRevision ?? 0,
      packetMarkdown: sections
        .map(
          (section) =>
            `## ${section.key} — ${section.heading}\n\n${section.body.trim()}`,
        )
        .join("\n\n"),
      sectionKeys: sections.map((section) => section.key),
      proposalMarkdown: markdown,
      evidenceLegend: legend,
    };
  },
});

export const saveGeneratedReviewInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    proposalId: v.id("procurementProposals"),
    extractionFingerprint: v.string(),
    packetRevision: v.number(),
    findings: v.array(v.any()),
    conclusion: conclusionValidator,
  },
  handler: async (ctx, args) => {
    await requireDirectOperator(ctx, args.operatorUserId);
    const proposal = await ctx.db.get(args.proposalId);
    if (
      !proposal ||
      proposal.extractionFingerprint !== args.extractionFingerprint
    )
      throw new Error("Stale proposal extraction");
    const request = await ctx.db.get(proposal.requestId);
    if (!request || (request.packetRevision ?? 0) !== args.packetRevision)
      throw new Error("Stale procurement packet");
    const now = dayjs().valueOf();
    const reviewId = await ctx.db.insert("procurementProposalReviews", {
      proposalId: proposal._id,
      requestId: request._id,
      clientOrgId: request.clientOrgId,
      extractionFingerprint: args.extractionFingerprint,
      packetRevision: args.packetRevision,
      modelConclusion: args.conclusion,
      findings: args.findings,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(proposal._id, {
      status: "review_ready",
      updatedAt: now,
    });
    const auditEventId = await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "setup_write",
      targetOrgId: request.clientOrgId,
      summary: `Generated packet-bound review for proposal ${proposal._id}`,
      metadata: {
        domain: "procurement",
        requestId: request._id,
        proposalId: proposal._id,
        reviewId,
        packetRevision: args.packetRevision,
        conclusion: args.conclusion,
      },
    });
    return { reviewId, auditEventId };
  },
});

export async function confirmProcurementProposalReviewByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    reviewId: Id<"procurementProposalReviews">;
    conclusion: "meets_requirements" | "has_gaps" | "insufficient_evidence";
  },
) {
  await requireDirectOperator(ctx, args.operatorUserId);
  const review = await ctx.db.get(args.reviewId);
  if (!review) throw new Error("Review not found");
  const proposal = await requireProposal(ctx, review.proposalId);
  await assertBrokerOutreach(
    ctx,
    proposal.requestId,
    proposal.outreachId,
    proposal.brokerOrgId,
  );
  const request = await ctx.db.get(review.requestId);
  if (
    !request ||
    proposal.requestId !== request._id ||
    proposal.clientOrgId !== request.clientOrgId ||
    proposal.extractionFingerprint !== review.extractionFingerprint ||
    (request.packetRevision ?? 0) !== (review.packetRevision ?? -1)
  )
    throw new Error("Review is stale");
  const now = dayjs().valueOf();
  await ctx.db.patch(review._id, {
    staffConclusion: args.conclusion,
    confirmedByUserId: args.operatorUserId,
    confirmedAt: now,
    updatedAt: now,
  });
  await ctx.db.patch(proposal._id, {
    status: "reviewed",
    updatedByUserId: args.operatorUserId,
    updatedAt: now,
  });
  const auditEventId = await writeOperatorAudit(ctx, {
    operatorUserId: args.operatorUserId,
    type: "setup_write",
    targetOrgId: request.clientOrgId,
    summary: `Confirmed proposal review as ${args.conclusion.replaceAll("_", " ")}`,
    metadata: {
      domain: "procurement",
      requestId: request._id,
      proposalId: proposal._id,
      reviewId: review._id,
      conclusion: args.conclusion,
    },
  });
  return { proposalId: proposal._id, auditEventId };
}

export const confirmReview = mutation({
  args: {
    reviewId: v.id("procurementProposalReviews"),
    conclusion: conclusionValidator,
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return await confirmProcurementProposalReviewByOperator(ctx, {
      operatorUserId: operator.userId,
      ...args,
    });
  },
});

export async function selectProcurementProposalByOperator(
  ctx: MutationCtx,
  args: { operatorUserId: Id<"users">; proposalId: Id<"procurementProposals"> },
) {
  await requireDirectOperator(ctx, args.operatorUserId);
  const proposal = await requireProposal(ctx, args.proposalId);
  await assertBrokerOutreach(
    ctx,
    proposal.requestId,
    proposal.outreachId,
    proposal.brokerOrgId,
  );
  const request = await ctx.db.get(proposal.requestId);
  if (!request) throw new Error("Request not found");
  if (proposal.status !== "reviewed" && proposal.status !== "selected") {
    throw new Error("Only a reviewed proposal can be selected");
  }
  const reviews = await ctx.db
    .query("procurementProposalReviews")
    .withIndex("proposal", (q) => q.eq("proposalId", proposal._id))
    .order("desc")
    .collect();
  const current = reviews.find(
    (review) =>
      review.staffConclusion &&
      review.requestId === request._id &&
      review.clientOrgId === request.clientOrgId &&
      review.extractionFingerprint === proposal.extractionFingerprint &&
      (review.packetRevision ?? -1) === (request.packetRevision ?? 0),
  );
  if (!current) throw new Error("A current staff-confirmed review is required");
  if (current.staffConclusion !== "meets_requirements") {
    throw new Error(
      "Only a proposal confirmed to meet every requirement can be selected",
    );
  }
  const brokerSections = (
    await ctx.db
      .query("procurementPacketSections")
      .withIndex("request", (q) => q.eq("requestId", request._id))
      .collect()
  ).filter(
    (section) =>
      audienceIncludes(section.audience, "client") && section.body.trim(),
  );
  if (brokerSections.length === 0) {
    throw new Error(
      "Share at least one broker-visible packet section before selecting a proposal",
    );
  }
  const selected = await ctx.db
    .query("procurementProposals")
    .withIndex("request_status", (q) =>
      q.eq("requestId", request._id).eq("status", "selected"),
    )
    .collect();
  const now = dayjs().valueOf();
  for (const prior of selected)
    if (prior._id !== proposal._id)
      await ctx.db.patch(prior._id, {
        status: "reviewed",
        selectedAt: undefined,
        selectedByUserId: undefined,
        updatedByUserId: args.operatorUserId,
        updatedAt: now,
      });
  await ctx.db.patch(proposal._id, {
    status: "selected",
    selectedAt: now,
    selectedByUserId: args.operatorUserId,
    updatedByUserId: args.operatorUserId,
    updatedAt: now,
  });
  await ctx.db.patch(request._id, {
    status: "binding",
    updatedByUserId: args.operatorUserId,
    updatedAt: now,
  });
  const auditEventId = await writeOperatorAudit(ctx, {
    operatorUserId: args.operatorUserId,
    type: "setup_write",
    targetOrgId: request.clientOrgId,
    summary: `Selected proposal ${proposal._id} for binding`,
    metadata: {
      domain: "procurement",
      requestId: request._id,
      proposalId: proposal._id,
      reviewId: current._id,
      conclusion: current.staffConclusion,
    },
  });
  return {
    proposalId: proposal._id,
    reviewId: current._id,
    conclusion: current.staffConclusion,
    auditEventId,
  };
}

export const select = mutation({
  args: { proposalId: v.id("procurementProposals") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return await selectProcurementProposalByOperator(ctx, {
      operatorUserId: operator.userId,
      ...args,
    });
  },
});
