import { clientIdentity, clientIdentityMatches } from "./lib/clientProfile";
import { scheduleCompanyResearch } from "./companyResearch";
import dayjs from "dayjs";
import { assertExternalBrokerIdentity } from "./lib/brokerProfileValidation";
import { v } from "convex/values";
import { createAccount, getAuthUserId } from "@convex-dev/auth/server";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { buildEmailShell, escapeHtml } from "./lib/emailTemplate";
import { getAuthFromAddress, sendResendEmail } from "./lib/resend";
import { getAuthSiteUrl } from "./lib/domains";
import { normalizeCoverageName } from "./lib/coverageNames";
import {
  findUserByNormalizedPhone,
  normalizeAvailableUserPhone,
  normalizeUserPhone,
} from "./lib/userPhone";
import {
  assertFeatureFlagAllowedForOrg,
  setFeatureFlagPatch,
} from "./lib/featureFlags";
import {
  assertCustomerUser,
  isBootstrapOperatorEmail,
  bootstrapOperatorUser,
  operatorEmailAliases,
  requireOperator,
  requireOperatorForUser,
  writeOperatorAudit,
} from "./lib/operatorIdentity";
import { parseStandaloneEmailAddress } from "./lib/emailAddress";
import { orgBrandFields } from "./lib/orgBranding";
import { assertNoOperatorImpersonation } from "./lib/clientFiles";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "./lib/userFacingErrors";

const clientStatusValidator = v.union(
  v.literal("onboarding"),
  v.literal("live"),
  v.literal("lost"),
  v.literal("churned"),
);
const orgRoleValidator = v.union(v.literal("admin"), v.literal("member"));
const operatorClientUserValidator = v.object({
  email: v.string(),
  name: v.optional(v.string()),
  phone: v.optional(v.string()),
  role: orgRoleValidator,
});
const extractionTraceStatusValidator = v.union(
  v.literal("running"),
  v.literal("complete"),
  v.literal("error"),
  v.literal("cancelled"),
);
const internalApi = internal as any;
const OPERATOR_TRACE_EVENT_LIMIT = 500;
const OPERATOR_POLICY_ARTIFACT_COUNT_LIMIT = 1_000;
const OPERATOR_CLIENT_USER_LIMIT = 25;
const CANCELLED_BY_USER = "Cancelled by user";

function normalizeClientUserEmail(value: string) {
  const email = parseStandaloneEmailAddress(value);
  if (!email || isBootstrapOperatorEmail(email)) {
    throw new Error("Every client user must have a valid customer email");
  }
  return email;
}

type OperatorSourceNode = Doc<"sourceNodes">;

async function assertNoActiveOperatorImpersonationForPolicyWrite(
  ctx: QueryCtx | MutationCtx,
  operatorUserId: Id<"users">,
) {
  const activeImpersonation = await ctx.db
    .query("operatorImpersonationSessions")
    .withIndex("operator_status", (q) =>
      q.eq("operatorUserId", operatorUserId).eq("status", "active"),
    )
    .first();
  if (activeImpersonation) {
    throw new Error(
      "Policy management is read-only during active impersonation.",
    );
  }
}

function normalizeSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "");
}

function slugFromName(name: string) {
  return normalizeSlug(name.trim().replace(/\s+/g, "-"));
}

function normalizeWebsiteUrl(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

async function clearOperatorExtractionQueue(
  ctx: MutationCtx,
  policyId: Id<"policies">,
) {
  const rows = await ctx.db
    .query("policyExtractionQueue")
    .withIndex("policy", (q) => q.eq("policyId", policyId))
    .collect();
  for (const row of rows) await ctx.db.delete(row._id);
}

async function clearOperatorExtractionArtifacts(
  ctx: MutationCtx,
  policyId: Id<"policies">,
) {
  const artifacts = await ctx.db
    .query("policyExtractionArtifacts")
    .withIndex("policy", (q) => q.eq("policyId", policyId))
    .collect();
  for (const artifact of artifacts) {
    await ctx.storage.delete(artifact.storageId).catch(() => {});
    await ctx.db.delete(artifact._id);
  }
}

function appendExtractionStopLog(
  log: Doc<"policyExtractionRuns">["pipelineLog"],
  timestamp: number,
) {
  return [
    ...(Array.isArray(log) ? log : []),
    {
      timestamp,
      message: "Extraction stopped by operator",
      phase: "cancel",
      level: "warn",
    },
  ].slice(-200);
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      )
    : [];
}

function sourceNodeText(node: OperatorSourceNode) {
  return node.textExcerpt || node.description || node.title;
}

function normalizeCoverageContextText(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s+[|/:-]+$/g, "")
    .trim();
}

function operatorCoverageName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = normalizeCoverageName(value);
  if (!name) return undefined;
  if (
    /^(?:limit of liability|deductible|retroactive date|aggregate|claim|proceeding|source)$/i.test(
      name,
    )
  )
    return undefined;
  if (
    /\$[\d,.]+/.test(name) &&
    /\b(?:limit|liability|deductible|aggregate|claim|policy)\b/i.test(name)
  )
    return undefined;
  return name;
}

function coverageSourceContext(
  coverage: Record<string, unknown>,
  node: OperatorSourceNode | undefined,
  children: OperatorSourceNode[],
) {
  if (!node) return undefined;
  const excluded = new Set(
    [coverage.name, coverage.limit, coverage.deductible, coverage.premium]
      .map((value) =>
        typeof value === "string"
          ? normalizeCoverageContextText(value).toLowerCase()
          : "",
      )
      .filter(Boolean),
  );
  const cells = children
    .filter((child) => child.kind === "table_cell")
    .sort((left, right) => left.order - right.order);
  const contextCells = cells
    .map((cell) => ({
      label: normalizeCoverageContextText(cell.title),
      value: normalizeCoverageContextText(sourceNodeText(cell)),
    }))
    .filter((cell) => {
      if (!cell.value || excluded.has(cell.value.toLowerCase())) return false;
      if (
        /^\$?[\d,.]+(?:\s*\/\s*\$?[\d,.]+)?(?:\s*\([^)]*\))?$/i.test(cell.value)
      )
        return false;
      if (
        /^(each claim limit|aggregate limit|deductible|premium|retroactive date)$/i.test(
          cell.label,
        )
      )
        return false;
      return true;
    });
  const preferred =
    contextCells.find((cell) =>
      /\b(coverage|part|class|description|item|subject|type|column 1)\b/i.test(
        cell.label,
      ),
    ) ?? contextCells[0];
  if (preferred) {
    return preferred.label && !/^column\s+\d+$/i.test(preferred.label)
      ? `${preferred.label}: ${preferred.value}`
      : preferred.value;
  }
  const rowText = normalizeCoverageContextText(node.textExcerpt ?? "");
  return rowText || undefined;
}

