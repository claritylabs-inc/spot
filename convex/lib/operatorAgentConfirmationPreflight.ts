import dayjs from "dayjs";

import type { Id, TableNames } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { effectiveExtractionDataStage } from "../backfillDeclarationFacts";
import {
  validateProcurementRequestCreateByOperator,
  writableProcurementRequestStatus,
} from "../procurementRequests";
import { assertFeatureFlagAllowedForOrg } from "./featureFlags";
import { assertNoOperatorImpersonation } from "./clientFiles";
import { isCompanyWikiFact, normalizeWikiContent } from "./orgWikiPolicy";
import { isOrgWikiSectionKey, wikiBulletLines } from "./orgWiki";
import { defaultPacketSection } from "./procurementPacket";
import type { OperatorAgentToolName } from "./operatorAgentToolRegistry";

export const OPERATOR_CONFIRMATION_PREFLIGHT_TOOL_NAMES = [
  "confirm_policy_fact",
  "update_client_wiki_section",
  "update_procurement_packet_section",
  "retry_failed_policy_extraction",
  "generate_coi",
  "update_client_file",
  "create_procurement_request",
  "update_procurement_request",
  "create_procurement_broker_outreach",
  "update_procurement_broker_outreach",
  "file_procurement_proposal",
  "file_procurement_email_quote",
  "archive_procurement_proposal",
  "retry_procurement_proposal_extraction",
  "cancel_procurement_proposal_extraction",
  "generate_procurement_proposal_review",
  "create_broker_packet_link",
  "rotate_broker_packet_link",
  "revoke_broker_packet_link",
  "confirm_procurement_proposal_review",
  "select_procurement_proposal",
  "create_broker_network_profile",
  "update_broker_network_profile",
  "create_procurement_file_item",
  "update_procurement_file_item",
  "update_procurement_email_thread",
  "create_client_organization",
  "update_organization_profile",
  "set_organization_status",
  "set_client_feature_flag",
  "send_operator_slack_message",
  "clear_all_agent_memory",
] as const satisfies readonly OperatorAgentToolName[];

type PreflightArgs = {
  operatorUserId: Id<"users">;
  threadId: Id<"operatorAgentThreads">;
  toolName: OperatorAgentToolName;
  input: Record<string, unknown>;
};

function exactId<TableName extends TableNames>(
  ctx: MutationCtx,
  table: TableName,
  value: unknown,
  label: string,
) {
  const id =
    typeof value === "string" ? ctx.db.normalizeId(table, value) : null;
  if (!id) {
    throw new Error(
      `${label} must be an exact ${table} ID returned by a read tool`,
    );
  }
  return id;
}

function optionalProcurementPolicyReference(
  ctx: MutationCtx,
  value: unknown,
  field: "replacingPolicyId" | "resultingPolicyId",
) {
  if (value === undefined || value === null) return undefined;
  const policyId =
    typeof value === "string" ? ctx.db.normalizeId("policies", value) : null;
  if (!policyId) {
    throw new Error(
      `${field} must be an exact policy ID returned by a policy read tool; omit it when no policy is being linked`,
    );
  }
  return policyId;
}

async function requireDocument<TableName extends TableNames>(
  ctx: MutationCtx,
  table: TableName,
  value: unknown,
  label: string,
) {
  const id = exactId(ctx, table, value, label);
  const document = await ctx.db.get(id);
  if (!document) throw new Error(`${label} not found`);
  return document;
}

async function requireClientOrganization(ctx: MutationCtx, value: unknown) {
  const organization = await requireDocument(
    ctx,
    "organizations",
    value,
    "Client organization",
  );
  if (organization.type !== "client") {
    throw new Error("Client organization not found");
  }
  return organization;
}

async function requireProcurementRequest(ctx: MutationCtx, value: unknown) {
  const request = await requireDocument(
    ctx,
    "procurementRequests",
    value,
    "Procurement request",
  );
  await requireClientOrganization(ctx, request.clientOrgId);
  return request;
}

async function requireBrokerOrganization(ctx: MutationCtx, value: unknown) {
  if (value === undefined || value === null) return null;
  const broker = await requireDocument(
    ctx,
    "organizations",
    value,
    "Broker organization",
  );
  if (broker.type !== "broker")
    throw new Error("Broker organization not found");
  return broker;
}

