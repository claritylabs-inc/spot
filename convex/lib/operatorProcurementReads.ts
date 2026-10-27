import dayjs from "dayjs";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { submittedIntakeApplication } from "../../lib/intake-application";
import {
  buildRequestTimeline,
  getProcurementRequestDetails,
  listAcrossClientRequestRows,
  requestRow,
  requireClient,
  requireRequest,
} from "../procurementRequests";
import { getProcurementProposalDetails } from "../procurementProposals";
import { readPolicyPipelineState } from "../policies";
import { activeTeamThread } from "./teamEmailStore";

export function procurementApplicationSummary(
  request: Doc<"procurementRequests">,
) {
  const application = submittedIntakeApplication(request);
  return application
    ? {
        submittedAt: application.submittedAt,
        revision: application.revision,
        legalName: application.answers.legalName,
        coverage: application.details.coverages.map((line) => line.coverage),
      }
    : null;
}

export function procurementRequestSummary(
  request: Doc<"procurementRequests">,
  client: Pick<Doc<"organizations">, "name">,
) {
  return {
    procurementRequestId: request._id,
    clientOrgId: request.clientOrgId,
    clientName: client.name,
    title: request.title,
    status: request.status,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    submittedAt: submittedIntakeApplication(request)?.submittedAt ?? null,
  };
}

export async function listOperatorProcurementRequests(
  ctx: QueryCtx,
  args: Parameters<typeof listAcrossClientRequestRows>[1] & {
    view?: "summary" | "full";
  },
) {
  const page = await listAcrossClientRequestRows(ctx, {
    ...args,
    limit: Math.min(args.limit, args.view === "full" ? 10 : 100),
  });
  return {
    requests: await Promise.all(
      page.rows.map(async ({ row, client }) =>
        args.view === "full"
          ? await requestRow(ctx, row)
          : procurementRequestSummary(row, client),
      ),
    ),
    nextCursor: page.nextCursor,
    bounded: page.bounded,
    scanned: page.scanned,
    countsOmitted:
      args.view === "full"
        ? []
        : ["brokerCount", "quoteCount", "emailThreadCount"],
    ...(args.view !== "full"
      ? {
          countsNote:
            "Counts require child-record scans; use get_procurement_request with outreach or emailThreads for bounded detail.",
        }
      : {}),
  };
}

export async function listOperatorProcurementProposals(
  ctx: QueryCtx,
  requestId: Id<"procurementRequests">,
  args: { view?: "summary" | "full"; limit?: number; cursor?: string } = {},
) {
  const request = await requireRequest(ctx, requestId);
  const page = await ctx.db
    .query("procurementProposals")
    .withIndex("request", (q) => q.eq("requestId", requestId))
    .order("desc")
    .paginate({
      cursor: args.cursor ?? null,
      numItems: Math.min(args.limit ?? 25, args.view === "full" ? 10 : 100),
    });
  return {
    proposals: await Promise.all(
      page.page.map(async (proposal) => {
        if (args.view === "full")
          return await getProcurementProposalDetails(ctx, proposal._id);
        const [broker, review] = await Promise.all([
          ctx.db.get(proposal.brokerOrgId),
          ctx.db
            .query("procurementProposalReviews")
            .withIndex("proposal", (q) => q.eq("proposalId", proposal._id))
            .order("desc")
            .first(),
        ]);
        const offer: unknown = proposal.extractedOffer;
        const premium =
          offer &&
          typeof offer === "object" &&
          "premium" in offer &&
          typeof offer.premium === "string"
            ? offer.premium
            : null;
        return {
          procurementProposalId: proposal._id,
          procurementRequestId: proposal.requestId,
          brokerOrgId: proposal.brokerOrgId,
          outreachId: proposal.outreachId,
          providerName: broker?.name ?? null,
          premium,
          status: proposal.status,
          reviewConclusion: review
            ? (review.staffConclusion ?? review.modelConclusion)
            : null,
          reviewStale: review
            ? review.packetRevision !== (request.packetRevision ?? 0) ||
              review.extractionFingerprint !== proposal.extractionFingerprint
            : null,
        };
      }),
    ),
    nextCursor: page.isDone ? null : page.continueCursor,
    bounded: !page.isDone,
    private: true,
  };
}