async function policyWithOperatorCoverageContext(
  ctx: QueryCtx,
  policy: Doc<"policies"> | null,
) {
  const profile = recordValue(policy?.operationalProfile);
  const coverages = Array.isArray(profile?.coverages)
    ? profile.coverages
        .map(recordValue)
        .filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
  if (!policy || !profile || coverages.length === 0) return policy;

  const coverageNodeIds = [
    ...new Set(
      coverages.flatMap((coverage) => stringArray(coverage.sourceNodeIds)),
    ),
  ].slice(0, 80);
  if (coverageNodeIds.length === 0) return policy;

  const nodeEntries = await Promise.all(
    coverageNodeIds.map(async (nodeId) => {
      const node = await ctx.db
        .query("sourceNodes")
        .withIndex("policy_node", (q) =>
          q.eq("policyId", policy._id).eq("nodeId", nodeId),
        )
        .first();
      const children = node
        ? await ctx.db
            .query("sourceNodes")
            .withIndex("policy_parent", (q) =>
              q.eq("policyId", policy._id).eq("parentNodeId", node.nodeId),
            )
            .collect()
        : [];
      return [nodeId, { node, children }] as const;
    }),
  );
  const nodesById = new Map(nodeEntries);
  return {
    ...policy,
    operationalProfile: {
      ...profile,
      coverages: coverages.map((coverage) => {
        const nodeId = stringArray(coverage.sourceNodeIds)[0];
        const entry = nodeId ? nodesById.get(nodeId) : undefined;
        const context = coverageSourceContext(
          coverage,
          entry?.node ?? undefined,
          entry?.children ?? [],
        );
        const name =
          operatorCoverageName(coverage.name) ?? operatorCoverageName(context);
        return name ? { ...coverage, name } : coverage;
      }),
    },
  };
}

async function getOrgAdmin(ctx: QueryCtx, orgId: Id<"organizations">) {
  const memberships = await ctx.db
    .query("orgMemberships")
    .withIndex("organization", (q) => q.eq("orgId", orgId))
    .take(20);
  const adminMembership = memberships.find(
    (membership) => membership.role === "admin",
  );
  return adminMembership ? await ctx.db.get(adminMembership.userId) : null;
}

export const bootstrapViewer = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    return bootstrapOperatorUser(ctx, userId);
  },
});

export const current = query({
  args: {},
  handler: async (ctx) => {
    const operator = await requireOperator(ctx);
    const activeImpersonation = await ctx.db
      .query("operatorImpersonationSessions")
      .withIndex("operator_status", (q) =>
        q.eq("operatorUserId", operator.userId).eq("status", "active"),
      )
      .first();
    const targetOrg = activeImpersonation
      ? await ctx.db.get(activeImpersonation.targetOrgId)
      : null;
    const loginEmails = operatorEmailAliases(operator.user.email);
    return {
      user: {
        _id: operator.user._id,
        name: operator.user.name,
        email: operator.user.email,
        loginEmails: loginEmails.length
          ? loginEmails
          : [operator.user.email].filter((email): email is string => !!email),
        phone: operator.user.phone,
      },
      profile: operator.profile,
      activeImpersonation:
        activeImpersonation && targetOrg
          ? {
              ...activeImpersonation,
              targetOrgName: targetOrg.name,
              targetOrgType: targetOrg.type ?? "client",
              targetOrgOperatorStatus: targetOrg.operatorStatus ?? "live",
            }
          : null,
    };
  },
});

export async function getOperatorAgentSettings(ctx: QueryCtx | MutationCtx) {
  return ctx.db
    .query("operatorAgentSettings")
    .withIndex("key", (q) => q.eq("key", "default"))
    .unique();
}

export const getAgentSettings = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    const settings = await getOperatorAgentSettings(ctx);
    return { approveAll: settings?.approveAll === true };
  },
});

export const setApproveAll = mutation({
  args: { approveAll: v.boolean() },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const impersonation = await ctx.db
      .query("operatorImpersonationSessions")
      .withIndex("operator_status", (q) =>
        q.eq("operatorUserId", operator.userId).eq("status", "active"),
      )
      .first();
    if (impersonation) {
      throw new Error("Stop impersonating before changing approval settings.");
    }
    const settings = await getOperatorAgentSettings(ctx);
    const patch = {
      approveAll: args.approveAll,
      updatedBy: operator.userId,
      updatedAt: dayjs().valueOf(),
    };
    if (settings) await ctx.db.patch(settings._id, patch);
    else
      await ctx.db.insert("operatorAgentSettings", {
        key: "default",
        ...patch,
      });
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      summary: `${args.approveAll ? "Enabled" : "Disabled"} Approve all for all operator agent actions`,
      metadata: { approveAll: args.approveAll },
    });
  },
});

async function listOperatorClientRows(ctx: QueryCtx) {
  const clients = await ctx.db
    .query("organizations")
    .withIndex("deletion_type", (q) =>
      q.eq("deletedAt", undefined).eq("type", "client"),
    )
    .take(500);
  return await Promise.all(
    clients.map(async (client) => {
      const admin = await getOrgAdmin(ctx, client._id);
      return {
        _id: client._id,
        name: client.name,
        ...(await orgBrandFields(ctx, client)),
        agentHandle: client.agentHandle,
        operatorStatus: client.operatorStatus ?? "live",
        onboardingComplete: client.onboardingComplete,
        primaryContactName: client.primaryContactName,
        primaryContactEmail: client.primaryContactEmail,
        primaryContactPhone: client.primaryContactPhone,
        featureFlags: client.featureFlags,
        adminUserId: admin?._id,
        adminName: admin?.name,
        adminEmail: admin?.email,
        adminPhone: admin?.phone,
        createdAt: client._creationTime,
      };
    }),
  );
}

export const listClients = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    return await listOperatorClientRows(ctx);
  },
});

export const getClientSupportDetails = query({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const client = await ctx.db.get(args.clientOrgId);
    if (!client || client.deletedAt !== undefined || client.type !== "client")
      return null;
    return {
      ...client,
      ...(await orgBrandFields(ctx, client)),
    };
  },
});

export const listPublicDemoSalesTranscripts = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 200), 500));
    return await ctx.db
      .query("publicDemoSalesTranscripts")
      .withIndex("updated")
      .order("desc")
      .take(limit);
  },
});

export const getPublicDemoSalesTranscript = query({
  args: { id: v.id("publicDemoSalesTranscripts") },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const transcript = await ctx.db.get(args.id);
    if (!transcript) return null;
    const conversation = await ctx.db.get(transcript.conversationId);
    const logs = await ctx.db
      .query("publicDemoChatLogs")
      .withIndex("conversation_created", (q) =>
        q.eq("conversationId", transcript.conversationId),
      )
      .order("asc")
      .take(200);
    return { transcript, conversation, logs };
  },
});

export const deletePublicDemoSalesTranscript = mutation({
  args: { id: v.id("publicDemoSalesTranscripts") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const transcript = await ctx.db.get(args.id);
    if (!transcript) return { deleted: false, deletedLogs: 0 };

    const [logs, transcripts] = await Promise.all([
      ctx.db
        .query("publicDemoChatLogs")
        .withIndex("conversation_created", (q) =>
          q.eq("conversationId", transcript.conversationId),
        )
        .collect(),
      ctx.db
        .query("publicDemoSalesTranscripts")
        .withIndex("conversation", (q) =>
          q.eq("conversationId", transcript.conversationId),
        )
        .collect(),
    ]);

    for (const log of logs) await ctx.db.delete(log._id);
    for (const relatedTranscript of transcripts) {
      await ctx.db.delete(relatedTranscript._id);
    }
    const conversation = await ctx.db.get(transcript.conversationId);
    if (conversation) await ctx.db.delete(conversation._id);

    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "demo_lead_deleted",
      summary: "Deleted a public demo lead and its chat history",
      metadata: {
        conversationId: transcript.conversationId,
        transcriptId: transcript._id,
        deletedLogs: logs.length,
      },
    });

    return { deleted: true, deletedLogs: logs.length };
  },
});

