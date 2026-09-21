import dayjs from "dayjs";
import { getOperatorBrokerHref } from "../lib/operator-navigation";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireOperatorForUser } from "./lib/operatorIdentity";
import { publicResearchUrl } from "./lib/companyResearch";
import { canAccessThread } from "./lib/threadAccess";
import { chatPresentationValidator } from "./lib/chatPresentationValidators";
import {
  parseChatPresentation,
  type ChatPresentation,
  type PresentationEvidence,
  type PresentationReference,
} from "../lib/chat-presentation";

const messageIdValidator = v.union(
  v.id("operatorAgentMessages"),
  v.id("threadMessages"),
);
const toolValidator = v.object({ name: v.string(), outputJson: v.string() });
export type CapturedPresentationTool = { name: string; outputJson: string };
type Message = Doc<"operatorAgentMessages"> | Doc<"threadMessages">;
export type PresentationReadBudget = {
  remaining: number;
  messagesRemaining: number;
  references: Map<string, Promise<PresentationReference | null>>;
};

export function presentationReadBudget(): PresentationReadBudget {
  return { remaining: 2048, messagesRemaining: 24, references: new Map() };
}

type Scope = { audience: "operator" | "client"; orgId?: Id<"organizations"> };
const EVIDENCE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_EVIDENCE_BYTES = 128 * 1024;
const supportedTools = new Set([
  "list_policies",
  "get_policy_status",
  "lookup_policy",
  "compare_coverages",
  "lookup_policy_section",
  "list_client_files",
  "lookup_client_files",
  "list_procurement_requests",
  "get_procurement_request",
  "list_procurement_proposals",
  "get_procurement_proposal",
  "list_broker_network_profiles",
  "get_broker_network_profile",
  "lookup_client_requests",
  "lookup_compliance_requirements",
  "lookup_vendor_compliance",
  "lookup_vendor_policies",
  "get_organization",
  "search_organizations",
]);
// Only domain data is retained; provider envelopes, credentials and URLs have no owner here.
const evidenceFields = new Set(
  `_id id policyId orgId clientOrgId brokerOrgId clientFileId requestId procurementRequestId
proposalId procurementProposalId requirementId sourceSpanIds spanId policyId1 policyId2 policy1
policy2 policies files requests proposals profiles organization profile policy requirement
requirements findings sources source evidence results items records comparisons coverages
coverageBreakdown limits amount limit deductible premium currency name title label value values
type kind status scope number policyNumber insured insuredName carrier effective expiration
effectiveDate expirationDate targetEffectiveDate linesOfBusiness lineOfBusinessCodes
lineOfBusiness writingStates states networkStatus extractionStatus dataStage extractionDataStage
pipelineStatus provisional archived clientVisible deletedAt archivedAt fileName filename
originalName contentType size client summary description text detail requirementText
evidenceText met satisfied missing uncertain bounded total count sourceIds page pageStart
pageEnd sourceDocumentId sourceDocumentName minAmBestRating admittedRequired maxDeductible
coverageForm provisions requiredForms retroactiveDateOnOrBefore requirementSourceDocumentId
sourceExcerpt sourcePageStart sourcePageEnd completionOutcome resultingPolicy packet markdown
currentComplianceStatus currentComplianceReasons matchedPolicyIds matchedPolicy matchedSummary
vendorOrgId vendorName requirementCount policyCount checks requiredLimits requiredProvisions
reasons expiresAt daysUntilExpiration notes limitAmount all pageNumber resolvedFromPage content
originalPdfChecked sourceSpans sourceNodes confidence coverageLimit extractedOffer brokerName
quoteNumber proposedEffectiveDate proposedExpirationDate quoteExpirationDate broker clientFile
brokerRelease release companyResearch sourceUrls facts key sourceRef needsDisambiguation vendors conditions subjectivities exclusions sectionHeadings reviews sectionKey
conclusion modelConclusion staffConclusion stale confirmedAt extractionFingerprint packetRevision
proposalDocumentId sourceNodeIds`.split(/\s+/),
);

