import { requestPacketText } from "./lib/procurementNarrative";
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
import { createClientFileFromProcurementEmail } from "./lib/clientFiles";
import { boundedClientFileHint } from "./lib/clientFileNames";
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
import { getAgentDomain } from "./lib/resend";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "./lib/userFacingErrors";

const MAX_REQUESTS = 100;
const MAX_EMAIL_THREADS = 200;
const MAX_TEXT = 20_000;

function activeEmailThread(thread: Doc<"procurementEmailThreads">) {
  return !thread.archivedAt && !thread.deletedAt;
}

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

const emailCategoryValidator = v.union(
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

async function requireClient(ctx: Ctx, clientOrgId: Id<"organizations">) {
  const client = await ctx.db.get(clientOrgId);
  if (!client || client.type !== "client") {
    throw new Error("Client organization not found");
  }
  return client;
}

async function requireRequest(ctx: Ctx, requestId: Id<"procurementRequests">) {
  const request = await ctx.db.get(requestId);
  if (!request) throw new Error("Procurement request not found");
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
  if (!broker || broker.type !== "broker") {
    throw new Error("Broker organization not found");
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

function requestForwardingAddress(request: Doc<"procurementRequests">) {
  if (!request.inboxToken) throw new Error("Procurement inbox is not ready");
  return procurementForwardingAddress(request.inboxToken, getAgentDomain());
}

function outreachDto(outreach: Doc<"procurementBrokerOutreaches">) {
  return outreach;
}

async function requestRow(ctx: Ctx, request: Doc<"procurementRequests">) {
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
        .query("procurementEmailThreads")
        .withIndex("request", (index) => index.eq("requestId", request._id))
        .collect(),
    ]);
  return {
    ...request,
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
function buildRequestTimeline(args: {
  auditEvents: Array<{ _id: string; summary: string; createdAt: number }>;
  emailThreads: Doc<"procurementEmailThreads">[];
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
      summary: `${brokerNameByOutreach.get(String(proposal.outreachId)) ?? "Broker"} proposal ${readable(proposal.status)}`,
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
      .query("procurementEmailThreads")
      .withIndex("request", (index) => index.eq("requestId", requestId))
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
  const files = await Promise.all(
    fileItems
      .filter((item) => item.clientFileId)
      .map(async (item) => {
        const file = item.clientFileId
          ? await ctx.db.get(item.clientFileId)
          : null;
        return {
          _id: item._id,
          requestId: item.requestId,
          clientOrgId: item.clientOrgId,
          clientFileId: item.clientFileId,
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
                url: await ctx.storage.getUrl(file.fileId),
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
  const search = args.query?.trim().toLowerCase();
  const matches = search
    ? (
        await Promise.all(
          rows.map(async (row) => ({
            row,
            text: `${row.title} ${await requestPacketText(ctx, row)}`.toLowerCase(),
          })),
        )
      )
        .filter(({ text }) => text.includes(search))
        .map(({ row }) => row)
    : rows;
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
    clientVisible: args.clientVisible ?? false,
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
        why: "Forward the relevant client or broker thread so Spot can preserve the correspondence and associate its attachments with this request",
        forwardingAddress,
      },
      {
        tool: "update_procurement_packet",
        why: "Complete and verify the broker-visible packet before sharing it",
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
  await writeOperatorAudit(ctx, {
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
  return { requestId: request._id, fields: changedFields };
}

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
    source: "operator" | "agent" | "workspace_scan";
  },
) {
  await requireDirectOperatorWrite(ctx, args.operatorUserId);
  const request = await requireRequest(ctx, args.requestId);
  const broker = await requireBrokerOrganization(ctx, args.brokerOrgId);
  if (!broker) throw new Error("Broker organization is required");
  assertExternalBrokerIdentity({ email: args.contactEmail });
  if (args.contactUserId) {
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("organization_user", (q) =>
        q.eq("orgId", broker._id).eq("userId", args.contactUserId!),
      )
      .unique();
    if (!membership)
      throw new Error("Broker contact must belong to the selected broker");
    const contact = await ctx.db.get(args.contactUserId);
    assertExternalBrokerIdentity({ email: contact?.email });
  }
  const now = dayjs().valueOf();
  const sent =
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
  if (!outreach) throw new Error("Broker outreach not found");
  const request = await requireRequest(ctx, outreach.requestId);
  const patch: Partial<Doc<"procurementBrokerOutreaches">> = {
    updatedByUserId: args.operatorUserId,
    updatedAt: dayjs().valueOf(),
  };
  if (args.brokerOrgId !== undefined) {
    if (!args.brokerOrgId) throw new Error("Broker organization is required");
    if (args.brokerOrgId !== outreach.brokerOrgId) {
      const existingProposal = await ctx.db
        .query("procurementProposals")
        .withIndex("outreach", (q) => q.eq("outreachId", outreach._id))
        .first();
      if (existingProposal) {
        throw new Error(
          "The broker cannot change after a proposal has been filed",
        );
      }
    }
    const broker = await requireBrokerOrganization(ctx, args.brokerOrgId);
    if (!broker) throw new Error("Broker organization is required");
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
      if (!nextBrokerOrgId) throw new Error("Select a broker before a contact");
      const membership = await ctx.db
        .query("orgMemberships")
        .withIndex("organization_user", (q) =>
          q.eq("orgId", nextBrokerOrgId).eq("userId", args.contactUserId!),
        )
        .unique();
      if (!membership)
        throw new Error("Broker contact must belong to the selected broker");
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
    brokerRelease: args.brokerRelease ?? "hidden",
    clientVisible: args.clientVisible ?? false,
    createdByUserId: args.operatorUserId,
    updatedByUserId: args.operatorUserId,
    createdAt: now,
    updatedAt: now,
  });
  if (args.brokerRelease && args.brokerRelease !== "hidden")
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
  if (!item) throw new Error("Procurement file item not found");
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
      .query("procurementEmailThreads")
      .withIndex("request", (index) => index.eq("requestId", request._id))
      .order("desc")
      .take(MAX_EMAIL_THREADS);
    return rows.filter(activeEmailThread).slice(0, limit);
  }
  const rows = await ctx.db
    .query("procurementEmailThreads")
    .withIndex("organization", (index) =>
      index.eq("clientOrgId", args.clientOrgId),
    )
    .order("desc")
    .take(MAX_EMAIL_THREADS);
  return rows.filter(activeEmailThread).slice(0, limit);
}

export async function getProcurementEmailThreadDetails(
  ctx: Ctx,
  emailThreadId: Id<"procurementEmailThreads">,
) {
  const thread = await ctx.db.get(emailThreadId);
  if (!thread || thread.deletedAt) return null;
  const [request, addressedRequest, messages] = await Promise.all([
    requireRequest(ctx, thread.requestId),
    requireRequest(ctx, thread.addressedRequestId),
    ctx.db
      .query("procurementEmailMessages")
      .withIndex("thread", (index) => index.eq("threadId", thread._id))
      .collect(),
  ]);
  const hydratedMessages = await Promise.all(
    messages.map(async (message) => ({
      ...message,
      files: await Promise.all(
        message.clientFileIds.map(async (clientFileId) => {
          const file = await ctx.db.get(clientFileId);
          return file && !file.archivedAt && !file.deletedAt
            ? {
                clientFileId,
                name: file.name,
                contentType: file.contentType,
                size: file.size,
                url: await ctx.storage.getUrl(file.fileId),
              }
            : null;
        }),
      ),
    })),
  );
  return {
    thread,
    request: { requestId: request._id, title: request.title },
    addressedRequest: {
      requestId: addressedRequest._id,
      title: addressedRequest.title,
      forwardingAddress: requestForwardingAddress(addressedRequest),
    },
    messages: hydratedMessages,
  };
}

export async function previewProcurementEmailReconciliation(
  ctx: Ctx,
  emailThreadId: Id<"procurementEmailThreads">,
  selectedOutreachId?: Id<"procurementBrokerOutreaches">,
) {
  const thread = await ctx.db.get(emailThreadId);
  if (!thread || thread.deletedAt)
    throw new Error("Procurement email thread not found");
  const [request, messages, outreaches, proposals] = await Promise.all([
    requireRequest(ctx, thread.requestId),
    ctx.db
      .query("procurementEmailMessages")
      .withIndex("thread", (query) => query.eq("threadId", thread._id))
      .collect(),
    ctx.db
      .query("procurementBrokerOutreaches")
      .withIndex("request", (query) => query.eq("requestId", thread.requestId))
      .collect(),
    ctx.db
      .query("procurementProposals")
      .withIndex("request", (query) => query.eq("requestId", thread.requestId))
      .collect(),
  ]);
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
  const matchingOutreaches = eligibleOutreaches.filter(
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
      "Selected outreach must belong to this request and an external broker",
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
  const filable = !thread.archivedAt;
  return {
    emailThreadId: thread._id,
    filable,
    requestId: request._id,
    requestTitle: request.title,
    deepLink: `/operator/clients/${request.clientOrgId}/procurement/${request._id}?view=email`,
    category: thread.category,
    participantEmails: thread.participantEmails,
    messageCount: messages.length,
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

export const getEmailThread = query({
  args: { emailThreadId: v.id("procurementEmailThreads") },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    return await getProcurementEmailThreadDetails(ctx, args.emailThreadId);
  },
});

export const previewEmailReconciliation = query({
  args: {
    emailThreadId: v.id("procurementEmailThreads"),
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

export async function updateProcurementEmailThreadByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    emailThreadId: Id<"procurementEmailThreads">;
    category?: ProcurementEmailCategory;
    requestId?: Id<"procurementRequests">;
    source: "operator" | "agent" | "workspace_scan";
  },
) {
  await requireDirectOperatorWrite(ctx, args.operatorUserId);
  const thread = await ctx.db.get(args.emailThreadId);
  if (!thread || thread.deletedAt) {
    throw new Error("Procurement email thread not found");
  }
  const currentRequest = await requireRequest(ctx, thread.requestId);
  const patch: Partial<Doc<"procurementEmailThreads">> = {
    updatedAt: dayjs().valueOf(),
  };
  if (args.category !== undefined) {
    patch.category = args.category;
    patch.categorySource = "operator";
    patch.categoryReason = `Set manually through ${args.source}`;
  }
  if (args.requestId !== undefined && args.requestId !== thread.requestId) {
    const nextRequest = await requireRequest(ctx, args.requestId);
    if (nextRequest.clientOrgId !== thread.clientOrgId) {
      throw new Error("Email thread can move only within the same client");
    }
    patch.requestId = nextRequest._id;
    const messages = await ctx.db
      .query("procurementEmailMessages")
      .withIndex("thread", (index) => index.eq("threadId", thread._id))
      .collect();
    for (const message of messages) {
      const fileItems = await ctx.db
        .query("procurementFileItems")
        .withIndex("email", (index) =>
          index.eq("sourceEmailMessageId", message._id),
        )
        .collect();
      for (const fileItem of fileItems) {
        await ctx.db.patch(fileItem._id, {
          requestId: nextRequest._id,
          updatedByUserId: args.operatorUserId,
          updatedAt: dayjs().valueOf(),
        });
      }
    }
  }
  const fields = Object.keys(patch).filter((field) => field !== "updatedAt");
  if (fields.length === 0) throw new Error("No email thread fields changed");
  await ctx.db.patch(thread._id, patch);
  await writeOperatorAudit(ctx, {
    operatorUserId: args.operatorUserId,
    type: "setup_write",
    targetOrgId: thread.clientOrgId,
    summary: `Updated procurement email thread ${thread.subject}`,
    metadata: {
      domain: "procurement",
      requestId: patch.requestId ?? currentRequest._id,
      emailThreadId: thread._id,
      previousRequestId: currentRequest._id,
      nextRequestId: patch.requestId ?? currentRequest._id,
      fields,
      source: args.source,
    },
  });
  return { emailThreadId: thread._id, fields };
}

export const updateEmailThread = mutation({
  args: {
    emailThreadId: v.id("procurementEmailThreads"),
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
    if (!request) return null;
    const client = await ctx.db.get(request.clientOrgId);
    return client?.type === "client" ? { request, client } : null;
  },
});

const inboundAttachmentValidator = v.object({
  fileId: v.id("_storage"),
  filename: v.string(),
  contentType: v.string(),
  size: v.number(),
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
    if (args.resendEmailId) {
      const duplicate = await ctx.db
        .query("procurementEmailMessages")
        .withIndex("resend", (index) =>
          index.eq("resendEmailId", args.resendEmailId),
        )
        .first();
      if (duplicate) {
        await Promise.all(
          args.attachments.map((attachment) =>
            ctx.storage.delete(attachment.fileId),
          ),
        );
        return { duplicate: true as const, threadId: duplicate.threadId };
      }
    }
    if (args.messageId) {
      const duplicate = await ctx.db
        .query("procurementEmailMessages")
        .withIndex("message", (index) => index.eq("messageId", args.messageId))
        .first();
      if (duplicate) {
        await Promise.all(
          args.attachments.map((attachment) =>
            ctx.storage.delete(attachment.fileId),
          ),
        );
        return { duplicate: true as const, threadId: duplicate.threadId };
      }
    }

    const addressedRequest = await requireRequest(ctx, args.addressedRequestId);
    const normalizedSubject = normalizeProcurementSubject(args.subject);
    const participants = uniqueProcurementEmails(args.participantEmails);
    const referenceIds = Array.from(
      new Set(
        [args.inReplyTo ?? "", ...args.references]
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ).slice(0, 50);
    let thread: Doc<"procurementEmailThreads"> | null = null;
    for (const reference of referenceIds) {
      const parent = await ctx.db
        .query("procurementEmailMessages")
        .withIndex("message", (index) => index.eq("messageId", reference))
        .first();
      if (!parent) continue;
      const candidate = await ctx.db.get(parent.threadId);
      if (
        candidate?.clientOrgId === addressedRequest.clientOrgId &&
        !candidate.deletedAt
      ) {
        thread = candidate;
        break;
      }
    }
    if (!thread && normalizedSubject) {
      const candidates = await ctx.db
        .query("procurementEmailThreads")
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
            procurementParticipantsOverlap(
              candidate.participantEmails,
              participants,
            ),
        ) ?? null;
    }

    const requestId = thread?.requestId ?? addressedRequest._id;
    const [outreaches, clientMemberships, operatorProfiles] = await Promise.all(
      [
        ctx.db
          .query("procurementBrokerOutreaches")
          .withIndex("request", (index) => index.eq("requestId", requestId))
          .collect(),
        ctx.db
          .query("orgMemberships")
          .withIndex("organization", (index) =>
            index.eq("orgId", addressedRequest.clientOrgId),
          )
          .collect(),
        ctx.db.query("operatorProfiles").collect(),
      ],
    );
    const brokerEmails = outreaches.flatMap((outreach) =>
      outreach.contactEmail ? [outreach.contactEmail] : [],
    );
    const clientEmails = (
      await Promise.all(
        clientMemberships.map(
          async (membership) => (await ctx.db.get(membership.userId))?.email,
        ),
      )
    ).filter((email): email is string => Boolean(email));
    const operatorEmails = (
      await Promise.all(
        operatorProfiles
          .filter((profile) => profile.status === "active")
          .map(async (profile) => (await ctx.db.get(profile.userId))?.email),
      )
    ).filter((email): email is string => Boolean(email));
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
    let threadId: Id<"procurementEmailThreads">;
    if (thread) {
      threadId = thread._id;
      await ctx.db.patch(thread._id, {
        subject: requiredText(args.subject || "(no subject)", "Subject", 500),
        participantEmails: classificationParticipants,
        latestMessageAt: args.receivedAt,
        messageCount: thread.messageCount + 1,
        archivedAt: undefined,
        archivedByUserId: undefined,
        ...(thread.categorySource === "auto"
          ? {
              category: inferred.category,
              categoryReason: inferred.reason,
            }
          : {}),
        updatedAt: now,
      });
    } else {
      threadId = await ctx.db.insert("procurementEmailThreads", {
        clientOrgId: addressedRequest.clientOrgId,
        addressedRequestId: addressedRequest._id,
        requestId: addressedRequest._id,
        normalizedSubject,
        subject: requiredText(args.subject || "(no subject)", "Subject", 500),
        category: inferred.category,
        categorySource: "auto",
        categoryReason: inferred.reason,
        participantEmails: participants,
        latestMessageAt: args.receivedAt,
        messageCount: 1,
        createdAt: now,
        updatedAt: now,
      });
    }

    const storedClientFiles = await Promise.all(
      args.attachments.slice(0, 20).map((attachment) =>
        createClientFileFromProcurementEmail(ctx, {
          orgId: addressedRequest.clientOrgId,
          fileId: attachment.fileId,
          originalName: attachment.filename,
          contentType: attachment.contentType,
          size: attachment.size,
        }),
      ),
    );
    for (const stored of storedClientFiles) {
      if (!stored.created) continue;
      await ctx.scheduler.runAfter(0, internal.actions.clientFileNaming.infer, {
        clientFileId: stored.clientFileId,
        expectedUpdatedAt: stored.expectedUpdatedAt,
        hint: boundedClientFileHint(args.subject),
      });
    }
    const clientFileIds: Id<"clientFiles">[] = storedClientFiles.map(
      (stored) => stored.clientFileId,
    );
    const emailMessageId = await ctx.db.insert("procurementEmailMessages", {
      threadId,
      clientOrgId: addressedRequest.clientOrgId,
      addressedRequestId: addressedRequest._id,
      resendEmailId: optionalText(args.resendEmailId, 500),
      messageId: optionalText(args.messageId, 500),
      inReplyTo: optionalText(args.inReplyTo, 500),
      references: args.references
        .map((value) => value.slice(0, 500))
        .slice(0, 50),
      subject: requiredText(args.subject || "(no subject)", "Subject", 500),
      fromName: optionalText(args.fromName, 300),
      fromEmail: normalizeProcurementEmail(args.fromEmail),
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
    for (const clientFileId of clientFileIds) {
      const file = await ctx.db.get(clientFileId);
      if (!file) continue;
      await ctx.db.insert("procurementFileItems", {
        requestId,
        clientOrgId: addressedRequest.clientOrgId,
        clientFileId,
        sourceEmailMessageId: emailMessageId,
        label: file.name,
        createdAt: now,
        updatedAt: now,
      });
    }
    return {
      duplicate: false as const,
      threadId,
      emailMessageId,
      clientFileIds,
    };
  },
});