export const listExtractionTraces = query({
  args: {
    status: v.optional(extractionTraceStatusValidator),
    orgId: v.optional(v.id("organizations")),
    policyId: v.optional(v.id("policies")),
    dateFrom: v.optional(v.number()),
    dateTo: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 200), 500));
    const sessions = args.policyId
      ? await ctx.db
          .query("policyExtractionTraceSessions")
          .withIndex("policy_started", (q) => {
            const byPolicy = q.eq("policyId", args.policyId!);
            if (args.dateFrom !== undefined && args.dateTo !== undefined)
              return byPolicy
                .gte("startedAt", args.dateFrom)
                .lte("startedAt", args.dateTo);
            if (args.dateFrom !== undefined)
              return byPolicy.gte("startedAt", args.dateFrom);
            if (args.dateTo !== undefined)
              return byPolicy.lte("startedAt", args.dateTo);
            return byPolicy;
          })
          .order("desc")
          .take(limit)
      : args.orgId
        ? await ctx.db
            .query("policyExtractionTraceSessions")
            .withIndex("organization_started", (q) => {
              const byOrg = q.eq("orgId", args.orgId!);
              if (args.dateFrom !== undefined && args.dateTo !== undefined)
                return byOrg
                  .gte("startedAt", args.dateFrom)
                  .lte("startedAt", args.dateTo);
              if (args.dateFrom !== undefined)
                return byOrg.gte("startedAt", args.dateFrom);
              if (args.dateTo !== undefined)
                return byOrg.lte("startedAt", args.dateTo);
              return byOrg;
            })
            .order("desc")
            .take(limit)
        : args.status
          ? await ctx.db
              .query("policyExtractionTraceSessions")
              .withIndex("status_started", (q) => {
                const byStatus = q.eq("status", args.status!);
                if (args.dateFrom !== undefined && args.dateTo !== undefined)
                  return byStatus
                    .gte("startedAt", args.dateFrom)
                    .lte("startedAt", args.dateTo);
                if (args.dateFrom !== undefined)
                  return byStatus.gte("startedAt", args.dateFrom);
                if (args.dateTo !== undefined)
                  return byStatus.lte("startedAt", args.dateTo);
                return byStatus;
              })
              .order("desc")
              .take(limit)
          : await ctx.db
              .query("policyExtractionTraceSessions")
              .withIndex("started", (q) => {
                if (args.dateFrom !== undefined && args.dateTo !== undefined)
                  return q
                    .gte("startedAt", args.dateFrom)
                    .lte("startedAt", args.dateTo);
                if (args.dateFrom !== undefined)
                  return q.gte("startedAt", args.dateFrom);
                if (args.dateTo !== undefined)
                  return q.lte("startedAt", args.dateTo);
                return q;
              })
              .order("desc")
              .take(limit);
    const filtered = sessions
      .filter((session) => !args.status || session.status === args.status)
      .filter((session) => !args.policyId || session.policyId === args.policyId)
      .filter(
        (session) =>
          args.dateFrom === undefined || session.startedAt >= args.dateFrom!,
      )
      .filter(
        (session) =>
          args.dateTo === undefined || session.startedAt <= args.dateTo!,
      )
      .slice(0, limit);

    const orgIds = Array.from(
      new Set(filtered.map((session) => session.orgId)),
    );
    const orgRows = await Promise.all(
      orgIds.map(async (orgId) => {
        const org = await ctx.db.get(orgId);
        return [orgId, org] as const;
      }),
    );
    const orgsById = new Map(orgRows);

    return filtered.map((session) => {
      const org = orgsById.get(session.orgId);
      const policyLabel = session.fileName ?? "Extraction trace";
      return {
        _id: session._id,
        _creationTime: session._creationTime,
        traceId: session.traceId,
        policyId: session.policyId,
        orgId: session.orgId,
        userId: session.userId,
        sourceKind: session.sourceKind,
        trigger: session.trigger,
        fileName: session.fileName,
        status: session.status,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        lastEventAt: session.lastEventAt,
        totalDurationMs: session.totalDurationMs,
        modelCallCount: session.modelCallCount,
        modelDurationMs: session.modelDurationMs,
        inputTokens: session.inputTokens,
        outputTokens: session.outputTokens,
        slowestLabel: session.slowestLabel,
        slowestKind: session.slowestKind,
        slowestDurationMs: session.slowestDurationMs,
        error: session.error,
        expiresAt: session.expiresAt,
        updatedAt: session.updatedAt,
        orgName: org?.name ?? "Unknown org",
        orgType: org?.type ?? "client",
        policyLabel,
        documentType: session.sourceKind ?? "policy",
      };
    });
  },
});

function boundedArtifactCount(rows: unknown[]) {
  const capped = rows.length > OPERATOR_POLICY_ARTIFACT_COUNT_LIMIT;
  return {
    count: capped ? OPERATOR_POLICY_ARTIFACT_COUNT_LIMIT : rows.length,
    capped,
  };
}

export const getPolicyExtractionOperations = query({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const policy = await ctx.db.get(args.policyId);
    if (!policy) return null;

    const takeCount = OPERATOR_POLICY_ARTIFACT_COUNT_LIMIT + 1;
    const [
      run,
      queue,
      previewQueue,
      sourceSpans,
      sourceNodes,
      documentChunks,
      policyFiles,
      artifacts,
      versions,
      latestTrace,
    ] = await Promise.all([
      ctx.db
        .query("policyExtractionRuns")
        .withIndex("policy", (q) => q.eq("policyId", args.policyId))
        .first(),
      ctx.db
        .query("policyExtractionQueue")
        .withIndex("policy", (q) => q.eq("policyId", args.policyId))
        .first(),
      ctx.db
        .query("policyExtractionPreviewQueue")
        .withIndex("policy", (q) => q.eq("policyId", args.policyId))
        .first(),
      ctx.db
        .query("sourceSpans")
        .withIndex("policy", (q) => q.eq("policyId", args.policyId))
        .take(takeCount),
      ctx.db
        .query("sourceNodes")
        .withIndex("policy", (q) => q.eq("policyId", args.policyId))
        .take(takeCount),
      ctx.db
        .query("documentChunks")
        .withIndex("policy", (q) => q.eq("policyId", args.policyId))
        .take(takeCount),
      ctx.db
        .query("policyFiles")
        .withIndex("policy", (q) => q.eq("policyId", args.policyId))
        .take(takeCount),
      ctx.db
        .query("policyExtractionArtifacts")
        .withIndex("policy", (q) => q.eq("policyId", args.policyId))
        .take(takeCount),
      ctx.db
        .query("policyVersions")
        .withIndex("policy", (q) => q.eq("policyId", args.policyId))
        .take(takeCount),
      ctx.db
        .query("policyExtractionTraceSessions")
        .withIndex("policy_started", (q) => q.eq("policyId", args.policyId))
        .order("desc")
        .first(),
    ]);

    return {
      policyId: policy._id,
      orgId: policy.orgId,
      run: run
        ? {
            pipelineStatus: run.pipelineStatus,
            pipelineError: run.pipelineError,
            pipelineCheckpoint: run.pipelineCheckpoint,
            createdAt: run.createdAt,
            updatedAt: run.updatedAt,
          }
        : null,
      queue: queue
        ? {
            status: queue.status,
            leaseExpiresAt: queue.leaseExpiresAt,
            heartbeatAt: queue.heartbeatAt,
            updatedAt: queue.updatedAt,
          }
        : null,
      previewQueue: previewQueue
        ? {
            status: previewQueue.status,
            leaseExpiresAt: previewQueue.leaseExpiresAt,
            heartbeatAt: previewQueue.heartbeatAt,
            updatedAt: previewQueue.updatedAt,
          }
        : null,
      counts: {
        sourceSpans: boundedArtifactCount(sourceSpans),
        sourceNodes: boundedArtifactCount(sourceNodes),
        documentChunks: boundedArtifactCount(documentChunks),
        policyFiles: boundedArtifactCount(policyFiles),
        artifacts: boundedArtifactCount(artifacts),
        versions: boundedArtifactCount(versions),
      },
      artifactKinds: artifacts.map((artifact) => artifact.kind),
      latestTrace: latestTrace
        ? {
            traceId: latestTrace.traceId,
            status: latestTrace.status,
            startedAt: latestTrace.startedAt,
            completedAt: latestTrace.completedAt,
            error: latestTrace.error,
          }
        : null,
    };
  },
});