async function requirePolicyForClient(
  ctx: MutationCtx,
  value: unknown,
  clientOrgId: Id<"organizations">,
  options: { active?: boolean } = {},
) {
  if (value === undefined || value === null) return null;
  const policy = await requireDocument(ctx, "policies", value, "Policy");
  if (
    policy.orgId !== clientOrgId ||
    (options.active === true && policy.deletedAt)
  ) {
    throw new Error(
      options.active
        ? "Policy is not an active policy for this client"
        : "Policy does not belong to this client",
    );
  }
  return policy;
}

function normalizedText(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
}

function validateOptionalDate(value: unknown) {
  const date = normalizedText(value);
  if (!date) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !dayjs(date).isValid()) {
    throw new Error("Effective date must use YYYY-MM-DD");
  }
}

function validateOptionalEmail(value: unknown) {
  const email = normalizedText(value)?.toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address");
  }
}

async function preflightOperatorSlackMessage(
  ctx: MutationCtx,
  input: Record<string, unknown>,
) {
  const recipientEmail = normalizedText(input.recipientEmail)?.toLowerCase();
  if (!recipientEmail) throw new Error("Recipient email is required");
  const recipient = await ctx.db
    .query("operatorProfiles")
    .withIndex("email", (query) => query.eq("email", recipientEmail))
    .unique();
  if (!recipient || recipient.status !== "active") {
    throw new Error("Active Spot operator not found for recipient email");
  }
  const hostTeamId = process.env.SLACK_CLARITY_TEAM_ID?.trim();
  if (
    !hostTeamId ||
    recipient.slackTeamId !== hostTeamId ||
    !recipient.slackUserId?.trim()
  ) {
    throw new Error(
      "Recipient is not linked to the configured operator Slack workspace",
    );
  }
}

function validateOptionalUrl(value: unknown) {
  const url = normalizedText(value);
  if (!url) return;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Enter a valid URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("URL must use http or https");
  }
}

/** Every line an operator writes into the wiki has to survive the same
 * company-context gate the extraction writers do. */
async function validateCompanyWikiSection(
  ctx: MutationCtx,
  args: { orgId: Id<"organizations">; key: unknown; body: unknown },
) {
  const organization = await requireClientOrganization(ctx, args.orgId);
  if (!isOrgWikiSectionKey(args.key)) {
    throw new Error("Unknown company wiki section");
  }
  const body = typeof args.body === "string" ? args.body : "";
  for (const line of wikiBulletLines(body)) {
    if (
      !isCompanyWikiFact({
        content: normalizeWikiContent(line),
        orgName: organization.name,
      })
    ) {
      throw new Error("The company wiki holds stable company facts only");
    }
  }
}

async function preflightConfirmPolicyFact(
  ctx: MutationCtx,
  input: Record<string, unknown>,
) {
  const organization = await requireClientOrganization(ctx, input.orgId);
  const policy = await requireDocument(
    ctx,
    "policies",
    input.policyId,
    "Policy",
  );
  if (policy.orgId !== organization._id) throw new Error("Policy not found");
  if (
    policy.deletedAt ||
    policy.pipelineStatus !== "complete" ||
    effectiveExtractionDataStage(policy) !== "final"
  ) {
    throw new Error(
      "Policy facts can be confirmed after full source-backed extraction finishes.",
    );
  }
  const spans = await ctx.db
    .query("sourceSpans")
    .withIndex("policy", (query) => query.eq("policyId", policy._id))
    .collect();
  const knownSpanIds = new Set(spans.map((span) => span.spanId));
  const requestedSpanIds = Array.isArray(input.sourceSpanIds)
    ? input.sourceSpanIds.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  if (
    requestedSpanIds.length === 0 ||
    requestedSpanIds.some((spanId) => !knownSpanIds.has(spanId))
  ) {
    throw new Error("Source evidence was not found on this policy");
  }
}

