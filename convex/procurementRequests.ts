import { procurementApplicationInputSchema } from "./lib/procurementApplicationInput";
import { detailsFromAnswers } from "../lib/insurance-intake-details";
import { intakeAnswersValidator } from "./lib/insuranceIntakeSchema";
import { intakeDetailsValidator } from "./lib/intakeDetailsSchema";
import {
  detailsAnswers,
  validCoverageLimit,
  validateIntakeDetails,
} from "../lib/insurance-intake-details";
import { refreshPremiumEstimateByOperator } from "./requestIntake";
import { linkClientIntakeAuthorization } from "./intakeAuthorizations";
import {
  hashIntakeToken,
  readIntakeBusinessProfile,
  submissionContent,
  writeIntakeBusinessProfile,
} from "./lib/intakeApplication";
import { saveMarkdownDocument } from "./markdownDocuments";
import { readPacketDocument } from "./lib/packetDocuments";
import {
  parseMarkdownDocument,
  stringifyMarkdownDocument,
} from "./lib/markdownDocument";
import {
  companyApplicationProfile,
  applicationMarkdownBlock,
  submittedIntakeApplication,
  withCompanyProfileFacts,
} from "../lib/intake-application";
import { requireCompanyRequest } from "./lib/companyRequest";
import { requestPacketText } from "./lib/procurementNarrative";
import { publishMcpEvent } from "./mcpEvents";
import {
  completionOutcomeValidator,
  normalizeCompletionOutcome,
  type CompletionOutcome,
} from "./lib/procurementCompletionOutcome";
import dayjs from "dayjs";
import {
  assertExternalBrokerIdentity,
  isSpotOwnedBrokerIdentity,
  isSpotOwnedDomain,
} from "./lib/brokerProfileValidation";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";

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
  activeTeamThread,
  insertProcurementEmailFileItems,
  isOutreachLocked,
  storeProcurementEmailAttachments,
  threadSummaryPatch,
  teamTargetProblem,
  type ProcurementEmailAttachment,
  type TeamThread,
} from "./lib/teamEmailStore";
import { getTeamThreadDetails, listTeamInbox } from "./lib/teamInboxProjection";
import {
  requireOperator,
  requireOperatorForUser,
  writeOperatorAudit,
} from "./lib/operatorIdentity";
import { NoWriteInputError } from "./lib/noWriteInputError";
import {
  createProcurementInboxToken,
  inferProcurementEmailCategory,
  normalizeProcurementEmail,
  normalizeProcurementSubject,
  procurementForwardingAddress,
  procurementParticipantsOverlap,
  uniqueProcurementEmails,
  type ProcurementEmailCategory,
} from "./lib/procurement";
import { seedRequestIntake } from "./lib/procurementNarrative";
import {
  outreachLeavesRequestSent,
  requestStatusStopsOutreach,
  stopOutreachSequences,
} from "./lib/providerOutreachLifecycle";
import { getAgentDomain } from "./lib/resend";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "./lib/userFacingErrors";
import {
  scheduleClientFileCompanyInformation,
  scheduleEmailThreadCompanyInformation,
} from "./companyInformation";
import { queueTeamReplySuggestion } from "./lib/teamReplySuggestions";

export { insertProcurementEmailFileItems, storeProcurementEmailAttachments };
export type { ProcurementEmailAttachment };

const MAX_REQUESTS = 100;
const MAX_EMAIL_THREADS = 200;
const MAX_TEXT = 20_000;
const MAX_THREAD_PREVIEW_MESSAGES = 300;

const activeEmailThread = activeTeamThread;

const requestStatusValidator = v.union(
  v.literal("draft"),
  v.literal("submitted"),
  v.literal("gathering_information"),
  v.literal("marketing"),
  v.literal("proposal_review"),
  v.literal("binding"),
  v.literal("completed"),
  v.literal("cancelled"),
);

const outreachStatusValidator = v.union(
  v.literal("observed"),
  v.literal("request_sent"),
  v.literal("can_handle"),
  v.literal("cannot_handle"),
  v.literal("quote_received"),
  v.literal("quote_accepted"),
  v.literal("quote_rejected"),
);

const releaseValidator = v.union(
  v.literal("hidden"),
  v.literal("listed"),
  v.literal("attached"),
);

export const emailCategoryValidator = v.union(
  v.literal("broker"),
  v.literal("client"),
  v.literal("internal"),
  v.literal("mixed"),
  v.literal("other"),
);

type Ctx = QueryCtx | MutationCtx;
type RequestStatus = Doc<"procurementRequests">["status"];
type OutreachStatus = Doc<"procurementBrokerOutreaches">["status"];

export function writableProcurementRequestStatus(
  value: unknown,
): RequestStatus | undefined {
  switch (value) {
    case "draft":
    case "submitted":
    case "gathering_information":
    case "marketing":
    case "proposal_review":
    case "binding":
    case "completed":
    case "cancelled":
      return value;
    default:
      return undefined;
  }
}

function requiredText(value: string, label: string, maximum = MAX_TEXT) {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) throw new Error(`${label} is required`);
  if (normalized.length > maximum) {
    throw new Error(
      `${label} must be ${maximum.toLocaleString()} characters or fewer`,
    );
  }
  return normalized;
}

function optionalText(value: unknown, maximum = MAX_TEXT) {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\r\n/g, "\n").trim();
  return normalized ? normalized.slice(0, maximum) : undefined;
}

function optionalEmail(value: unknown) {
  const normalized = optionalText(value, 320)?.toLowerCase();
  if (normalized && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("Enter a valid email address");
  }
  return normalized;
}

function optionalDate(value: unknown) {
  const normalized = optionalText(value, 10);
  if (!normalized) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || !dayjs(normalized).isValid()) {
    throw new Error("Effective date must use YYYY-MM-DD");
  }
  return normalized;
}

export async function requireClient(ctx: Ctx, clientOrgId: Id<"organizations">) {
  const client = await ctx.db.get(clientOrgId);
  if (!client || client.deletedAt !== undefined || client.type !== "client") {
    throw new Error("Client organization not found");
  }
  return client;
}

export async function requireRequest(ctx: Ctx, requestId: Id<"procurementRequests">) {
  const request = await ctx.db.get(requestId);
  if (!request) throw new Error("Procurement request not found");
  requireCompanyRequest(request);
  await requireClient(ctx, request.clientOrgId);
  return request;
}

export async function requireDirectOperatorWrite(
  ctx: MutationCtx,
  operatorUserId: Id<"users">,
) {
  await requireOperatorForUser(ctx, operatorUserId);
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

async function createUniqueInboxToken(ctx: MutationCtx) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const inboxToken = createProcurementInboxToken();
    const existing = await ctx.db
      .query("procurementRequests")
      .withIndex("inbox", (index) => index.eq("inboxToken", inboxToken))
      .first();
    if (!existing) return inboxToken;
  }
  throw new Error("Could not create a unique procurement forwarding address");
}

async function requirePolicyForRequest(
  ctx: Ctx,
  policyId: Id<"policies"> | undefined,
  clientOrgId: Id<"organizations">,
  allowArchived = false,
) {
  if (!policyId) return null;
  const policy = await ctx.db.get(policyId);
  if (!policy || policy.orgId !== clientOrgId) {
    throw new Error("Policy does not belong to this client");
  }
  if (policy.deletedAt && !allowArchived)
    throw new Error("Resulting policy must not be archived");
  return policy;
}

async function requireBrokerOrganization(
  ctx: Ctx,
  brokerOrgId: Id<"organizations"> | undefined,
) {
  if (!brokerOrgId) return null;
  const broker = await ctx.db.get(brokerOrgId);
  if (!broker || broker.deletedAt !== undefined || broker.type !== "broker") {
    throw new Error("Provider organization not found");
  }
  assertExternalBrokerIdentity(broker);
  return broker;
}

function policyLabel(policy: Doc<"policies"> | null) {
  if (!policy) return null;
  return {
    policyId: policy._id,
    label:
      [policy.carrier, policy.policyNumber]
        .map((value) => value?.trim())
        .filter(Boolean)
        .join(" · ") ||
      policy.fileName ||
      "Policy",
    archived: Boolean(policy.deletedAt),
  };
}

export function requestForwardingAddress(request: Doc<"procurementRequests">) {
  if (!request.inboxToken) throw new Error("Procurement inbox is not ready");
  return procurementForwardingAddress(request.inboxToken, getAgentDomain());
}

function outreachDto(outreach: Doc<"procurementBrokerOutreaches">) {
  return outreach;
}

export async function requestRow(ctx: Ctx, request: Doc<"procurementRequests">) {
  requireCompanyRequest(request);
  const [replacingPolicy, resultingPolicy, outreaches, emails] =
    await Promise.all([
      requirePolicyForRequest(
        ctx,
        request.replacingPolicyId,
        request.clientOrgId,
        true,
      ),
      requirePolicyForRequest(
        ctx,
        request.resultingPolicyId,
        request.clientOrgId,
      ),
      ctx.db
        .query("procurementBrokerOutreaches")
        .withIndex("request", (index) => index.eq("requestId", request._id))
        .collect(),
      ctx.db
        .query("teamEmailThreads")
        .withIndex("by_requestId_and_archivedAt_and_latestMessageAt", (index) =>
          index.eq("requestId", request._id).eq("archivedAt", undefined),
        )
        .take(MAX_EMAIL_THREADS),
    ]);
  return {
    ...request,
    application: submittedIntakeApplication(request),
    completionOutcome: request.completionOutcome,
    forwardingAddress: requestForwardingAddress(request),
    replacingPolicy: policyLabel(replacingPolicy),
    resultingPolicy: policyLabel(resultingPolicy),
    brokerCount: outreaches.length,
    quoteCount: outreaches.filter((outreach) =>
      ["quote_received", "quote_accepted", "quote_rejected"].includes(
        outreach.status,
      ),
    ).length,
    emailThreadCount: emails.filter(activeEmailThread).length,
  };
}

const TIMELINE_LIMIT = 40;

export type ProcurementTimelineEntry = {
  key: string;
  kind: "operator" | "email" | "file" | "proposal" | "outreach";
  summary: string;
  detail?: string;
  createdAt: number;
};

/** One request-scoped stream over every surface an operator has to reconcile:
 * operator writes, imported email, request files, outreach, and proposals.
 * Each entry is a stored record's own timestamp, never a reconstructed one. */