export const getExtractionTrace = query({
  args: { traceId: v.string() },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const session = await ctx.db
      .query("policyExtractionTraceSessions")
      .withIndex("trace", (q) => q.eq("traceId", args.traceId))
      .first();
    if (!session) return null;
    const [org, rawPolicy, eventsWithExtra] = await Promise.all([
      ctx.db.get(session.orgId),
      ctx.db.get(session.policyId),
      ctx.db
        .query("policyExtractionTraceEvents")
        .withIndex("trace_time", (q) => q.eq("traceId", args.traceId))
        .order("asc")
        .take(OPERATOR_TRACE_EVENT_LIMIT + 1),
    ]);
    const policy = await policyWithOperatorCoverageContext(ctx, rawPolicy);
    const eventsTruncated = eventsWithExtra.length > OPERATOR_TRACE_EVENT_LIMIT;
    const events = eventsWithExtra.slice(0, OPERATOR_TRACE_EVENT_LIMIT);
    const fileUrl = policy?.fileId
      ? await ctx.storage.getUrl(policy.fileId)
      : null;
    return {
      session: {
        ...session,
        orgName: org?.name ?? "Unknown org",
        orgType: org?.type ?? "client",
        policyLabel: policy
          ? [
              policy.carrier && policy.carrier !== "Extracting..."
                ? policy.carrier
                : null,
              policy.policyNumber && policy.policyNumber !== "Extracting..."
                ? policy.policyNumber
                : null,
            ]
              .filter(Boolean)
              .join(" · ") ||
            policy.fileName ||
            "Extracting..."
          : "Deleted policy",
        fileName: session.fileName ?? policy?.fileName,
        documentType: policy?.documentType ?? "policy",
      },
      policy,
      eventsTruncated,
      fileUrl,
      events,
    };
  },
});

export const rerunExtraction = action({
  args: { policyId: v.id("policies") },
  handler: async (
    ctx,
    args,
  ): Promise<{ success: boolean; traceId?: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    const access = (await ctx.runQuery(
      internalApi.operator.requireOperatorPolicyWriteForUserInternal,
      {
        userId,
        policyId: args.policyId,
      },
    )) as { pipelineStatus?: string };
    if (
      access.pipelineStatus === "running" ||
      access.pipelineStatus === "paused"
    ) {
      throw new Error("An extraction is already running for this policy.");
    }

    const result = (await ctx.runAction(
      internalApi.actions.policyExtraction.retryPolicyExtraction,
      {
        policyId: args.policyId,
        mode: "full",
      },
    )) as { success?: boolean; traceId?: string } | undefined;
    await ctx.runMutation(
      internalApi.operator.recordPolicyExtractionOperationInternal,
      {
        operatorUserId: userId,
        policyId: args.policyId,
        operation: "full_extraction",
        metadata: result?.traceId ? { traceId: result.traceId } : undefined,
      },
    );
    return { success: true, traceId: result?.traceId };
  },
});

export const rerunSupplementaryExtraction = action({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    const access = (await ctx.runQuery(
      internalApi.operator.requireOperatorPolicyWriteForUserInternal,
      {
        userId,
        policyId: args.policyId,
      },
    )) as { pipelineStatus?: string };
    if (access.pipelineStatus !== "complete") {
      throw new Error(
        "Supplementary extraction requires a complete policy extraction.",
      );
    }
    const result = await ctx.runAction(
      internalApi.actions.extractSupplementary.extractOne,
      { policyId: args.policyId, force: true },
    );
    await ctx.runMutation(
      internalApi.operator.recordPolicyExtractionOperationInternal,
      {
        operatorUserId: userId,
        policyId: args.policyId,
        operation: "supplementary_extraction",
        metadata: result,
      },
    );
    return result;
  },
});

export const rebuildPolicySearchIndex = action({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    const access = (await ctx.runQuery(
      internalApi.operator.requireOperatorPolicyWriteForUserInternal,
      { userId, policyId: args.policyId },
    )) as { orgId: Id<"organizations">; pipelineStatus?: string };
    if (access.pipelineStatus !== "complete") {
      throw new Error("Search indexing requires a complete policy extraction.");
    }
    const result = await ctx.runAction(
      internalApi.actions.rechunkPolicy.rechunkOne,
      { policyId: args.policyId, orgId: access.orgId },
    );
    await ctx.runMutation(
      internalApi.operator.recordPolicyExtractionOperationInternal,
      {
        operatorUserId: userId,
        policyId: args.policyId,
        operation: "search_index",
        metadata: result,
      },
    );
    return result;
  },
});