async function preflightGenerateCoi(
  ctx: MutationCtx,
  input: Record<string, unknown>,
) {
  const policyReference = normalizedText(input.policyId);
  const sourceReference = normalizedText(input.requirementSourceDocumentId);
  const requirementReference = normalizedText(input.requirementId);
  const requirementsMode = Boolean(sourceReference || requirementReference);
  if (Boolean(policyReference) === requirementsMode) {
    throw new Error(
      "Choose either one policy or one requirements source for certificate generation",
    );
  }
  if (policyReference) {
    const policy = await requireDocument(
      ctx,
      "policies",
      policyReference,
      "Policy",
    );
    if (!policy.orgId || policy.deletedAt) throw new Error("Policy not found");
    await requireClientOrganization(ctx, policy.orgId);
    const holderName = normalizedText(input.certificateHolder)
      ?.split(/\r?\n/)[0]
      ?.trim();
    if (!holderName) throw new Error("Certificate holder is required");
    return;
  }

  const source = sourceReference
    ? await requireDocument(
        ctx,
        "requirementSourceDocuments",
        sourceReference,
        "Requirements source",
      )
    : null;
  const requirement = requirementReference
    ? await requireDocument(
        ctx,
        "insuranceRequirements",
        requirementReference,
        "Requirement",
      )
    : null;
  if (source?.archivedAt) throw new Error("Requirements source not found");
  if (requirement && requirement.status !== "active") {
    throw new Error("Requirement not found");
  }
  if (source && requirement && requirement.sourceDocumentId !== source._id) {
    throw new Error("Requirement does not belong to the requirements source");
  }
  const orgId = source?.orgId ?? requirement?.orgId;
  if (!orgId) throw new Error("Requirements source not found");
  await requireClientOrganization(ctx, orgId);
}

async function preflightProcurementRequestUpdate(
  ctx: MutationCtx,
  input: Record<string, unknown>,
) {
  const request = await requireProcurementRequest(
    ctx,
    input.procurementRequestId,
  );
  await Promise.all([
    requirePolicyForClient(ctx, input.replacingPolicyId, request.clientOrgId),
    requirePolicyForClient(ctx, input.resultingPolicyId, request.clientOrgId),
  ]);
  if (input.targetEffectiveDate !== null) {
    validateOptionalDate(input.targetEffectiveDate);
  }
}

async function preflightOutreachCreate(
  ctx: MutationCtx,
  input: Record<string, unknown>,
) {
  await requireProcurementRequest(ctx, input.procurementRequestId);
  await requireBrokerOrganization(ctx, input.brokerOrgId);
  validateOptionalEmail(input.contactEmail);
}

async function preflightOutreachUpdate(
  ctx: MutationCtx,
  input: Record<string, unknown>,
) {
  const outreach = await requireDocument(
    ctx,
    "procurementBrokerOutreaches",
    input.procurementOutreachId,
    "Broker outreach",
  );
  await requireProcurementRequest(ctx, outreach.requestId);
  await requireBrokerOrganization(ctx, input.brokerOrgId);
  validateOptionalEmail(input.contactEmail);
}

async function preflightProposalFile(
  ctx: MutationCtx,
  threadId: Id<"operatorAgentThreads">,
  input: Record<string, unknown>,
) {
  const request = await requireProcurementRequest(
    ctx,
    input.procurementRequestId,
  );
  const outreach = await requireDocument(
    ctx,
    "procurementBrokerOutreaches",
    input.procurementOutreachId,
    "Broker outreach",
  );
  if (outreach.requestId !== request._id)
    throw new Error("Outreach does not belong to this request");
  const clientFileIds = Array.isArray(input.clientFileIds)
    ? input.clientFileIds
    : [];
  for (const value of clientFileIds) {
    const file = await requireDocument(
      ctx,
      "clientFiles",
      value,
      "Client file",
    );
    if (file.orgId !== request.clientOrgId || file.archivedAt || file.deletedAt)
      throw new Error("Client file does not belong to this request's client");
  }
  const fileItemIds = Array.isArray(input.procurementFileItemIds)
    ? input.procurementFileItemIds
    : [];
  for (const value of fileItemIds) {
    const item = await requireDocument(
      ctx,
      "procurementFileItems",
      value,
      "Procurement file item",
    );
    if (item.requestId !== request._id || !item.clientFileId)
      throw new Error(
        "Proposal file item must belong to this request and reference an available client file",
      );
  }
  const attachmentReferences = Array.isArray(input.attachmentFileIds)
    ? input.attachmentFileIds.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  if (attachmentReferences.length) {
    const attachments = await ctx.db
      .query("operatorAgentAttachments")
      .withIndex("thread_file", (query) => query.eq("threadId", threadId))
      .take(50);
    for (const reference of attachmentReferences) {
      const storageId = ctx.db.system.normalizeId("_storage", reference);
      const matches = attachments.filter(
        (attachment) =>
          (storageId && attachment.fileId === storageId) ||
          attachment.filename.trim().toLowerCase() ===
            reference.trim().toLowerCase(),
      );
      if (matches.length !== 1)
        throw new Error(
          `Proposal attachment ${reference} must resolve to one file in this Spot-agent conversation`,
        );
    }
  }
  if (input.procurementProposalId != null) {
    const proposal = await requireDocument(
      ctx,
      "procurementProposals",
      input.procurementProposalId,
      "Proposal",
    );
    if (
      proposal.outreachId !== outreach._id ||
      proposal.requestId !== request._id
    )
      throw new Error("Proposal does not belong to this outreach");
  }
  if (input.supersedesProposalId != null) {
    const superseded = await requireDocument(
      ctx,
      "procurementProposals",
      input.supersedesProposalId,
      "Proposal",
    );
    if (superseded.outreachId !== outreach._id)
      throw new Error("Superseded proposal must belong to this outreach");
  }
}

