import {
  prepareEnsureProviders,
  prepareUpdateProviders,
  validateProviderCreate,
  validateProviderUpdate,
} from "./operatorBrokerProfiles";
import { internal } from "../_generated/api";
import { isRemainingBatchToolName, prepareRemainingBatch, resolveBatchAttachment, type RemainingBatchToolName } from "./operatorRemainingBatch";
import { normalizeCompletionOutcome } from "./procurementCompletionOutcome";
import { prepareApplicationToolUpdate } from "../procurementRequests";
import { prepareBusinessProfileToolUpdate } from "../orgWiki";
import { getMarkdownDocument } from "../markdownDocuments";
import { requireCompanyRequest } from "./companyRequest";
import { clientRecipientOptions } from "./clientOutreach";
import { parseMarkdownDocument } from "./markdownDocument";
import { appendWikiSection } from "./wikiAppend";
import { clientIdentity, clientIdentityMatches } from "./clientProfile";
import dayjs from "dayjs";

import type { Id, TableNames } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  validateProcurementRequestCreateByOperator,
  writableProcurementRequestStatus,
} from "../procurementRequests";
import { assertFeatureFlagAllowedForOrg } from "./featureFlags";
import { clientBatchConfirmationSummary } from "./operatorClientBatch";
import { assertExternalBrokerIdentity } from "./brokerProfileValidation";
import { assertNoOperatorImpersonation } from "./clientFiles";
import type { OperatorAgentToolName } from "./operatorAgentToolRegistry";
import { resolveOperatorPolicySources } from "../operatorPolicyImports";
import { validateOperatorInvitation } from "../operatorInvitations";
import { requireSendableOperatorEmailDraft } from "../operatorEmailDrafts";
import { isOutreachLocked } from "./teamEmailStore";
import { previewTeamEmailReply } from "./teamEmailReply";
import { assertOutreachIdentity } from "./outreachIdentity";