export async function getOperatorProcurementRequest(
  ctx: QueryCtx,
  requestId: Id<"procurementRequests">,
  args: { include?: string[]; view?: "summary" | "full" },
) {
  const include = new Set(args.include ?? []);
  if (args.view === "full") {
    return await getProcurementRequestDetails(ctx, requestId, {
      signedFileUrls: include.has("files"),
    });
  }
  const request = await requireRequest(ctx, requestId);
  const client = await requireClient(ctx, request.clientOrgId);
  const timeline = include.has("timeline");
  const [outreaches, fileItems, emails, proposals, audits] = await Promise.all([
    include.has("outreach") || timeline
      ? ctx.db
          .query("procurementBrokerOutreaches")
          .withIndex("request", (q) => q.eq("requestId", requestId))
          .order("desc")
          .take(101)
      : [],
    include.has("files") || timeline
      ? ctx.db
          .query("procurementFileItems")
          .withIndex("request", (q) => q.eq("requestId", requestId))
          .order("desc")
          .take(101)
      : [],
    include.has("emailThreads") || timeline
      ? ctx.db
          .query("teamEmailThreads")
          .withIndex("by_requestId_and_latestMessageAt", (q) =>
            q.eq("requestId", requestId),
          )
          .order("desc")
          .take(51)
      : [],
    timeline
      ? ctx.db
          .query("procurementProposals")
          .withIndex("request", (q) => q.eq("requestId", requestId))
          .order("desc")
          .take(101)
      : [],
    include.has("audit") || timeline
      ? ctx.db
          .query("operatorAuditEvents")
          .withIndex("request_created", (q) => q.eq("requestId", requestId))
          .order("desc")
          .take(26)
      : [],
  ]);
  const files = await Promise.all(
    fileItems
      .slice(0, 100)
      .filter((item) => item.clientFileId && !item.removedAt)
      .map(async (item) => {
        const file = item.clientFileId
          ? await ctx.db.get(item.clientFileId)
          : null;
        return {
          _id: item._id,
          clientFileId: item.clientFileId,
          label: item.label,
          clientVisible: item.clientVisible,
          brokerRelease: item.outreachId ? "hidden" : item.brokerRelease,
          sourceEmailMessageId: item.sourceEmailMessageId,
          updatedAt: item.updatedAt,
          clientFile: file
            ? {
                name: file.name,
                contentType: file.contentType,
                uploadedBySide: file.uploadedBySide,
                ...(include.has("files")
                  ? { url: await ctx.storage.getUrl(file.fileId) }
                  : {}),
              }
            : null,
        };
      }),
  );
  const activeEmails = emails.slice(0, 50).filter(activeTeamThread);
  const auditEvents = audits.slice(0, 25).map((event) => ({
    _id: event._id,
    type: event.type,
    summary: event.summary,
    createdAt: event.createdAt,
  }));
  const proposalPage = include.has("proposals")
    ? await listOperatorProcurementProposals(ctx, requestId)
    : undefined;
  return {
    request: {
      ...procurementRequestSummary(request, client),
      intakeRevision: request.intakeRevision ?? 0,
      targetEffectiveDate: request.targetEffectiveDate,
      replacingPolicyId: request.replacingPolicyId,
      resultingPolicyId: request.resultingPolicyId,
      completionOutcome: request.completionOutcome,
      application: include.has("application")
        ? submittedIntakeApplication(request)
        : procurementApplicationSummary(request),
    },
    ...(include.has("outreach")
      ? { outreaches: outreaches.slice(0, 100) }
      : {}),
    ...(include.has("files") ? { files } : {}),
    ...(include.has("emailThreads")
      ? {
          emailThreads: activeEmails.map((thread) => ({
            _id: thread._id,
            subject: thread.subject,
            category: thread.category,
            messageCount: thread.messageCount,
            latestMessageAt: thread.latestMessageAt,
          })),
        }
      : {}),
    ...(proposalPage
      ? {
          proposals: proposalPage.proposals,
          proposalsNextCursor: proposalPage.nextCursor,
        }
      : {}),
    ...(include.has("audit") ? { auditEvents } : {}),
    ...(timeline
      ? {
          timeline: buildRequestTimeline({
            auditEvents,
            emailThreads: activeEmails,
            fileItems: files,
            outreaches: outreaches.slice(0, 100),
            proposals: proposals.slice(0, 100),
          }),
        }
      : {}),
    timelineBounded:
      timeline &&
      auditEvents.length +
        activeEmails.length +
        files.length +
        outreaches.length +
        proposals.length >
        40,
    bounded:
      outreaches.length > 100 ||
      fileItems.length > 100 ||
      emails.length > 50 ||
      proposals.length > 100 ||
      audits.length > 25 ||
      (proposalPage?.bounded ?? false),
    ...(include.has("audit") || timeline
      ? {
          auditScope:
            "Request-indexed events only; legacy organization-scoped events are available in view full.",
        }
      : {}),
  };
}