export const stopExtraction = mutation({
  args: { traceId: v.string() },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const session = await ctx.db
      .query("policyExtractionTraceSessions")
      .withIndex("trace", (q) => q.eq("traceId", args.traceId))
      .first();
    if (!session) throw new Error("Extraction trace not found");
    await assertNoActiveOperatorImpersonationForPolicyWrite(
      ctx,
      operator.userId,
    );
    if (session.status !== "running") {
      return { success: true, stopped: false };
    }

    const timestamp = dayjs().valueOf();
    const policy = await ctx.db.get(session.policyId);
    const run = await ctx.db
      .query("policyExtractionRuns")
      .withIndex("policy", (q) => q.eq("policyId", session.policyId))
      .first();

    if (run) {
      await ctx.db.patch(run._id, {
        pipelineStatus: "error",
        pipelineError: CANCELLED_BY_USER,
        pipelineCheckpoint: undefined,
        pipelineLog: appendExtractionStopLog(run.pipelineLog, timestamp),
        updatedAt: timestamp,
      });
    }
    await clearOperatorExtractionQueue(ctx, session.policyId);
    await clearOperatorExtractionArtifacts(ctx, session.policyId);

    if (policy) {
      await ctx.db.patch(session.policyId, {
        pipelineStatus: "error",
        pipelineError: CANCELLED_BY_USER,
        pipelineCheckpoint: undefined,
        pipelineLog: undefined,
      });
      await ctx.db.insert("policyAuditLog", {
        policyId: session.policyId,
        userId: operator.userId,
        orgId: policy.orgId,
        action: "operator_cancelled_extraction",
        detail: args.traceId,
      });
    }

    await ctx.db.patch(session._id, {
      status: "cancelled",
      completedAt: timestamp,
      lastEventAt: timestamp,
      totalDurationMs: timestamp - session.startedAt,
      error: CANCELLED_BY_USER,
      updatedAt: timestamp,
    });
    await ctx.db.insert("policyExtractionTraceEvents", {
      traceId: session.traceId,
      policyId: session.policyId,
      orgId: session.orgId,
      kind: "session",
      timestamp,
      status: "cancelled",
      message: "Extraction stopped by operator",
      error: CANCELLED_BY_USER,
      durationMs: timestamp - session.startedAt,
      expiresAt: session.expiresAt,
    });
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      targetOrgId: session.orgId,
      summary: "Stopped a policy extraction",
      metadata: {
        domain: "policies",
        policyId: session.policyId,
        traceId: session.traceId,
        operation: "stop_extraction",
      },
    });

    return { success: true, stopped: true };
  },
});

export const createSoloClient = action({
  args: {
    name: v.string(),
    website: v.optional(v.string()),
    users: v.array(operatorClientUserValidator),
  },
  handler: async (ctx, args): Promise<{ clientOrgId: Id<"organizations"> }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    await ctx.runQuery(internalApi.operator.requireOperatorForUserInternal, {
      userId,
    });

    const users = args.users.map((user) => ({
      email: normalizeClientUserEmail(user.email),
      name: user.name?.trim() || undefined,
      phone: user.phone?.trim() || undefined,
      role: user.role,
    }));
    if (users.length > OPERATOR_CLIENT_USER_LIMIT) {
      throw new Error(`Add at most ${OPERATOR_CLIENT_USER_LIMIT} client users`);
    }
    if (users.length > 0 && !users.some((user) => user.role === "admin")) {
      throw new Error("At least one client user must be an admin");
    }
    const emails = new Set<string>();
    const phones = new Set<string>();
    for (const user of users) {
      if (emails.has(user.email)) {
        throw new Error("Use a different email for each client user");
      }
      emails.add(user.email);

      const normalizedPhone = normalizeUserPhone(user.phone);
      if (normalizedPhone && phones.has(normalizedPhone)) {
        throw new Error("Use a different phone number for each client user");
      }
      if (normalizedPhone) phones.add(normalizedPhone);
    }
    await ctx.runQuery(internalApi.operator.validateSoloClientUsersInternal, {
      users: users.map(({ email, phone }) => ({ email, phone })),
    });

    const now = dayjs().valueOf();
    const provisionedUsers: Array<{
      userId: Id<"users">;
      email: string;
      name?: string;
      phone?: string;
      role: "admin" | "member";
    }> = [];
    for (const user of users) {
      const account = await createAccount(ctx, {
        provider: "resend-otp",
        account: { id: user.email },
        profile: {
          email: user.email,
          name: user.name,
          accountKind: "customer",
          emailVerificationTime: now,
          onboardingComplete: true,
        },
        shouldLinkViaEmail: true,
      });
      if (!account.user)
        throw new Error(`Could not create client user ${user.email}`);
      provisionedUsers.push({
        userId: account.user._id,
        email: user.email,
        name: user.name ?? (account.user.name?.trim() || undefined),
        phone: user.phone ?? account.user.phone,
        role: user.role,
      });
    }

    const website = normalizeWebsiteUrl(args.website);
    const result = await ctx.runMutation(
      internalApi.operator.createSoloClientInternal,
      {
        operatorUserId: userId,
        users: provisionedUsers,
        client: {
          name: args.name,
          website,
        },
      },
    );
    return result;
  },
});

export const createClientWithoutUsersForAgentInternal = internalAction({
  args: {
    operatorUserId: v.id("users"),
    name: v.string(),
    website: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.runQuery(internalApi.operator.requireOperatorForUserInternal, {
      userId: args.operatorUserId,
    });
    const website = normalizeWebsiteUrl(args.website);
    const result = await ctx.runMutation(
      internalApi.operator.createSoloClientInternal,
      {
        operatorUserId: args.operatorUserId,
        users: [],
        client: { name: args.name, website },
      },
    );
    return {
      ...result,
      deepLink: `/operator/clients/${result.clientOrgId}`,
      nextActions: [
        {
          tool: "create_procurement_request" as const,
          why: "Create the procurement request against this exact standalone client",
          input: { orgId: result.clientOrgId },
        },
      ],
    };
  },
});

export const setSoloClientStatus = mutation({
  args: {
    clientOrgId: v.id("organizations"),
    status: clientStatusValidator,
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await assertNoOperatorImpersonation(ctx, operator.userId);
    const client = await ctx.db.get(args.clientOrgId);
    if (!client || client.deletedAt !== undefined || client.type !== "client")
      throw new Error("Client not found");
    const previous = client.operatorStatus ?? "live";
    await ctx.db.patch(args.clientOrgId, { operatorStatus: args.status });
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "client_status_changed",
      targetOrgId: args.clientOrgId,
      summary: `${client.name} changed from ${previous} to ${args.status}`,
      metadata: { previous, next: args.status },
    });
  },
});

export const setClientFeatureFlag = mutation({
  args: {
    clientOrgId: v.id("organizations"),
    flagId: v.union(
      v.literal("connect_features"),
      v.literal("imessage_app_cards"),
    ),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const client = await ctx.db.get(args.clientOrgId);
    if (!client || client.deletedAt !== undefined || client.type !== "client")
      throw new Error("Client not found");
    assertFeatureFlagAllowedForOrg(args.flagId, client);
    await ctx.db.patch(args.clientOrgId, {
      featureFlags: setFeatureFlagPatch(
        client.featureFlags,
        args.flagId,
        args.enabled,
      ),
    });
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      targetOrgId: args.clientOrgId,
      summary: `Updated ${args.flagId} for ${client.name}`,
      metadata: { flagId: args.flagId, enabled: args.enabled },
    });
  },
});

export const updateClientSettings = mutation({
  args: {
    clientOrgId: v.id("organizations"),
    name: v.optional(v.string()),
    website: v.optional(v.string()),
    iconStorageId: v.optional(v.union(v.id("_storage"), v.null())),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await assertNoOperatorImpersonation(ctx, operator.userId);
    const client = await ctx.db.get(args.clientOrgId);
    if (!client || client.deletedAt !== undefined || client.type !== "client")
      throw new Error("Client not found");
    const identity = args.name !== undefined ? clientIdentity(args.name) : null;
    const name = identity?.name ?? client.name;
    if (!name) throw new Error("Organization name is required");

    if (args.iconStorageId) {
      const file = await ctx.db.system.get(args.iconStorageId);
      if (
        !file?.contentType?.startsWith("image/") ||
        file.size > 5 * 1024 * 1024
      )
        throw new Error("Choose an image smaller than 5 MB");
    }

    const patch = {
      ...identity,
      ...(args.iconStorageId !== undefined
        ? { iconStorageId: args.iconStorageId ?? undefined }
        : {}),
      ...(args.website !== undefined
        ? { website: args.website.trim() || undefined }
        : {}),
    };

    await ctx.db.patch(args.clientOrgId, patch);
    if (args.name !== undefined || args.website !== undefined)
      await scheduleCompanyResearch(ctx, args.clientOrgId);
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      targetOrgId: args.clientOrgId,
      summary: `Updated client settings for ${name}`,
      metadata: {
        previousName: client.name,
        nextName: name,
        website: patch.website,
      },
    });
  },
});