export const OPERATOR_CONFIRMATION_PREFLIGHT_TOOL_NAMES = [
  "call_mcp_tool",
  "confirm_policy_fact",
  "update_client_wiki",
  "update_procurement_packet",
  "retry_failed_policy_extraction",
  "generate_coi",
  "import_policy_files",
  "update_client_file",
  "update_client_files",
  "add_client_files",
  "cancel_email_drafts",
  "create_procurement_request",
  "update_procurement_request",
  "update_procurement_requests",
  "update_procurement_application",
  "create_procurement_broker_outreach",
  "launch_procurement_provider_outreach",
  "stop_procurement_provider_outreach",
  "send_procurement_client_email",
  "create_procurement_information_form",
  "cancel_procurement_information_form",
  "reply_procurement_email_thread",
  "reply_email_thread",
  "link_team_inbox_thread",
  "link_team_inbox_threads",
  "update_procurement_broker_outreach",
  "update_procurement_broker_outreaches",
  "file_procurement_proposal",
  "file_procurement_email_quote",
  "archive_procurement_proposal",
  "archive_procurement_proposals",
  "retry_procurement_proposal_extraction",
  "cancel_procurement_proposal_extraction",
  "generate_procurement_proposal_review",
  "create_broker_packet_link",
  "rotate_broker_packet_link",
  "revoke_broker_packet_link",
  "confirm_procurement_proposal_review",
  "select_procurement_proposal",
  "create_broker_network_profile",
  "ensure_broker_network_profiles",
  "update_broker_network_profiles",
  "update_broker_network_profile",
  "create_procurement_file_item",
  "create_procurement_file_items",
  "update_procurement_file_item",
  "update_procurement_file_items",
  "update_procurement_email_thread",
  "update_procurement_email_threads",
  "create_client_organization",
  "create_client_organizations",
  "invite_operator",
  "update_organization_profile",
  "update_organization_profiles",
  "update_client_business_profile",
  "research_client",
  "research_broker",
  "research_brokers",
  "set_client_access_status",
  "set_client_assignee",
  "set_client_feature_flag",
  "set_client_assignees",
  "set_client_access_statuses",
  "set_client_feature_flags",
  "send_operator_slack_message",
  "send_email_draft",
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
  if (
    !document ||
    (table === "organizations" &&
      "deletedAt" in document &&
      document.deletedAt !== undefined)
  )
    throw new Error(`${label} not found`);
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

async function requireTeamEmailThread(ctx: MutationCtx, value: unknown) {
  const id = typeof value === "string" ? ctx.db.normalizeId("teamEmailThreads", value) : null;
  const thread = id ? await ctx.db.get(id) : null;
  if (!thread || thread.deletedAt !== undefined) throw new Error("Email conversation not found");
  if (thread.clientOrgId) await requireClientOrganization(ctx, thread.clientOrgId);
  if (thread.requestId) {
    const request = await requireProcurementRequest(ctx, thread.requestId);
    if (request.clientOrgId !== thread.clientOrgId) throw new Error("Email conversation has an invalid client link");
  }
  return thread;
}

async function requireProcurementRequest(ctx: MutationCtx, value: unknown) {
  const request = await requireDocument(
    ctx,
    "procurementRequests",
    value,
    "Procurement request",
  );
  if (request.deletedAt !== undefined) throw new Error("Procurement request not found");
  await requireClientOrganization(ctx, request.clientOrgId);
  return request;
}

async function requireBrokerOrganization(ctx: MutationCtx, value: unknown) {
  if (value === undefined || value === null) return null;
  const broker = await requireDocument(
    ctx,
    "organizations",
    value,
    "Provider organization",
  );
  if (broker.type !== "broker")
    throw new Error("Provider organization not found");
  assertExternalBrokerIdentity(broker);
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
    policy.extractionDataStage !== "final"
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
  requireCompanyRequest(request);
  await Promise.all([
    requirePolicyForClient(ctx, input.replacingPolicyId, request.clientOrgId),
    requirePolicyForClient(ctx, input.resultingPolicyId, request.clientOrgId, {
      active: true,
    }),
  ]);
  if (input.targetEffectiveDate !== null) {
    validateOptionalDate(input.targetEffectiveDate);
  }
  if (input.title !== undefined && !normalizedText(input.title))
    throw new Error("Title is required");
  if (input.status !== undefined)
    writableProcurementRequestStatus(input.status);
  if (input.completionOutcome != null)
    normalizeCompletionOutcome(input.completionOutcome);
}

async function preflightOutreachCreate(
  ctx: MutationCtx,
  input: Record<string, unknown>,
) {
  await requireProcurementRequest(ctx, input.procurementRequestId);
  await requireBrokerOrganization(ctx, input.brokerOrgId);
  validateOptionalEmail(input.contactEmail);
  assertExternalBrokerIdentity({ email: normalizedText(input.contactEmail) });
}

async function preflightOutreachUpdate(
  ctx: MutationCtx,
  input: Record<string, unknown>,
) {
  const outreach = await requireDocument(
    ctx,
    "procurementBrokerOutreaches",
    input.procurementOutreachId,
    "Provider outreach",
  );
  await requireProcurementRequest(ctx, outreach.requestId);
  if (
    input.brokerOrgId !== undefined &&
    input.brokerOrgId !== outreach.brokerOrgId
  ) {
    const proposal = await ctx.db
      .query("procurementProposals")
      .withIndex("outreach", (q) => q.eq("outreachId", outreach._id))
      .first();
    if (proposal)
      throw new Error(
        "The provider cannot change after a proposal has been filed",
      );
  }
  await requireBrokerOrganization(
    ctx,
    input.brokerOrgId ?? outreach.brokerOrgId,
  );
  validateOptionalEmail(input.contactEmail);
  assertExternalBrokerIdentity({
    email:
      input.contactEmail === undefined
        ? outreach.contactEmail
        : normalizedText(input.contactEmail),
  });
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
    "Provider outreach",
  );
  if (outreach.requestId !== request._id)
    throw new Error("Outreach does not belong to this request");
  await requireBrokerOrganization(ctx, outreach.brokerOrgId);
  assertExternalBrokerIdentity({ email: outreach.contactEmail });
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
  const thread = await requireTeamEmailThread(ctx, input.procurementEmailThreadId);
  if (thread.deletedAt || thread.archivedAt)
    throw new Error("Procurement email thread not found");
  const request = await requireProcurementRequest(ctx, thread.requestId);
  const outreach = await requireDocument(
    ctx,
    "procurementBrokerOutreaches",
    input.procurementOutreachId,
    "Provider outreach",
  );
  if (outreach.requestId !== request._id)
    throw new Error("Outreach does not belong to this email thread's request");
  const messages = await ctx.db
    .query("teamEmailMessages")
    .withIndex("by_threadId_and_receivedAt", (query) => query.eq("threadId", thread._id))
    .take(301);
  if (messages.length > 300) throw new Error("This conversation exceeds the filing preview limit; select exact client files instead.");
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
  await requireBrokerOrganization(ctx, proposal.brokerOrgId);
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
  await requireBrokerOrganization(ctx, proposal.brokerOrgId);
  if (proposal.clientOrgId !== request.clientOrgId) {
    throw new Error("Proposal belongs to a different client");
  }
  if (proposal.status !== "reviewed" && proposal.status !== "selected") {
    throw new Error("Only a reviewed proposal can be selected");
  }
}