export async function getClientAttention(
  ctx: QueryCtx,
  orgId: Id<"organizations">,
) {
  const client = await requireClient(ctx, orgId);
  const now = dayjs();
  const start = now.startOf("day");
  const end = start.add(90, "day").endOf("day");
  const [policies, requests] = await Promise.all([
    ctx.db
      .query("policies")
      .withIndex("organization", (q) => q.eq("orgId", orgId))
      .take(201),
    listOperatorProcurementRequests(ctx, {
      clientOrgId: orgId,
      status: [
        "draft",
        "submitted",
        "gathering_information",
        "marketing",
        "proposal_review",
        "binding",
      ],
      limit: 50,
    }),
  ]);
  const livePolicies = policies
    .slice(0, 200)
    .filter((policy) => policy.deletedAt === undefined);
  const expiring = livePolicies
    .filter((policy) => {
      const expiration = dayjs(policy.expirationDate);
      return (
        expiration.isValid() &&
        !expiration.isBefore(start) &&
        !expiration.isAfter(end)
      );
    })
    .sort(
      (a, b) =>
        dayjs(a.expirationDate).valueOf() - dayjs(b.expirationDate).valueOf(),
    );
  const policyIssues = (
    await Promise.all(
      livePolicies.map(async (policy) => {
        const state = await readPolicyPipelineState(ctx, policy._id);
        const lease = state?.pipelineCheckpoint?.lease?.expiresAt;
        const stuck =
          state?.pipelineStatus === "running" &&
          typeof lease === "number" &&
          now.valueOf() - lease > 5 * 60 * 1000;
        return state?.pipelineStatus === "error" ||
          state?.pipelineStatus === "paused" ||
          stuck
          ? {
              domain: "policy",
              policyId: policy._id,
              fileName: policy.fileName,
              status: stuck ? "stuck" : state.pipelineStatus,
            }
          : null;
      }),
    )
  ).filter((issue) => issue !== null);
  const proposalBatches = await Promise.all(
    (["failed", "running"] as const).map((status) =>
      ctx.db
        .query("procurementProposalExtractionJobs")
        .withIndex("status", (q) => q.eq("status", status))
        .order("desc")
        .take(101),
    ),
  );
  const proposalIssues = [];
  for (const job of proposalBatches.flatMap((batch) => batch.slice(0, 100))) {
    if (job.clientOrgId !== orgId || job.cancelledAt) continue;
    const stuck =
      job.status === "running" &&
      (job.leaseExpiresAt ?? Number.MAX_SAFE_INTEGER) <= now.valueOf();
    if (job.status !== "failed" && !stuck) continue;
    const [proposal, latest] = await Promise.all([
      ctx.db.get(job.proposalId),
      ctx.db
        .query("procurementProposalExtractionJobs")
        .withIndex("proposal", (q) => q.eq("proposalId", job.proposalId))
        .order("desc")
        .first(),
    ]);
    if (
      !proposal ||
      proposal.status === "archived" ||
      proposal.status === "withdrawn" ||
      latest?._id !== job._id
    )
      continue;
    proposalIssues.push({
      domain: "proposal",
      proposalId: proposal._id,
      status: stuck ? "stuck" : "error",
    });
  }
  const issues = [...policyIssues, ...proposalIssues];
  return {
    orgId,
    clientName: client.name,
    renewals: {
      through: end.format("YYYY-MM-DD"),
      count: expiring.length,
      items: expiring.slice(0, 10).map((policy) => ({
        policyId: policy._id,
        carrier: policy.carrier,
        policyNumber: policy.policyNumber,
        expirationDate: policy.expirationDate,
      })),
      bounded: policies.length > 200 || expiring.length > 10,
    },
    extractionIssues: {
      count: issues.length,
      items: issues.slice(0, 10),
      bounded:
        policies.length > 200 ||
        proposalBatches.some((batch) => batch.length > 100) ||
        issues.length > 10,
      scope:
        "Current failed/paused/stalled policy extractions and latest failed/stalled proposal jobs among 100 recent jobs per status platform-wide. Counts are lower bounds when scanning is bounded.",
    },
    procurementRequests: requests.requests,
    procurementNextCursor: requests.nextCursor,
    procurementBounded: requests.bounded,
    compliance: {
      omitted: true,
      reason:
        "The existing compliance read reassesses requirements across policies; use lookup_compliance_requirements for current gaps.",
    },
  };
}