export function buildRequestTimeline(args: {
  auditEvents: Array<{ _id: string; summary: string; createdAt: number }>;
  emailThreads: Doc<"teamEmailThreads">[];
  fileItems: Array<{
    _id: Id<"procurementFileItems">;
    label: string;
    updatedAt: number;
    clientFile: { uploadedBySide?: string } | null;
  }>;
  outreaches: Doc<"procurementBrokerOutreaches">[];
  proposals: Doc<"procurementProposals">[];
}): ProcurementTimelineEntry[] {
  const brokerNameByOutreach = new Map(
    args.outreaches.map((outreach) => [
      String(outreach._id),
      outreach.brokerName,
    ]),
  );
  const readable = (value: string) => value.replaceAll("_", " ");
  const entries: ProcurementTimelineEntry[] = [
    ...args.auditEvents.map((event) => ({
      key: `operator:${event._id}`,
      kind: "operator" as const,
      summary: event.summary,
      createdAt: event.createdAt,
    })),
    ...args.emailThreads.map((thread) => ({
      key: `email:${thread._id}`,
      kind: "email" as const,
      summary: thread.subject,
      detail: `${thread.messageCount} ${thread.messageCount === 1 ? "message" : "messages"} · ${readable(thread.category)}`,
      createdAt: thread.latestMessageAt,
    })),
    ...args.fileItems.map((item) => ({
      key: `file:${item._id}`,
      kind: "file" as const,
      summary:
        item.clientFile?.uploadedBySide === "client"
          ? `Client provided ${item.label}`
          : `Updated ${item.label}`,
      createdAt: item.updatedAt,
    })),
    ...args.outreaches.map((outreach) => ({
      key: `outreach:${outreach._id}`,
      kind: "outreach" as const,
      summary: `${outreach.brokerName} outreach ${readable(outreach.status)}`,
      detail: outreach.contactName ?? outreach.contactEmail ?? undefined,
      createdAt: outreach.updatedAt,
    })),
    ...args.proposals.map((proposal) => ({
      key: `proposal:${proposal._id}`,
      kind: "proposal" as const,
      summary: `${brokerNameByOutreach.get(String(proposal.outreachId)) ?? "Provider"} proposal ${readable(proposal.status)}`,
      createdAt: proposal.updatedAt,
    })),
  ];
  return entries
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, TIMELINE_LIMIT);
}

export async function getProcurementRequestDetails(
  ctx: Ctx,
  requestId: Id<"procurementRequests">,
  options?: { signedFileUrls?: boolean },
) {
  const request = await requireRequest(ctx, requestId);
  const [
    summary,
    outreaches,
    fileItems,
    emailThreads,
    proposals,
    requestAudits,
    legacyOperatorAudits,
  ] = await Promise.all([
    requestRow(ctx, request),
    ctx.db
      .query("procurementBrokerOutreaches")
      .withIndex("request", (index) => index.eq("requestId", requestId))
      .order("desc")
      .collect(),
    ctx.db
      .query("procurementFileItems")
      .withIndex("request", (index) => index.eq("requestId", requestId))
      .order("desc")
      .collect(),
    ctx.db
      .query("teamEmailThreads")
      .withIndex("by_requestId_and_latestMessageAt", (index) =>
        index.eq("requestId", requestId),
      )
      .order("desc")
      .take(50),
    ctx.db
      .query("procurementProposals")
      .withIndex("request", (q) => q.eq("requestId", requestId))
      .collect(),
    ctx.db
      .query("operatorAuditEvents")
      .withIndex("request_created", (query) => query.eq("requestId", requestId))
      .order("desc")
      .take(25),
    ctx.db
      .query("operatorAuditEvents")
      .withIndex("target_created", (query) =>
        query.eq("targetOrgId", request.clientOrgId),
      )
      .order("desc")
      .take(250),
  ]);
  const intakeFiles = await ctx.db
    .query("requestIntakeFiles")
    .withIndex("request", (q) => q.eq("requestId", requestId))
    .take(30);
  const intakeCategories = new Map(
    intakeFiles
      .filter((file) => file.clientFileId)
      .map((file) => [String(file.clientFileId), file.category]),
  );
  const files = await Promise.all(
    fileItems
      .filter((item) => item.clientFileId && !item.removedAt)
      .map(async (item) => {
        const file = item.clientFileId
          ? await ctx.db.get(item.clientFileId)
          : null;
        return {
          _id: item._id,
          requestId: item.requestId,
          clientOrgId: item.clientOrgId,
          clientFileId: item.clientFileId,
          intakeCategory:
            item.documentCategory ??
            intakeCategories.get(String(item.clientFileId)) ??
            "supporting",
          sourceEmailMessageId: item.sourceEmailMessageId,
          label: item.label,
          brokerRelease: item.outreachId ? "hidden" : item.brokerRelease,
          clientVisible: item.clientVisible,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          clientFile: file
            ? {
                _id: file._id,
                clientFileId: file._id,
                name: file.name,
                originalName: file.originalName,
                contentType: file.contentType,
                size: file.size,
                clientVisible: file.clientVisible,
                policyId: file.policyId,
                uploadedBySide: file.uploadedBySide,
                nameStatus: file.nameStatus,
                url: options?.signedFileUrls === false
                  ? null
                  : await ctx.storage.getUrl(file.fileId),
              }
            : null,
        };
      }),
  );
  const legacyAuditEvents = legacyOperatorAudits
    .filter((event) => {
      const metadata =
        event.metadata && typeof event.metadata === "object"
          ? (event.metadata as Record<string, unknown>)
          : null;
      return String(metadata?.requestId ?? "") === String(requestId);
    })
    .filter(
      (event) => !requestAudits.some((current) => current._id === event._id),
    );
  const auditEvents = [...requestAudits, ...legacyAuditEvents]
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, 25)
    .map((event) => ({
      _id: event._id,
      summary: event.summary,
      type: event.type,
      createdAt: event.createdAt,
    }));
  const activeEmailThreads = emailThreads.filter(activeEmailThread);
  return {
    request: summary,
    outreaches: await Promise.all(
      outreaches.map((outreach) => outreachDto(outreach)),
    ),
    files,
    emailThreads: activeEmailThreads,
    proposals,
    auditEvents,
    timeline: buildRequestTimeline({
      auditEvents,
      emailThreads: activeEmailThreads,
      fileItems: files,
      outreaches,
      proposals,
    }),
  };
}

export async function listProcurementRequestSummaries(
  ctx: Ctx,
  args: {
    clientOrgId: Id<"organizations">;
    status?: RequestStatus;
    query?: string;
    limit?: number;
  },
) {
  await requireClient(ctx, args.clientOrgId);
  const limit = Math.max(1, Math.min(args.limit ?? 50, MAX_REQUESTS));
  const status = args.status;
  const rows = status
    ? await ctx.db
        .query("procurementRequests")
        .withIndex("status", (index) =>
          index.eq("clientOrgId", args.clientOrgId).eq("status", status!),
        )
        .order("desc")
        .take(MAX_REQUESTS)
    : await ctx.db
        .query("procurementRequests")
        .withIndex("organization", (index) =>
          index.eq("clientOrgId", args.clientOrgId),
        )
        .order("desc")
        .take(MAX_REQUESTS);
  const activeRows = rows.filter(
    (row) => !row.deletedAt && row.intakeAnswers?.intakeGoal !== "savings",
  );
  const search = args.query?.trim().toLowerCase();
  const matches = search
    ? (
        await Promise.all(
          activeRows.map(async (row) => ({
            row,
            text: `${row.title} ${await requestPacketText(ctx, row)}`.toLowerCase(),
          })),
        )
      )
        .filter(({ text }) => text.includes(search))
        .map(({ row }) => row)
    : activeRows;
  return Promise.all(
    matches.slice(0, limit).map((row) => requestRow(ctx, row)),
  );
}

export const list = query({
  args: {
    clientOrgId: v.id("organizations"),
    status: v.optional(requestStatusValidator),
    query: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    return await listProcurementRequestSummaries(ctx, args);
  },
});

export async function listAcrossClientRequestRows(
  ctx: Ctx,
  args: {
    clientOrgId?: Id<"organizations">;
    status?: RequestStatus[];
    assigneeUserId?: Id<"users">;
    updatedAfter?: number;
    updatedBefore?: number;
    query?: string;
    sort?: "updated_desc" | "created_desc";
    cursor?: string;
    limit: number;
  },
) {
  if (args.clientOrgId) await requireClient(ctx, args.clientOrgId);
  const after = args.updatedAfter ?? Number.MIN_SAFE_INTEGER;
  const before = args.updatedBefore ?? Number.MAX_SAFE_INTEGER;
  const source =
    args.sort === "created_desc"
      ? ctx.db
          .query("procurementRequests")
          .withIndex("by_deletedAt_and_createdAt", (q) =>
            q.eq("deletedAt", undefined),
          )
      : args.clientOrgId
        ? ctx.db
            .query("procurementRequests")
            .withIndex("organization", (q) =>
              q
                .eq("clientOrgId", args.clientOrgId)
                .gte("updatedAt", after)
                .lte("updatedAt", before),
            )
        : ctx.db
            .query("procurementRequests")
            .withIndex("by_deletedAt_and_updatedAt", (q) =>
              q
                .eq("deletedAt", undefined)
                .gte("updatedAt", after)
                .lte("updatedAt", before),
            );
  const page = await source.order("desc").paginate({
    cursor: args.cursor ?? null,
    numItems: args.limit,
  });
  const clients = new Map<Id<"organizations">, Doc<"organizations"> | null>();
  const rows: Array<{
    row: Doc<"procurementRequests">;
    client: Doc<"organizations">;
  }> = [];
  const search = args.query?.trim().toLowerCase();
  for (const row of page.page) {
    const orgId = row.clientOrgId;
    if (
      !orgId ||
      row.deletedAt !== undefined ||
      row.intakeAnswers?.intakeGoal === "savings"
    )
      continue;
    if (args.clientOrgId && orgId !== args.clientOrgId) continue;
    if (args.status?.length && !args.status.includes(row.status)) continue;
    if (row.updatedAt < after || row.updatedAt > before) continue;
    if (!clients.has(orgId)) {
      const client = await ctx.db.get(orgId);
      clients.set(
        orgId,
        client && client.deletedAt === undefined && client.type === "client"
          ? client
          : null,
      );
    }
    const client = clients.get(orgId);
    if (
      !client ||
      (args.assigneeUserId &&
        client.assignedOperatorUserId !== args.assigneeUserId)
    )
      continue;
    if (
      search &&
      !`${row.title} ${await requestPacketText(ctx, row)}`
        .toLowerCase()
        .includes(search)
    )
      continue;
    rows.push({ row, client });
  }
  return {
    rows,
    nextCursor: page.isDone ? null : page.continueCursor,
    bounded: !page.isDone,
    scanned: page.page.length,
  };
}

/**
 * Live procurement requests across every client, most recently updated first,
 * for the operator Procurement page. Reads one bounded index page; deleted
 * requests, savings reviews, requests without a company and requests of
 * deleted clients are left out, as in `list`.
 */
export const listAcrossClients = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const limit = Math.max(1, Math.min(args.limit ?? MAX_REQUESTS, MAX_REQUESTS));
    const page = await listAcrossClientRequestRows(ctx, { limit: MAX_REQUESTS * 2 });
    return {
      requests: await Promise.all(
        page.rows.slice(0, limit).map(async ({ row, client }) => ({
          ...(await requestRow(ctx, row)),
          client: { _id: client._id, name: client.name },
        })),
      ),
      bounded: page.bounded || page.rows.length > limit,
    };
  },
});

// Narrow internal projections used by packet delivery actions.
export const getInternal = internalQuery({
  args: { requestId: v.id("procurementRequests") },
  handler: async (ctx, args) => ctx.db.get(args.requestId),
});

export const getOutreachInternal = internalQuery({
  args: { outreachId: v.id("procurementBrokerOutreaches") },
  handler: async (ctx, args) => ctx.db.get(args.outreachId),
});

export const get = query({
  args: { requestId: v.id("procurementRequests") },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    if ((await ctx.db.get(args.requestId))?.deletedAt) return null;
    return await getProcurementRequestDetails(ctx, args.requestId);
  },
});