async function preflightProcurementEmailQuote(
  ctx: MutationCtx,
  input: Record<string, unknown>,
) {
  const thread = await requireDocument(
    ctx,
    "procurementEmailThreads",
    input.procurementEmailThreadId,
    "Procurement email thread",
  );
  if (thread.deletedAt || thread.archivedAt)
    throw new Error("Procurement email thread not found");
  const request = await requireProcurementRequest(ctx, thread.requestId);
  const outreach = await requireDocument(
    ctx,
    "procurementBrokerOutreaches",
    input.procurementOutreachId,
    "Broker outreach",
  );
  if (outreach.requestId !== request._id)
    throw new Error("Outreach does not belong to this email thread's request");
  const messages = await ctx.db
    .query("procurementEmailMessages")
    .withIndex("thread", (query) => query.eq("threadId", thread._id))
    .collect();
  const clientFileIds = [
    ...new Set(messages.flatMap((message) => message.clientFileIds)),
  ];
  let activeAttachmentCount = 0;
  for (const clientFileId of clientFileIds) {
    const file = await ctx.db.get(clientFileId);
    if (
      file &&
      file.orgId === request.clientOrgId &&
      !file.archivedAt &&
      !file.deletedAt
    )
      activeAttachmentCount += 1;
  }
  if (activeAttachmentCount === 0)
    throw new Error("This email thread has no active file attachments to file");
  if (input.supersedesProposalId != null) {
    const superseded = await requireDocument(
      ctx,
      "procurementProposals",
      input.supersedesProposalId,
      "Proposal",
    );
    if (superseded.outreachId !== outreach._id)
      throw new Error("Superseded proposal must belong to this outreach");
  }
}

async function preflightProposalLifecycle(
  ctx: MutationCtx,
  input: Record<string, unknown>,
) {
  const proposal = await requireDocument(
    ctx,
    "procurementProposals",
    input.procurementProposalId,
    "Proposal",
  );
  await requireProcurementRequest(ctx, proposal.requestId);
  if (proposal.status === "selected")
    throw new Error(
      "A selected proposal must be replaced before it can be archived or changed",
    );
  return proposal;
}

async function preflightProposalExtraction(
  ctx: MutationCtx,
  input: Record<string, unknown>,
  operation: "retry" | "cancel" | "review",
) {
  const proposal = await requireDocument(
    ctx,
    "procurementProposals",
    input.procurementProposalId,
    "Proposal",
  );
  await requireProcurementRequest(ctx, proposal.requestId);
  if (
    operation === "retry" &&
    !["draft", "extracting", "review_ready"].includes(proposal.status)
  )
    throw new Error(
      `Proposal ${proposal._id} cannot be re-extracted from ${proposal.status}`,
    );
  if (operation === "review" && proposal.status !== "review_ready")
    throw new Error("Proposal extraction is not ready for review");
  return proposal;
}