export const generateClientLogoUploadUrl = mutation({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await assertNoOperatorImpersonation(ctx, operator.userId);
    const client = await ctx.db.get(args.clientOrgId);
    if (!client || client.deletedAt !== undefined || client.type !== "client")
      throw new Error("Client not found");
    return ctx.storage.generateUploadUrl();
  },
});

export const launchSoloClient = action({
  args: {
    clientOrgId: v.id("organizations"),
    adminUserId: v.optional(v.id("users")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    loginUrl: string;
    recipientEmail: string;
    adminUserId: Id<"users">;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    await ctx.runQuery(internalApi.operator.requireOperatorForUserInternal, {
      userId,
    });
    const launch: {
      clientOrgId: Id<"organizations">;
      name: string;
      adminUserId?: Id<"users">;
      adminEmail?: string;
      adminName?: string;
    } | null = await ctx.runQuery(
      internalApi.operator.getSoloClientLaunchContextInternal,
      {
        clientOrgId: args.clientOrgId,
        adminUserId: args.adminUserId,
      },
    );
    if (!launch?.adminUserId) throw new Error("Client admin not found");
    if (!launch.adminEmail) throw new Error("Client admin has no email");

    const siteUrl = getAuthSiteUrl();
    const loginUrl = `${siteUrl}/login?email=${encodeURIComponent(launch.adminEmail)}`;
    const subject = `${launch.name} is ready on Spot`;
    const bodyHtml = `
<tr><td style="padding:28px 40px 0 40px;">
  <p class="spot-email-text-secondary" style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;color:#374151;line-height:1.6;">
    Your Spot workspace for <strong>${escapeHtml(launch.name)}</strong> is ready.
  </p>
</td></tr>
<tr><td align="center" style="padding:24px 40px 0 40px;">
  <a href="${escapeHtml(loginUrl)}" class="spot-email-button" style="display:inline-block;padding:8px 22px;background-color:#000000;color:#ffffff;font-family:-apple-system,sans-serif;font-size:14px;font-weight:500;text-decoration:none;border-radius:999px;line-height:1.4;">Open Spot</a>
</td></tr>
<tr><td style="padding:20px 40px 32px 40px;">
  <p class="spot-email-text-muted" style="margin:0;font-family:-apple-system,sans-serif;font-size:12px;color:#6b7280;line-height:1.6;">
    Sign in with ${escapeHtml(launch.adminEmail)}. You can also copy this link:<br>
    <a href="${escapeHtml(loginUrl)}" class="spot-email-link" style="color:#6b7280;word-break:break-all;">${escapeHtml(loginUrl)}</a>
  </p>
</td></tr>`;
    const html = buildEmailShell({ title: subject, bodyHtml, siteUrl });
    const text = `Your Spot workspace for ${launch.name} is ready.\n\nOpen Spot:\n${loginUrl}\n\nSign in with ${launch.adminEmail}.`;
    const result = await sendResendEmail(
      {
        from: getAuthFromAddress("Spot"),
        to: launch.adminName
          ? `${launch.adminName} <${launch.adminEmail}>`
          : launch.adminEmail,
        subject,
        html,
        text,
      },
      { retries: 2 },
    );
    if (!result.ok)
      throw new Error(`Failed to send launch email: ${result.error}`);
    await ctx.runMutation(internalApi.operator.markSoloClientLaunchedInternal, {
      clientOrgId: args.clientOrgId,
      operatorUserId: userId,
      adminUserId: launch.adminUserId,
      recipientEmail: launch.adminEmail,
      resendEmailId: result.id,
    });
    return {
      loginUrl,
      recipientEmail: launch.adminEmail,
      adminUserId: launch.adminUserId,
    };
  },
});

export const startImpersonation = mutation({
  args: {
    targetOrgId: v.id("organizations"),
    targetRole: orgRoleValidator,
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const org = await ctx.db.get(args.targetOrgId);
    if (!org || org.deletedAt !== undefined)
      throw new Error("Organization not found");
    const now = dayjs().valueOf();
    const active = await ctx.db
      .query("operatorImpersonationSessions")
      .withIndex("operator_status", (q) =>
        q.eq("operatorUserId", operator.userId).eq("status", "active"),
      )
      .collect();

    const matchingSession = active
      .filter(
        (session) =>
          session.targetOrgId === args.targetOrgId &&
          session.targetRole === args.targetRole,
      )
      .sort((left, right) => right.createdAt - left.createdAt)[0];

    if (matchingSession) {
      for (const session of active) {
        if (session._id === matchingSession._id) continue;
        await ctx.db.patch(session._id, { status: "ended", endedAt: now });
      }
      return { sessionId: matchingSession._id, reused: true };
    }

    for (const session of active) {
      await ctx.db.patch(session._id, { status: "ended", endedAt: now });
    }
    const sessionId = await ctx.db.insert("operatorImpersonationSessions", {
      operatorUserId: operator.userId,
      targetOrgId: args.targetOrgId,
      targetRole: args.targetRole,
      status: "active",
      createdAt: now,
    });
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "impersonation_started",
      targetOrgId: args.targetOrgId,
      summary: `Started ${args.targetRole} impersonation for ${org.name}`,
    });
    return { sessionId, reused: false };
  },
});

export const stopImpersonation = mutation({
  args: {},
  handler: async (ctx) => {
    const operator = await requireOperator(ctx);
    const now = dayjs().valueOf();
    const active = await ctx.db
      .query("operatorImpersonationSessions")
      .withIndex("operator_status", (q) =>
        q.eq("operatorUserId", operator.userId).eq("status", "active"),
      )
      .collect();
    for (const session of active) {
      await ctx.db.patch(session._id, { status: "ended", endedAt: now });
      await writeOperatorAudit(ctx, {
        operatorUserId: operator.userId,
        type: "impersonation_stopped",
        targetOrgId: session.targetOrgId,
        summary: "Stopped operator impersonation",
      });
    }
  },
});

export const requireOperatorForUserInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const operator = await requireOperatorForUser(ctx, args.userId);
    return { userId: operator.userId, profile: operator.profile };
  },
});