export const listPolicyOptions = query({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    await requireClient(ctx, args.clientOrgId);
    const policies = await ctx.db
      .query("policies")
      .withIndex("organization", (index) => index.eq("orgId", args.clientOrgId))
      .collect();
    return policies
      .sort((left, right) =>
        String(right.expirationDate ?? "").localeCompare(
          String(left.expirationDate ?? ""),
        ),
      )
      .map((policy) => policyLabel(policy));
  },
});

type CreateProcurementRequestArgs = {
  operatorUserId: Id<"users">;
  clientOrgId: Id<"organizations">;
  title: string;
  narrative: string;
  targetEffectiveDate?: string;
  status?: RequestStatus;
  replacingPolicyId?: Id<"policies">;
  resultingPolicyId?: Id<"policies">;
  completionOutcome?: CompletionOutcome;
  clientVisible?: boolean;
};

export async function validateProcurementRequestCreateByOperator(
  ctx: MutationCtx,
  args: CreateProcurementRequestArgs,
) {
  await requireDirectOperatorWrite(ctx, args.operatorUserId);
  const client = await requireClient(ctx, args.clientOrgId);
  await Promise.all([
    requirePolicyForRequest(
      ctx,
      args.replacingPolicyId,
      args.clientOrgId,
      true,
    ),
    requirePolicyForRequest(ctx, args.resultingPolicyId, args.clientOrgId),
  ]);
  requiredText(args.title, "Title", 200);
  requiredText(args.narrative, "Client request");
  optionalDate(args.targetEffectiveDate);
  if (args.completionOutcome)
    normalizeCompletionOutcome(args.completionOutcome);
  return client;
}

export async function createProcurementRequestByOperator(
  ctx: MutationCtx,
  args: CreateProcurementRequestArgs & {
    source: "operator" | "agent" | "workspace_scan";
  },
) {
  const client = await validateProcurementRequestCreateByOperator(ctx, args);
  const now = dayjs().valueOf();
  const inboxToken = await createUniqueInboxToken(ctx);
  const narrative = requiredText(args.narrative, "Client request");
  const requestId = await ctx.db.insert("procurementRequests", {
    clientOrgId: args.clientOrgId,
    title: requiredText(args.title, "Title", 200),
    normalizedTitle: requiredText(args.title, "Title", 200)
      .toLowerCase()
      .replace(/\s+/g, " "),
    targetEffectiveDate: optionalDate(args.targetEffectiveDate),
    status:
      args.resultingPolicyId || args.completionOutcome
        ? "completed"
        : (args.status ?? "draft"),
    completionOutcome: args.completionOutcome
      ? normalizeCompletionOutcome(args.completionOutcome)
      : undefined,
    clientVisible: args.clientVisible ?? true,
    replacingPolicyId: args.replacingPolicyId,
    resultingPolicyId: args.resultingPolicyId,
    inboxToken,
    createdByUserId: args.operatorUserId,
    updatedByUserId: args.operatorUserId,
    createdAt: now,
    updatedAt: now,
  });
  await seedRequestIntake(ctx, {
    requestId,
    clientOrgId: args.clientOrgId,
    narrative,
    userId: args.operatorUserId,
    source: args.source === "agent" ? "operator_agent" : "manual",
  });
  await linkClientIntakeAuthorization(ctx, requestId);
  if (args.source !== "workspace_scan")
    await ctx.scheduler.runAfter(
      0,
      internal.procurementPacket.ensureRequestLinkInternal,
      { requestId, createdByUserId: args.operatorUserId },
    );
  await writeOperatorAudit(ctx, {
    operatorUserId: args.operatorUserId,
    type: "setup_write",
    targetOrgId: args.clientOrgId,
    summary: `Created procurement request ${args.title} for ${client.name}`,
    metadata: { domain: "procurement", requestId, source: args.source },
  });
  const request = await ctx.db.get(requestId);
  const forwardingAddress = request
    ? requestForwardingAddress(request)
    : undefined;
  return {
    requestId,
    forwardingAddress,
    deepLink: `/operator/clients/${args.clientOrgId}/procurement/${requestId}`,
    nextActions: [
      {
        action: "forward_correspondence",
        why: "Forward the relevant client or provider thread so Spot can preserve the correspondence and associate its attachments with this request",
        forwardingAddress,
      },
      {
        tool: "update_procurement_packet",
        why: "Complete and verify the provider-visible packet before sharing it",
        input: { procurementRequestId: requestId },
      },
    ],
  };
}

export const create = mutation({
  args: {
    clientOrgId: v.id("organizations"),
    title: v.string(),
    narrative: v.string(),
    targetEffectiveDate: v.optional(v.string()),
    status: v.optional(requestStatusValidator),
    replacingPolicyId: v.optional(v.id("policies")),
    resultingPolicyId: v.optional(v.id("policies")),
    completionOutcome: v.optional(completionOutcomeValidator),
    clientVisible: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return await createProcurementRequestByOperator(ctx, {
      operatorUserId: operator.userId,
      ...args,
      source: "operator",
    });
  },
});

export async function updateProcurementRequestByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    requestId: Id<"procurementRequests">;
    title?: string;
    targetEffectiveDate?: string | null;
    status?: RequestStatus;
    replacingPolicyId?: Id<"policies"> | null;
    resultingPolicyId?: Id<"policies"> | null;
    completionOutcome?: CompletionOutcome | null;
    clientVisible?: boolean;
    source: "operator" | "agent" | "workspace_scan";
  },
) {
  await requireDirectOperatorWrite(ctx, args.operatorUserId);
  const request = await requireRequest(ctx, args.requestId);
  const patch: Partial<Doc<"procurementRequests">> = {
    updatedByUserId: args.operatorUserId,
    updatedAt: dayjs().valueOf(),
  };
  if (args.title !== undefined) {
    patch.title = requiredText(args.title, "Title", 200);
    patch.normalizedTitle = patch.title.toLowerCase().replace(/\s+/g, " ");
  }
  if (args.targetEffectiveDate !== undefined) {
    patch.targetEffectiveDate =
      optionalDate(args.targetEffectiveDate) ?? undefined;
  }
  if (args.status !== undefined) patch.status = args.status;
  if (args.replacingPolicyId !== undefined) {
    await requirePolicyForRequest(
      ctx,
      args.replacingPolicyId ?? undefined,
      request.clientOrgId,
      true,
    );
    patch.replacingPolicyId = args.replacingPolicyId ?? undefined;
  }
  if (args.resultingPolicyId !== undefined) {
    await requirePolicyForRequest(
      ctx,
      args.resultingPolicyId ?? undefined,
      request.clientOrgId,
    );
    patch.resultingPolicyId = args.resultingPolicyId ?? undefined;
    if (args.resultingPolicyId) patch.status = "completed";
  }
  if (args.completionOutcome !== undefined) {
    patch.completionOutcome =
      args.completionOutcome === null
        ? undefined
        : normalizeCompletionOutcome(args.completionOutcome);
    if (args.completionOutcome) patch.status = "completed";
  }
  if (patch.status && patch.status !== "completed")
    patch.completionOutcome = undefined;
  if (args.clientVisible !== undefined)
    patch.clientVisible = args.clientVisible;
  const changedFields = Object.keys(patch).filter(
    (field) => !["updatedAt", "updatedByUserId"].includes(field),
  );
  if (changedFields.length === 0) throw new Error("No request fields changed");
  await ctx.db.patch(request._id, patch);
  // Every status writer (update, application edit, operator tools, resulting policy,
  // completion outcome) funnels through here, so one hook covers cancel and complete.
  const stopReason = requestStatusStopsOutreach(patch.status);
  if (stopReason)
    await stopOutreachSequences(ctx, {
      requestId: request._id,
      reason: stopReason,
      now: patch.updatedAt,
    });
  const auditEventId = await writeOperatorAudit(ctx, {
    operatorUserId: args.operatorUserId,
    type: "setup_write",
    targetOrgId: request.clientOrgId,
    summary: `Updated procurement request ${patch.title ?? request.title}`,
    metadata: {
      domain: "procurement",
      requestId: request._id,
      fields: changedFields,
      source: args.source,
    },
  });
  const publicChanged =
    (patch.title !== undefined && patch.title !== request.title) ||
    (patch.status !== undefined && patch.status !== request.status) ||
    (args.targetEffectiveDate !== undefined &&
      patch.targetEffectiveDate !== request.targetEffectiveDate) ||
    (patch.clientVisible === true && request.clientVisible === false);
  if ((patch.clientVisible ?? request.clientVisible) !== false && publicChanged)
    await publishMcpEvent(ctx, {
      name: "procurement.request_updated",
      key: auditEventId,
      orgId: request.clientOrgId,
      data: {
        org_id: request.clientOrgId,
        request_id: request._id,
        status: patch.status ?? request.status,
      },
    });
  return { requestId: request._id, fields: changedFields };
}

/** Direct operator corrections have their own audit; never impersonate applicant consent. */
export const updateApplication = mutation({
  args: {
    requestId: v.id("procurementRequests"),
    expectedRevision: v.number(),
    expectedUpdatedAt: v.number(),
    answers: intakeAnswersValidator,
    details: intakeDetailsValidator,
    title: v.string(),
    targetEffectiveDate: v.union(v.string(), v.null()),
    status: requestStatusValidator,
    replacingPolicyId: v.union(v.id("policies"), v.null()),
    resultingPolicyId: v.union(v.id("policies"), v.null()),
    clientVisible: v.boolean(),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return await updateApplicationByOperator(ctx, operator.userId, args);
  },
});

/** Explicit operator request; opening the request never schedules an estimate. */
export const refreshPremiumEstimate = mutation({
  args: {
    requestId: v.id("procurementRequests"),
    expectedStartedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await requireDirectOperatorWrite(ctx, operator.userId);
    const request = await requireRequest(ctx, args.requestId);
    await refreshPremiumEstimateByOperator(
      ctx,
      request,
      args.expectedStartedAt,
    );
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      targetOrgId: request.clientOrgId,
      summary: `Requested a premium estimate for ${request.title}`,
      metadata: {
        domain: "procurement",
        requestId: request._id,
        action: "refresh_premium_estimate",
      },
    });
    return null;
  },
});