async function preflightPacketLinkCreate(
  ctx: MutationCtx,
  input: Record<string, unknown>,
) {
  await requireProcurementRequest(ctx, input.procurementRequestId);
  if (input.expiresAt !== undefined) {
    if (
      typeof input.expiresAt !== "number" ||
      !Number.isFinite(input.expiresAt) ||
      !dayjs(input.expiresAt).isAfter(dayjs())
    )
      throw new Error("Packet link expiry must be in the future");
    if (dayjs(input.expiresAt).isAfter(dayjs().add(90, "day")))
      throw new Error("Packet links may expire at most 90 days after issue");
  }
}

async function preflightPacketLinkChange(
  ctx: MutationCtx,
  input: Record<string, unknown>,
) {
  const link = await requireDocument(
    ctx,
    "procurementPacketLinks",
    input.procurementPacketLinkId,
    "Packet link",
  );
  await requireProcurementRequest(ctx, link.requestId);
}

async function preflightProposalReviewConfirm(
  ctx: MutationCtx,
  input: Record<string, unknown>,
) {
  const review = await requireDocument(
    ctx,
    "procurementProposalReviews",
    input.procurementProposalReviewId,
    "Proposal review",
  );
  const proposal = await requireDocument(
    ctx,
    "procurementProposals",
    review.proposalId,
    "Proposal",
  );
  const request = await requireProcurementRequest(ctx, review.requestId);
  if (
    proposal.requestId !== request._id ||
    proposal.clientOrgId !== request.clientOrgId ||
    proposal.extractionFingerprint !== review.extractionFingerprint ||
    (request.packetRevision ?? 0) !== (review.packetRevision ?? -1)
  ) {
    throw new Error("Review is stale");
  }
}

async function preflightProposalSelect(
  ctx: MutationCtx,
  input: Record<string, unknown>,
) {
  const proposal = await requireDocument(
    ctx,
    "procurementProposals",
    input.procurementProposalId,
    "Proposal",
  );
  const request = await requireProcurementRequest(ctx, proposal.requestId);
  if (proposal.clientOrgId !== request.clientOrgId) {
    throw new Error("Proposal belongs to a different client");
  }
  if (proposal.status !== "reviewed" && proposal.status !== "selected") {
    throw new Error("Only a reviewed proposal can be selected");
  }
}