export const validateSoloClientUsersInternal = internalQuery({
  args: {
    users: v.array(
      v.object({
        email: v.string(),
        phone: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    if (args.users.length > OPERATOR_CLIENT_USER_LIMIT) {
      throw new Error("Client team size is invalid");
    }

    for (const input of args.users) {
      const email = normalizeClientUserEmail(input.email);
      const users = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", email))
        .take(5);
      for (const user of users) {
        await assertCustomerUser(ctx, user._id);
        const membership = await ctx.db
          .query("orgMemberships")
          .withIndex("user", (q) => q.eq("userId", user._id))
          .first();
        if (membership) {
          throw new Error(`${email} already belongs to another organization`);
        }
      }

      const normalizedPhone = normalizeUserPhone(input.phone);
      if (!normalizedPhone) continue;
      const phoneOwner = await findUserByNormalizedPhone(ctx, normalizedPhone);
      if (phoneOwner && !users.some((user) => user._id === phoneOwner._id)) {
        throw new Error("This phone number is already used by another user");
      }
    }
    return null;
  },
});

export const requireOperatorPolicyWriteForUserInternal = internalQuery({
  args: {
    userId: v.id("users"),
    policyId: v.id("policies"),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperatorForUser(ctx, args.userId);
    const policy = await ctx.db.get(args.policyId);
    if (!policy) throw new Error("Policy not found");
    await assertNoActiveOperatorImpersonationForPolicyWrite(
      ctx,
      operator.userId,
    );
    const run = await ctx.db
      .query("policyExtractionRuns")
      .withIndex("policy", (q) => q.eq("policyId", args.policyId))
      .first();
    return {
      userId: operator.userId,
      orgId: policy.orgId,
      pipelineStatus: run?.pipelineStatus ?? policy.pipelineStatus,
    };
  },
});

export const recordPolicyExtractionOperationInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    policyId: v.id("policies"),
    operation: v.union(
      v.literal("full_extraction"),
      v.literal("supplementary_extraction"),
      v.literal("search_index"),
    ),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.policyId);
    if (!policy) return;
    await ctx.db.insert("policyAuditLog", {
      policyId: args.policyId,
      userId: args.operatorUserId,
      orgId: policy.orgId,
      action: `operator_${args.operation}`,
      detail: "Operator started a targeted extraction operation",
      metadata: args.metadata,
    });
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "setup_write",
      targetOrgId: policy.orgId,
      summary: `Ran policy extraction operation: ${args.operation.replaceAll("_", " ")}`,
      metadata: {
        domain: "policies",
        policyId: args.policyId,
        operation: args.operation,
        result: args.metadata,
      },
    });
  },
});

export const upsertBrokerInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    adminUserId: v.id("users"),
    adminEmail: v.string(),
    adminName: v.optional(v.string()),
    adminPhone: v.optional(v.string()),
    broker: v.object({
      name: v.string(),
      slug: v.optional(v.string()),
      website: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    await assertCustomerUser(ctx, args.adminUserId);
    assertExternalBrokerIdentity({ ...args.broker, email: args.adminEmail });
    const brokerName = args.broker.name.trim();
    if (!brokerName) throw new Error("Broker name is required");
    const slug = args.broker.slug
      ? normalizeSlug(args.broker.slug)
      : slugFromName(brokerName);
    if (slug.length < 3 || slug.length > 40)
      throw new Error("Slug must be 3-40 characters");
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) {
      throw new Error("Slug must start and end with a letter or number");
    }
    const existingBySlug = await ctx.db
      .query("organizations")
      .withIndex("slug", (q) => q.eq("slug", slug))
      .first();
    if (existingBySlug?.deletedAt !== undefined)
      throw new Error("Broker was deleted; choose a different slug");
    if (existingBySlug && existingBySlug.type !== "broker") {
      throw new Error("Slug is already used by a non-broker org");
    }
    const patch = {
      name: brokerName,
      type: "broker" as const,
      slug,
      website: args.broker.website?.trim() || undefined,
      primaryInsuranceContactId: args.adminUserId,
      onboardingComplete: true,
      operatorStatus: "onboarding" as const,
    };
    const brokerOrgId =
      existingBySlug?._id ?? (await ctx.db.insert("organizations", patch));
    if (existingBySlug) await ctx.db.patch(brokerOrgId, patch);

    const existingAdminMembership = await ctx.db
      .query("orgMemberships")
      .withIndex("organization_user", (q) =>
        q.eq("orgId", brokerOrgId).eq("userId", args.adminUserId),
      )
      .first();
    if (!existingAdminMembership) {
      const otherMembership = await ctx.db
        .query("orgMemberships")
        .withIndex("user", (q) => q.eq("userId", args.adminUserId))
        .first();
      if (otherMembership)
        throw new Error("Broker admin already belongs to another organization");
      await ctx.db.insert("orgMemberships", {
        orgId: brokerOrgId,
        userId: args.adminUserId,
        role: "admin",
      });
    }
    const adminUserPatch: {
      accountKind: "customer";
      email: string;
      name?: string;
      phone?: string;
      onboardingComplete: boolean;
    } = {
      accountKind: "customer",
      email: args.adminEmail,
      name: args.adminName?.trim() || undefined,
      onboardingComplete: true,
    };
    if (args.adminPhone !== undefined) {
      adminUserPatch.phone = await normalizeAvailableUserPhone(
        ctx,
        args.adminPhone,
        args.adminUserId,
      );
    }
    await ctx.db.patch(args.adminUserId, adminUserPatch);
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "broker_created",
      targetOrgId: brokerOrgId,
      targetUserId: args.adminUserId,
      summary: `Created or updated broker ${brokerName}`,
      metadata: { slug, adminEmail: args.adminEmail },
    });
    await scheduleCompanyResearch(ctx, brokerOrgId);
    return { brokerOrgId };
  },
});

export async function createStandaloneClientOrganizationByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    name: string;
    website?: string;
    operatorStatus?: Doc<"organizations">["operatorStatus"];
  },
) {
  await requireOperatorForUser(ctx, args.operatorUserId);
  await assertNoOperatorImpersonation(ctx, args.operatorUserId);
  const identity = clientIdentity(args.name);
  if (!identity.name) throw new Error("Client name is required");
  const existingClients = await ctx.db
    .query("organizations")
    .withIndex("type", (q) => q.eq("type", "client"))
    .collect();
  const duplicate = existingClients.find(
    (client) =>
      client.deletedAt === undefined &&
      clientIdentityMatches(client, args.name),
  );
  if (duplicate)
    throw new Error(
      `Client ${duplicate.name} already exists as ${duplicate._id}`,
    );
  const orgId = await ctx.db.insert("organizations", {
    ...identity,
    type: "client",
    website: normalizeWebsiteUrl(args.website),
    allowedEmails: [],
    emailVerification: "strict",
    onboardingComplete: true,
    operatorStatus: args.operatorStatus ?? "onboarding",
  });
  await scheduleCompanyResearch(ctx, orgId);
  return orgId;
}