async function preflightClientOrganizationCreate(
  ctx: MutationCtx,
  input: Record<string, unknown>,
) {
  const name = clientIdentity(normalizedText(input.name) ?? "").name;
  if (!name) throw new Error("Client name is required");
  validateOptionalUrl(input.website);
  const clients = await ctx.db
    .query("organizations")
    .withIndex("type", (query) => query.eq("type", "client"))
    .collect();
  const duplicate = clients.find(
    (client) =>
      client.deletedAt === undefined &&
      clientIdentityMatches(client, String(input.name)),
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
  const file = await requireDocument(
    ctx,
    "clientFiles",
    input.clientFileId,
    "Client file",
  );
  if (file.archivedAt || file.deletedAt || file.orgId !== request.clientOrgId) {
    throw new Error(
      "Client file is unavailable or does not belong to this request's client",
    );
  }
  if (!normalizedText(input.label)) throw new Error("File label is required");
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
  if (item.removedAt) throw new Error("Procurement file item not found");
  const request = await requireProcurementRequest(ctx, item.requestId);
  if (input.label !== undefined && !normalizedText(input.label))
    throw new Error("File label is required");
  if (input.clientFileId != null) {
    const file = await requireDocument(
      ctx,
      "clientFiles",
      input.clientFileId,
      "Client file",
    );
    if (
      file.archivedAt ||
      file.deletedAt ||
      file.orgId !== request.clientOrgId
    ) {
      throw new Error(
        "Client file is unavailable or does not belong to this request's client",
      );
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

export async function prepareRemainingBatchForConfirmation(
  ctx: MutationCtx,
  args: PreflightArgs & { toolName: RemainingBatchToolName },
) {
  return prepareRemainingBatch(
    ctx,
    { ...args, toolName: args.toolName },
    async (toolName, input) => {
      if (toolName === "add_client_file") {
        const client = await requireClientOrganization(ctx, input.orgId);
        await requirePolicyForClient(ctx, input.policyId, client._id, {
          active: true,
        });
        const attachment = await resolveBatchAttachment(
          ctx,
          args.threadId,
          input.attachmentFileId,
        );
        if (attachment.operatorUserId !== args.operatorUserId)
          throw new Error("Operator attachment was not found in this thread");
        if (!(await ctx.db.system.get("_storage", attachment.fileId)))
          throw new Error("Operator attachment file is unavailable");
        const existing = await ctx.db
          .query("clientFiles")
          .withIndex("storage", (q) => q.eq("fileId", attachment.fileId))
          .first();
        if (existing && existing.orgId !== client._id)
          throw new Error(
            "Operator attachment is already filed for another client",
          );
        return;
      }
      if (toolName === "cancel_email_draft") {
        const draft = await requireDocument(
          ctx,
          "pendingEmails",
          input.draftId,
          "Email draft",
        );
        if (
          draft.operatorThreadId !== args.threadId ||
          draft.threadId ||
          draft.status !== "draft"
        )
          throw new Error(
            "Only unsent drafts in this operator conversation can be cancelled",
          );
        await ctx.runQuery(internal.operatorEmailDrafts.resolveSenderInternal, {
          operatorUserId: args.operatorUserId,
          threadId: args.threadId,
          draftId: draft._id,
          write: true,
        });
        return;
      }
      await preflightOperatorToolConfirmation(ctx, {
        ...args,
        toolName,
        input,
      });
    },
  );
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

  if (isRemainingBatchToolName(args.toolName)) {
    await prepareRemainingBatchForConfirmation(ctx, { ...args, toolName: args.toolName });
    return;
  }

  switch (args.toolName) {
    case "call_mcp_tool": {
      const server = await ctx.db.get(
        exactId(ctx, "operatorMcpServers", args.input.serverId, "MCP server"),
      );
      if (!server?.enabled || server.revision !== args.input.serverRevision)
        throw new Error(
          "MCP server changed or was disabled. Discover tools again.",
        );
      const tools = JSON.parse(server.toolsJson) as { name: string }[];
      if (!tools.some((tool) => tool.name === args.input.toolName))
        throw new Error("MCP tool is not in the saved catalog");
      if (JSON.stringify(args.input.arguments).length > 100_000)
        throw new Error("MCP arguments are too large");
      return;
    }
    case "import_policy_files":
      await resolveOperatorPolicySources(ctx, {
        operatorUserId: args.operatorUserId,
        threadId: args.threadId,
        orgId: exactId(
          ctx,
          "organizations",
          args.input.orgId,
          "Client organization",
        ),
        attachmentFileIds: Array.isArray(args.input.attachmentFileIds)
          ? args.input.attachmentFileIds
          : undefined,
        clientFileIds: Array.isArray(args.input.clientFileIds)
          ? args.input.clientFileIds
          : undefined,
      });
      return;
    case "confirm_policy_fact":
      await preflightConfirmPolicyFact(ctx, args.input);
      return;
    case "update_client_wiki": {
      const organization = await requireDocument(
        ctx,
        "organizations",
        args.input.orgId,
        "Organization",
      );
      if (organization.type !== "client" && organization.type !== "broker") {
        throw new Error("Client or supplier organization not found");
      }
      const document = await getMarkdownDocument(ctx, {
        orgId: organization._id as Id<"organizations">,
        kind: "company_wiki",
      });
      if (args.input.mode === "append") {
        // The write appends to whatever is current, so there is no revision to match.
        parseMarkdownDocument(
          appendWikiSection(document?.markdown ?? "", String(args.input.markdown)),
        );
        return;
      }
      parseMarkdownDocument(String(args.input.markdown));
      const revision = document?.revision ?? 0;
      if (args.input.expectedRevision !== revision) {
        throw new Error(
          `Company document revision changed (expected ${args.input.expectedRevision}, current ${revision}). No write started. Call lookup_client_wiki, merge the intended changes into the latest Markdown, and retry with its revision.`,
        );
      }
      return;
    }
    case "update_procurement_packet": {
      const request = await requireDocument(
        ctx,
        "procurementRequests",
        args.input.procurementRequestId,
        "Procurement request",
      );
      await requireClientOrganization(ctx, request.clientOrgId);
      parseMarkdownDocument(String(args.input.markdown));
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
      // A running extraction is reported as already_running at execution, not rejected.
      if ((run?.pipelineStatus ?? policy.pipelineStatus) === "paused") {
        throw new Error("An extraction is paused for this policy");
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
    case "update_procurement_application":
      await prepareApplicationToolUpdate(ctx, args.input);
      return;
    case "update_procurement_request":
      await preflightProcurementRequestUpdate(ctx, args.input);
      return;
    case "launch_procurement_provider_outreach": {
      await assertOutreachIdentity(ctx, args.operatorUserId);
      const request = await requireProcurementRequest(
        ctx,
        args.input.procurementRequestId,
      );
      requireCompanyRequest(request);
      if (
        request.deletedAt ||
        request.status === "completed" ||
        request.status === "cancelled"
      )
        throw new Error("Procurement request is closed");
      await requireClientOrganization(ctx, request.clientOrgId);
      if (
        !Array.isArray(args.input.brokerOrgIds) ||
        !args.input.brokerOrgIds.length ||
        args.input.brokerOrgIds.length > 50
      )
        throw new Error("Select one to 50 providers");
      for (const brokerOrgId of args.input.brokerOrgIds) {
        const broker = await requireBrokerOrganization(ctx, brokerOrgId);
        if (!broker || broker.deletedAt) throw new Error("Provider not found");
      }
      return;
    }
    case "send_procurement_client_email": {
      await assertOutreachIdentity(ctx, args.operatorUserId);
      const request = await requireProcurementRequest(
        ctx,
        args.input.procurementRequestId,
      );
      requireCompanyRequest(request);
      if (
        request.deletedAt ||
        request.status === "completed" ||
        request.status === "cancelled"
      )
        throw new Error("Procurement request is closed");
      const client = await requireClientOrganization(ctx, request.clientOrgId);
      const email =
        typeof args.input.recipientEmail === "string"
          ? args.input.recipientEmail.trim().toLowerCase()
          : "";
      const recipients = await clientRecipientOptions(ctx, request, client._id);
      if (!recipients.some((option) => option.email === email))
        throw new Error("Recipient is not a current client contact");
      if (args.input.informationFormId != null) {
        const form = await requireDocument(ctx, "procurementInformationForms", args.input.informationFormId, "Information form");
        if (form.requestId !== request._id || form.status === "cancelled")
          throw new Error("Choose an available form from this request");
        if (form.outreachSequenceId)
          throw new Error("This form already has an email sequence. Open its conversation to follow up.");
      }
      return;
    }
    case "create_procurement_information_form":
      await requireProcurementRequest(ctx, args.input.procurementRequestId);
      if (Array.isArray(args.input.questionIds))
        for (const id of args.input.questionIds)
          exactId(ctx, "procurementInformationQuestions", id, "Question");
      return;
    case "cancel_procurement_information_form": {
      const form = await requireDocument(ctx, "procurementInformationForms", args.input.informationFormId, "Information form");
      if (form.status !== "open") throw new Error("Only open forms can be cancelled");
      return;
    }
    case "reply_procurement_email_thread":
    case "reply_email_thread": {
      const thread = await requireTeamEmailThread(ctx, args.input.teamEmailThreadId ?? args.input.procurementEmailThreadId);
      if (args.input.procurementRequestId) {
        const request = await requireProcurementRequest(ctx, args.input.procurementRequestId);
        if (thread.requestId !== request._id) throw new Error("Email conversation does not belong to the request");
      }
      if (thread.archivedAt) throw new Error("Restore this conversation before replying");
      const reply = await previewTeamEmailReply(ctx, {
        operatorUserId: args.operatorUserId,
        teamEmailThreadId: thread._id,
        message: String(args.input.message ?? ""),
      });
      if (!reply.ok) throw new Error(reply.reason);
      return;
    }
    case "link_team_inbox_thread": {
      const thread = await requireTeamEmailThread(ctx, args.input.teamEmailThreadId);
      if (isOutreachLocked(thread)) throw new Error("Outreach conversations stay with their originating request");
      const request = args.input.procurementRequestId
        ? await requireProcurementRequest(ctx, args.input.procurementRequestId)
        : null;
      const client = await requireClientOrganization(ctx, args.input.clientOrgId ?? request?.clientOrgId);
      if (request && request.clientOrgId !== client._id) throw new Error("Request does not belong to that client");
      if (thread.clientOrgId && thread.clientOrgId !== client._id) throw new Error("Email conversation can move only within the same client");
      if (thread.requestId && request && thread.requestId !== request._id) throw new Error("Use the request move for a conversation that already has a request");
      return;
    }
    case "stop_procurement_provider_outreach": {
      const request = await requireProcurementRequest(
        ctx,
        args.input.procurementRequestId,
      );
      requireCompanyRequest(request);
      await requireClientOrganization(ctx, request.clientOrgId);
      const sequence = await requireDocument(
        ctx,
        "procurementOutreachSequences",
        args.input.sequenceId,
        "Outreach sequence",
      );
      if (sequence.requestId !== request._id)
        throw new Error("Sequence does not belong to the request");
      return;
    }
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
      await validateProviderCreate(ctx, args.input);
      return;
    case "ensure_broker_network_profiles":
      await prepareEnsureProviders(ctx, args.input);
      return;
    case "update_broker_network_profiles":
      await prepareUpdateProviders(ctx, args.input);
      return;
    case "update_broker_network_profile":
      await validateProviderUpdate(ctx, args.input);
      return;
    case "create_procurement_file_item":
      await preflightProcurementFileCreate(ctx, args.input);
      return;
    case "update_procurement_file_item":
      await preflightProcurementFileUpdate(ctx, args.input);
      return;
    case "update_procurement_email_thread": {
      const thread = await requireTeamEmailThread(ctx, args.input.procurementEmailThreadId);
      if (args.input.procurementRequestId != null) {
        const request = await requireProcurementRequest(
          ctx,
          args.input.procurementRequestId,
        );
        if (thread.clientOrgId && request.clientOrgId !== thread.clientOrgId) {
          throw new Error("Email thread can move only within the same client");
        }
        if (isOutreachLocked(thread) && request._id !== thread.requestId) {
          throw new Error("Provider outreach conversations stay with their originating request");
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
    case "invite_operator": {
      await validateOperatorInvitation(ctx, String(args.input.email ?? ""));
      return;
    }
    case "update_client_business_profile":
      await prepareBusinessProfileToolUpdate(ctx, args.input);
      return;
    case "update_organization_profile": {
      const org = await requireDocument(
        ctx,
        "organizations",
        args.input.orgId,
        "Organization",
      );
      if (args.input.website !== null) validateOptionalUrl(args.input.website);
      if (args.input.name !== undefined && !normalizedText(args.input.name))
        throw new Error("Organization name cannot be blank");
      if (org.type === "broker")
        assertExternalBrokerIdentity({
          ...org,
          ...(args.input.name !== undefined
            ? { name: String(args.input.name) }
            : {}),
          ...(args.input.website !== undefined
            ? { website: normalizedText(args.input.website) }
            : {}),
        });
      return;
    }
    case "research_broker":
      await requireBrokerOrganization(ctx, args.input.orgId);
      return;
    case "research_client":
      await requireClientOrganization(ctx, args.input.orgId);
      return;
    case "set_client_assignees":
    case "set_client_access_statuses":
    case "set_client_feature_flags":
      await clientBatchConfirmationSummary(ctx, args.toolName, args.input);
      return;
    case "set_client_access_status":
      await requireClientOrganization(ctx, args.input.orgId);
      return;
    case "set_client_assignee": {
      await requireClientOrganization(ctx, args.input.orgId);
      if (args.input.assigneeUserId !== null) {
        const userId = exactId(ctx, "users", args.input.assigneeUserId, "Assignee");
        const profile = await ctx.db
          .query("operatorProfiles")
          .withIndex("user", (q) => q.eq("userId", userId))
          .first();
        if (profile?.status !== "active") throw new Error("Operator not found");
      }
      return;
    }
    case "set_client_feature_flag": {
      const organization = await requireClientOrganization(
        ctx,
        args.input.orgId,
      );
      const flagId = args.input.flagId;
      if (flagId !== "connect_features") {
        throw new Error("Unsupported feature flag");
      }
      assertFeatureFlagAllowedForOrg(flagId, organization);
      return;
    }
    case "send_operator_slack_message":
      await preflightOperatorSlackMessage(ctx, args.input);
      return;
    case "send_email_draft":
      await requireSendableOperatorEmailDraft(ctx, {
        operatorUserId: args.operatorUserId,
        threadId: args.threadId,
        draftId: args.input.draftId,
      });
      return;
    default:
      throw new Error(
        `Missing confirmation preflight for exact-confirmed tool ${args.toolName}`,
      );
  }
}