async function preflightBrokerProfileCreate(
  ctx: MutationCtx,
  input: Record<string, unknown>,
) {
  const name = normalizedText(input.name);
  if (!name) throw new Error("Broker name is required");
  validateOptionalUrl(input.website);
  // The agent reaches this tool from unstructured submission records, where the
  // same broker often appears under a name it has already been registered with.
  // Registering a duplicate splits that broker's outreach and proposal history.
  const brokers = await ctx.db
    .query("organizations")
    .withIndex("type", (query) => query.eq("type", "broker"))
    .collect();
  const duplicate = brokers.find(
    (broker) => broker.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (duplicate) {
    throw new Error(
      `Broker ${duplicate.name} is already registered as ${duplicate._id}; update that profile instead`,
    );
  }
}

async function preflightClientOrganizationCreate(
  ctx: MutationCtx,
  input: Record<string, unknown>,
) {
  const name = normalizedText(input.name);
  if (!name) throw new Error("Client name is required");
  validateOptionalUrl(input.website);
  const clients = await ctx.db
    .query("organizations")
    .withIndex("type", (query) => query.eq("type", "client"))
    .collect();
  const duplicate = clients.find(
    (client) => client.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (duplicate)
    throw new Error(
      `Client ${duplicate.name} already exists as ${duplicate._id}`,
    );
}

async function preflightProcurementFileCreate(
  ctx: MutationCtx,
  input: Record<string, unknown>,
) {
  const request = await requireProcurementRequest(
    ctx,
    input.procurementRequestId,
  );
  if (input.procurementOutreachId != null) {
    const outreach = await requireDocument(
      ctx,
      "procurementBrokerOutreaches",
      input.procurementOutreachId,
      "Broker outreach",
    );
    if (outreach.requestId !== request._id) {
      throw new Error("Broker outreach does not belong to this request");
    }
  }
  if (input.clientFileId != null) {
    const file = await requireDocument(
      ctx,
      "clientFiles",
      input.clientFileId,
      "Client file",
    );
    if (file.orgId !== request.clientOrgId) {
      throw new Error("Client file does not belong to this request's client");
    }
  }
}

async function preflightProcurementFileUpdate(
  ctx: MutationCtx,
  input: Record<string, unknown>,
) {
  const item = await requireDocument(
    ctx,
    "procurementFileItems",
    input.procurementFileItemId,
    "Procurement file item",
  );
  const request = await requireProcurementRequest(ctx, item.requestId);
  if (input.procurementOutreachId != null) {
    const outreach = await requireDocument(
      ctx,
      "procurementBrokerOutreaches",
      input.procurementOutreachId,
      "Broker outreach",
    );
    if (outreach.requestId !== request._id) {
      throw new Error("Broker outreach does not belong to this request");
    }
  }
  if (input.clientFileId != null) {
    const file = await requireDocument(
      ctx,
      "clientFiles",
      input.clientFileId,
      "Client file",
    );
    if (file.orgId !== request.clientOrgId) {
      throw new Error("Client file does not belong to this request's client");
    }
  }
}

async function preflightUpdateClientFile(
  ctx: MutationCtx,
  input: Record<string, unknown>,
) {
  const file = await requireDocument(
    ctx,
    "clientFiles",
    input.clientFileId,
    "Client file",
  );
  if (file.archivedAt || file.deletedAt)
    throw new Error("Client file not found");
  await requireClientOrganization(ctx, file.orgId);
  await requirePolicyForClient(ctx, input.policyId, file.orgId, {
    active: true,
  });
}

/** A packet section can only be written under a canonical key, and a sensitive
 * section can never be widened past the operator. */
function preflightPacketSection(
  canonical: { sensitive: boolean },
  audience: unknown,
) {
  if (audience === undefined || audience === null) return;
  if (canonical.sensitive && audience !== "operator") {
    throw new Error("Sensitive packet sections require operator visibility");
  }
}

export async function preflightOperatorToolConfirmation(
  ctx: MutationCtx,
  args: PreflightArgs,
) {
  if (
    !new Set<OperatorAgentToolName>(
      OPERATOR_CONFIRMATION_PREFLIGHT_TOOL_NAMES,
    ).has(args.toolName)
  ) {
    throw new Error(
      `Missing confirmation preflight for exact-confirmed tool ${args.toolName}`,
    );
  }
  if (args.toolName === "clear_all_agent_memory") return;
  await assertNoOperatorImpersonation(ctx, args.operatorUserId);

  switch (args.toolName) {
    case "confirm_policy_fact":
      await preflightConfirmPolicyFact(ctx, args.input);
      return;
    case "update_client_wiki_section": {
      const orgId = exactId(
        ctx,
        "organizations",
        args.input.orgId,
        "Client organization",
      );
      await validateCompanyWikiSection(ctx, {
        orgId,
        key: args.input.key,
        body: args.input.body,
      });
      return;
    }
    case "update_procurement_packet_section": {
      const request = await requireDocument(
        ctx,
        "procurementRequests",
        args.input.procurementRequestId,
        "Procurement request",
      );
      await requireClientOrganization(ctx, request.clientOrgId);
      preflightPacketSection(
        defaultPacketSection(String(args.input.key)),
        args.input.audience,
      );
      return;
    }
    case "retry_failed_policy_extraction": {
      const policy = await requireDocument(
        ctx,
        "policies",
        args.input.policyId,
        "Policy",
      );
      const run = await ctx.db
        .query("policyExtractionRuns")
        .withIndex("policy", (query) => query.eq("policyId", policy._id))
        .order("desc")
        .first();
      const status = run?.pipelineStatus ?? policy.pipelineStatus;
      if (status === "running" || status === "paused") {
        throw new Error(
          "An extraction is already running or paused for this policy",
        );
      }
      if (!policy.fileId) throw new Error("Policy source file is missing");
      return;
    }
    case "generate_coi":
      await preflightGenerateCoi(ctx, args.input);
      return;
    case "update_client_file":
      await preflightUpdateClientFile(ctx, args.input);
      return;
    case "create_procurement_request": {
      const clientOrgId = exactId(
        ctx,
        "organizations",
        args.input.orgId,
        "Client organization",
      );
      await validateProcurementRequestCreateByOperator(ctx, {
        operatorUserId: args.operatorUserId,
        clientOrgId,
        title: typeof args.input.title === "string" ? args.input.title : "",
        narrative:
          typeof args.input.narrative === "string" ? args.input.narrative : "",
        targetEffectiveDate: normalizedText(args.input.targetEffectiveDate),
        status: writableProcurementRequestStatus(args.input.status),
        replacingPolicyId: optionalProcurementPolicyReference(
          ctx,
          args.input.replacingPolicyId,
          "replacingPolicyId",
        ),
        resultingPolicyId: optionalProcurementPolicyReference(
          ctx,
          args.input.resultingPolicyId,
          "resultingPolicyId",
        ),
      });
      return;
    }
    case "update_procurement_request":
      await preflightProcurementRequestUpdate(ctx, args.input);
      return;
    case "create_procurement_broker_outreach":
      await preflightOutreachCreate(ctx, args.input);
      return;
    case "update_procurement_broker_outreach":
      await preflightOutreachUpdate(ctx, args.input);
      return;
    case "file_procurement_proposal":
      await preflightProposalFile(ctx, args.threadId, args.input);
      return;
    case "file_procurement_email_quote":
      await preflightProcurementEmailQuote(ctx, args.input);
      return;
    case "archive_procurement_proposal":
      await preflightProposalLifecycle(ctx, args.input);
      return;
    case "retry_procurement_proposal_extraction":
      await preflightProposalExtraction(ctx, args.input, "retry");
      return;
    case "cancel_procurement_proposal_extraction":
      await preflightProposalExtraction(ctx, args.input, "cancel");
      return;
    case "generate_procurement_proposal_review":
      await preflightProposalExtraction(ctx, args.input, "review");
      return;
    case "create_broker_packet_link":
      await preflightPacketLinkCreate(ctx, args.input);
      return;
    case "rotate_broker_packet_link":
    case "revoke_broker_packet_link":
      await preflightPacketLinkChange(ctx, args.input);
      return;
    case "confirm_procurement_proposal_review":
      await preflightProposalReviewConfirm(ctx, args.input);
      return;
    case "select_procurement_proposal":
      await preflightProposalSelect(ctx, args.input);
      return;
    case "create_broker_network_profile":
      await preflightBrokerProfileCreate(ctx, args.input);
      return;
    case "update_broker_network_profile":
      await requireBrokerOrganization(ctx, args.input.brokerOrgId);
      return;
    case "create_procurement_file_item":
      await preflightProcurementFileCreate(ctx, args.input);
      return;
    case "update_procurement_file_item":
      await preflightProcurementFileUpdate(ctx, args.input);
      return;
    case "update_procurement_email_thread": {
      const thread = await requireDocument(
        ctx,
        "procurementEmailThreads",
        args.input.procurementEmailThreadId,
        "Procurement email thread",
      );
      if (thread.deletedAt)
        throw new Error("Procurement email thread not found");
      await requireProcurementRequest(ctx, thread.requestId);
      if (args.input.procurementRequestId != null) {
        const request = await requireProcurementRequest(
          ctx,
          args.input.procurementRequestId,
        );
        if (request.clientOrgId !== thread.clientOrgId) {
          throw new Error("Email thread can move only within the same client");
        }
        if (request._id === thread.requestId && args.input.category == null) {
          throw new Error("No email thread fields changed");
        }
      }
      return;
    }
    case "create_client_organization":
      await preflightClientOrganizationCreate(ctx, args.input);
      return;
    case "update_organization_profile":
    case "set_organization_status":
      await requireDocument(
        ctx,
        "organizations",
        args.input.orgId,
        "Organization",
      );
      return;
    case "set_client_feature_flag": {
      const organization = await requireClientOrganization(
        ctx,
        args.input.orgId,
      );
      const flagId = args.input.flagId;
      if (
        flagId !== "connect_features" &&
        flagId !== "coverage_recovery_v2" &&
        flagId !== "imessage_app_cards"
      ) {
        throw new Error("Unsupported feature flag");
      }
      assertFeatureFlagAllowedForOrg(flagId, organization);
      return;
    }
    case "send_operator_slack_message":
      await preflightOperatorSlackMessage(ctx, args.input);
      return;
    default:
      throw new Error(
        `Missing confirmation preflight for exact-confirmed tool ${args.toolName}`,
      );
  }
}