function projectEvidence(value: unknown, depth = 0): unknown {
  if (depth > 8) return undefined;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string")
    return value.length <= 4000 ? value : undefined;
  if (Array.isArray(value))
    return value
      .slice(0, 40)
      .map((item) => projectEvidence(item, depth + 1))
      .filter((item) => item !== undefined);
  if (!value || typeof value !== "object") return undefined;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      if (!evidenceFields.has(key)) return [];
      if (
        key === "sectionHeadings" &&
        item &&
        typeof item === "object" &&
        !Array.isArray(item)
      ) {
        return [
          [
            key,
            Object.fromEntries(
              Object.entries(item)
                .slice(0, 40)
                .filter(
                  ([section, heading]) =>
                    section.length <= 200 &&
                    typeof heading === "string" &&
                    heading.length <= 200,
                ),
            ),
          ],
        ];
      }
      const projected = projectEvidence(item, depth + 1);
      return projected === undefined ? [] : [[key, projected]];
    }),
  );
}

export function capturePresentationTool(
  name: string,
  output: unknown,
): CapturedPresentationTool | null {
  if (!supportedTools.has(name) || !output || typeof output !== "object")
    return null;
  if (
    "error" in output ||
    ("ok" in output && output.ok === false) ||
    ("success" in output && output.success === false) ||
    ("isError" in output && output.isError === true)
  )
    return null;
  if (
    "status" in output &&
    [
      "failed",
      "error",
      "unavailable",
      "cancelled",
      "confirmation_required",
      "blocked_by_confirmation",
    ].includes(String(output.status))
  )
    return null;
  const result =
    "status" in output && output.status === "succeeded" && "result" in output
      ? output.result
      : output;
  if (
    !result ||
    typeof result !== "object" ||
    "error" in result ||
    ("success" in result && result.success === false) ||
    ("isError" in result && result.isError === true)
  )
    return null;
  const outputJson = JSON.stringify(projectEvidence(result));
  if (
    !outputJson ||
    outputJson === "{}" ||
    outputJson === "[]" ||
    new TextEncoder().encode(outputJson).length > 24 * 1024
  )
    return null;
  return { name, outputJson };
}

export function presentationSourceRevision(message: Message): string {
  return `${message._id}:${message.presentationRevision ?? 0}`;
}

async function evidenceFor(
  ctx: QueryCtx | MutationCtx,
  messageId: Message["_id"],
) {
  return ctx.db
    .query("chatPresentationEvidence")
    .withIndex("message", (q) => q.eq("messageId", messageId))
    .unique();
}

async function appendEvidence(
  ctx: MutationCtx,
  args: {
    messageId: Message["_id"];
    userId: Id<"users">;
    operatorRunId?: Id<"operatorAgentRuns">;
    tools: CapturedPresentationTool[];
  },
) {
  let existing = await evidenceFor(ctx, args.messageId);
  if (existing && existing.expiresAt <= dayjs().valueOf()) {
    await ctx.db.delete(existing._id);
    existing = null;
  }
  if (
    existing &&
    (existing.userId !== args.userId ||
      existing.operatorRunId !== args.operatorRunId)
  )
    return;
  const tools = [...(existing?.tools ?? [])];
  let bytes = new TextEncoder().encode(JSON.stringify(tools)).length;
  for (const tool of args.tools) {
    // Reapply the projection at the persistence boundary.
    let captured: CapturedPresentationTool | null;
    try {
      captured = capturePresentationTool(
        tool.name,
        JSON.parse(tool.outputJson),
      );
    } catch {
      continue;
    }
    if (
      !captured ||
      tools.some(
        (item) =>
          item.name === captured.name &&
          item.outputJson === captured.outputJson,
      )
    )
      continue;
    const size = new TextEncoder().encode(JSON.stringify(captured)).length;
    if (tools.length >= 24 || bytes + size > MAX_EVIDENCE_BYTES) continue;
    tools.push(captured);
    bytes += size;
  }
  if (existing) {
    await ctx.db.patch(existing._id, { tools });
    return;
  }
  const expiresAt = dayjs().valueOf() + EVIDENCE_TTL_MS;
  const id = await ctx.db.insert("chatPresentationEvidence", {
    ...args,
    tools,
    expiresAt,
  });
  try {
    await ctx.scheduler.runAfter(
      EVIDENCE_TTL_MS,
      internal.chatPresentations.cleanup,
      { id },
    );
  } catch (error) {
    await ctx.db.delete(id);
    throw error;
  }
}