export async function updateApplicationByOperator(
  ctx: MutationCtx,
  operatorUserId: Id<"users">,
  args: {
    requestId: Id<"procurementRequests">;
    expectedRevision: number;
    expectedUpdatedAt: number;
    answers: import("../lib/insurance-intake").IntakeAnswers;
    details: import("../lib/insurance-intake-details").IntakeDetails;
    title: string;
    targetEffectiveDate: string | null;
    status: Doc<"procurementRequests">["status"];
    replacingPolicyId: Id<"policies"> | null;
    resultingPolicyId: Id<"policies"> | null;
    clientVisible: boolean;
  },
) {
  await requireDirectOperatorWrite(ctx, operatorUserId);
  const request = await requireRequest(ctx, args.requestId);
  if (
    (request.intakeRevision ?? 0) !== args.expectedRevision ||
    request.updatedAt !== args.expectedUpdatedAt
  )
    throw new Error(
      "This application changed while you were editing. Reload it before saving.",
    );
  validateIntakeDetails(args.details);
  for (const line of args.details.coverages)
    for (const [key, value] of Object.entries(line.limits))
      if (value && !validCoverageLimit(key, value))
        throw new Error("Enter a valid coverage limit or select I'm not sure");
  for (const value of Object.values(args.answers))
    if (value && value.length > 8000)
      throw new Error("Keep each answer within 8,000 characters");
  const effectiveDate = optionalDate(args.targetEffectiveDate);
  const entered = {
    ...args.details,
    dateParts: effectiveDate
      ? {
          year: dayjs(effectiveDate).format("YYYY"),
          month: dayjs(effectiveDate).format("MM"),
          day: dayjs(effectiveDate).format("DD"),
        }
      : { year: "", month: "", day: "" },
  };
  const edited = {
    ...args.answers,
    ...detailsAnswers(entered),
    effectiveDate: effectiveDate ?? "",
  };
  if (edited.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(edited.email))
    throw new Error("Enter a valid contact email");
  const { answers, details } = withCompanyProfileFacts(
    { answers: edited, details: entered },
    (await readIntakeBusinessProfile(ctx, request.clientOrgId))?.details,
  );
  const accepted = submittedIntakeApplication(request);
  const uploads = await ctx.db
    .query("requestIntakeFiles")
    .withIndex("request", (q) => q.eq("requestId", request._id))
    .take(30);
  const files = uploads.map((file) => ({
    id: String(file._id),
    name: file.name,
  }));
  const now = dayjs().valueOf();
  const revision = (request.intakeRevision ?? 0) + 1;
  const application = { answers, details, files, submittedAt: now, revision };
  await updateProcurementRequestByOperator(ctx, {
    operatorUserId: operatorUserId,
    requestId: request._id,
    title: args.title,
    targetEffectiveDate: args.targetEffectiveDate,
    status: args.status,
    replacingPolicyId: args.replacingPolicyId,
    resultingPolicyId: args.resultingPolicyId,
    clientVisible: args.clientVisible,
    source: "operator",
  });
  const current = (await ctx.db.get(request._id))!;
  await ctx.db.patch(request._id, {
    intakeAnswers: answers,
    intakeDetails: details,
    intakeRevision: revision,
    intakeSubmittedApplication: application,
    intakeSubmittedContentHash: await hashIntakeToken(
      submissionContent(
        answers,
        details,
        files.map((file) => file.id),
      ),
    ),
    packetRevision: (current.packetRevision ?? 0) + 1,
    updatedAt: now,
    updatedByUserId: operatorUserId,
  });
  if (!accepted) {
    const document = await readPacketDocument(ctx, request, "public.md");
    const parsed = parseMarkdownDocument(document.markdown);
    await saveMarkdownDocument(ctx, {
      orgId: request.clientOrgId,
      requestId: request._id,
      kind: "packet",
      filename: "public.md",
      expectedRevision: document.revision,
      markdown: stringifyMarkdownDocument(
        { ...parsed.frontmatter, visibility: "shared" },
        [parsed.body, applicationMarkdownBlock(application)]
          .filter(Boolean)
          .join("\n\n"),
      ),
    });
  }
  const org = await ctx.db.get(request.clientOrgId);
  if (org?.intakeBusinessProfile?.sourceRequestId === request._id)
    await writeIntakeBusinessProfile(ctx, org._id, {
      ...companyApplicationProfile(application),
      sourceRequestId: request._id,
    });
  await writeOperatorAudit(ctx, {
    operatorUserId: operatorUserId,
    type: "setup_write",
    targetOrgId: request.clientOrgId,
    summary: `Corrected application details for ${args.title}`,
    metadata: {
      domain: "procurement",
      requestId: request._id,
      action: "update_application",
      revision,
    },
  });
  return { revision, updatedAt: now };
}

export async function prepareApplicationToolUpdate(
  ctx: MutationCtx,
  input: unknown,
) {
  const patch = procurementApplicationInputSchema.parse(input);
  const requestId = ctx.db.normalizeId(
    "procurementRequests",
    patch.procurementRequestId,
  );
  if (!requestId) throw new Error("Invalid procurement request");
  const request = await requireRequest(ctx, requestId);
  if (
    (request.intakeRevision ?? 0) !== patch.expectedRevision ||
    request.updatedAt !== patch.expectedUpdatedAt
  )
    throw new Error(
      "This application changed. Read get_procurement_request again before updating.",
    );
  const application = submittedIntakeApplication(request);
  const answers = {
    ...(application?.answers ?? request.intakeAnswers ?? {}),
    ...patch.answers,
  };
  const details = {
    ...(application?.details ??
      request.intakeDetails ??
      detailsFromAnswers(answers)),
    ...patch.details,
  };
  validateIntakeDetails(details);
  for (const line of details.coverages)
    for (const [key, value] of Object.entries(line.limits))
      if (value && !validCoverageLimit(key, value))
        throw new Error("Enter a valid coverage limit");
  if (answers.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answers.email))
    throw new Error("Enter a valid contact email");
  return {
    requestId,
    expectedRevision: patch.expectedRevision,
    expectedUpdatedAt: patch.expectedUpdatedAt,
    answers,
    details,
    title: request.title,
    targetEffectiveDate:
      patch.answers?.effectiveDate !== undefined
        ? patch.answers.effectiveDate || null
        : (request.targetEffectiveDate ?? null),
    status: request.status,
    replacingPolicyId: request.replacingPolicyId ?? null,
    resultingPolicyId: request.resultingPolicyId ?? null,
    clientVisible: request.clientVisible !== false,
  };
}

/** Recoverable deletion: retain audit/evidence, deny normal request and packet access. */
export const remove = mutation({
  args: { requestId: v.id("procurementRequests") },
  handler: async (ctx, { requestId }) => {
    const operator = await requireOperator(ctx);
    await requireDirectOperatorWrite(ctx, operator.userId);
    const request = await ctx.db.get(requestId);
    if (!request) throw new Error("Procurement request not found");
    if (request.deletedAt) return;
    requireCompanyRequest(request);
    await requireClient(ctx, request.clientOrgId);
    const now = dayjs().valueOf();
    await ctx.db.patch(requestId, {
      deletedAt: now,
      deletedByUserId: operator.userId,
      updatedAt: now,
    });
    await stopOutreachSequences(ctx, {
      requestId,
      reason: "request_deleted",
      now,
    });
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      targetOrgId: request.clientOrgId,
      summary: `Deleted procurement request ${request.title}`,
      metadata: { domain: "procurement", requestId, action: "delete" },
    });
  },
});
export const restore = mutation({
  args: { requestId: v.id("procurementRequests") },
  handler: async (ctx, { requestId }) => {
    const operator = await requireOperator(ctx);
    await requireDirectOperatorWrite(ctx, operator.userId);
    const request = await ctx.db.get(requestId);
    if (!request?.clientOrgId) throw new Error("Procurement request not found");
    await requireClient(ctx, request.clientOrgId);
    if (!request.deletedAt) return;
    await ctx.db.patch(requestId, {
      deletedAt: undefined,
      deletedByUserId: undefined,
      updatedAt: dayjs().valueOf(),
    });
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      targetOrgId: request.clientOrgId,
      summary: `Restored procurement request ${request.title}`,
      metadata: { domain: "procurement", requestId, action: "restore" },
    });
  },
});

export const update = mutation({
  args: {
    requestId: v.id("procurementRequests"),
    title: v.optional(v.string()),
    targetEffectiveDate: v.optional(v.union(v.string(), v.null())),
    status: v.optional(requestStatusValidator),
    replacingPolicyId: v.optional(v.union(v.id("policies"), v.null())),
    resultingPolicyId: v.optional(v.union(v.id("policies"), v.null())),
    completionOutcome: v.optional(
      v.union(completionOutcomeValidator, v.null()),
    ),
    clientVisible: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return await updateProcurementRequestByOperator(ctx, {
      operatorUserId: operator.userId,
      ...args,
      source: "operator",
    });
  },
});

export async function createProcurementOutreachByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    requestId: Id<"procurementRequests">;
    brokerOrgId: Id<"organizations">;
    contactUserId?: Id<"users">;
    contactName?: string;
    contactEmail?: string;
    contactPhone?: string;
    status?: OutreachStatus;
    /**
     * Internal only (not exposed by any public mutation or tool): create the
     * tracking record without claiming it was sent. The outreach sender sets
     * `sentAt` once the first email actually leaves.
     */
    deferSentAt?: boolean;
    source: "operator" | "agent" | "workspace_scan";
  },
) {
  await requireDirectOperatorWrite(ctx, args.operatorUserId);
  const request = await requireRequest(ctx, args.requestId);
  const broker = await requireBrokerOrganization(ctx, args.brokerOrgId);
  if (!broker) throw new Error("Provider organization is required");
  assertExternalBrokerIdentity({ email: args.contactEmail });
  if (args.contactUserId) {
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("organization_user", (q) =>
        q.eq("orgId", broker._id).eq("userId", args.contactUserId!),
      )
      .unique();
    if (!membership)
      throw new Error("Provider contact must belong to the selected provider");
    const contact = await ctx.db.get(args.contactUserId);
    assertExternalBrokerIdentity({ email: contact?.email });
  }
  const now = dayjs().valueOf();
  const sent =
    !args.deferSentAt &&
    args.source !== "workspace_scan" &&
    (args.status ?? "request_sent") === "request_sent";
  const outreachId = await ctx.db.insert("procurementBrokerOutreaches", {
    requestId: request._id,
    clientOrgId: request.clientOrgId,
    brokerOrgId: broker._id,
    // Keep a display snapshot for historical rows; identity comes from the
    // linked broker organization, never from caller-supplied text.
    brokerName: broker.name,
    contactName: optionalText(args.contactName, 200),
    contactEmail: optionalEmail(args.contactEmail),
    contactPhone: optionalText(args.contactPhone, 100),
    contactUserId: args.contactUserId,
    sentAt: sent ? now : undefined,
    status: args.status ?? "request_sent",
    createdByUserId: args.operatorUserId,
    updatedByUserId: args.operatorUserId,
    createdAt: now,
    updatedAt: now,
  });
  await writeOperatorAudit(ctx, {
    operatorUserId: args.operatorUserId,
    type: "setup_write",
    targetOrgId: request.clientOrgId,
    summary: `Added ${broker.name} to procurement request ${request.title}`,
    metadata: {
      domain: "procurement",
      requestId: request._id,
      outreachId,
      source: args.source,
    },
  });
  return { outreachId };
}

export const createOutreach = mutation({
  args: {
    requestId: v.id("procurementRequests"),
    brokerOrgId: v.id("organizations"),
    contactUserId: v.optional(v.id("users")),
    contactName: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    status: v.optional(outreachStatusValidator),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return await createProcurementOutreachByOperator(ctx, {
      operatorUserId: operator.userId,
      ...args,
      source: "operator",
    });
  },
});