export const createSoloClientInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    users: v.array(
      v.object({
        userId: v.id("users"),
        email: v.string(),
        name: v.optional(v.string()),
        phone: v.optional(v.string()),
        role: orgRoleValidator,
      }),
    ),
    client: v.object({
      name: v.string(),
      website: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperatorForUser(ctx, args.operatorUserId);
    const activeImpersonation = await ctx.db
      .query("operatorImpersonationSessions")
      .withIndex("operator_status", (query) =>
        query.eq("operatorUserId", operator.userId).eq("status", "active"),
      )
      .first();
    if (activeImpersonation) throw new Error("IMPERSONATION_READ_ONLY");
    if (args.users.length > OPERATOR_CLIENT_USER_LIMIT) {
      throw new Error("Client team size is invalid");
    }
    const primaryAdminInput = args.users.find((user) => user.role === "admin");
    if (args.users.length > 0 && !primaryAdminInput) {
      throw new Error("At least one client user must be an admin");
    }
    const clientName = clientIdentity(args.client.name).name;
    if (!clientName) throw new Error("Client name is required");
    const seenUserIds = new Set<Id<"users">>();
    const seenEmails = new Set<string>();
    const seenPhones = new Set<string>();
    const users: Array<{
      userId: Id<"users">;
      email: string;
      name?: string;
      phone?: string;
      role: "admin" | "member";
    }> = [];
    for (const input of args.users) {
      const email = normalizeClientUserEmail(input.email);
      await assertCustomerUser(ctx, input.userId);
      if (seenUserIds.has(input.userId) || seenEmails.has(email)) {
        throw new Error("Each client user must be unique");
      }
      seenUserIds.add(input.userId);
      seenEmails.add(email);

      const otherMembership = await ctx.db
        .query("orgMemberships")
        .withIndex("user", (q) => q.eq("userId", input.userId))
        .first();
      if (otherMembership) {
        throw new Error(`${email} already belongs to another organization`);
      }

      const phone = await normalizeAvailableUserPhone(
        ctx,
        input.phone,
        input.userId,
      );
      if (phone && seenPhones.has(phone)) {
        throw new Error("Use a different phone number for each client user");
      }
      if (phone) seenPhones.add(phone);
      users.push({
        ...input,
        email,
        name: input.name?.trim() || undefined,
        phone,
      });
    }
    const primaryAdmin = users.find((user) => user.role === "admin");

    const clientOrgId = await createStandaloneClientOrganizationByOperator(
      ctx,
      {
        operatorUserId: args.operatorUserId,
        name: args.client.name,
        website: args.client.website,
      },
    );
    await ctx.db.patch(clientOrgId, {
      allowedEmails: users.map((user) => user.email),
      primaryInsuranceContactId: primaryAdmin?.userId,
      primaryContactName: primaryAdmin?.name?.trim() || undefined,
      primaryContactEmail: primaryAdmin?.email,
      primaryContactPhone: primaryAdmin?.phone,
    });
    for (const user of users) {
      await ctx.db.insert("orgMemberships", {
        orgId: clientOrgId,
        userId: user.userId,
        role: user.role,
      });
      await ctx.db.patch(user.userId, {
        accountKind: "customer",
        email: user.email,
        name: user.name,
        phone: user.phone,
        onboardingComplete: true,
      });
    }
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "client_created",
      targetOrgId: clientOrgId,
      targetUserId: primaryAdmin?.userId,
      summary: `Created client ${clientName}`,
      metadata: {
        ...(primaryAdmin ? { adminEmail: primaryAdmin.email } : {}),
        userCount: users.length,
        adminCount: users.filter((user) => user.role === "admin").length,
      },
    });
    return { clientOrgId };
  },
});

export const getBrokerLaunchContextInternal = internalQuery({
  args: { brokerOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const broker = await ctx.db.get(args.brokerOrgId);
    if (!broker || broker.type !== "broker") return null;
    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("organization", (q) => q.eq("orgId", args.brokerOrgId))
      .collect();
    const adminMembership = memberships.find(
      (membership) => membership.role === "admin",
    );
    const admin = adminMembership
      ? await ctx.db.get(adminMembership.userId)
      : null;
    return {
      brokerOrgId: broker._id,
      name: broker.name,
      slug: broker.slug,
      adminUserId: admin?._id,
      adminEmail: admin?.email,
      adminName: admin?.name,
    };
  },
});

export const getSoloClientLaunchContextInternal = internalQuery({
  args: {
    clientOrgId: v.id("organizations"),
    adminUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientOrgId);
    if (!client || client.deletedAt !== undefined || client.type !== "client")
      return null;
    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("organization", (q) => q.eq("orgId", args.clientOrgId))
      .take(200);
    const targetMembership = args.adminUserId
      ? memberships.find((membership) => membership.userId === args.adminUserId)
      : memberships.find((membership) => membership.role === "admin");
    if (
      !targetMembership ||
      ((client.operatorStatus ?? "live") === "onboarding" &&
        targetMembership.role !== "admin")
    ) {
      return null;
    }
    const recipient = await ctx.db.get(targetMembership.userId);
    if (!recipient || recipient.serviceAccountKind) return null;
    return {
      clientOrgId: client._id,
      name: client.name,
      adminUserId: recipient._id,
      adminEmail: recipient.email,
      adminName: recipient.name,
    };
  },
});

export const markBrokerLaunchedInternal = internalMutation({
  args: {
    brokerOrgId: v.id("organizations"),
    operatorUserId: v.id("users"),
    adminUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const broker = await ctx.db.get(args.brokerOrgId);
    if (!broker || broker.type !== "broker")
      throw new Error("Broker not found");
    await ctx.db.patch(args.brokerOrgId, {
      operatorStatus: "live",
      onboardingComplete: true,
    });
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "broker_launch_email_sent",
      targetOrgId: args.brokerOrgId,
      targetUserId: args.adminUserId,
      summary: `Launched ${broker.name} and sent broker login email`,
    });
  },
});

export const markSoloClientLaunchedInternal = internalMutation({
  args: {
    clientOrgId: v.id("organizations"),
    operatorUserId: v.id("users"),
    adminUserId: v.id("users"),
    recipientEmail: v.string(),
    resendEmailId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientOrgId);
    if (!client || client.deletedAt !== undefined || client.type !== "client")
      throw new Error("Client not found");
    const wasOnboarding = client.operatorStatus === "onboarding";
    await ctx.db.patch(args.clientOrgId, {
      operatorStatus:
        client.operatorStatus === "onboarding" ? "live" : client.operatorStatus,
      onboardingComplete: true,
    });
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "client_launch_email_sent",
      targetOrgId: args.clientOrgId,
      targetUserId: args.adminUserId,
      summary: `${wasOnboarding ? "Launched" : "Sent activation email for"} ${client.name}; email provider accepted client login email`,
      metadata: {
        recipientEmail: args.recipientEmail,
        resendEmailId: args.resendEmailId,
      },
    });
  },
});

export const deleteOrganization = mutation({
  args: {
    orgId: v.id("organizations"),
    type: v.union(v.literal("client"), v.literal("broker")),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await assertNoOperatorImpersonation(ctx, operator.userId);
    const org = await ctx.db.get(args.orgId);
    if (!org || org.type !== args.type)
      throw new Error("Organization not found");
    if (org.type === "broker") assertExternalBrokerIdentity(org);
    if (org.deletedAt !== undefined) return;
    await ctx.db.patch(org._id, {
      deletedAt: dayjs().valueOf(),
      deletedByUserId: operator.userId,
    });
    for await (const session of ctx.db
      .query("operatorImpersonationSessions")
      .withIndex("target", (q) => q.eq("targetOrgId", org._id))) {
      if (session.status === "active")
        await ctx.db.patch(session._id, {
          status: "ended",
          endedAt: dayjs().valueOf(),
        });
    }
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      targetOrgId: org._id,
      summary: `Deleted ${args.type} ${org.name}; retained account history`,
      metadata: { operation: "soft_delete", organizationType: args.type },
    });
  },
});