export const captureOperatorEvidence = internalMutation({
  args: {
    runId: v.id("operatorAgentRuns"),
    expectedRunnerAttempt: v.number(),
    expectedCheckpointIteration: v.number(),
    tool: toolValidator,
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.status !== "running" ||
      run.cancellationRequestedAt ||
      run.runnerAttempt !== args.expectedRunnerAttempt ||
      (run.checkpoint?.iteration ?? 0) !== args.expectedCheckpointIteration
    )
      return;
    const message = await ctx.db.get(run.agentMessageId);
    if (!message || message.channel !== "chat") return;
    await requireOperatorForUser(ctx, run.operatorUserId);
    await appendEvidence(ctx, {
      messageId: message._id,
      userId: run.operatorUserId,
      operatorRunId: run._id,
      tools: [args.tool],
    });
  },
});

export async function schedulePresentation(
  ctx: MutationCtx,
  message: Message,
  options: {
    userId: Id<"users">;
    operatorRunId?: Id<"operatorAgentRuns">;
    tools?: CapturedPresentationTool[];
  },
): Promise<void> {
  if (
    message.channel !== "chat" ||
    message.role !== "agent" ||
    message.status ||
    !message.content.trim()
  )
    return;
  try {
    await appendEvidence(ctx, {
      messageId: message._id,
      ...options,
      tools: options.tools ?? [],
    });
    await ctx.scheduler.runAfter(
      0,
      internal.actions.chatPresentations.compose,
      {
        messageId: message._id,
        sourceRevision: presentationSourceRevision(message),
      },
    );
  } catch {
    console.warn("Chat presentation scheduling unavailable", {
      messageId: message._id,
    });
  }
}

async function activeScope(
  ctx: QueryCtx | MutationCtx,
  message: Message,
  evidence: Doc<"chatPresentationEvidence">,
): Promise<Scope | null> {
  if (
    evidence.expiresAt <= dayjs().valueOf() ||
    message.channel !== "chat" ||
    message.role !== "agent" ||
    message.status
  )
    return null;
  if ("ownerUserId" in message) {
    const run = evidence.operatorRunId
      ? await ctx.db.get(evidence.operatorRunId)
      : null;
    const thread = await ctx.db.get(message.threadId);
    if (
      !run ||
      run.agentMessageId !== message._id ||
      run.threadId !== message.threadId ||
      run.operatorUserId !== evidence.userId ||
      run.status !== "completed" ||
      run.cancellationRequestedAt ||
      !thread ||
      thread.archivedAt ||
      (thread.ownerUserId !== evidence.userId && thread.visibility !== "shared")
    )
      return null;
    await requireOperatorForUser(ctx, evidence.userId);
    const impersonation = await ctx.db
      .query("operatorImpersonationSessions")
      .withIndex("operator_status", (q) =>
        q.eq("operatorUserId", evidence.userId).eq("status", "active"),
      )
      .first();
    return impersonation ? null : { audience: "operator" };
  }
  const thread = await ctx.db.get(message.threadId);
  const org = await ctx.db.get(message.orgId);
  const user = await ctx.db.get(evidence.userId);
  if (
    !thread ||
    thread.archivedAt ||
    !org ||
    org.deletedAt !== undefined ||
    org.type === "broker" ||
    !user ||
    !canAccessThread({
      userId: evidence.userId,
      userOrgId: message.orgId,
      thread,
    }) ||
    thread.orgId !== message.orgId
  )
    return null;
  const membership = await ctx.db
    .query("orgMemberships")
    .withIndex("organization_user", (q) =>
      q.eq("orgId", message.orgId).eq("userId", evidence.userId),
    )
    .first();
  if (!membership) {
    const source = message.replyToMessageId
      ? await ctx.db.get(message.replyToMessageId)
      : null;
    const initiated = source?.operatorInitiated;
    if (
      !initiated ||
      source?.userId !== evidence.userId ||
      initiated.operatorUserId !== evidence.userId ||
      initiated.targetOrgId !== message.orgId
    )
      return null;
    const session = await ctx.db.get(initiated.impersonationSessionId);
    if (
      session?.status !== "active" ||
      session.operatorUserId !== evidence.userId ||
      session.targetOrgId !== message.orgId
    )
      return null;
    await requireOperatorForUser(ctx, evidence.userId);
  }
  return { audience: "client", orgId: message.orgId };
}