export async function updateProcurementOutreachByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    outreachId: Id<"procurementBrokerOutreaches">;
    brokerOrgId?: Id<"organizations">;
    contactUserId?: Id<"users"> | null;
    contactName?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    status?: OutreachStatus;
    source: "operator" | "agent" | "workspace_scan";
  },
) {
  await requireDirectOperatorWrite(ctx, args.operatorUserId);
  const outreach = await ctx.db.get(args.outreachId);
  if (!outreach) throw new Error("Provider outreach not found");
  const request = await requireRequest(ctx, outreach.requestId);
  const patch: Partial<Doc<"procurementBrokerOutreaches">> = {
    updatedByUserId: args.operatorUserId,
    updatedAt: dayjs().valueOf(),
  };
  if (args.brokerOrgId !== undefined) {
    if (!args.brokerOrgId) throw new Error("Provider organization is required");
    if (args.brokerOrgId !== outreach.brokerOrgId) {
      const existingProposal = await ctx.db
        .query("procurementProposals")
        .withIndex("outreach", (q) => q.eq("outreachId", outreach._id))
        .first();
      if (existingProposal) {
        throw new Error(
          "The provider cannot change after a proposal has been filed",
        );
      }
    }
    const broker = await requireBrokerOrganization(ctx, args.brokerOrgId);
    if (!broker) throw new Error("Provider organization is required");
    patch.brokerOrgId = broker._id;
    patch.brokerName = broker.name;
  }
  const nextBrokerOrgId = patch.brokerOrgId ?? outreach.brokerOrgId;
  await requireBrokerOrganization(ctx, nextBrokerOrgId);
  assertExternalBrokerIdentity({
    email:
      args.contactEmail === undefined
        ? outreach.contactEmail
        : args.contactEmail,
  });
  if (args.contactUserId !== undefined) {
    if (args.contactUserId) {
      if (!nextBrokerOrgId)
        throw new Error("Select a provider before a contact");
      const membership = await ctx.db
        .query("orgMemberships")
        .withIndex("organization_user", (q) =>
          q.eq("orgId", nextBrokerOrgId).eq("userId", args.contactUserId!),
        )
        .unique();
      if (!membership)
        throw new Error(
          "Provider contact must belong to the selected provider",
        );
      const contact = await ctx.db.get(args.contactUserId);
      assertExternalBrokerIdentity({ email: contact?.email });
    }
    patch.contactUserId = args.contactUserId ?? undefined;
  }
  if (args.contactName !== undefined)
    patch.contactName = optionalText(args.contactName, 200);
  if (args.contactEmail !== undefined)
    patch.contactEmail = optionalEmail(args.contactEmail);
  if (args.contactPhone !== undefined)
    patch.contactPhone = optionalText(args.contactPhone, 100);
  if (args.status !== undefined) {
    patch.status = args.status;
    if (args.status === "request_sent" && !outreach.sentAt) {
      patch.sentAt = dayjs().valueOf();
    }
  }
  const fields = Object.keys(patch).filter(
    (field) => !["updatedAt", "updatedByUserId"].includes(field),
  );
  if (fields.length === 0) throw new Error("No outreach fields changed");
  await ctx.db.patch(outreach._id, patch);
  const stopReason = outreachLeavesRequestSent(outreach.status, patch.status)
    ? "outreach_status_changed"
    : patch.brokerOrgId && patch.brokerOrgId !== outreach.brokerOrgId
      ? "provider_changed"
      : undefined;
  if (stopReason)
    await stopOutreachSequences(ctx, {
      outreachId: outreach._id,
      reason: stopReason,
      now: patch.updatedAt,
    });
  await writeOperatorAudit(ctx, {
    operatorUserId: args.operatorUserId,
    type: "setup_write",
    targetOrgId: request.clientOrgId,
    summary: `Updated ${patch.brokerName ?? outreach.brokerName} on ${request.title}`,
    metadata: {
      domain: "procurement",
      requestId: request._id,
      outreachId: outreach._id,
      fields,
      source: args.source,
    },
  });
  return { outreachId: outreach._id, fields };
}

export const updateOutreach = mutation({
  args: {
    outreachId: v.id("procurementBrokerOutreaches"),
    brokerOrgId: v.optional(v.id("organizations")),
    contactUserId: v.optional(v.union(v.id("users"), v.null())),
    contactName: v.optional(v.union(v.string(), v.null())),
    contactEmail: v.optional(v.union(v.string(), v.null())),
    contactPhone: v.optional(v.union(v.string(), v.null())),
    status: v.optional(outreachStatusValidator),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return await updateProcurementOutreachByOperator(ctx, {
      operatorUserId: operator.userId,
      ...args,
      source: "operator",
    });
  },
});

export async function createProcurementFileItemByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    requestId: Id<"procurementRequests">;
    clientFileId: Id<"clientFiles">;
    label: string;
    documentCategory?: "requirements" | "policy" | "loss_runs" | "supporting";
    brokerRelease?: "hidden" | "listed" | "attached";
    clientVisible?: boolean;
    source: "operator" | "agent" | "workspace_scan";
  },
) {
  await requireDirectOperatorWrite(ctx, args.operatorUserId);
  const request = await requireRequest(ctx, args.requestId);
  const file = await ctx.db.get(args.clientFileId);
  if (
    !file ||
    file.archivedAt ||
    file.deletedAt ||
    file.orgId !== request.clientOrgId
  ) {
    throw new NoWriteInputError(
      "invalid_client_file",
      "Client file is unavailable or belongs to another client",
    );
  }
  const now = dayjs().valueOf();
  const fileItemId = await ctx.db.insert("procurementFileItems", {
    requestId: request._id,
    clientOrgId: request.clientOrgId,
    clientFileId: args.clientFileId,
    label: requiredText(args.label, "File label", 300),
    documentCategory: args.documentCategory,
    brokerRelease: args.brokerRelease ?? "attached",
    clientVisible: args.clientVisible ?? false,
    createdByUserId: args.operatorUserId,
    updatedByUserId: args.operatorUserId,
    createdAt: now,
    updatedAt: now,
  });
  await scheduleClientFileCompanyInformation(ctx, args.clientFileId);
  if ((args.brokerRelease ?? "attached") !== "hidden")
    await ctx.db.patch(request._id, {
      packetRevision: (request.packetRevision ?? 0) + 1,
      updatedByUserId: args.operatorUserId,
      updatedAt: now,
    });
  await writeOperatorAudit(ctx, {
    operatorUserId: args.operatorUserId,
    type: "setup_write",
    targetOrgId: request.clientOrgId,
    summary: `Added ${args.label} to procurement request ${request.title}`,
    metadata: {
      domain: "procurement",
      requestId: request._id,
      fileItemId,
      source: args.source,
    },
  });
  return { fileItemId };
}

export const createFileItem = mutation({
  args: {
    requestId: v.id("procurementRequests"),
    clientFileId: v.id("clientFiles"),
    label: v.string(),
    documentCategory: v.optional(
      v.union(
        v.literal("requirements"),
        v.literal("policy"),
        v.literal("loss_runs"),
        v.literal("supporting"),
      ),
    ),
    brokerRelease: v.optional(releaseValidator),
    clientVisible: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return await createProcurementFileItemByOperator(ctx, {
      operatorUserId: operator.userId,
      ...args,
      source: "operator",
    });
  },
});

export async function updateProcurementFileItemByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    fileItemId: Id<"procurementFileItems">;
    clientFileId?: Id<"clientFiles">;
    label?: string;
    brokerRelease?: "hidden" | "listed" | "attached";
    clientVisible?: boolean;
    source: "operator" | "agent" | "workspace_scan";
  },
) {
  await requireDirectOperatorWrite(ctx, args.operatorUserId);
  const item = await ctx.db.get(args.fileItemId);
  if (!item || item.removedAt)
    throw new Error("Procurement file item not found");
  const request = await requireRequest(ctx, item.requestId);
  const patch: Partial<Doc<"procurementFileItems">> = {
    updatedByUserId: args.operatorUserId,
    updatedAt: dayjs().valueOf(),
  };
  if (args.clientFileId !== undefined) {
    const file = await ctx.db.get(args.clientFileId);
    if (
      !file ||
      file.archivedAt ||
      file.deletedAt ||
      file.orgId !== request.clientOrgId
    ) {
      throw new NoWriteInputError(
        "invalid_client_file",
        "Client file is unavailable or belongs to another client",
      );
    }
    patch.clientFileId = args.clientFileId;
  }
  if (args.label !== undefined)
    patch.label = requiredText(args.label, "File label", 300);
  if (args.brokerRelease !== undefined)
    patch.brokerRelease = args.brokerRelease;
  if (args.clientVisible !== undefined)
    patch.clientVisible = args.clientVisible;
  const effectiveBrokerRelease =
    args.brokerRelease ?? item.brokerRelease ?? "hidden";
  const fields = Object.keys(patch).filter(
    (field) => !["updatedAt", "updatedByUserId"].includes(field),
  );
  if (fields.length === 0) throw new Error("No file fields changed");
  await ctx.db.patch(item._id, {
    ...patch,
    purpose: undefined,
    status: undefined,
    brokerReleaseProposed: undefined,
    ...(args.brokerRelease !== undefined ? { outreachId: undefined } : {}),
  });
  const brokerProjectionChanged =
    effectiveBrokerRelease !== (item.brokerRelease ?? "hidden") ||
    (Boolean(item.outreachId) &&
      args.brokerRelease !== undefined &&
      effectiveBrokerRelease !== "hidden") ||
    (effectiveBrokerRelease !== "hidden" &&
      ((args.clientFileId !== undefined &&
        args.clientFileId !== item.clientFileId) ||
        (patch.label !== undefined && patch.label !== item.label)));
  if (brokerProjectionChanged)
    await ctx.db.patch(request._id, {
      packetRevision: (request.packetRevision ?? 0) + 1,
      updatedByUserId: args.operatorUserId,
      updatedAt: dayjs().valueOf(),
    });
  if (args.clientFileId !== undefined) {
    for (const clientFileId of new Set(
      [item.clientFileId, args.clientFileId ?? undefined].filter(
        (id): id is Id<"clientFiles"> => Boolean(id),
      ),
    )) {
      await scheduleClientFileCompanyInformation(ctx, clientFileId);
    }
  }
  await writeOperatorAudit(ctx, {
    operatorUserId: args.operatorUserId,
    type: "setup_write",
    targetOrgId: request.clientOrgId,
    summary: `Updated ${patch.label ?? item.label} on ${request.title}`,
    metadata: {
      domain: "procurement",
      requestId: request._id,
      fileItemId: item._id,
      fields,
      source: args.source,
    },
  });
  return { fileItemId: item._id, fields };
}

/** Detach a request document; keep company evidence and issued snapshots intact. */
export const removeFileItem = mutation({
  args: { fileItemId: v.id("procurementFileItems") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await requireDirectOperatorWrite(ctx, operator.userId);
    const item = await ctx.db.get(args.fileItemId);
    if (!item) throw new Error("Procurement file item not found");
    const request = await requireRequest(ctx, item.requestId);
    if (item.removedAt) return { updatedAt: request.updatedAt };
    const now = dayjs().valueOf();
    await ctx.db.patch(item._id, {
      removedAt: now,
      brokerRelease: "hidden",
      clientVisible: false,
      updatedAt: now,
      updatedByUserId: operator.userId,
    });
    if (item.clientFileId) {
      const intakeFiles = await ctx.db
        .query("requestIntakeFiles")
        .withIndex("request", (q) => q.eq("requestId", request._id))
        .take(31);
      if (intakeFiles.length > 30)
        throw new Error("Too many request uploads to detach safely");
      for (const file of intakeFiles)
        if (file.clientFileId === item.clientFileId)
          await ctx.db.delete(file._id);
    }
    await ctx.db.patch(request._id, {
      packetRevision: (request.packetRevision ?? 0) + 1,
      updatedAt: now,
      updatedByUserId: operator.userId,
      ...(request.intakeSubmittedAt ? { intakeAmendedAt: now } : {}),
    });
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      targetOrgId: request.clientOrgId,
      summary: `Removed ${item.label} from ${request.title}`,
      metadata: {
        domain: "procurement",
        requestId: request._id,
        fileItemId: item._id,
        source: "operator",
      },
    });
    return { updatedAt: now };
  },
});

export const updateFileItem = mutation({
  args: {
    fileItemId: v.id("procurementFileItems"),
    clientFileId: v.optional(v.id("clientFiles")),
    label: v.optional(v.string()),
    brokerRelease: v.optional(releaseValidator),
    clientVisible: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return await updateProcurementFileItemByOperator(ctx, {
      operatorUserId: operator.userId,
      ...args,
      source: "operator",
    });
  },
});

export async function listProcurementEmailThreads(
  ctx: Ctx,
  args: {
    clientOrgId: Id<"organizations">;
    requestId?: Id<"procurementRequests">;
    limit?: number;
  },
) {
  await requireClient(ctx, args.clientOrgId);
  const limit = Math.max(1, Math.min(args.limit ?? 100, MAX_EMAIL_THREADS));
  if (args.requestId) {
    const request = await requireRequest(ctx, args.requestId);
    if (request.clientOrgId !== args.clientOrgId) {
      throw new Error("Procurement request does not belong to this client");
    }
    const rows = await ctx.db
      .query("teamEmailThreads")
      .withIndex("by_requestId_and_archivedAt_and_latestMessageAt", (index) =>
        index.eq("requestId", request._id).eq("archivedAt", undefined),
      )
      .order("desc")
      .take(MAX_EMAIL_THREADS);
    return rows.filter(activeEmailThread).slice(0, limit);
  }
  const rows = await ctx.db
    .query("teamEmailThreads")
    .withIndex("by_clientOrgId_and_archivedAt_and_latestMessageAt", (index) =>
      index.eq("clientOrgId", args.clientOrgId).eq("archivedAt", undefined),
    )
    .order("desc")
    .take(MAX_EMAIL_THREADS);
  return rows.filter(activeEmailThread).slice(0, limit);
}

/** Thread detail for operator tools and the Inbox reader; null when missing, deleted or outside `expectedRequestId`. */
export async function getProcurementEmailThreadDetails(
  ctx: QueryCtx,
  emailThreadId: Id<"teamEmailThreads">,
  expectedRequestId?: Id<"procurementRequests">,
  viewerUserId?: Id<"users">,
  includeArchived?: boolean,
) {
  return await getTeamThreadDetails(ctx, {
    threadId: emailThreadId,
    requestId: expectedRequestId,
    viewerUserId,
    includeArchived,
  });
}

/** Filing preview for a linked conversation; null when it is missing, deleted or not linked to a request yet. */
export async function previewProcurementEmailReconciliation(
  ctx: Ctx,
  emailThreadId: Id<"teamEmailThreads">,
  selectedOutreachId?: Id<"procurementBrokerOutreaches">,
) {
  const thread = await ctx.db.get(emailThreadId);
  if (!thread || thread.deletedAt || !thread.requestId) return null;
  const threadRequestId = thread.requestId;
  const [request, scanned, outreaches, proposals] = await Promise.all([
    requireRequest(ctx, threadRequestId),
    ctx.db
      .query("teamEmailMessages")
      .withIndex("by_threadId_and_receivedAt", (query) => query.eq("threadId", thread._id))
      .take(MAX_THREAD_PREVIEW_MESSAGES + 1),
    ctx.db
      .query("procurementBrokerOutreaches")
      .withIndex("request", (query) => query.eq("requestId", threadRequestId))
      .collect(),
    ctx.db
      .query("procurementProposals")
      .withIndex("request", (query) => query.eq("requestId", threadRequestId))
      .collect(),
  ]);
  // A bounded read never stands for the whole thread: past the cap the preview
  // says so and offers no filing, because the file list would be incomplete.
  const messagesTruncated = scanned.length > MAX_THREAD_PREVIEW_MESSAGES;
  const messages = scanned.slice(0, MAX_THREAD_PREVIEW_MESSAGES);
  const clientFileIds = [
    ...new Set(messages.flatMap((message) => message.clientFileIds)),
  ];
  const files = (
    await Promise.all(
      clientFileIds.map(async (clientFileId) => {
        const file = await ctx.db.get(clientFileId);
        return file && !file.archivedAt && !file.deletedAt
          ? {
              clientFileId: file._id,
              name: file.name,
              contentType: file.contentType,
              size: file.size,
            }
          : null;
      }),
    )
  ).filter((file): file is NonNullable<typeof file> => file !== null);
  const proposalDocuments = (
    await Promise.all(
      proposals
        .filter(
          (proposal) =>
            proposal.status !== "archived" && proposal.status !== "withdrawn",
        )
        .map((proposal) =>
          ctx.db
            .query("procurementProposalDocuments")
            .withIndex("proposal", (query) =>
              query.eq("proposalId", proposal._id),
            )
            .collect(),
        ),
    )
  ).flat();
  const participantEmails = new Set(
    thread.participantEmails.map(normalizeProcurementEmail),
  );
  const eligibleOutreaches = (
    await Promise.all(
      outreaches.map(async (outreach) => {
        const broker = outreach.brokerOrgId
          ? await ctx.db.get(outreach.brokerOrgId)
          : null;
        return broker?.type === "broker" &&
          !isSpotOwnedBrokerIdentity(broker) &&
          !isSpotOwnedDomain(outreach.contactEmail)
          ? outreach
          : null;
      }),
    )
  ).filter(
    (outreach): outreach is NonNullable<typeof outreach> => outreach !== null,
  );
  const linkedOutreach = eligibleOutreaches.find((outreach) => outreach._id === thread.outreachId);
  const matchingOutreaches = linkedOutreach ? [linkedOutreach] : eligibleOutreaches.filter(
    (outreach) =>
      outreach.contactEmail &&
      participantEmails.has(normalizeProcurementEmail(outreach.contactEmail)),
  );
  const suggestedOutreach =
    matchingOutreaches.length === 1 ? matchingOutreaches[0] : null;
  const selectedOutreach = selectedOutreachId
    ? eligibleOutreaches.find((outreach) => outreach._id === selectedOutreachId)
    : suggestedOutreach;
  if (selectedOutreachId && !selectedOutreach) {
    throw new Error(
      "Selected outreach must belong to this request and an external provider",
    );
  }
  const selectedProposalIds = new Set(
    proposals
      .filter(
        (proposal) =>
          selectedOutreach &&
          proposal.outreachId === selectedOutreach._id &&
          proposal.status !== "archived" &&
          proposal.status !== "withdrawn",
      )
      .map((proposal) => String(proposal._id)),
  );
  const proposedClientFileIds = new Set(
    proposalDocuments.flatMap((document) =>
      selectedProposalIds.has(String(document.proposalId)) &&
      document.clientFileId
        ? [String(document.clientFileId)]
        : [],
    ),
  );
  const unfiledFiles = files.filter(
    (file) => !proposedClientFileIds.has(String(file.clientFileId)),
  );
  // `fileEmailQuote` refuses archived threads, so the preview must not offer
  // filing from one either.
  const filable = !thread.archivedAt && !messagesTruncated;
  return {
    emailThreadId: thread._id,
    filable,
    requestId: request._id,
    requestTitle: request.title,
    deepLink: `/operator/clients/${request.clientOrgId}/procurement/${request._id}?view=email`,
    category: thread.category,
    participantEmails: thread.participantEmails,
    messageCount: messages.length,
    messagesTruncated,
    files,
    unfiledFiles,
    selectedOutreachId: selectedOutreach?._id ?? null,
    // Eligible outreaches on the thread's current request, so a client that moved
    // the thread can rebuild its picker instead of trusting a stale snapshot.
    outreaches: eligibleOutreaches.map((outreach) => ({
      outreachId: outreach._id,
      brokerOrgId: outreach.brokerOrgId,
      brokerName: outreach.brokerName,
      contactName: outreach.contactName ?? null,
      contactEmail: outreach.contactEmail ?? null,
    })),
    outreachInference: {
      status:
        matchingOutreaches.length === 1
          ? ("exact" as const)
          : matchingOutreaches.length > 1
            ? ("ambiguous" as const)
            : ("none" as const),
      candidates: matchingOutreaches.map((outreach) => ({
        outreachId: outreach._id,
        brokerOrgId: outreach.brokerOrgId ?? null,
        brokerName: outreach.brokerName,
        contactName: outreach.contactName ?? null,
        contactEmail: outreach.contactEmail ?? null,
      })),
    },
    nextActions:
      filable && !selectedOutreachId && suggestedOutreach && unfiledFiles.length
        ? [
            {
              tool: "file_procurement_email_quote" as const,
              why: `One outreach contact matches this thread and ${unfiledFiles.length} attachment${unfiledFiles.length === 1 ? " is" : "s are"} not yet filed in a proposal`,
              input: {
                procurementEmailThreadId: thread._id,
                procurementOutreachId: suggestedOutreach._id,
              },
            },
          ]
        : [],
  };
}

/** Request-bound inbox projection; the team inbox reader scoped to one request. */
export const getInbox = query({
  args: { requestId: v.id("procurementRequests"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { requestId, paginationOpts }) => {
    const operator = await requireOperator(ctx);
    await requireRequest(ctx, requestId);
    return await listTeamInbox(ctx, {
      viewerUserId: operator.userId,
      requestId,
      paginationOpts,
    });
  },
});

export const getEmailThread = query({
  args: {
    emailThreadId: v.id("teamEmailThreads"),
    requestId: v.optional(v.id("procurementRequests")),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    if (args.requestId) await requireRequest(ctx, args.requestId);
    return await getProcurementEmailThreadDetails(
      ctx,
      args.emailThreadId,
      args.requestId,
      operator.userId,
      args.includeArchived,
    );
  },
});

export const previewEmailReconciliation = query({
  args: {
    emailThreadId: v.id("teamEmailThreads"),
    outreachId: v.optional(v.id("procurementBrokerOutreaches")),
  },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    return await previewProcurementEmailReconciliation(
      ctx,
      args.emailThreadId,
      args.outreachId,
    );
  },
});

/** Whether the thread's own request may be changed: only linked, non-outreach threads can move. */
async function moveTeamThreadRequest(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    thread: TeamThread;
    nextRequest: Doc<"procurementRequests">;
  },
) {
  const { thread, nextRequest } = args;
  const now = dayjs().valueOf();
  const movedClientFileIds = new Set<Id<"clientFiles">>();
  // Every message moves or nothing does: refuse a thread past the bound before any write.
  const sized = await ctx.db
    .query("teamEmailMessages")
    .withIndex("by_threadId_and_receivedAt", (index) => index.eq("threadId", thread._id))
    .take(MAX_MOVE_MESSAGES + 1);
  if (sized.length > MAX_MOVE_MESSAGES)
    throw new Error(
      `Moving a conversation supports at most ${MAX_MOVE_MESSAGES} messages; this one has more.`,
    );
  for (const message of sized) {
    const fileItems = await ctx.db
      .query("procurementFileItems")
      .withIndex("email", (index) => index.eq("sourceEmailMessageId", message._id))
      .take(MAX_EMAIL_FILE_ITEMS);
    for (const fileItem of fileItems) {
      if (fileItem.clientFileId) movedClientFileIds.add(fileItem.clientFileId);
      await ctx.db.patch(fileItem._id, {
        requestId: nextRequest._id,
        updatedByUserId: args.operatorUserId,
        updatedAt: now,
      });
    }
  }
  for (const clientFileId of movedClientFileIds) {
    await scheduleClientFileCompanyInformation(ctx, clientFileId);
  }
}

export async function updateProcurementEmailThreadByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    emailThreadId: Id<"teamEmailThreads">;
    category?: ProcurementEmailCategory;
    requestId?: Id<"procurementRequests">;
    source: "operator" | "agent" | "workspace_scan";
  },
) {
  await requireDirectOperatorWrite(ctx, args.operatorUserId);
  let thread = await ctx.db.get(args.emailThreadId);
  if (!thread || thread.deletedAt) {
    throw new Error("Procurement email thread not found");
  }
  const fields: string[] = [];
  const patch: Partial<TeamThread> = { updatedAt: dayjs().valueOf() };
  if (args.requestId !== undefined && args.requestId !== thread.requestId) {
    if (isOutreachLocked(thread)) {
      throw new Error("Provider outreach conversations stay with their originating request");
    }
    const nextRequest = await requireRequest(ctx, args.requestId);
    if (!thread.requestId) {
      // Unlinked or client-only: this is a link, with its own audit and filing.
      await linkTeamEmailThreadByOperator(ctx, {
        operatorUserId: args.operatorUserId,
        threadId: thread._id,
        requestId: nextRequest._id,
        source: args.source,
      });
      thread = (await ctx.db.get(thread._id))!;
    } else {
      if (nextRequest.clientOrgId !== thread.clientOrgId) {
        throw new Error("Email thread can move only within the same client");
      }
      patch.requestId = nextRequest._id;
      // A new link revision: a filing continuation still running for the old
      // request stops, and filing restarts for the new one (held uploads included).
      patch.linkedAt = patch.updatedAt;
      patch.linkedByUserId = args.operatorUserId;
      await moveTeamThreadRequest(ctx, {
        operatorUserId: args.operatorUserId,
        thread,
        nextRequest,
      });
    }
    fields.push("requestId");
  }
  if (args.category !== undefined) {
    patch.category = args.category;
    patch.categorySource = "operator";
    patch.categoryReason = `Set manually through ${args.source}`;
    fields.push("category");
  }
  if (fields.length === 0) throw new Error("No email thread fields changed");
  const previousRequestId = thread.requestId;
  if (patch.requestId || patch.category) await ctx.db.patch(thread._id, patch);
  if (patch.requestId && thread.clientOrgId && patch.linkedAt) {
    await fileLinkedThreadBatch(ctx, {
      threadId: thread._id,
      linkedAt: patch.linkedAt,
      clientOrgId: thread.clientOrgId,
      requestId: patch.requestId,
      cursor: null,
    });
  }
  // A link audits itself; a move or category change is audited here.
  if (patch.requestId || patch.category)
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "setup_write",
      targetOrgId: thread.clientOrgId,
      summary: `Updated procurement email thread ${thread.subject}`,
      metadata: {
        domain: "procurement",
        requestId: patch.requestId ?? thread.requestId,
        emailThreadId: thread._id,
        previousRequestId,
        nextRequestId: patch.requestId ?? thread.requestId,
        fields,
        source: args.source,
      },
    });
  return { emailThreadId: thread._id, fields };
}

/**
 * Archives or restores up to 100 conversations, in or out of any scope. With a
 * `requestId` every conversation must belong to that request. A later inbound
 * message unarchives a conversation.
 */
export async function setTeamThreadsArchivedByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    emailThreadIds: Id<"teamEmailThreads">[];
    archived: boolean;
    requestId?: Id<"procurementRequests">;
  },
) {
  await requireDirectOperatorWrite(ctx, args.operatorUserId);
  const request = args.requestId ? await requireRequest(ctx, args.requestId) : null;
  const ids = [...new Set(args.emailThreadIds)];
  if (!ids.length || ids.length > 100) throw new Error("Select 1 to 100 conversations");
  const now = dayjs().valueOf();
  const changedThreads: TeamThread[] = [];
  for (const emailThreadId of ids) {
    const thread = await ctx.db.get(emailThreadId);
    if (!thread || thread.deletedAt || (request && thread.requestId !== request._id))
      throw new Error(
        request ? "Conversation not found on this request" : "Conversation not found",
      );
    if (Boolean(thread.archivedAt) === args.archived) continue;
    await ctx.db.patch(thread._id, {
      archivedAt: args.archived ? now : undefined,
      archivedByUserId: args.archived ? args.operatorUserId : undefined,
      updatedAt: now,
    });
    changedThreads.push(thread);
  }
  if (changedThreads.length) {
    const clientOrgIds = [
      ...new Set(
        changedThreads.flatMap((thread) => (thread.clientOrgId ? [thread.clientOrgId] : [])),
      ),
    ];
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "setup_write",
      targetOrgId: request?.clientOrgId ?? (clientOrgIds.length === 1 ? clientOrgIds[0] : undefined),
      summary: `${args.archived ? "Archived" : "Restored"} ${changedThreads.length} conversation${changedThreads.length === 1 ? "" : "s"}${request ? ` on ${request.title}` : ""}`,
      metadata: {
        domain: "procurement",
        operation: args.archived ? "archive_email_threads" : "unarchive_email_threads",
        ...(request ? { requestId: request._id } : {}),
        emailThreadIds: changedThreads.map((thread) => thread._id),
      },
    });
  }
  return { changed: changedThreads.length };
}

/** Inbox bulk archive/unarchive. */
export const setEmailThreadsArchived = mutation({
  args: {
    requestId: v.optional(v.id("procurementRequests")),
    emailThreadIds: v.array(v.id("teamEmailThreads")),
    archived: v.boolean(),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return await setTeamThreadsArchivedByOperator(ctx, {
      operatorUserId: operator.userId,
      ...args,
    });
  },
});

export const updateEmailThread = mutation({
  args: {
    emailThreadId: v.id("teamEmailThreads"),
    category: v.optional(emailCategoryValidator),
    requestId: v.optional(v.id("procurementRequests")),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return await updateProcurementEmailThreadByOperator(ctx, {
      operatorUserId: operator.userId,
      ...args,
      source: "operator",
    });
  },
});

export const resolveInboxInternal = internalQuery({
  args: { inboxToken: v.string() },
  handler: async (ctx, args) => {
    const request = await ctx.db
      .query("procurementRequests")
      .withIndex("inbox", (index) => index.eq("inboxToken", args.inboxToken))
      .unique();
    if (
      !request?.clientOrgId ||
      request.deletedAt ||
      request.intakeAnswers?.intakeGoal === "savings"
    )
      return null;
    const client = await ctx.db.get(request.clientOrgId);
    return client?.type === "client" && client.deletedAt === undefined
      ? { request, client }
      : null;
  },
});

const inboundAttachmentValidator = v.object({
  fileId: v.id("_storage"),
  filename: v.string(),
  contentType: v.string(),
  size: v.number(),
});

const MAX_LINK_BATCH = 25;
const MAX_MOVE_MESSAGES = 300;
const MAX_EMAIL_FILE_ITEMS = 40;

async function emailThreadClientFileIds(ctx: QueryCtx | MutationCtx, emailThreadId: Id<"teamEmailThreads">) {
  const ids = new Set<Id<"clientFiles">>();
  for await (const message of ctx.db
    .query("teamEmailMessages")
    .withIndex("by_threadId_and_receivedAt", (index) => index.eq("threadId", emailThreadId)))
    for (const clientFileId of message.clientFileIds) ids.add(clientFileId);
  return [...ids];
}

/**
 * Attaches a client, and optionally one of its requests, to a team thread and
 * files the held attachments. Derives the client from `requestId`; a `clientOrgId`
 * that disagrees is rejected and at least one target is required. Outreach
 * conversations stay with their request, and a linked conversation is never
 * moved to another client. Callers authorize the operator (this checks direct
 * write access, so impersonation is read-only). Filing is bounded: when the
 * thread has more messages than one batch, `linkTeamEmailThreadBatchInternal`
 * continues and re-checks the link revision so a changed link cannot move files
 * into another client. Held storage is reused by the client files it becomes;
 * it is deleted only when identical content already exists for the client.
 */
export async function linkTeamEmailThreadByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    threadId: Id<"teamEmailThreads">;
    requestId?: Id<"procurementRequests">;
    clientOrgId?: Id<"organizations">;
    source: "operator" | "agent" | "workspace_scan" | "suggestion";
  },
) {
  await requireDirectOperatorWrite(ctx, args.operatorUserId);
  const thread = await ctx.db.get(args.threadId);
  if (!thread || thread.deletedAt) throw new Error("Conversation not found");
  if (!args.requestId && !args.clientOrgId)
    throw new Error("Choose a client or request to link this conversation to");
  const request = args.requestId ? await requireRequest(ctx, args.requestId) : null;
  if (request && args.clientOrgId && request.clientOrgId !== args.clientOrgId)
    throw new Error("Request does not belong to that client");
  const clientOrgId = request?.clientOrgId ?? args.clientOrgId!;
  await requireClient(ctx, clientOrgId);
  if (isOutreachLocked(thread))
    throw new Error("Provider outreach conversations stay with their originating request");
  if (thread.clientOrgId && thread.clientOrgId !== clientOrgId)
    throw new Error("Email thread can move only within the same client");
  if (thread.requestId && request && thread.requestId !== request._id)
    throw new Error("Use the request move for a conversation that already has a request");
  if (thread.clientOrgId === clientOrgId && (!request || thread.requestId === request._id))
    return { threadId: thread._id, linked: false as const };

  const now = dayjs().valueOf();
  const participants = thread.participantEmails;
  const [brokerEmails, clientEmails, operatorEmails] = await linkedParticipantGroups(ctx, {
    clientOrgId,
    requestId: request?._id,
  });
  const inferred = inferProcurementEmailCategory({
    participantEmails: participants,
    brokerEmails,
    clientEmails,
    operatorEmails,
  });
  await ctx.db.patch(thread._id, {
    clientOrgId,
    ...(request
      ? { requestId: request._id, addressedRequestId: thread.addressedRequestId ?? request._id }
      : {}),
    linkedAt: now,
    linkedByUserId: args.operatorUserId,
    linkSuggestion: undefined,
    ...(thread.categorySource === "auto"
      ? { category: inferred.category, categoryReason: inferred.reason }
      : {}),
    updatedAt: now,
  });
  await writeOperatorAudit(ctx, {
    operatorUserId: args.operatorUserId,
    type: "setup_write",
    targetOrgId: clientOrgId,
    summary: `Linked email conversation ${thread.subject} to ${request ? request.title : "the client"}`,
    metadata: {
      domain: "procurement",
      operation: "link_team_email_thread",
      ...(request ? { requestId: request._id } : {}),
      emailThreadId: thread._id,
      clientOrgId,
      source: args.source,
    },
  });
  await fileLinkedThreadBatch(ctx, {
    threadId: thread._id,
    linkedAt: now,
    clientOrgId,
    requestId: request?._id,
    cursor: null,
  });
  return { threadId: thread._id, linked: true as const };
}