async function connectedRequirementOwner(
  ctx: QueryCtx | MutationCtx,
  ownerOrgId: Id<"organizations">,
  vendorOrgId: Id<"organizations"> | undefined,
): Promise<boolean> {
  if (!vendorOrgId) return false;
  const owner = await ctx.db.get(ownerOrgId);
  if (!owner || owner.deletedAt !== undefined) return false;
  const relationship = await ctx.db
    .query("connectedOrgRelationships")
    .withIndex("client_vendor", (q) =>
      q.eq("clientOrgId", ownerOrgId).eq("vendorOrgId", vendorOrgId),
    )
    .first();
  return relationship?.status === "active";
}

async function authorizeReference(
  ctx: QueryCtx | MutationCtx,
  reference: PresentationReference,
  scope: Scope,
): Promise<PresentationReference | null> {
  const operator = scope.audience === "operator";
  const orgAllowed = async (id: Id<"organizations"> | undefined) => {
    if (!id || (!operator && id !== scope.orgId)) return false;
    const org = await ctx.db.get(id);
    return Boolean(org && org.deletedAt === undefined);
  };
  const policyReference = async (recordId: string) => {
    const id = ctx.db.normalizeId("policies", recordId);
    const policy = id ? await ctx.db.get(id) : null;
    if (!policy || policy.deletedAt || !policy.orgId) return null;
    let connected = false;
    if (!(await orgAllowed(policy.orgId))) {
      if (operator || !scope.orgId) return null;
      const clientOrgId = scope.orgId;
      const vendorOrgId = policy.orgId;
      const relationship = await ctx.db
        .query("connectedOrgRelationships")
        .withIndex("client_vendor", (q) =>
          q.eq("clientOrgId", clientOrgId).eq("vendorOrgId", vendorOrgId),
        )
        .first();
      const vendor = await ctx.db.get(policy.orgId);
      if (
        relationship?.status !== "active" ||
        !vendor ||
        vendor.deletedAt !== undefined
      )
        return null;
      connected = true;
    }
    return {
      policy,
      href: operator
        ? `/operator/clients/${policy.orgId}/policies/${policy._id}`
        : connected
          ? `/connect/vendors/${policy.orgId}/policies/${policy._id}`
          : `/policies/${policy._id}`,
    };
  };
  let href: string | undefined;
  let sourceUrl: string | undefined;
  if (reference.kind === "source" && !reference.policyId) {
    const documentId = ctx.db.normalizeId(
      "requirementSourceDocuments",
      reference.recordId,
    );
    if (documentId) {
      if (reference.sourceUrl) return null;
      const document = await ctx.db.get(documentId);
      if (!document || document.archivedAt) return null;
      if (await orgAllowed(document.orgId)) {
        href = operator
          ? `/operator/clients/${document.orgId}/compliance?tab=sources&source=${document._id}`
          : `/compliance?tab=sources&source=${document._id}`;
      } else {
        if (
          operator ||
          !(await connectedRequirementOwner(ctx, document.orgId, scope.orgId))
        )
          return null;
        const requirements = await ctx.db
          .query("insuranceRequirements")
          .withIndex("organization_status", (q) =>
            q.eq("orgId", document.orgId).eq("status", "active"),
          )
          .take(200);
        const requirement = requirements.find(
          (item) =>
            item.kind === "coverage" &&
            item.scope === "vendors" &&
            item.sourceDocumentId === document._id,
        );
        if (!requirement) return null;
        href = `/compliance?requirement=${requirement._id}`;
      }
    } else {
      if (!operator) return null;
      const providerId = ctx.db.normalizeId(
        "organizations",
        reference.recordId,
      );
      const provider = providerId ? await ctx.db.get(providerId) : null;
      if (
        !provider ||
        provider.type !== "broker" ||
        provider.deletedAt ||
        !reference.sourceUrl ||
        !publicResearchUrl(reference.sourceUrl) ||
        !provider.companyResearch?.sourceUrls.includes(reference.sourceUrl) ||
        !provider.companyResearch.facts.some(
          (fact) => fact.sourceRef === reference.sourceUrl,
        )
      )
        return null;
      sourceUrl = reference.sourceUrl;
    }
  } else if (reference.kind === "policy" || reference.kind === "source") {
    const resolved = await policyReference(
      reference.kind === "policy"
        ? reference.recordId
        : (reference.policyId ?? ""),
    );
    if (!resolved) return null;
    if (reference.kind === "source") {
      const spanIds = reference.sourceSpanIds?.length
        ? reference.sourceSpanIds
        : [reference.recordId];
      for (const spanId of spanIds) {
        const span = await ctx.db
          .query("sourceSpans")
          .withIndex("policy_span", (q) =>
            q.eq("policyId", resolved.policy._id).eq("spanId", spanId),
          )
          .first();
        if (!span || span.orgId !== resolved.policy.orgId) return null;
      }
    }
    href = resolved.href;
  } else if (reference.kind === "file") {
    const id = ctx.db.normalizeId("clientFiles", reference.recordId);
    const file = id ? await ctx.db.get(id) : null;
    if (
      !file ||
      file.deletedAt ||
      file.archivedAt ||
      !(await orgAllowed(file.orgId))
    )
      return null;
    if (reference.requestId) {
      const requestId = ctx.db.normalizeId(
        "procurementRequests",
        reference.requestId,
      );
      const request = requestId ? await ctx.db.get(requestId) : null;
      if (
        !request ||
        request.clientOrgId !== file.orgId ||
        (!operator && !request.clientVisible)
      )
        return null;
      const associations = await ctx.db
        .query("procurementFileItems")
        .withIndex("file", (q) => q.eq("clientFileId", file._id))
        .take(100);
      if (
        !associations.some(
          (item) =>
            item.requestId === request._id &&
            item.clientOrgId === file.orgId &&
            (operator || item.clientVisible),
        )
      )
        return null;
      href = operator
        ? `/operator/clients/${file.orgId}/procurement/${request._id}`
        : `/requests/${request._id}`;
    } else {
      if (!operator && !file.clientVisible) return null;
      href = operator ? `/operator/clients/${file.orgId}/files` : "/files";
    }
  } else if (reference.kind === "request") {
    const id = ctx.db.normalizeId("procurementRequests", reference.recordId);
    const request = id ? await ctx.db.get(id) : null;
    if (
      !request ||
      (!operator && !request.clientVisible) ||
      !(await orgAllowed(request.clientOrgId))
    )
      return null;
    href = operator
      ? `/operator/clients/${request.clientOrgId}/procurement/${request._id}`
      : `/requests/${request._id}`;
  } else if (reference.kind === "proposal") {
    if (!operator) return null;
    const id = ctx.db.normalizeId("procurementProposals", reference.recordId);
    const proposal = id ? await ctx.db.get(id) : null;
    if (!proposal || !(await orgAllowed(proposal.clientOrgId))) return null;
    href = `/operator/clients/${proposal.clientOrgId}/procurement/${proposal.requestId}?view=proposals&proposal=${proposal._id}`;
  } else if (reference.kind === "vendor") {
    const vendorId = ctx.db.normalizeId("organizations", reference.recordId);
    const vendor = vendorId ? await ctx.db.get(vendorId) : null;
    if (!vendor || vendor.deletedAt !== undefined) return null;
    if (!operator) {
      if (!scope.orgId) return null;
      const clientOrgId = scope.orgId;
      const relationship = await ctx.db
        .query("connectedOrgRelationships")
        .withIndex("client_vendor", (q) =>
          q.eq("clientOrgId", clientOrgId).eq("vendorOrgId", vendor._id),
        )
        .first();
      if (relationship?.status !== "active") return null;
    }
    href = operator
      ? `/operator/clients/${vendor._id}`
      : `/connect/vendors/${vendor._id}/policies`;
  } else if (reference.kind === "provider") {
    if (!operator) return null;
    const id = ctx.db.normalizeId("organizations", reference.recordId);
    const provider = id ? await ctx.db.get(id) : null;
    if (!provider || provider.type !== "broker" || provider.deletedAt)
      return null;
    href = getOperatorBrokerHref(provider._id);
  } else {
    const id = ctx.db.normalizeId("insuranceRequirements", reference.recordId);
    const requirement = id ? await ctx.db.get(id) : null;
    if (!requirement || requirement.status !== "active") return null;
    if (!(await orgAllowed(requirement.orgId))) {
      if (
        operator ||
        requirement.kind !== "coverage" ||
        requirement.scope !== "vendors" ||
        !(await connectedRequirementOwner(ctx, requirement.orgId, scope.orgId))
      )
        return null;
    }
    href = operator
      ? `/operator/clients/${requirement.orgId}/compliance?requirement=${requirement._id}`
      : `/compliance?requirement=${requirement._id}`;
  }
  return {
    id: reference.id,
    kind: reference.kind,
    recordId: reference.recordId,
    label: reference.label,
    ...(href ? { href } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(reference.kind === "source"
      ? {
          policyId: reference.policyId,
          sourceSpanIds: reference.sourceSpanIds,
          page: reference.page,
        }
      : {}),
    ...(reference.kind === "file" && reference.requestId
      ? { requestId: reference.requestId }
      : {}),
  };
}

export async function visiblePresentation(
  ctx: QueryCtx | MutationCtx,
  message: Message,
  scope: Scope,
  budget: PresentationReadBudget = presentationReadBudget(),
): Promise<ChatPresentation | undefined> {
  if (message.channel !== "chat" || message.role !== "agent" || message.status)
    return undefined;
  const presentation = parseChatPresentation(message.presentation);
  if (
    !presentation ||
    presentation.sourceRevision !== presentationSourceRevision(message)
  )
    return undefined;
  if (budget.messagesRemaining <= 0) return undefined;
  budget.messagesRemaining--;
  const references: PresentationReference[] = [];
  for (const reference of presentation.references) {
    const key = JSON.stringify([scope.audience, scope.orgId, reference]);
    let authorization = budget.references.get(key);
    if (!authorization) {
      const cost =
        4 +
        (reference.sourceSpanIds?.length ?? 0) +
        (reference.kind === "file" && reference.requestId ? 100 : 0) +
        (reference.kind === "source" &&
        !reference.policyId &&
        !reference.sourceUrl
          ? 200
          : 0);
      if (cost > budget.remaining) return undefined;
      budget.remaining -= cost;
      authorization = authorizeReference(ctx, reference, scope);
      budget.references.set(key, authorization);
    }
    const authorized = await authorization;
    if (!authorized) return undefined;
    references.push(authorized);
  }
  return { ...presentation, references };
}

export const load = internalQuery({
  args: { messageId: messageIdValidator, sourceRevision: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{
    evidence: PresentationEvidence;
    orgId?: Id<"organizations">;
  } | null> => {
    const message = await ctx.db.get(args.messageId);
    const evidence = await evidenceFor(ctx, args.messageId);
    if (
      !message ||
      !evidence ||
      message.presentation ||
      presentationSourceRevision(message) !== args.sourceRevision
    )
      return null;
    const scope = await activeScope(ctx, message, evidence);
    if (!scope) return null;
    const prompt = message.replyToMessageId
      ? await ctx.db.get(message.replyToMessageId)
      : null;
    return {
      orgId: scope.orgId,
      evidence: {
        audience: scope.audience,
        prompt: prompt?.content.slice(0, 8000) ?? "",
        response: message.content.slice(0, 12000),
        tools: evidence.tools.map((tool) => ({
          name: tool.name,
          output: JSON.parse(tool.outputJson),
        })),
      },
    };
  },
});

export const save = internalMutation({
  args: {
    messageId: messageIdValidator,
    sourceRevision: v.string(),
    presentation: chatPresentationValidator,
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    const evidence = await evidenceFor(ctx, args.messageId);
    if (
      !message ||
      !evidence ||
      message.presentation ||
      presentationSourceRevision(message) !== args.sourceRevision ||
      args.presentation.sourceRevision !== args.sourceRevision
    )
      return false;
    const scope = await activeScope(ctx, message, evidence);
    if (!scope) return false;
    const presentation = await visiblePresentation(
      ctx,
      { ...message, presentation: args.presentation },
      scope,
    );
    if (!presentation) return false;
    await ctx.db.patch(message._id, { presentation });
    await ctx.db.delete(evidence._id);
    return true;
  },
});

export const cleanup = internalMutation({
  args: { id: v.id("chatPresentationEvidence") },
  handler: async (ctx, { id }) => {
    const evidence = await ctx.db.get(id);
    if (evidence && evidence.expiresAt <= dayjs().valueOf())
      await ctx.db.delete(id);
  },
});