async function linkedParticipantGroups(
  ctx: QueryCtx | MutationCtx,
  args: { clientOrgId: Id<"organizations">; requestId?: Id<"procurementRequests"> },
) {
  const [outreaches, memberships, operatorProfiles] = await Promise.all([
    args.requestId
      ? ctx.db
          .query("procurementBrokerOutreaches")
          .withIndex("request", (index) => index.eq("requestId", args.requestId!))
          .take(200)
      : [],
    ctx.db
      .query("orgMemberships")
      .withIndex("organization", (index) => index.eq("orgId", args.clientOrgId))
      .take(200),
    ctx.db
      .query("operatorProfiles")
      .withIndex("status", (index) => index.eq("status", "active"))
      .take(200),
  ]);
  const emailOf = async (userId: Id<"users">) => (await ctx.db.get(userId))?.email;
  const compact = (values: (string | undefined)[]) =>
    values.filter((email): email is string => Boolean(email));
  return [
    compact(outreaches.map((outreach) => outreach.contactEmail)),
    compact(await Promise.all(memberships.map((membership) => emailOf(membership.userId)))),
    compact(await Promise.all(operatorProfiles.map((profile) => emailOf(profile.userId)))),
  ] as const;
}

/**
 * Files one batch of a linked thread's messages: held uploads become client
 * files, then every attached client file is listed on the request when there is
 * one. A batch resumes only while the thread still carries the same link
 * revision (`linkedAt`) and client, so a re-link between batches stops the
 * stale continuation instead of filing into the wrong client.
 */
async function fileLinkedThreadBatch(
  ctx: MutationCtx,
  args: {
    threadId: Id<"teamEmailThreads">;
    linkedAt: number;
    clientOrgId: Id<"organizations">;
    requestId?: Id<"procurementRequests">;
    cursor: string | null;
  },
) {
  const thread = await ctx.db.get(args.threadId);
  if (
    !thread ||
    thread.deletedAt ||
    thread.linkedAt !== args.linkedAt ||
    thread.clientOrgId !== args.clientOrgId ||
    (args.requestId && thread.requestId !== args.requestId) ||
    // The client or request may have been deleted between batches.
    (await teamTargetProblem(ctx, {
      clientOrgId: args.clientOrgId,
      requestId: args.requestId,
    }))
  )
    return { done: true as const, stale: true as const };
  const page = await ctx.db
    .query("teamEmailMessages")
    .withIndex("by_threadId_and_receivedAt", (index) => index.eq("threadId", thread._id))
    .paginate({ cursor: args.cursor, numItems: MAX_LINK_BATCH });
  const now = dayjs().valueOf();
  for (const message of page.page) {
    let clientFileIds = message.clientFileIds;
    const held = message.unfiledAttachments ?? [];
    if (held.length) {
      const filed = await storeProcurementEmailAttachments(ctx, {
        clientOrgId: args.clientOrgId,
        // Held files may still be referenced by an operator's sent draft.
        preserveSourceStorage: true,
        attachments: held.map((file) => ({
          fileId: file.storageId,
          filename: file.name,
          contentType: file.contentType,
          size: file.size,
        })),
        subject: message.subject,
      });
      clientFileIds = [...new Set([...clientFileIds, ...filed])];
    }
    await ctx.db.patch(message._id, {
      clientOrgId: args.clientOrgId,
      addressedRequestId: message.addressedRequestId ?? args.requestId,
      clientFileIds,
      unfiledAttachments: undefined,
    });
    if (args.requestId)
      await insertProcurementEmailFileItems(ctx, {
        requestId: args.requestId,
        clientOrgId: args.clientOrgId,
        emailMessageId: message._id,
        clientFileIds,
        now,
      });
    if (args.requestId && message.direction === "inbound")
      await ctx.scheduler.runAfter(0, internal.procurementInformationEmail.queueEmail, {messageId:message._id});
  }
  if (page.isDone) {
    await scheduleEmailThreadCompanyInformation(ctx, thread._id);
    return { done: true as const, stale: false as const };
  }
  await ctx.scheduler.runAfter(0, internal.procurementRequests.linkTeamEmailThreadBatchInternal, {
    ...args,
    cursor: page.continueCursor,
  });
  return { done: false as const, stale: false as const };
}

export const linkTeamEmailThreadBatchInternal = internalMutation({
  args: {
    threadId: v.id("teamEmailThreads"),
    linkedAt: v.number(),
    clientOrgId: v.id("organizations"),
    requestId: v.optional(v.id("procurementRequests")),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => await fileLinkedThreadBatch(ctx, args),
});

export const ingestEmailInternal = internalMutation({
  args: {
    addressedRequestId: v.id("procurementRequests"),
    resendEmailId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    inReplyTo: v.optional(v.string()),
    references: v.array(v.string()),
    subject: v.string(),
    fromName: v.optional(v.string()),
    fromEmail: v.string(),
    toAddresses: v.array(v.string()),
    ccAddresses: v.array(v.string()),
    bccAddresses: v.array(v.string()),
    currentText: v.string(),
    bodyHtml: v.optional(v.string()),
    forwarded: v.optional(v.any()),
    participantEmails: v.array(v.string()),
    attachments: v.array(inboundAttachmentValidator),
    receivedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const dropUploads = () =>
      Promise.all(args.attachments.map((attachment) => ctx.storage.delete(attachment.fileId)));
    if (args.resendEmailId) {
      const duplicate = await ctx.db
        .query("teamEmailMessages")
        .withIndex("by_resendEmailId", (index) => index.eq("resendEmailId", args.resendEmailId))
        .first();
      if (duplicate) {
        await dropUploads();
        return { duplicate: true as const, threadId: duplicate.threadId };
      }
    }
    if (args.messageId) {
      const duplicate = await ctx.db
        .query("teamEmailMessages")
        .withIndex("by_messageId", (index) => index.eq("messageId", args.messageId))
        .first();
      if (duplicate) {
        await dropUploads();
        return { duplicate: true as const, threadId: duplicate.threadId };
      }
    }
    const addressedRequest = await requireRequest(ctx, args.addressedRequestId);
    const normalizedSubject = normalizeProcurementSubject(args.subject);
    const participants = uniqueProcurementEmails(args.participantEmails);
    const referenceIds = Array.from(
      new Set(
        [args.inReplyTo ?? "", ...args.references].map((value) => value.trim()).filter(Boolean),
      ),
    ).slice(0, 50);
    let thread: TeamThread | null = null;
    for (const reference of referenceIds) {
      const parent = await ctx.db
        .query("teamEmailMessages")
        .withIndex("by_messageId", (index) => index.eq("messageId", reference))
        .first();
      if (!parent) continue;
      const candidate = await ctx.db.get(parent.threadId);
      if (
        candidate?.clientOrgId === addressedRequest.clientOrgId &&
        !candidate.deletedAt &&
        (!isOutreachLocked(candidate) || candidate.requestId === addressedRequest._id)
      ) {
        thread = candidate;
        break;
      }
    }
    if (!thread && normalizedSubject) {
      const candidates = await ctx.db
        .query("teamEmailThreads")
        .withIndex("subject", (index) =>
          index
            .eq("clientOrgId", addressedRequest.clientOrgId)
            .eq("normalizedSubject", normalizedSubject),
        )
        .order("desc")
        .take(20);
      thread =
        candidates.find(
          (candidate) =>
            !candidate.deletedAt &&
            candidate.addressedRequestId === addressedRequest._id &&
            procurementParticipantsOverlap(candidate.participantEmails, participants),
        ) ?? null;
    }

    const requestId = thread?.requestId ?? addressedRequest._id;
    const [brokerEmails, clientEmails, operatorEmails] = await linkedParticipantGroups(ctx, {
      clientOrgId: addressedRequest.clientOrgId,
      requestId,
    });
    const classificationParticipants = thread
      ? uniqueProcurementEmails([...thread.participantEmails, ...participants])
      : participants;
    const inferred = inferProcurementEmailCategory({
      participantEmails: classificationParticipants,
      brokerEmails,
      clientEmails,
      operatorEmails,
    });
    const now = dayjs().valueOf();
    const restoredClientFileIds = thread?.archivedAt
      ? await emailThreadClientFileIds(ctx, thread._id)
      : [];
    const subject = requiredText(args.subject || "(no subject)", "Subject", 500);
    let threadId: Id<"teamEmailThreads">;
    if (thread) {
      threadId = thread._id;
      await ctx.db.patch(thread._id, {
        subject,
        ...(thread.categorySource === "auto"
          ? { category: inferred.category, categoryReason: inferred.reason }
          : {}),
      });
    } else {
      threadId = await ctx.db.insert("teamEmailThreads", {
        source: "forward",
        clientOrgId: addressedRequest.clientOrgId,
        addressedRequestId: addressedRequest._id,
        requestId: addressedRequest._id,
        normalizedSubject,
        subject,
        category: inferred.category,
        categorySource: "auto",
        categoryReason: inferred.reason,
        participantEmails: participants,
        latestMessageAt: 0,
        messageCount: 0,
        createdAt: now,
        updatedAt: now,
      });
    }
    const target = (await ctx.db.get(threadId))!;
    const clientFileIds = await storeProcurementEmailAttachments(ctx, {
      clientOrgId: addressedRequest.clientOrgId,
      attachments: args.attachments,
      subject: args.subject,
    });
    const fromEmail = normalizeProcurementEmail(args.fromEmail);
    const emailMessageId = await ctx.db.insert("teamEmailMessages", {
      direction: "inbound",
      threadId,
      clientOrgId: addressedRequest.clientOrgId,
      addressedRequestId: addressedRequest._id,
      resendEmailId: optionalText(args.resendEmailId, 500),
      messageId: optionalText(args.messageId, 500),
      inReplyTo: optionalText(args.inReplyTo, 500),
      references: args.references.map((value) => value.slice(0, 500)).slice(0, 50),
      subject,
      fromName: optionalText(args.fromName, 300),
      fromEmail,
      toAddresses: uniqueProcurementEmails(args.toAddresses),
      ccAddresses: uniqueProcurementEmails(args.ccAddresses),
      bccAddresses: uniqueProcurementEmails(args.bccAddresses),
      currentText: args.currentText.slice(0, 120_000),
      bodyHtml: args.bodyHtml?.slice(0, 180_000),
      forwarded: args.forwarded,
      clientFileIds,
      receivedAt: args.receivedAt,
      createdAt: now,
    });
    await ctx.db.patch(threadId, {
      participantEmails: classificationParticipants,
      latestMessageAt: Math.max(target.latestMessageAt, args.receivedAt),
      messageCount: target.messageCount + 1,
      archivedAt: undefined,
      archivedByUserId: undefined,
      latestInboundAt: Math.max(target.latestInboundAt ?? 0, args.receivedAt),
      ...(args.receivedAt >= target.latestMessageAt
        ? threadSummaryPatch({
            direction: "inbound",
            currentText: args.currentText,
            fromName: optionalText(args.fromName, 300),
            fromEmail,
          })
        : {}),
      updatedAt: now,
    });
    await insertProcurementEmailFileItems(ctx, {
      requestId,
      clientOrgId: addressedRequest.clientOrgId,
      emailMessageId,
      clientFileIds,
      now,
    });
    await scheduleEmailThreadCompanyInformation(ctx, threadId);
    await ctx.scheduler.runAfter(0, internal.procurementInformationEmail.queueEmail, {messageId:emailMessageId});
    if (args.receivedAt >= target.latestMessageAt)
      await queueTeamReplySuggestion(ctx, { threadId, messageId: emailMessageId });
    for (const clientFileId of restoredClientFileIds) {
      await scheduleClientFileCompanyInformation(ctx, clientFileId);
    }
    return {
      duplicate: false as const,
      threadId,
      emailMessageId,
      clientFileIds,
    };
  },
});
