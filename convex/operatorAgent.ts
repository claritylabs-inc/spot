import { resolveOperatorToolDispatch } from "./lib/operatorToolConsolidation";
import { listProviderSubmissionDefaults } from "./providerSubmissionDefaults";
import {
  currentRequestCadence,
  getProviderOutreachPanel,
  launchProviderOutreachByOperator,
  loadCompanyRequest,
  previewProviderOutreachLaunch,
  requestEmailTemplate,
  stopProviderOutreachByOperator,
} from "./providerOutreach";
import { writeProviderOutreachDraft } from "./lib/providerOutreachDrafts";
import { MAX_LAUNCH_PROVIDERS } from "./lib/providerOutreachSchedule";
import { getClientOutreachPanel } from "./clientOutreach";
import {
  addInformationQuestionsByOperator,
  cancelInformationFormByOperator,
  createInformationFormByOperator,
  procurementInformationOverview,
} from "./lib/procurementInformationOperator";
import { NoWriteInputError } from "./lib/noWriteInputError";
import { operatorTeamAddressFor } from "./lib/teamEmail";
import { ensureOperatorInbox } from "./lib/operatorInbox";
import { listTeamInbox, getTeamThreadDetails, linkTeamEmailThreadByOperator } from "./teamInbox";
import { searchTeamInbox } from "./lib/teamInboxProjection";
import { reviseTeamReplySuggestion } from "./lib/teamReplySuggestions";
import {
  operatorPlanningAssessmentValidator,
  operatorExecutionPlanValidator,
  operatorExecutionPlanSchema,
  operatorPlanningLevel,
} from "./lib/operatorRunPlan";
import { jevProceedThreshold } from "./lib/jevThreshold";
import { clRouterDecide } from "./lib/clRouterClient";
import { flagTeamInboxTargets } from "./lib/teamInboxTargets";
import { planningLevelFromAssessment } from "./lib/operatorPlanning";
import { readUnlinkedIntakeByOperator } from "./lib/intakeDiagnostics";
import {
  prepareApplicationToolUpdate,
  updateApplicationByOperator,
} from "./procurementRequests";
import { clientAccessStatus } from "./lib/clientAccess";
import { routerJobFailureValidator } from "./lib/routerJobFailure";
import {
  OPERATOR_RUN_TIMING_RETENTION_DAYS,
  operatorRunTimingView,
  operatorRunTimingValidator,
  type OperatorRunTiming,
} from "./lib/operatorRunTiming";
import {
  prepareBusinessProfileToolUpdate,
  updateBusinessProfileByOperator,
} from "./orgWiki";
import { requireCompanyRequest } from "./lib/companyRequest";
import {
  presentationReadBudget,
  schedulePresentation,
  visiblePresentation,
} from "./chatPresentations";
import { scheduleNextMessageSuggestion } from "./operatorNextMessage";
import { serializeToolActivityInput } from "./lib/agentToolAudit";
import { clientIdentity } from "./lib/clientProfile";
import { scheduleCompanyResearch } from "./companyResearch";
import {
  readWebsiteTechProfile,
  scheduleWebsiteTechScan,
} from "./websiteTech";
import { websiteTechDomain } from "./lib/websiteTech";
import { clientRecipientOptions } from "./lib/clientOutreach";
import { appendWikiSection } from "./lib/wikiAppend";
import {
  companyResearchStatus,
  techStackResearchStatus,
  type ResearchStatus,
} from "./lib/researchStatus";
import { normalizeCompletionOutcome } from "./lib/procurementCompletionOutcome";
import {
  getClientAttention,
  getOperatorProcurementRequest,
  listOperatorProcurementProposals,
  listOperatorProcurementRequests,
  procurementApplicationSummary,
} from "./lib/operatorProcurementReads";
import dayjs from "dayjs";
import { scheduleOperatorHistoryCompaction } from "./operatorAgentHistory";
import { operatorEmailContentValidator } from "./lib/threadMessageValidators";
import {
  assertExternalBrokerIdentity,
  isSpotOwnedBrokerIdentity,
} from "./lib/brokerProfileValidation";
import { v, type Infer } from "convex/values";
import { cancelRouterJobForInvocation } from "./routerJobs";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  TOOL_PREVIEW_MAX_ITEMS,
  toolPreviewItemValidator,
} from "./lib/toolResultPreview";
import {
  MESSAGE_ACTIVITY_MAX_CHANGE,
  type MessageActivityToolTarget,
} from "./lib/messageActivity";
import {
  internalMutation,
  internalQuery,
  internalAction,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { setClientAssigneeForOperator, getOperatorAgentSettings } from "./operator";
import { actionConfirmationFingerprint } from "./lib/actionConfirmationFingerprint";
import {
  MAX_AGENT_ATTACHMENT_AGGREGATE_BYTES,
  MAX_AGENT_ATTACHMENT_BYTES,
  normalizeAgentAttachmentContentType,
  normalizeAgentAttachmentFilename,
} from "./lib/agentAttachmentLimits";
import {
  assertFeatureFlagAllowedForOrg,
  setFeatureFlagPatch,
} from "./lib/featureFlags";
import {
  OPERATOR_AGENT_TOOL_REGISTRY,
  getOperatorAgentToolSpec,
  availableOperatorAgentToolNames,
  assertOperatorEmailToolAccess,
  operatorToolRoleAllowed,
  isOperatorAgentToolName,
  isProviderEmailSendTool,
  parseOperatorAgentToolInput,
  operatorUpdateFieldLabel,
  operatorUpdateValue,
  type OperatorAgentToolName,
  type OperatorToolIntegration,
  type OperatorToolRole,
} from "./lib/operatorAgentToolRegistry";
import type { OperatorGoogleWorkspaceToolName } from "./lib/googleWorkspace";
import {
  listOperatorAgentIntents,
  resolveOperatorAgentIntent,
} from "./lib/operatorAgentIntentRegistry";
import { collectOperatorSuggestionCandidates } from "./lib/operatorSuggestionRanking";
import type { OperatorSuggestionCandidate } from "./lib/operatorSuggestionTypes";
import {
  buildOperatorRunCheckpointSummary,
  OPERATOR_INLINE_CONTINUATION_BYTES,
} from "./lib/operatorAgentContinuation";
import { googleWorkspaceCredentialEnvelope } from "./lib/googleWorkspaceCredentials";
import { lookupMapboxAddress } from "./lib/mapboxAddress";
import {
  requireOperator,
  requireOperatorForUser,
  writeOperatorAudit,
} from "./lib/operatorIdentity";
import { emitOperatorNotification } from "./lib/operatorNotify";
import {
  createClientFileFromOperatorAttachment,
  updateClientFileByOperator,
} from "./lib/clientFiles";
import {
  createProcurementFileItemByOperator,
  createProcurementOutreachByOperator,
  createProcurementRequestByOperator,
  getProcurementEmailThreadDetails,
  getProcurementRequestDetails,
  listProcurementEmailThreads,
  previewProcurementEmailReconciliation,
  updateProcurementEmailThreadByOperator,
  updateProcurementFileItemByOperator,
  updateProcurementOutreachByOperator,
  updateProcurementRequestByOperator,
  writableProcurementRequestStatus,
} from "./procurementRequests";
import {
  archiveProcurementProposalByOperator,
  cancelProcurementProposalExtractionByOperator,
  confirmProcurementProposalReviewByOperator,
  fileProcurementEmailQuoteByOperator,
  fileProcurementProposalByOperator,
  getProcurementProposalDetails,
  listProposalExtractionIssues,
  retryProcurementProposalExtractionByOperator,
  selectProcurementProposalByOperator,
} from "./procurementProposals";
import {
  getBrokerProfileDetails,
  createStandaloneBrokerByOperator,
  updateBrokerProfileByOperator,
} from "./brokerProfiles";
import type { ProviderBatchResult } from "./operatorBrokerBatches";
import {
  listProviderPage,
  validateProviderCreate,
} from "./lib/operatorBrokerProfiles";
import { readOrgWiki, upsertOrgWikiDocumentByOperator } from "./orgWiki";
import { loadEmailPrompts } from "./lib/emailPrompts";
import {
  listPacketLinksForOperator,
  listPacketDocuments,
  mintPacketLinkForOperator,
  previewBrokerPacket,
  revokePacketLinkByOperator,
  rotatePacketLinkByOperator,
  updatePacketDocumentByOperator,
} from "./procurementPacket";
import { normalizedSearchText, uniqueSearchTerms } from "./lib/searchTokenizer";
import { applyOperatorBatch } from "./lib/operatorBatch";
import { isRemainingBatchToolName, remainingBatchConfirmationSummary, REMAINING_BATCH_TOOLS, type RemainingBatchResult } from "./lib/operatorRemainingBatch";
import { assertNoOperatorImpersonation } from "./lib/clientFiles";
import {
  preflightOperatorToolConfirmation,
  prepareRemainingBatchForConfirmation,
  providerLaunchApprovalLines,
  providerLaunchFingerprint,
} from "./lib/operatorAgentConfirmationPreflight";
import { clientBatchConfirmationSummary, isClientBatchToolName, type ClientBatchResult } from "./lib/operatorClientBatch";
import {
  describeOperatorRecordFields,
  type OperatorDescribableRecord,
} from "./lib/operatorRecordFieldCatalog";
import { assertOutreachIdentity } from "./lib/outreachIdentity";
import {
  OPERATOR_EMAIL_SEND_SUMMARY_LIMIT,
  operatorEmailSendConfirmation,
} from "./operatorEmailDrafts";
import {
  confirmedPreflightOperatorToolFailure,
  executionOperatorToolFailure,
  operatorNoWriteCode,
  isRecoverableOperatorToolFailure,
  preflightOperatorToolFailure,
  type OperatorToolFailedOutcome,
} from "./lib/operatorAgentToolFailure";
import {
  resolveOperatorPolicySources,
  operatorPolicySourceFingerprint,
} from "./operatorPolicyImports";
import {
  createSlackThreadContextArtifact,
  slackThreadContextMessageTimestamps,
  slackThreadContextSnapshotValidator,
  type SlackThreadContextSnapshot,
} from "./lib/slackThreadContext";
import {
  normalizeOperatorPageContext,
  threadPageContext,
} from "./lib/threadPageContext";
import { operatorPeople, operatorPerson } from "./lib/operatorAvatar";
import {
  loadOrganizationAssignees,
  organizationDetail,
  organizationIncludeSet,
  organizationRow,
} from "./lib/operatorOrganizationReads";
import { compactProposal, compactTeamThread, readMany, uniqueIds } from "./lib/operatorReadViews";

const operatorChannelValidator = v.union(
  v.literal("chat"),
  v.literal("slack"),
  v.literal("imessage"),
  v.literal("email"),
  v.literal("mcp"),
);

const operatorAttachmentValidator = v.object({
  fileId: v.id("_storage"),
  filename: v.string(),
  contentType: v.string(),
  size: v.number(),
  uploadIntentId: v.optional(v.id("operatorAgentUploadIntents")),
});

const pageContextValidator = v.object({
  pageType: v.string(),
  entityId: v.optional(v.string()),
  summary: v.optional(v.string()),
  href: v.optional(v.string()),
  related: v.optional(
    v.array(
      v.object({ kind: v.string(), id: v.string(), label: v.optional(v.string()) }),
    ),
  ),
});

const operatorToolExecutionArgs = {
  operatorUserId: v.id("users"),
  runId: v.id("operatorAgentRuns"),
  threadId: v.id("operatorAgentThreads"),
  threadMessageId: v.id("operatorAgentMessages"),
  toolName: v.string(),
  input: v.any(),
  inputHash: v.string(),
  idempotencyKey: v.string(),
  channel: operatorChannelValidator,
};

const ACTIVE_RUN_STATUSES = new Set([
  "queued",
  "running",
  "waiting_confirmation",
]);
const MAX_OPERATOR_MESSAGE_CHARS = 20_000;
const MAX_OPERATOR_CONVERSATION_KEY_CHARS = 500;
const MAX_OPERATOR_DEDUPE_KEY_CHARS = 500;

type OperatorChannel = "chat" | "slack" | "imessage" | "email" | "mcp";

type OperatorConfirmationDisplayState =
  | "pending"
  | "approved"
  | "cancelled"
  | "expired"
  | "superseded"
  | "unavailable";

function operatorConfirmationDisplayState(confirmation: {
  status: "pending" | "completed" | "stale" | "expired";
  invalidationReason?: string;
}): OperatorConfirmationDisplayState {
  if (confirmation.status === "completed") return "approved";
  if (confirmation.status === "expired") {
    return "expired";
  }
  if (confirmation.status === "pending") return "pending";
  if (
    confirmation.invalidationReason === "rejected_by_operator" ||
    confirmation.invalidationReason === "cancelled_by_operator"
  ) {
    return "cancelled";
  }
  if (confirmation.invalidationReason === "superseded") return "superseded";
  return "unavailable";
}

type OperatorAttachment = {
  fileId: Id<"_storage">;
  filename: string;
  contentType: string;
  size: number;
  uploadIntentId?: Id<"operatorAgentUploadIntents">;
};

type ExecuteToolArgs = {
  operatorUserId: Id<"users">;
  runId: Id<"operatorAgentRuns">;
  threadId: Id<"operatorAgentThreads">;
  threadMessageId: Id<"operatorAgentMessages">;
  toolName: string;
  input: unknown;
  inputHash: string;
  idempotencyKey: string;
  channel: OperatorChannel;
  confirmationId?: Id<"operatorAgentConfirmations">;
};

type DirectToolInvocation = {
  threadId: Id<"operatorAgentThreads">;
  runId: Id<"operatorAgentRuns">;
  userMessageId: Id<"operatorAgentMessages">;
  agentMessageId: Id<"operatorAgentMessages">;
  duplicate: boolean;
  summary: string;
};

type DirectToolOutcome =
  | {
      status: "confirmation_required";
      confirmationId?: Id<"operatorAgentConfirmations">;
      summary: string;
    }
  | {
      status: "blocked_by_confirmation";
      confirmationId: Id<"operatorAgentConfirmations">;
      runId: Id<"operatorAgentRuns">;
      summary: string;
      expiresAt?: number;
    }
  | {
      status: "succeeded";
      result: unknown;
      idempotent: boolean;
    }
  | OperatorToolFailedOutcome;

type OperatorActionToolResult = {
  result: unknown;
  attachments?: OperatorAttachment[];
};

const OPERATOR_RICH_ACTION_TOOLS = new Set<OperatorAgentToolName>([
  "import_policy_files",
  "fill_pdf_form",
  "web_search",
  "fetch_url",
  "lookup_policy",
  "compare_coverages",
  "lookup_policy_section",
  "attach_policy_document",
  "confirm_policy_fact",
  "lookup_compliance_requirements",
  "read_client_file",
  "attach_client_file",
  "search_thread_history",
  "read_thread_attachment",
  "save_email_draft",
  // Retired send tools that now only save drafts.
  "reply_email_thread",
  "reply_procurement_email_thread",
  "send_procurement_client_email",
  "draft_email",
  "update_email_draft",
  "attach_policy_pdf_to_draft",
  "attach_client_file_to_draft",
  "list_email_drafts",
  "send_email_draft",
  "cancel_email_draft",
]);

function boundedJson(value: unknown, maximum = 8_000) {
  try {
    return JSON.stringify(value).slice(0, maximum);
  } catch {
    return String(value).slice(0, maximum);
  }
}

function isOperatorGoogleWorkspaceTool(
  toolName: string,
): toolName is OperatorGoogleWorkspaceToolName {
  return (
    toolName === "list_company_mailboxes" ||
    toolName === "search_company_email" ||
    toolName === "read_company_email_thread" ||
    toolName === "read_company_email_threads" ||
    toolName === "get_company_email_attachment" ||
    toolName === "scan_workspace_mailbox"
  );
}

function serializedOperatorActionOutput(toolName: string, result: unknown) {
  return isOperatorGoogleWorkspaceTool(toolName) ||
    toolName === "web_search" ||
    toolName === "fetch_url" ||
    toolName === "list_operator_conversations" ||
    toolName === "read_operator_conversation" ||
    toolName === "list_team_inbox_threads" ||
    toolName === "get_team_inbox_thread" ||
    toolName === "search_team_inbox" ||
    toolName === "get_procurement_email_thread" ||
    isClientBatchToolName(toolName) ||
    toolName === "list_broker_network_profiles" ||
    toolName === "ensure_broker_network_profiles" ||
    toolName === "update_broker_network_profiles" ||
    toolName === "get_procurement_proposal" ||
    toolName === "list_procurement_provider_matches" ||
    toolName === "get_procurement_provider_emails" ||
    toolName === "get_platform_status" ||
    toolName === "get_procurement_information" ||
    toolName === "get_procurement_packet" ||
    toolName === "get_channel_health" ||
    toolName === "list_email_drafts" ||
    toolName === "search_thread_history"
    ? JSON.stringify(result)
    : boundedJson(result);
}

function operatorActionResultForCaller(
  toolName: string,
  auditId: Id<"agentActionAuditEvents">,
  result: unknown,
) {
  const record = recordValue(result);
  if (
    isOperatorGoogleWorkspaceTool(toolName) &&
    typeof record?.nextCursor === "string" &&
    record.nextCursor
  ) {
    return { ...record, nextCursor: `gws:${auditId}` };
  }
  return result;
}

async function resolveGoogleWorkspaceContinuation(
  ctx: MutationCtx,
  args: {
    toolName: string;
    operatorUserId: Id<"users">;
    threadId: Id<"operatorAgentThreads">;
  },
  input: Record<string, unknown>,
) {
  if (
    !isOperatorGoogleWorkspaceTool(args.toolName) ||
    typeof input.cursor !== "string" ||
    !input.cursor.startsWith("gws:")
  )
    return input;
  const id = ctx.db.normalizeId(
    "agentActionAuditEvents",
    input.cursor.slice(4),
  );
  const source = id ? await ctx.db.get(id) : null;
  const cursor = recordValue(parseStoredOutput(source?.output))?.nextCursor;
  if (
    !source ||
    source.status !== "succeeded" ||
    source.action !== args.toolName ||
    source.operatorUserId !== args.operatorUserId ||
    source.operatorThreadId !== args.threadId ||
    typeof cursor !== "string" ||
    !cursor
  ) {
    throw new NoWriteInputError(
      "invalid_continuation",
      "Google Workspace continuation reference is invalid for this operator, thread, or tool. Restart without a cursor using the original filters.",
    );
  }
  return { ...input, cursor };
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function boundedDisplayText(
  value: string,
  maximum = 160,
  preserveLines = false,
) {
  const normalized = value
    .trim()
    .replace(preserveLines ? /[^\S\n]+/g : /\s+/g, " ");
  return normalized.length <= maximum
    ? normalized
    : `${normalized.slice(0, maximum - 1).trimEnd()}…`;
}

function policyDisplayName(policy: {
  carrier?: string;
  security?: string;
  policyNumber?: string;
  insuredName?: string;
  fileName?: string;
}) {
  const carrier = policy.security?.trim() || policy.carrier?.trim();
  const number = policy.policyNumber?.trim();
  if (carrier && number) return `${carrier} policy ${number}`;
  if (number) return `policy ${number}`;
  return (
    policy.insuredName?.trim() ||
    policy.fileName?.trim() ||
    "the selected policy"
  );
}

const DISPLAY_REFERENCE_FALLBACKS: Record<string, string> = {
  orgId: "the selected organization",
  brokerOrgId: "the selected provider",
  policyId: "the selected policy",
  policyId1: "the first selected policy",
  policyId2: "the second selected policy",
  replacingPolicyId: "the policy being replaced",
  resultingPolicyId: "the resulting policy",
  clientFileId: "the selected client file",
  procurementRequestId: "the selected procurement request",
  procurementOutreachId: "the selected provider outreach",
  procurementFileItemId: "the selected procurement file",
  procurementEmailThreadId: "the selected email thread",
  teamEmailThreadId: "the selected email conversation",
  requirementId: "the selected requirement",
  requirementSourceDocumentId: "the selected requirements source",
};

async function referenceDisplayName(
  ctx: QueryCtx,
  key: string,
  value: string,
): Promise<string | undefined> {
  if (key === "orgId" || key === "brokerOrgId") {
    const id = ctx.db.normalizeId("organizations", value);
    const row = id ? await ctx.db.get(id) : null;
    return row?.name?.trim() || DISPLAY_REFERENCE_FALLBACKS[key];
  }
  if (
    key === "policyId" ||
    key === "policyId1" ||
    key === "policyId2" ||
    key === "replacingPolicyId" ||
    key === "resultingPolicyId"
  ) {
    const id = ctx.db.normalizeId("policies", value);
    const row = id ? await ctx.db.get(id) : null;
    return row ? policyDisplayName(row) : DISPLAY_REFERENCE_FALLBACKS[key];
  }
  if (key === "clientFileId") {
    const id = ctx.db.normalizeId("clientFiles", value);
    const row = id ? await ctx.db.get(id) : null;
    return row?.name?.trim() || DISPLAY_REFERENCE_FALLBACKS[key];
  }
  if (key === "procurementRequestId") {
    const id = ctx.db.normalizeId("procurementRequests", value);
    const row = id ? await ctx.db.get(id) : null;
    return row?.title?.trim() || DISPLAY_REFERENCE_FALLBACKS[key];
  }
  if (key === "procurementOutreachId") {
    const id = ctx.db.normalizeId("procurementBrokerOutreaches", value);
    const row = id ? await ctx.db.get(id) : null;
    return row?.brokerName?.trim() || DISPLAY_REFERENCE_FALLBACKS[key];
  }
  if (key === "procurementFileItemId") {
    const id = ctx.db.normalizeId("procurementFileItems", value);
    const row = id ? await ctx.db.get(id) : null;
    return row?.label?.trim() || DISPLAY_REFERENCE_FALLBACKS[key];
  }
  if (key === "procurementEmailThreadId" || key === "teamEmailThreadId") {
    const id = ctx.db.normalizeId("teamEmailThreads", value);
    const row = id ? await ctx.db.get(id) : null;
    return row?.subject?.trim() || DISPLAY_REFERENCE_FALLBACKS[key];
  }
  if (key === "requirementId") {
    const id = ctx.db.normalizeId("insuranceRequirements", value);
    const row = id ? await ctx.db.get(id) : null;
    return row?.title?.trim() || DISPLAY_REFERENCE_FALLBACKS[key];
  }
  if (key === "requirementSourceDocumentId") {
    const id = ctx.db.normalizeId("requirementSourceDocuments", value);
    const row = id ? await ctx.db.get(id) : null;
    return row?.title?.trim() || DISPLAY_REFERENCE_FALLBACKS[key];
  }
  return undefined;
}

async function operatorDisplaySummary(
  ctx: QueryCtx,
  summary: string,
  input: Record<string, unknown>,
) {
  let displaySummary = summary;
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== "string" || !value) continue;
    const displayName = await referenceDisplayName(ctx, key, value);
    if (!displayName) continue;
    displaySummary = displaySummary.split(value).join(displayName);
  }
  return boundedDisplayText(displaySummary, 2_500, true);
}

async function operatorConfirmationSummary(
  ctx: MutationCtx,
  toolName: string,
  input: Record<string, unknown>,
  context: {
    operatorUserId: Id<"users">;
    threadId: Id<"operatorAgentThreads">;
  },
) {
  if (isRemainingBatchToolName(toolName)) {
    return remainingBatchConfirmationSummary(ctx, toolName, input);
  }
  if (isClientBatchToolName(toolName)) {
    return clientBatchConfirmationSummary(ctx, toolName, input);
  }
  if (
    toolName === "ensure_broker_network_profiles" ||
    toolName === "update_broker_network_profiles"
  ) {
    return getOperatorAgentToolSpec(toolName).summarize(input);
  }
  if (isProviderEmailSendTool(toolName)) {
    const identity = await assertOutreachIdentity(ctx, context.operatorUserId);
    const lines = [
      await operatorDisplaySummary(ctx, getOperatorAgentToolSpec(toolName).summarize(input), input),
      `From: ${identity.fromHeader}`,
      `Always CC: ${identity.alwaysCc ?? "None"}`,
    ];
    lines.push(
      "",
      ...(await providerLaunchApprovalLines(ctx, {
        operatorUserId: context.operatorUserId,
        input,
        budget: OPERATOR_EMAIL_SEND_SUMMARY_LIMIT - lines.join("\n").length - 2,
      })),
    );
    const summary = lines.join("\n");
    if (summary.length > OPERATOR_EMAIL_SEND_SUMMARY_LIMIT) {
      throw new Error("This email is too long to review here. Send it from the request's Email client composer.");
    }
    return summary;
  }
  if (toolName === "call_mcp_tool") {
    const id = ctx.db.normalizeId("operatorMcpServers", String(input.serverId));
    const server = id ? await ctx.db.get(id) : null;
    return `Call ${String(input.toolName)} on ${server?.name ?? "MCP server"} (${server?.url ?? "unavailable"})`;
  }
  if (toolName === "import_policy_files") {
    const orgId = normalizeOrganizationId(ctx, input.orgId);
    const files = await resolveOperatorPolicySources(ctx, {
      ...context,
      orgId,
      attachmentFileIds: stringList(input.attachmentFileIds),
      clientFileIds: stringList(input.clientFileIds),
    });
    const client = await ctx.db.get(orgId);
    return `Import into ${client!.name}'s policy library\nFiles: ${files.map((file) => file.fileName).join(", ")}\nGrouping: ${input.mode === "combined" ? "one policy containing all selected PDFs" : `${files.length} separate policies (one per PDF)`}\nQueue extraction; duplicate PDFs reuse existing policies.`;
  }
  if (toolName === "update_client_wiki" && input.mode === "append") {
    const client = await ctx.db.get(normalizeOrganizationId(ctx, input.orgId));
    return `Append to ${client?.name ?? "the organization"}'s company notes:\n\n${boundedDisplayText(String(input.markdown), 2_000, true)}`;
  }
  if (toolName === "send_email_draft") {
    const { summary } = await operatorEmailSendConfirmation(ctx, {
      operatorUserId: context.operatorUserId,
      threadId: context.threadId,
      draftId: input.draftId,
    });
    return boundedDisplayText(summary, OPERATOR_EMAIL_SEND_SUMMARY_LIMIT, true);
  }
  if (toolName !== "update_broker_network_profile") {
    return operatorDisplaySummary(
      ctx,
      getOperatorAgentToolSpec(toolName).summarize(input),
      input,
    );
  }
  const details = await getBrokerProfileDetails(
    ctx,
    normalizeOrganizationId(ctx, input.brokerOrgId),
  );
  const current: Record<string, unknown> = {
    ...details.profile,
    ...details.broker,
  };
  const changes = Object.entries(input)
    .filter(
      ([key, value]) =>
        key !== "brokerOrgId" && key !== "evidence" && value !== undefined,
    )
    .map(([key, value]) => {
      const next =
        key === "officeAddress" && value && typeof value === "object"
          ? { ...details.profile?.officeAddress, ...value }
          : value;
      const label = operatorUpdateFieldLabel(key).toLowerCase();
      const previous = operatorUpdateValue(key, current[key]);
      if (
        next === null ||
        next === "" ||
        (Array.isArray(next) && !next.length)
      ) {
        return `Clear ${label} (currently ${previous}).`;
      }
      const valueText = operatorUpdateValue(key, next);
      if (previous === "Not set" || previous === "None") {
        return `Set ${label} to ${valueText}.`;
      }
      return `Change ${label} from ${previous} to ${valueText}.`;
    });
  return boundedDisplayText(
    [`Update ${details.broker.name}`, ...changes].join("\n"),
    2_500,
    true,
  );
}

function boundedTokenEditDistance(
  left: string,
  right: string,
  maximum: number,
) {
  if (Math.abs(left.length - right.length) > maximum) return maximum + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      const distance = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + cost,
      );
      current.push(distance);
      rowMinimum = Math.min(rowMinimum, distance);
    }
    if (rowMinimum > maximum) return maximum + 1;
    previous = current;
  }
  return previous[right.length];
}

function searchTokensMatch(left: string, right: string) {
  if (left === right || left.includes(right) || right.includes(left))
    return true;
  const maximum = Math.max(left.length, right.length) >= 7 ? 2 : 1;
  if (Math.min(left.length, right.length) < 4) return false;
  return boundedTokenEditDistance(left, right, maximum) <= maximum;
}

function organizationSearchScore(
  organization: {
    name: string;
    slug?: string;
    website?: string;
    primaryContactEmail?: string;
  },
  query: string,
) {
  if (!query) return 1;
  const normalizedQuery = normalizedSearchText(query);
  const normalizedName = normalizedSearchText(organization.name);
  const normalizedFields = [
    organization.name,
    organization.slug,
    organization.website,
    organization.primaryContactEmail,
  ]
    .filter((value): value is string => Boolean(value))
    .map(normalizedSearchText);
  if (normalizedName === normalizedQuery) return 100;
  if (normalizedName.includes(normalizedQuery)) return 95;
  if (normalizedFields.some((field) => field.includes(normalizedQuery)))
    return 90;

  const queryTokens = uniqueSearchTerms(query);
  const fieldTokens = uniqueSearchTerms(normalizedFields.join(" "));
  const nameTokens = uniqueSearchTerms(organization.name);
  const queryMatches = queryTokens.filter((queryToken) =>
    fieldTokens.some((fieldToken) => searchTokensMatch(queryToken, fieldToken)),
  ).length;
  const nameMatches = nameTokens.filter((nameToken) =>
    queryTokens.some((queryToken) => searchTokensMatch(nameToken, queryToken)),
  ).length;
  if (queryMatches === 0) return 0;
  const queryCoverage = queryMatches / Math.max(queryTokens.length, 1);
  const nameCoverage = nameMatches / Math.max(nameTokens.length, 1);
  if (nameCoverage === 1) return 75 + queryCoverage * 10;
  if (queryCoverage === 1) return 55 + nameCoverage * 10;
  return queryCoverage >= 0.5 && nameCoverage >= 0.5
    ? 30 + queryCoverage * 10 + nameCoverage * 10
    : 0;
}

function selectedRecordFields(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  const record = recordValue(value);
  if (!record) return {};
  return Object.fromEntries(
    fields.flatMap((field) =>
      record[field] === undefined ? [] : [[field, record[field]]],
    ),
  );
}

export function normalizeOperatorCoiBatch(
  value: unknown,
): OperatorActionToolResult {
  const batch = recordValue(value) ?? {};
  const rows = Array.isArray(batch.results) ? batch.results : [];
  const certificates = rows.map((row) =>
    selectedRecordFields(row, [
      "status",
      "message",
      "policyId",
      "fileId",
      "fileName",
      "clientFileId",
      "size",
      "certificateId",
      "policyCertificateId",
      "certificateVersionId",
      "holderId",
      "versionNumber",
      "requestKind",
      "additionalInsuredName",
      "requiredChanges",
      "reasonCode",
      "reason",
      "evidence",
      "emailDraft",
      "brokerHandoffOffered",
      "rebuildStatus",
    ]),
  );
  const attachments = certificates.flatMap((certificate) => {
    if (
      typeof certificate.fileId !== "string" ||
      typeof certificate.fileName !== "string"
    ) {
      return [];
    }
    return [
      {
        fileId: certificate.fileId as Id<"_storage">,
        filename: certificate.fileName,
        contentType: "application/pdf",
        size: typeof certificate.size === "number" ? certificate.size : 0,
      },
    ];
  });
  return {
    result: {
      ...selectedRecordFields(batch, [
        "status",
        "generationBatchId",
        "requirementSourceDocumentId",
        "holder",
      ]),
      certificates,
      gaps: Array.isArray(batch.gaps) ? batch.gaps : [],
    },
    attachments: attachments.length > 0 ? attachments : undefined,
  };
}

async function validateOperatorAttachments(
  ctx: MutationCtx,
  operatorUserId: Id<"users">,
  attachments: OperatorAttachment[] | undefined,
  options: { requireUploadIntent?: boolean } = {},
): Promise<OperatorAttachment[] | undefined> {
  if (!attachments?.length) return undefined;

  const seen = new Set<string>();
  const normalized: OperatorAttachment[] = [];
  let aggregateSize = 0;
  for (const attachment of attachments) {
    const fileKey = String(attachment.fileId);
    if (seen.has(fileKey)) throw new Error("Duplicate operator attachment");
    seen.add(fileKey);
    const existingReference = await ctx.db
      .query("operatorAgentAttachments")
      .withIndex("file", (index) => index.eq("fileId", attachment.fileId))
      .first();
    if (
      existingReference &&
      existingReference.operatorUserId !== operatorUserId
    ) {
      throw new Error("Operator attachment belongs to another operator");
    }
    const uploadIntent = attachment.uploadIntentId
      ? await ctx.db.get(attachment.uploadIntentId)
      : null;
    if (options.requireUploadIntent || attachment.uploadIntentId) {
      if (
        !uploadIntent ||
        uploadIntent.operatorUserId !== operatorUserId ||
        uploadIntent.expiresAt <= dayjs().valueOf() ||
        uploadIntent.fileId !== attachment.fileId
      ) {
        throw new Error(
          "Operator attachment upload intent is invalid or expired",
        );
      }
    }
    const metadata = await ctx.db.system.get("_storage", attachment.fileId);
    if (!metadata) throw new Error("Operator attachment was not uploaded");
    if (metadata.size > MAX_AGENT_ATTACHMENT_BYTES) {
      throw new Error(
        `${attachment.filename || "Attachment"} exceeds the 25 MB file limit`,
      );
    }
    aggregateSize += metadata.size;
    if (aggregateSize > MAX_AGENT_ATTACHMENT_AGGREGATE_BYTES) {
      throw new Error("Operator attachments exceed the 50 MB message limit");
    }
    const filename = normalizeAgentAttachmentFilename(attachment.filename);
    if (uploadIntent) {
      await ctx.db.delete(uploadIntent._id);
    }
    normalized.push({
      fileId: attachment.fileId,
      filename,
      contentType: normalizeAgentAttachmentContentType(
        attachment.contentType,
        metadata.contentType || "application/octet-stream",
      ),
      size: metadata.size,
    });
  }
  return normalized;
}

async function attachGeneratedOperatorArtifacts(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    threadId: Id<"operatorAgentThreads">;
    messageId: Id<"operatorAgentMessages">;
    attachments: OperatorAttachment[] | undefined;
  },
) {
  if (!args.attachments?.length) return undefined;
  const normalized: OperatorAttachment[] = [];
  for (const attachment of args.attachments) {
    const metadata = await ctx.db.system.get("_storage", attachment.fileId);
    if (!metadata) continue;
    const value = {
      fileId: attachment.fileId,
      filename: normalizeAgentAttachmentFilename(attachment.filename),
      contentType: normalizeAgentAttachmentContentType(
        attachment.contentType,
        metadata.contentType || "application/octet-stream",
      ),
      size: metadata.size,
    };
    normalized.push(value);
    const existing = await ctx.db
      .query("operatorAgentAttachments")
      .withIndex("thread_file", (index) =>
        index.eq("threadId", args.threadId).eq("fileId", value.fileId),
      )
      .first();
    if (!existing) {
      await ctx.db.insert("operatorAgentAttachments", {
        ...value,
        operatorUserId: args.operatorUserId,
        threadId: args.threadId,
        messageId: args.messageId,
        createdAt: dayjs().valueOf(),
      });
    }
  }
  if (normalized.length === 0) return undefined;
  const message = await ctx.db.get(args.messageId);
  const byFile = new Map(
    [...(message?.attachments ?? []), ...normalized].map((attachment) => [
      String(attachment.fileId),
      attachment,
    ]),
  );
  const merged = [...byFile.values()];
  await ctx.db.patch(args.messageId, { attachments: merged });
  return merged;
}

function parseStoredOutput(value: string | undefined) {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function assertOperatorRole(
  actual: OperatorToolRole,
  required: OperatorToolRole,
) {
  if (!operatorToolRoleAllowed(actual, required)) {
    throw new Error("This operator action requires an owner");
  }
}

function normalizedOptionalText(value: unknown) {
  if (value === null) return undefined;
  if (typeof value !== "string") return undefined;
  return value.trim() || undefined;
}

function normalizeOperatorConversationKey(value: string) {
  const conversationKey = value.trim();
  if (!conversationKey) throw new Error("Conversation key is required");
  if (conversationKey.length > MAX_OPERATOR_CONVERSATION_KEY_CHARS) {
    throw new Error("Conversation key is too long");
  }
  return conversationKey;
}

function normalizeOperatorThreadTitle(value: string | undefined) {
  return value?.trim().replace(/\s+/g, " ").slice(0, 200) || "New chat";
}

function normalizeOrganizationId(ctx: QueryCtx | MutationCtx, value: unknown) {
  if (typeof value !== "string")
    throw new NoWriteInputError(
      "invalid_identifier",
      "Organization ID is required",
    );
  const orgId = ctx.db.normalizeId("organizations", value);
  if (!orgId)
    throw new NoWriteInputError(
      "invalid_identifier",
      "Invalid organization ID",
    );
  return orgId;
}

function normalizePolicyId(ctx: QueryCtx | MutationCtx, value: unknown) {
  if (typeof value !== "string")
    throw new NoWriteInputError("invalid_identifier", "Policy ID is required");
  const policyId = ctx.db.normalizeId("policies", value);
  if (!policyId)
    throw new NoWriteInputError("invalid_identifier", "Invalid policy ID");
  return policyId;
}

function alreadyRunningExtraction(policyId: Id<"policies">) {
  return {
    status: "already_running" as const,
    policyId,
    message:
      "An extraction is already running; no new one was queued. Check get_policy_status for progress.",
  };
}

const CLIENT_FILE_SCAN_LIMIT = 1_000;
const RESEARCH_POLL_MS = 3_000;

/** Offset into the sorted match list of one bounded policy scan. */
function listCursorOffset(value: unknown) {
  if (value === undefined) return 0;
  if (typeof value !== "string" || !/^\d{1,4}$/.test(value))
    throw new NoWriteInputError(
      "invalid_continuation",
      "Cursor is invalid. Restart without a cursor using the original filters.",
    );
  return Number(value);
}

function fileListCursor(value: unknown) {
  if (value === undefined) return undefined;
  const match = typeof value === "string" ? /^(\d{1,16}):(\d{1,4})$/.exec(value) : null;
  if (!match)
    throw new NoWriteInputError(
      "invalid_continuation",
      "Cursor is invalid. Restart without a cursor using the original filters.",
    );
  return { createdAt: Number(match[1]), skip: Number(match[2]) };
}

function normalizeClientFileId(ctx: QueryCtx | MutationCtx, value: unknown) {
  if (typeof value !== "string")
    throw new NoWriteInputError(
      "invalid_identifier",
      "Client file ID is required",
    );
  const clientFileId = ctx.db.normalizeId("clientFiles", value);
  if (!clientFileId)
    throw new NoWriteInputError("invalid_identifier", "Invalid client file ID");
  return clientFileId;
}

function normalizeProcurementRequestId(
  ctx: QueryCtx | MutationCtx,
  value: unknown,
) {
  if (typeof value !== "string") {
    throw new NoWriteInputError(
      "invalid_identifier",
      "Procurement request ID is required",
    );
  }
  const requestId = ctx.db.normalizeId("procurementRequests", value);
  if (!requestId)
    throw new NoWriteInputError(
      "invalid_identifier",
      "Invalid procurement request ID",
    );
  return requestId;
}

function normalizeInformationQuestionId(
  ctx: QueryCtx | MutationCtx,
  value: string,
) {
  const id = ctx.db.normalizeId("procurementInformationQuestions", value);
  if (!id)
    throw new NoWriteInputError(
      "invalid_identifier",
      "Use an exact information question ID from list_procurement_information",
    );
  return id;
}

function normalizeInformationFormId(
  ctx: QueryCtx | MutationCtx,
  value: unknown,
) {
  const id =
    typeof value === "string"
      ? ctx.db.normalizeId("procurementInformationForms", value)
      : null;
  if (!id)
    throw new NoWriteInputError(
      "invalid_identifier",
      "Use an exact information form ID from list_procurement_information",
    );
  return id;
}

function normalizeProcurementOutreachId(
  ctx: QueryCtx | MutationCtx,
  value: unknown,
) {
  if (typeof value !== "string") {
    throw new NoWriteInputError(
      "invalid_identifier",
      "Procurement provider outreach ID is required",
    );
  }
  const outreachId = ctx.db.normalizeId("procurementBrokerOutreaches", value);
  if (!outreachId)
    throw new NoWriteInputError(
      "invalid_identifier",
      "Invalid procurement provider outreach ID",
    );
  return outreachId;
}

function normalizeProcurementFileItemId(
  ctx: QueryCtx | MutationCtx,
  value: unknown,
) {
  if (typeof value !== "string") {
    throw new NoWriteInputError(
      "invalid_identifier",
      "Procurement file item ID is required",
    );
  }
  const fileItemId = ctx.db.normalizeId("procurementFileItems", value);
  if (!fileItemId)
    throw new NoWriteInputError(
      "invalid_identifier",
      "Invalid procurement file item ID",
    );
  return fileItemId;
}

function emailThreadIdInput(value: unknown) {
  if (typeof value !== "string") {
    throw new NoWriteInputError(
      "invalid_identifier",
      "Procurement email thread ID is required",
    );
  }
  return value;
}

const invalidEmailThreadId = () =>
  new NoWriteInputError(
    "invalid_identifier",
    "Invalid procurement email thread ID",
  );

async function normalizeProcurementEmailThreadId(
  ctx: QueryCtx | MutationCtx,
  value: unknown,
) {
  const id = ctx.db.normalizeId("teamEmailThreads", emailThreadIdInput(value));
  if (!id) throw invalidEmailThreadId();
  return id;
}

function normalizeProcurementProposalId(
  ctx: QueryCtx | MutationCtx,
  value: unknown,
) {
  if (typeof value !== "string") {
    throw new NoWriteInputError(
      "invalid_identifier",
      "Procurement proposal ID is required",
    );
  }
  const id = ctx.db.normalizeId("procurementProposals", value);
  if (!id)
    throw new NoWriteInputError(
      "invalid_identifier",
      "Invalid procurement proposal ID",
    );
  return id;
}

function normalizeProcurementProposalReviewId(
  ctx: QueryCtx | MutationCtx,
  value: unknown,
) {
  if (typeof value !== "string") {
    throw new NoWriteInputError(
      "invalid_identifier",
      "Procurement proposal review ID is required",
    );
  }
  const id = ctx.db.normalizeId("procurementProposalReviews", value);
  if (!id)
    throw new NoWriteInputError(
      "invalid_identifier",
      "Invalid procurement proposal review ID",
    );
  return id;
}

function normalizeProcurementPacketLinkId(
  ctx: QueryCtx | MutationCtx,
  value: unknown,
) {
  if (typeof value !== "string") {
    throw new NoWriteInputError(
      "invalid_identifier",
      "Procurement packet link ID is required",
    );
  }
  const id = ctx.db.normalizeId("procurementPacketLinks", value);
  if (!id)
    throw new NoWriteInputError(
      "invalid_identifier",
      "Invalid procurement packet link ID",
    );
  return id;
}

function procurementOutreachStatus(value: unknown) {
  switch (value) {
    case "observed":
    case "request_sent":
    case "can_handle":
    case "cannot_handle":
    case "quote_received":
    case "quote_accepted":
    case "quote_rejected":
      return value;
    default:
      return undefined;
  }
}

function brokerNetworkStatus(value: unknown) {
  switch (value) {
    case "prospect":
    case "active":
    case "inactive":
    case "blacklisted":
      return value;
    default:
      return undefined;
  }
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : undefined;
}

function procurementFileBrokerRelease(value: unknown) {
  switch (value) {
    case "hidden":
    case "listed":
    case "attached":
      return value;
    default:
      return undefined;
  }
}

function procurementEmailCategory(value: unknown) {
  switch (value) {
    case "broker":
    case "client":
    case "internal":
    case "mixed":
    case "other":
      return value;
    default:
      return undefined;
  }
}

const MAX_RESOLVABLE_THREAD_ATTACHMENTS = 50;

async function resolveThreadAttachment(
  ctx: MutationCtx,
  threadId: Id<"operatorAgentThreads">,
  value: unknown,
) {
  const reference = typeof value === "string" ? value.trim() : "";
  const attachments = await ctx.db
    .query("operatorAgentAttachments")
    .withIndex("thread_file", (index) => index.eq("threadId", threadId))
    .take(MAX_RESOLVABLE_THREAD_ATTACHMENTS);
  const exact = reference
    ? ctx.db.system.normalizeId("_storage", reference)
    : null;
  if (exact) {
    const match = attachments.find((attachment) => attachment.fileId === exact);
    if (match) return match;
  }
  const matches = attachments.filter(
    (attachment) =>
      attachment.filename.trim().toLowerCase() === reference.toLowerCase(),
  );
  if (matches.length === 1) return matches[0]!;
  const available = attachments
    .map((attachment) => attachment.filename)
    .join(", ");
  throw new Error(
    `Attachment file ID must be an exact storage ID or filename from this thread's attachment references${
      available ? `. This thread holds: ${available}` : ""
    }`,
  );
}

async function resolveThreadAttachmentFileId(
  ctx: MutationCtx,
  threadId: Id<"operatorAgentThreads">,
  value: unknown,
) {
  return (await resolveThreadAttachment(ctx, threadId, value)).fileId;
}

async function requireOperatorThread(
  ctx: QueryCtx | MutationCtx,
  threadId: Id<"operatorAgentThreads">,
  operatorUserId: Id<"users">,
  options: { anyOperator?: boolean } = {},
) {
  const thread = await ctx.db.get(threadId);
  // Every operator conversation is open to all operators; ownership only
  // gates creator-scoped actions such as reusing an empty draft chat.
  if (
    !thread ||
    (!options.anyOperator && thread.ownerUserId !== operatorUserId)
  ) {
    throw new Error("Operator thread not found");
  }
  return thread;
}

async function findEmptyChatThread(
  ctx: MutationCtx,
  threadId: Id<"operatorAgentThreads">,
  operatorUserId: Id<"users">,
) {
  const thread = await requireOperatorThread(ctx, threadId, operatorUserId);
  if (thread.channel !== "chat") return null;
  const firstMessage = await ctx.db
    .query("operatorAgentMessages")
    .withIndex("thread", (index) => index.eq("threadId", threadId))
    .first();
  return firstMessage ? null : thread;
}

async function insertOperatorThread(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    channel: OperatorChannel;
    title?: string;
    initialContext?: {
      pageType: string;
      entityId?: string;
      summary?: string;
      href?: string;
      related?: Array<{ kind: string; id: string; label?: string }>;
    };
    conversationKey?: string;
    visibility?: "private" | "shared";
  },
) {
  const now = dayjs().valueOf();
  const initialContext = normalizeOperatorPageContext(args.initialContext);
  return ctx.db.insert("operatorAgentThreads", {
    ownerUserId: args.operatorUserId,
    visibility: args.visibility ?? "private",
    conversationKey: args.conversationKey,
    title: normalizeOperatorThreadTitle(args.title),
    lastMessageAt: now,
    channel: args.channel,
    initialContext,
    createdAt: now,
    updatedAt: now,
  });
}

export async function cancelActiveRunsForThread(
  ctx: MutationCtx,
  threadId: Id<"operatorAgentThreads">,
  reason: string,
  onlyRunId?: Id<"operatorAgentRuns">,
) {
  const runs = (
    await Promise.all(
      (["queued", "running", "waiting_confirmation"] as const).map((status) =>
        ctx.db
          .query("operatorAgentRuns")
          .withIndex("thread_status", (index) =>
            index.eq("threadId", threadId).eq("status", status),
          )
          .take(25),
      ),
    )
  ).flat().filter((run) => !onlyRunId || run._id === onlyRunId);
  const now = dayjs().valueOf();
  for (const run of runs) {
    await deleteRunContinuation(ctx, run);
    const retry = run.checkpoint?.routerRetryCount
      ? `:r${run.checkpoint.routerRetryCount}`
      : "";
    const invocationKeys = [
      `operator:${String(run._id)}:${run.checkpoint?.iteration ?? 0}${retry}:0`,
      `operator:${String(run._id)}:plan${retry}:0`,
    ].flatMap((key) => [key, `${key}:routed`]);
    for (const invocationKey of invocationKeys) {
      await cancelRouterJobForInvocation(ctx, invocationKey);
      await ctx.scheduler.runAfter(0, internal.actions.routerJobs.cancel, {
        invocationKey,
      });
    }
    await ctx.db.patch(run._id, {
      status: "cancelled",
      modelContinuationStorageId: undefined,
      modelContinuationId: undefined,
      cancellationRequestedAt: now,
      completedAt: now,
      lastError: reason,
      updatedAt: now,
    });
    const message = await ctx.db.get(run.agentMessageId);
    if (message?.status === "processing") {
      await ctx.db.patch(message._id, {
        content: "Response cancelled.",
        status: "cancelled",
        updatedAt: now,
      });
    }
    const ledgerRows = await ctx.db
      .query("agentActionAuditEvents")
      .withIndex("run_created", (index) => index.eq("runId", run._id))
      .take(100);
    await Promise.all(
      ledgerRows
        .filter(
          (ledger) =>
            ledger.status === "pending" ||
            ledger.status === "awaiting_confirmation",
        )
        .map((ledger) =>
          ctx.db.patch(ledger._id, { status: "cancelled", updatedAt: now }),
        ),
    );
  }
  return runs.length;
}

async function invalidatePendingOperatorConfirmations(
  ctx: MutationCtx,
  threadId: Id<"operatorAgentThreads">,
  reason: string,
) {
  const pending = await ctx.db
    .query("operatorAgentConfirmations")
    .withIndex("thread_status", (index) =>
      index.eq("threadId", threadId).eq("status", "pending"),
    )
    .take(100);
  const now = dayjs().valueOf();
  await Promise.all(
    pending.map((confirmation) =>
      ctx.db.patch(confirmation._id, {
        status: "stale",
        invalidatedAt: now,
        invalidationReason: reason,
        updatedAt: now,
      }),
    ),
  );
}

export async function enqueueOperatorMessage(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    threadId: Id<"operatorAgentThreads">;
    channel: OperatorChannel;
    content: string;
    emailContent?: Infer<typeof operatorEmailContentValidator>;
    preservePendingEmailConfirmation?: boolean;
    emailReadOnly?: boolean;
    dedupeKey?: string;
    attachments?: OperatorAttachment[];
    pageContext?: {
      pageType: string;
      entityId?: string;
      summary?: string;
      href?: string;
      related?: Array<{ kind: string; id: string; label?: string }>;
    };
    slackThreadContext?: SlackThreadContextSnapshot;
    toolArtifacts?: Array<{ type: string; data: unknown }>;
    requireUploadIntent?: boolean;
    /** Operator asked for a plan before acting (plan mode). */
    planRequested?: boolean;
    mcpClientId?: string;
  },
) {
  const thread = await requireOperatorThread(
    ctx,
    args.threadId,
    args.operatorUserId,
    { anyOperator: true },
  );
  const content = args.content.trim();
  if (!content) throw new Error("Message content is required");
  if (content.length > MAX_OPERATOR_MESSAGE_CHARS) {
    throw new Error(
      `Operator messages must be at most ${MAX_OPERATOR_MESSAGE_CHARS.toLocaleString()} characters`,
    );
  }
  if (args.dedupeKey && args.dedupeKey.length > MAX_OPERATOR_DEDUPE_KEY_CHARS) {
    throw new Error("Operator message dedupe key is too long");
  }
  const pageContext = normalizeOperatorPageContext(args.pageContext);

  if (args.dedupeKey) {
    const existing = await ctx.db
      .query("operatorAgentMessages")
      .withIndex("thread_dedupe", (index) =>
        index.eq("threadId", args.threadId).eq("dedupeKey", args.dedupeKey),
      )
      .unique();
    if (existing?.role === "user") {
      const run = await ctx.db
        .query("operatorAgentRuns")
        .withIndex("message", (index) =>
          index.eq("userMessageId", existing._id),
        )
        .unique();
      if (run) {
        return { messageId: existing._id, runId: run._id, duplicate: true };
      }
    }
  }

  const attachments = await validateOperatorAttachments(
    ctx,
    args.operatorUserId,
    args.attachments,
    { requireUploadIntent: args.requireUploadIntent },
  );
  let slackThreadContextArtifact:
    | ReturnType<typeof createSlackThreadContextArtifact>
    | undefined;
  if (
    args.channel === "slack" &&
    args.slackThreadContext &&
    thread.conversationKey
  ) {
    const contextPrefix = `operator:${thread.conversationKey}:`;
    const existingMessages = await ctx.db
      .query("operatorAgentMessages")
      .withIndex("thread", (index) => index.eq("threadId", args.threadId))
      .order("desc")
      .take(256);
    const knownMessageTimestamps = new Set(
      existingMessages.flatMap((message) => [
        ...(message.dedupeKey?.startsWith(contextPrefix)
          ? [message.dedupeKey.slice(contextPrefix.length)]
          : []),
        ...slackThreadContextMessageTimestamps(message.toolArtifacts),
      ]),
    );
    const latestMessageTs = args.dedupeKey?.startsWith(contextPrefix)
      ? args.dedupeKey.slice(contextPrefix.length)
      : undefined;
    if (latestMessageTs) knownMessageTimestamps.add(latestMessageTs);
    slackThreadContextArtifact = createSlackThreadContextArtifact(
      args.slackThreadContext,
      { knownMessageTimestamps, latestMessageTs },
    );
  }

  if (args.channel === "email" && args.emailReadOnly) {
    const privilegedRuns = await Promise.all(
      (["queued", "running", "waiting_confirmation"] as const).map((status) =>
        ctx.db
          .query("operatorAgentRuns")
          .withIndex("thread_status", (index) =>
            index.eq("threadId", args.threadId).eq("status", status),
          )
          .filter((q) => q.neq(q.field("emailReadOnly"), true))
          .first(),
      ),
    );
    if (privilegedRuns.some(Boolean)) {
      throw new Error(
        "This conversation has an active authenticated request. Use operator chat or authenticated email to continue it.",
      );
    }
  }

  const continuedRun =
    args.channel === "email" && !args.emailReadOnly && args.preservePendingEmailConfirmation
      ? await ctx.db
          .query("operatorAgentRuns")
          .withIndex("thread_status", (index) =>
            index
              .eq("threadId", args.threadId)
              .eq("status", "waiting_confirmation"),
          )
          .order("desc")
          .first()
      : null;
  if (!continuedRun) {
    await cancelActiveRunsForThread(ctx, args.threadId, "superseded");
    await invalidatePendingOperatorConfirmations(
      ctx,
      args.threadId,
      "superseded",
    );
  }

  const now = dayjs().valueOf();
  const operator = await ctx.db.get(args.operatorUserId);
  const toolArtifacts = [
    ...(args.toolArtifacts ?? []),
    ...(slackThreadContextArtifact ? [slackThreadContextArtifact] : []),
  ];
  const userMessageId = await ctx.db.insert("operatorAgentMessages", {
    threadId: args.threadId,
    ownerUserId: args.operatorUserId,
    dedupeKey: args.dedupeKey,
    channel: args.channel,
    role: "user",
    userId: args.operatorUserId,
    userName: operator?.name ?? operator?.email ?? "Operator",
    content,
    pageContext: threadPageContext(thread) ?? pageContext,
    attachments,
    emailContent: args.emailContent,
    toolArtifacts: toolArtifacts.length > 0 ? toolArtifacts : undefined,
    createdAt: now,
    updatedAt: now,
  });
  await Promise.all(
    (attachments ?? []).map((attachment) =>
      ctx.db.insert("operatorAgentAttachments", {
        ...attachment,
        operatorUserId: args.operatorUserId,
        threadId: args.threadId,
        messageId: userMessageId,
        createdAt: now,
      }),
    ),
  );
  if (continuedRun) {
    await ctx.db.insert("operatorAgentMessages", {
      threadId: args.threadId,
      ownerUserId: args.operatorUserId,
      channel: "email",
      role: "agent",
      replyToMessageId: userMessageId,
      content:
        "The existing action is still waiting for your decision. Approve or cancel it using its controls in this conversation.",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.threadId, { lastMessageAt: now, updatedAt: now });
    return {
      messageId: userMessageId,
      runId: continuedRun._id,
      duplicate: false,
    };
  }
  const agentMessageId = await ctx.db.insert("operatorAgentMessages", {
    threadId: args.threadId,
    ownerUserId: args.operatorUserId,
    channel: args.channel,
    role: "agent",
    replyToMessageId: userMessageId,
    content: "",
    status: "processing",
    agentRunStartedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const runId = await ctx.db.insert("operatorAgentRuns", {
    threadId: args.threadId,
    operatorUserId: args.operatorUserId,
    userMessageId,
    agentMessageId,
    executionKind: "goal",
    objective: content,
    mcpClientId: args.mcpClientId,
    ...(args.channel === "email" && args.emailReadOnly ? { emailReadOnly: true } : {}),
    status: "queued",
    ...(args.planRequested ? { planRequested: true } : {}),
    checkpoint: { iteration: 0, executionCount: 0 },
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.patch(args.threadId, {
    lastMessageAt: now,
    archivedAt: undefined,
    archiveState: undefined,
    updatedAt: now,
    ...(!thread.initialContext && pageContext
      ? { initialContext: pageContext }
      : {}),
    ...(!threadPageContext(thread) && pageContext ? { pageContext } : {}),
  });
  if (thread.title === "New chat") {
    await ctx.scheduler.runAfter(
      0,
      internal.actions.threadTitle.generateOperatorTitle,
      { threadId: args.threadId, expectedTitle: "New chat" },
    );
  }
  await ctx.scheduler.runAfter(0, internal.operatorAgentRunner.run, { runId });
  return { messageId: userMessageId, runId, duplicate: false };
}

const OPERATOR_CONVERSATION_FAILURE_WINDOW = 20;
const OPERATOR_CONVERSATION_MAX_TOOL_CALLS = 40;
const OPERATOR_CONVERSATION_INPUT_PREVIEW = 200;

function operatorChannelFilter(value: unknown): OperatorChannel | undefined {
  return value === "chat" ||
    value === "slack" ||
    value === "imessage" ||
    value === "email" ||
    value === "mcp"
    ? value
    : undefined;
}

/**
 * Compact execution trace of one agent message for conversation reads: tool
 * names, truncated inputs (never outputs), failure and the run that produced
 * it, so a caller can follow up with get_operator_run.
 */
async function operatorConversationAgentTrace(
  ctx: QueryCtx | MutationCtx,
  message: Doc<"operatorAgentMessages">,
) {
  const candidates = message.replyToMessageId
    ? await ctx.db
        .query("operatorAgentRuns")
        .withIndex("message", (q) =>
          q.eq("userMessageId", message.replyToMessageId!),
        )
        .take(5)
    : [];
  const run = candidates.find(
    (candidate) => candidate.agentMessageId === message._id,
  );
  const toolCalls = message.toolCalls ?? [];
  const usedTools =
    message.usedTools ??
    (message.activity
      ? [...new Set(message.activity.tools.map((tool) => tool.toolName))]
      : undefined);
  return {
    status: message.status,
    runId: run?._id,
    run: run
      ? {
          status: run.status,
          iteration: run.checkpoint?.iteration,
          executionCount: run.checkpoint?.executionCount,
          lastToolName: run.checkpoint?.lastToolName,
        }
      : undefined,
    usedTools,
    toolCalls: toolCalls.length
      ? toolCalls
          .slice(-OPERATOR_CONVERSATION_MAX_TOOL_CALLS)
          .map((call) => ({
            name: call.name,
            input: call.input?.slice(0, OPERATOR_CONVERSATION_INPUT_PREVIEW),
          }))
      : undefined,
    toolCallCount: toolCalls.length || undefined,
    failure:
      message.failure || message.status === "error"
        ? {
            category: message.failure?.code ?? "error",
            message: message.error?.slice(0, 300),
            retryable: message.failure?.retryable,
            executionStarted: message.failure?.executionStarted,
          }
        : undefined,
  };
}

/** Reads a thread detail in its own function run; the read paginates and a function may paginate once. */
async function readTeamThreadOwnRun(
  ctx: MutationCtx,
  threadId: Id<"teamEmailThreads">,
  viewerUserId: Id<"users">,
): Promise<Awaited<ReturnType<typeof getTeamThreadDetails>>> {
  return await ctx.runQuery(internal.operatorBulkReads.teamThreadDetailsInternal, {
    threadId,
    viewerUserId,
  });
}

type OperatorToolDomainArgs = {
  runId?: Id<"operatorAgentRuns">;
  operatorUserId: Id<"users">;
  threadId: Id<"operatorAgentThreads">;
  channel: OperatorChannel;
  toolName: OperatorAgentToolName;
  input: Record<string, unknown>;
  sourceFingerprint?: string;
};

async function executeToolDomain(ctx: MutationCtx, args: OperatorToolDomainArgs) {
  const { toolName, input } = resolveOperatorToolDispatch(args.toolName, args.input);
  if (toolName === "get_platform_status") {
    const sections = [...new Set(stringList(input.sections) ?? ["overview"])];
    const entries = await Promise.all(sections.map(async (section) => {
      const name = section === "overview" ? "get_operator_overview" : section === "routing" ? "get_routing_status" : "get_channel_health";
      return [section, await executeToolDomainSingle(ctx, { ...args, toolName: name, input })];
    }));
    return Object.fromEntries(entries);
  }
  if (toolName === "get_procurement_information") {
    if (!input.include) {
      const information = await procurementInformationOverview(
        ctx, normalizeProcurementRequestId(ctx, input.procurementRequestId),
      );
      return {
        providers: information.providers,
        questionCount: information.questions.length,
        formCount: information.forms.length,
      };
    }
    const sections = [...new Set(stringList(input.include) ?? [])];
    const entries = await Promise.all(sections.map(async (section) => [
      section,
      await executeToolDomainSingle(ctx, { ...args, toolName: section === "information" ? "list_procurement_information" : "list_procurement_client_outreach", input }),
    ]));
    return Object.fromEntries(entries);
  }
  return executeToolDomainSingle(ctx, { ...args, toolName, input });
}

async function executeToolDomainSingle(ctx: MutationCtx, args: OperatorToolDomainArgs) {
  const { toolName, input } = args;
  if (toolName === "compact_context") {
    const run = args.runId ? await ctx.db.get(args.runId) : null;
    return run?.executionKind === "direct_tool"
      ? { status: "not_applicable", note: "Direct MCP tools have no model working context. Use compact_context inside run_operator_task." }
      : { status: "compaction_requested", ...input };
  }
  if (toolName === "list_operator_conversations") {
    const archived = input.archived === true;
    const archiveState = archived ? "archived" : undefined;
    const channel = operatorChannelFilter(input.channel);
    const sinceMs =
      typeof input.since === "string"
        ? dayjs(`${input.since}T00:00:00Z`).valueOf()
        : undefined;
    const threads =
      input.scope === "all"
        ? channel
          ? ctx.db
              .query("operatorAgentThreads")
              .withIndex("archive_channel_last_message", (q) => {
                const channelScope = q
                  .eq("archiveState", archiveState)
                  .eq("channel", channel);
                return sinceMs === undefined
                  ? channelScope
                  : channelScope.gte("lastMessageAt", sinceMs);
              })
          : ctx.db
              .query("operatorAgentThreads")
              .withIndex("archive_last_message", (q) => {
                const archiveScope = q.eq("archiveState", archiveState);
                return sinceMs === undefined
                  ? archiveScope
                  : archiveScope.gte("lastMessageAt", sinceMs);
              })
        : ctx.db
            .query("operatorAgentThreads")
            .withIndex("owner_archive", (q) => {
              const ownerScope = q
                .eq("ownerUserId", args.operatorUserId)
                .eq("archiveState", archiveState);
              return sinceMs === undefined
                ? ownerScope
                : ownerScope.gte("lastMessageAt", sinceMs);
            })
            .filter((q) =>
              channel ? q.eq(q.field("channel"), channel) : true,
            );
    const page = await threads.order("desc").paginate({
      cursor: typeof input.cursor === "string" ? input.cursor : null,
      numItems: typeof input.limit === "number" ? input.limit : 15,
    });
    const wantFailure =
      typeof input.hasFailure === "boolean" ? input.hasFailure : undefined;
    const failureFlags =
      wantFailure === undefined
        ? undefined
        : await Promise.all(
            page.page.map(async (thread) => {
              const recent = await ctx.db
                .query("operatorAgentMessages")
                .withIndex("thread", (q) => q.eq("threadId", thread._id))
                .order("desc")
                .take(OPERATOR_CONVERSATION_FAILURE_WINDOW);
              return recent.some(
                (message) =>
                  message.role === "agent" &&
                  (message.status === "error" || Boolean(message.failure)),
              );
            }),
          );
    const visible = failureFlags
      ? page.page.filter((_thread, index) => failureFlags[index] === wantFailure)
      : page.page;
    const people = await operatorPeople(
      ctx,
      visible.map((thread) => thread.ownerUserId),
    );
    return {
      conversations: visible.map((thread) => ({
        threadId: thread._id,
        title: thread.title,
        channel: thread.channel,
        createdBy: people.get(thread.ownerUserId)?.name,
        archived: Boolean(thread.archivedAt),
        lastMessageAt: thread.lastMessageAt,
      })),
      nextCursor: page.isDone ? null : page.continueCursor,
      isDone: page.isDone,
    };
  }
  if (toolName === "read_operator_conversation") {
    const threadId =
      typeof input.operatorThreadId === "string"
        ? ctx.db.normalizeId("operatorAgentThreads", input.operatorThreadId)
        : null;
    if (!threadId) throw new Error("Operator conversation not found");
    const thread = await requireOperatorThread(
      ctx,
      threadId,
      args.operatorUserId,
      { anyOperator: true },
    );
    const page = await ctx.db
      .query("operatorAgentMessages")
      .withIndex("thread", (q) => q.eq("threadId", threadId))
      .order("desc")
      .paginate({
        cursor: typeof input.cursor === "string" ? input.cursor : null,
        numItems: typeof input.limit === "number" ? input.limit : 5,
      });
    const messages = await Promise.all(
      page.page.map(async (message) => ({
        messageId: message._id,
        role: message.role,
        author: message.userName,
        channel: message.channel,
        createdAt: message.createdAt,
        content: message.content,
        attachments: message.attachments?.map(
          ({ filename, contentType, size }) => ({
            filename,
            contentType,
            size,
          }),
        ),
        ...(message.role === "agent"
          ? await operatorConversationAgentTrace(ctx, message)
          : {}),
      })),
    );
    return {
      threadId,
      title: thread.title,
      messages,
      nextCursor: page.isDone ? null : page.continueCursor,
      isDone: page.isDone,
    };
  }
  if (toolName === "search_organizations") {
    const queryText = typeof input.query === "string" ? input.query.trim() : "";
    const queryList = Array.isArray(input.queries)
      ? input.queries.flatMap((value: unknown) =>
          typeof value === "string" && value.trim() ? [value.trim()] : [],
        )
      : undefined;
    const statusFilter = Array.isArray(input.clientAccessStatus)
      ? new Set<unknown>(input.clientAccessStatus)
      : undefined;
    const assigneeFilter =
      typeof input.assigneeUserId === "string"
        ? ctx.db.normalizeId("users", input.assigneeUserId)
        : undefined;
    if (assigneeFilter === null)
      throw new NoWriteInputError(
        "invalid_identifier",
        "Invalid assignee user ID",
      );
    const clientFilters = Boolean(statusFilter || assigneeFilter);
    if (clientFilters && input.type === "broker")
      throw new NoWriteInputError(
        "invalid_filter",
        "clientAccessStatus and assigneeUserId apply to clients only",
      );
    const requestedType =
      input.type === "client" || clientFilters
        ? "client"
        : input.type === "broker"
          ? "broker"
          : undefined;
    const sort = input.sort === "created_desc" ? "created_desc" : "name";
    const limit =
      typeof input.limit === "number" ? input.limit : queryList ? 5 : 15;
    const order = sort === "created_desc" ? "desc" : "asc";
    const takeType = (type: "client" | "broker" | undefined) =>
      ctx.db
        .query("organizations")
        .withIndex("deletion_type", (index) =>
          index.eq("deletedAt", undefined).eq("type", type),
        )
        .order(order)
        .take(500);
    const ranges =
      requestedType === "client"
        ? await Promise.all(
            clientFilters
              ? [takeType("client")]
              : [takeType("client"), takeType(undefined)],
          )
        : requestedType === "broker"
          ? [await takeType("broker")]
          : [
              await ctx.db
                .query("organizations")
                .withIndex("deletion_type", (q) => q.eq("deletedAt", undefined))
                .order(order)
                .take(1_000),
            ];
    const organizations = ranges.flat();
    const scanBounded = ranges.some(
      (range) => range.length >= (requestedType ? 500 : 1_000),
    );
    const candidates = organizations.filter(
      (organization) =>
        (organization.type !== "broker" ||
          !isSpotOwnedBrokerIdentity(organization)) &&
        (!statusFilter ||
          statusFilter.has(clientAccessStatus(organization))) &&
        (!assigneeFilter ||
          organization.assignedOperatorUserId === assigneeFilter),
    );
    const byQuery = (query: string) =>
      candidates
        .map((organization) => ({
          organization,
          score: organizationSearchScore(organization, query),
        }))
        .filter(({ score }) => score > 0)
        .sort(
          (left, right) =>
            right.score - left.score ||
            left.organization.name.localeCompare(right.organization.name),
        )
        .map(({ organization }) => organization);
    const presentRows = async (groups: Doc<"organizations">[][]) => {
      const assignees = await loadOrganizationAssignees(ctx, groups.flat());
      return groups.map((group) =>
        group.map((organization) => organizationRow(organization, assignees)),
      );
    };

    if (queryList) {
      const matched = queryList.map(byQuery);
      const rows = await presentRows(
        matched.map((matches) => matches.slice(0, limit)),
      );
      const results = queryList.map((query, index) => ({
        query,
        organizations: rows[index],
        matchedInScan: matched[index].length,
        bounded: scanBounded || matched[index].length > limit,
      }));
      return {
        results,
        scanned: organizations.length,
        bounded: results.some((result) => result.bounded),
        scanBounded,
        limit,
      };
    }

    if (queryText) {
      const matches = byQuery(queryText);
      const [rows] = await presentRows([matches.slice(0, limit)]);
      return {
        organizations: rows,
        matchedInScan: matches.length,
        scanned: organizations.length,
        bounded: scanBounded || matches.length > limit,
        scanBounded,
        limit,
      };
    }

    // Listing: keyset pagination over the bounded scan, stable under inserts.
    const sorted = [...candidates].sort((left, right) =>
      sort === "created_desc"
        ? right._creationTime - left._creationTime ||
          left._id.localeCompare(right._id)
        : left.name.localeCompare(right.name) ||
          left._id.localeCompare(right._id),
    );
    let remaining = sorted;
    if (typeof input.cursor === "string") {
      let position: { s?: unknown; k?: unknown; id?: unknown } | null = null;
      try {
        position = JSON.parse(input.cursor);
      } catch {
        position = null;
      }
      if (
        !position ||
        position.s !== sort ||
        (typeof position.k !== "string" && typeof position.k !== "number") ||
        typeof position.id !== "string"
      )
        throw new NoWriteInputError(
          "invalid_cursor",
          "Invalid cursor; restart the listing without a cursor using the same sort",
        );
      const { k, id } = position;
      remaining = sorted.filter((organization) =>
        sort === "created_desc"
          ? organization._creationTime < Number(k) ||
            (organization._creationTime === Number(k) &&
              organization._id.localeCompare(id) > 0)
          : organization.name.localeCompare(String(k)) > 0 ||
            (organization.name.localeCompare(String(k)) === 0 &&
              organization._id.localeCompare(id) > 0),
      );
    }
    const page = remaining.slice(0, limit);
    const last = page.at(-1);
    const nextCursor =
      last && remaining.length > limit
        ? JSON.stringify({
            s: sort,
            k: sort === "created_desc" ? last._creationTime : last.name,
            id: last._id,
          })
        : null;
    const [rows] = await presentRows([page]);
    return {
      organizations: rows,
      matchedInScan: sorted.length,
      scanned: organizations.length,
      bounded: scanBounded || nextCursor !== null,
      scanBounded,
      limit,
      nextCursor,
    };
  }

  if (toolName === "get_organization") {
    const orgId = normalizeOrganizationId(ctx, input.orgId);
    const organization = await ctx.db.get(orgId);
    if (!organization || organization.deletedAt !== undefined)
      throw new Error("Organization not found");
    return await organizationDetail(
      ctx,
      organization,
      await loadOrganizationAssignees(ctx, [organization]),
      organizationIncludeSet(input.include),
      5_000,
    );
  }

  if (toolName === "get_organizations") {
    const requested: unknown[] = Array.isArray(input.orgIds)
      ? input.orgIds
      : [];
    const loaded = await Promise.all(
      requested.map(async (value) => {
        const orgId =
          typeof value === "string"
            ? ctx.db.normalizeId("organizations", value)
            : null;
        const organization = orgId ? await ctx.db.get(orgId) : null;
        return organization && organization.deletedAt === undefined
          ? organization
          : null;
      }),
    );
    const found = [
      ...new Map(
        loaded.flatMap((organization) =>
          organization ? [[organization._id, organization] as const] : [],
        ),
      ).values(),
    ];
    const assignees = await loadOrganizationAssignees(ctx, found);
    const include = organizationIncludeSet(input.include);
    return {
      organizations: await Promise.all(
        found.map((organization) =>
          organizationDetail(ctx, organization, assignees, include, 100),
        ),
      ),
      notFound: requested.flatMap((value, index) =>
        loaded[index] ? [] : [String(value)],
      ),
    };
  }

  if (toolName === "get_client_assignees") {
    const assigneeFilter =
      input.assigneeUserId === undefined
        ? undefined
        : typeof input.assigneeUserId === "string"
          ? ctx.db.normalizeId("users", input.assigneeUserId)
          : null;
    if (assigneeFilter === null)
      throw new NoWriteInputError(
        "invalid_identifier",
        "Invalid assignee user ID",
      );
    const notFound: string[] = [];
    let clients: Doc<"organizations">[];
    let bounded = false;
    if (Array.isArray(input.orgIds)) {
      const loaded = await Promise.all(
        input.orgIds.map(async (value: unknown) => {
          const orgId =
            typeof value === "string"
              ? ctx.db.normalizeId("organizations", value)
              : null;
          const organization = orgId ? await ctx.db.get(orgId) : null;
          if (
            !organization ||
            organization.deletedAt !== undefined ||
            organization.type !== "client"
          ) {
            notFound.push(String(value));
            return null;
          }
          return organization;
        }),
      );
      clients = loaded.filter((organization) => organization !== null);
    } else {
      clients = await ctx.db
        .query("organizations")
        .withIndex("deletion_type", (q) =>
          q.eq("deletedAt", undefined).eq("type", "client"),
        )
        .take(501);
      bounded = clients.length > 500;
      clients = clients.slice(0, 500);
    }
    if (assigneeFilter)
      clients = clients.filter(
        (organization) => organization.assignedOperatorUserId === assigneeFilter,
      );
    const people = await operatorPeople(
      ctx,
      clients.flatMap((organization) =>
        organization.assignedOperatorUserId
          ? [organization.assignedOperatorUserId]
          : [],
      ),
    );
    return {
      clients: clients.map((organization) => ({
        orgId: organization._id,
        clientName: organization.name,
        assignee: organization.assignedOperatorUserId
          ? (people.get(organization.assignedOperatorUserId) ?? null)
          : null,
      })),
      notFound,
      bounded,
    };
  }

  if (toolName === "list_operators") {
    const profiles = await ctx.db.query("operatorProfiles").take(200);
    const operators = await Promise.all(
      profiles.map(async (profile) => ({
        userId: profile.userId,
        name: (await operatorPerson(ctx, profile.userId)).name,
        email: profile.email,
        role: profile.role,
        status: profile.status,
      })),
    );
    return {
      operators: operators.sort((a, b) => a.name.localeCompare(b.name)),
      bounded: profiles.length === 200,
    };
  }

  if (toolName === "describe_record_fields") {
    return describeOperatorRecordFields(
      input.record as OperatorDescribableRecord,
    );
  }

  if (toolName === "get_operator_overview") {
    const [organizations, policies, extractionRuns, agentRuns] =
      await Promise.all([
        ctx.db
          .query("organizations")
          .withIndex("deletion_type", (q) => q.eq("deletedAt", undefined))
          .take(2_000),
        ctx.db.query("policies").take(5_000),
        ctx.db.query("policyExtractionRuns").take(5_000),
        ctx.db.query("operatorAgentRuns").take(2_000),
      ]);
    return {
      organizations: {
        total: organizations.length,
        brokers: organizations.filter(
          (org) => org.type === "broker" && !isSpotOwnedBrokerIdentity(org),
        ).length,
        spot: organizations.filter(
          (org) => org.type === "broker" && isSpotOwnedBrokerIdentity(org),
        ).length,
        clients: organizations.filter((org) => org.type !== "broker").length,
      },
      policies: {
        active: policies.filter((policy) => !policy.deletedAt).length,
        archived: policies.filter((policy) => policy.deletedAt).length,
      },
      extractions: {
        running: extractionRuns.filter(
          (run) => run.pipelineStatus === "running",
        ).length,
        paused: extractionRuns.filter((run) => run.pipelineStatus === "paused")
          .length,
        failed: extractionRuns.filter((run) => run.pipelineStatus === "error")
          .length,
      },
      operatorAgent: {
        active: agentRuns.filter((run) => ACTIVE_RUN_STATUSES.has(run.status))
          .length,
        failed: agentRuns.filter((run) => run.status === "failed").length,
      },
      bounded: {
        organizations: organizations.length === 2_000,
        policies: policies.length === 5_000,
        extractionRuns: extractionRuns.length === 5_000,
        operatorAgentRuns: agentRuns.length === 2_000,
      },
    };
  }

  if (toolName === "list_policies") {
    const orgId = normalizeOrganizationId(ctx, input.orgId);
    const organization = await ctx.db.get(orgId);
    if (!organization || organization.deletedAt !== undefined)
      throw new Error("Organization not found");
    const queryText =
      typeof input.query === "string" ? input.query.trim().toLowerCase() : "";
    const limit = typeof input.limit === "number" ? input.limit : 15;
    const includeArchived = input.includeArchived === true;
    const expiringBefore =
      typeof input.expiringBefore === "string"
        ? dayjs(input.expiringBefore).endOf("day")
        : undefined;
    const offset = listCursorOffset(input.cursor);
    const policies = await ctx.db
      .query("policies")
      .withIndex("organization", (index) => index.eq("orgId", orgId))
      .take(2_000);
    const expirationOf = (policy: (typeof policies)[number]) => {
      if (!policy.expirationDate || policy.policyTermType === "continuous")
        return undefined;
      const expiration = dayjs(policy.expirationDate);
      return expiration.isValid() ? expiration : undefined;
    };
    const matches = policies
      .filter((policy) => includeArchived || !policy.deletedAt)
      .filter((policy) => {
        if (!expiringBefore) return true;
        const expiration = expirationOf(policy);
        return Boolean(expiration && !expiration.isAfter(expiringBefore));
      })
      .filter((policy) => {
        if (!queryText) return true;
        return [
          policy.policyNumber,
          policy.carrier,
          policy.security,
          policy.insuredName,
          policy.fileName,
          policy.summary,
        ].some((value) =>
          String(value ?? "")
            .toLowerCase()
            .includes(queryText),
        );
      });
    if (input.sort === "expiration_asc") {
      matches.sort(
        (left, right) =>
          (expirationOf(left)?.valueOf() ?? Number.MAX_SAFE_INTEGER) -
          (expirationOf(right)?.valueOf() ?? Number.MAX_SAFE_INTEGER),
      );
    } else if (input.sort === "updated_desc") {
      const changedAt = (policy: (typeof policies)[number]) =>
        Math.max(policy.extractionDataStageUpdatedAt ?? 0, policy._creationTime);
      matches.sort((left, right) => changedAt(right) - changedAt(left));
    }
    const page = matches.slice(offset, offset + limit);
    const nextCursor =
      offset + limit < matches.length ? String(offset + limit) : null;
    return {
      policies: page.map((policy) => ({
        policyId: policy._id,
        policyNumber: policy.policyNumber,
        carrier: policy.carrier,
        insuredName: policy.insuredName,
        effectiveDate: policy.effectiveDate,
        expirationDate: policy.expirationDate,
        linesOfBusiness: policy.linesOfBusiness,
        extractionDataStage: policy.extractionDataStage,
        pipelineStatus: policy.pipelineStatus,
        pipelineError: policy.pipelineError?.slice(0, 200),
        sourceTreeStatus: policy.sourceTreeStatus,
        archived: Boolean(policy.deletedAt),
      })),
      matchedInScan: matches.length,
      scanned: policies.length,
      bounded: policies.length >= 2_000 || nextCursor !== null,
      scanBounded: policies.length >= 2_000,
      nextCursor,
      limit,
    };
  }

  if (toolName === "get_policy_status") {
    const readStatus = async (policyId: Id<"policies">) => {
      const policy = await ctx.db.get(policyId);
      if (!policy) return null;
      const extractionRun = await ctx.db
        .query("policyExtractionRuns")
        .withIndex("policy", (index) => index.eq("policyId", policyId))
        .order("desc")
        .first();
      return {
        policyId,
        orgId: policy.orgId,
        policyNumber: policy.policyNumber,
        carrier: policy.carrier,
        extractionDataStage: policy.extractionDataStage,
        pipelineStatus: extractionRun?.pipelineStatus ?? policy.pipelineStatus,
        pipelineError: extractionRun?.pipelineError ?? policy.pipelineError,
        sourceTreeStatus: policy.sourceTreeStatus,
        archived: Boolean(policy.deletedAt),
        fileName: policy.fileName,
      };
    };
    if (Array.isArray(input.policyIds)) {
      const items = [];
      const notFound: string[] = [];
      for (const value of input.policyIds as string[]) {
        const policyId = ctx.db.normalizeId("policies", value);
        const status = policyId ? await readStatus(policyId) : null;
        if (status) items.push(status);
        else notFound.push(value);
      }
      return { items, notFound };
    }
    const status = await readStatus(normalizePolicyId(ctx, input.policyId));
    if (!status) throw new Error("Policy not found");
    return status;
  }

  if (toolName === "list_client_files") {
    const orgId = normalizeOrganizationId(ctx, input.orgId);
    const organization = await ctx.db.get(orgId);
    if (
      !organization ||
      organization.deletedAt !== undefined ||
      organization.type !== "client"
    ) {
      throw new Error("Client organization not found");
    }
    const limit = typeof input.limit === "number" ? input.limit : 25;
    const policyId =
      typeof input.policyId === "string"
        ? normalizePolicyId(ctx, input.policyId)
        : undefined;
    const clientVisible =
      typeof input.clientVisible === "boolean" ? input.clientVisible : undefined;
    const queryText =
      typeof input.query === "string" ? input.query.trim().toLowerCase() : "";
    const contentType =
      typeof input.contentType === "string"
        ? input.contentType.trim().toLowerCase()
        : "";
    const createdAfter =
      typeof input.createdAfter === "string"
        ? dayjs(input.createdAfter).valueOf() - 1
        : -1;
    // Cursor "<createdAt>:<scanned at that instant>" resumes inside a
    // millisecond that bulk uploads can share.
    const cursor = fileListCursor(input.cursor);
    const upper = cursor?.createdAt ?? Number.MAX_SAFE_INTEGER;
    const files = policyId
      ? ctx.db
          .query("clientFiles")
          .withIndex("policy", (index) =>
            index
              .eq("policyId", policyId)
              .gt("createdAt", createdAfter)
              .lte("createdAt", upper),
          )
      : clientVisible !== undefined
        ? ctx.db
            .query("clientFiles")
            .withIndex("visibility", (index) =>
              index
                .eq("orgId", orgId)
                .eq("clientVisible", clientVisible)
                .gt("createdAt", createdAfter)
                .lte("createdAt", upper),
            )
        : ctx.db
            .query("clientFiles")
            .withIndex("organization", (index) =>
              index
                .eq("orgId", orgId)
                .gt("createdAt", createdAfter)
                .lte("createdAt", upper),
            );
    const matches: Array<{ file: Doc<"clientFiles">; sameInstant: number }> = [];
    let scanned = 0;
    let skip = cursor?.skip ?? 0;
    let sameInstant = 0;
    let lastCreatedAt = -1;
    let scanBounded = false;
    for await (const file of files.order("desc")) {
      if (++scanned > CLIENT_FILE_SCAN_LIMIT) {
        scanBounded = true;
        break;
      }
      sameInstant = file.createdAt === lastCreatedAt ? sameInstant + 1 : 1;
      lastCreatedAt = file.createdAt;
      if (skip > 0 && file.createdAt === cursor?.createdAt) {
        skip -= 1;
        continue;
      }
      if (
        file.orgId !== orgId ||
        file.archivedAt ||
        file.deletedAt ||
        (clientVisible !== undefined && file.clientVisible !== clientVisible) ||
        (contentType && !file.contentType.toLowerCase().includes(contentType)) ||
        (queryText &&
          !`${file.name} ${file.originalName}`.toLowerCase().includes(queryText))
      ) {
        continue;
      }
      matches.push({ file, sameInstant });
      if (matches.length > limit) break;
    }
    const page = matches.slice(0, limit);
    const hasMore = matches.length > limit;
    const last = page.at(-1);
    return {
      files: await Promise.all(
        page.map(async ({ file }) => {
          const policy = file.policyId ? await ctx.db.get(file.policyId) : null;
          return {
            clientFileId: file._id,
            name: file.name,
            originalName: file.originalName,
            contentType: file.contentType,
            size: file.size,
            clientVisible: file.clientVisible,
            policyId: file.policyId,
            policyNumber: policy?.policyNumber,
            carrier: policy?.carrier,
            nameStatus: file.nameStatus,
            createdAt: file.createdAt,
          };
        }),
      ),
      nextCursor:
        hasMore && last ? `${last.file.createdAt}:${last.sameInstant}` : null,
      bounded: hasMore || scanBounded,
    };
  }

  if (toolName === "lookup_client_wiki") {
    const orgId = normalizeOrganizationId(ctx, input.orgId);
    const organization = await ctx.db.get(orgId);
    if (
      !organization ||
      (organization.type !== "client" && organization.type !== "broker")
    ) {
      throw new Error("Client or supplier organization not found");
    }
    return await readOrgWiki(ctx, orgId);
  }

  if (toolName === "update_client_wiki") {
    const orgId = normalizeOrganizationId(ctx, input.orgId);
    // Append reads the current revision in this same transaction, so it cannot conflict.
    const current =
      input.mode === "append" ? await readOrgWiki(ctx, orgId) : null;
    return await upsertOrgWikiDocumentByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      orgId,
      markdown: current
        ? appendWikiSection(current.markdown, String(input.markdown))
        : String(input.markdown),
      expectedRevision: current ? current.revision : Number(input.expectedRevision),
      source: args.channel === "mcp" ? "mcp" : "operator",
    });
  }

  if (toolName === "lookup_procurement_packet") {
    return await listPacketDocuments(ctx, {
      requestId: normalizeProcurementRequestId(ctx, input.procurementRequestId),
      audience: "operator",
    });
  }

  if (toolName === "preview_broker_packet") {
    return await previewBrokerPacket(ctx, {
      requestId: normalizeProcurementRequestId(ctx, input.procurementRequestId),
    });
  }

  if (toolName === "list_broker_packet_links") {
    return {
      links: await listPacketLinksForOperator(
        ctx,
        normalizeProcurementRequestId(ctx, input.procurementRequestId),
      ),
      secretsIncluded: false,
    };
  }

  if (toolName === "update_procurement_packet") {
    return await updatePacketDocumentByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      requestId: normalizeProcurementRequestId(ctx, input.procurementRequestId),
      filename: String(input.filename),
      markdown: String(input.markdown),
      expectedRevision: Number(input.expectedRevision),
    });
  }

  if (toolName === "list_procurement_requests") {
    const after = normalizedOptionalText(input.updatedAfter);
    const before = normalizedOptionalText(input.updatedBefore);
    const updatedAfter = after ? dayjs(after).valueOf() : undefined;
    const updatedBefore = before
      ? (before.length === 10
          ? dayjs(before).endOf("day")
          : dayjs(before)
        ).valueOf()
      : undefined;
    if (
      updatedAfter !== undefined &&
      updatedBefore !== undefined &&
      updatedAfter > updatedBefore
    ) {
      throw new Error("updatedAfter must not be later than updatedBefore");
    }
    const assigneeUserId = input.assigneeUserId
      ? ctx.db.normalizeId("users", String(input.assigneeUserId))
      : undefined;
    if (assigneeUserId === null) throw new Error("Invalid assignee user ID");
    const statuses = Array.isArray(input.status)
      ? input.status
      : input.status
        ? [input.status]
        : undefined;
    return await listOperatorProcurementRequests(ctx, {
      clientOrgId: input.orgId
        ? normalizeOrganizationId(ctx, input.orgId)
        : undefined,
      query: normalizedOptionalText(input.query),
      status: statuses?.map(
        (status) => writableProcurementRequestStatus(status)!,
      ),
      assigneeUserId,
      updatedAfter,
      updatedBefore,
      sort: input.sort === "created_desc" ? "created_desc" : "updated_desc",
      view: input.view === "full" ? "full" : "summary",
      cursor: normalizedOptionalText(input.cursor),
      limit: typeof input.limit === "number" ? input.limit : 50,
    });
  }

  if (toolName === "get_client_attention") {
    return await getClientAttention(
      ctx,
      normalizeOrganizationId(ctx, input.orgId),
    );
  }

  if (toolName === "get_procurement_request") {
    const requestId = normalizeProcurementRequestId(
      ctx,
      input.procurementRequestId,
    );
    const include = Array.isArray(input.include)
      ? input.include.map(String)
      : [];
    const intake = await readUnlinkedIntakeByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      requestId,
    });
    if (intake) {
      if (input.view === "full") return intake;
      const request = (await ctx.db.get(requestId))!;
      return {
        procurementRequestId: intake._id,
        title: intake.title,
        diagnosticStatus: intake.diagnosticStatus,
        clientOrgId: null,
        intakeStep: intake.intakeStep,
        intakeRevision: intake.intakeRevision,
        createdAt: intake.createdAt,
        updatedAt: intake.updatedAt,
        fulfillmentAvailable: false,
        application: include.includes("application")
          ? intake.application
          : procurementApplicationSummary(request),
        ...(include.includes("application")
          ? {
              intakeAnswers: intake.intakeAnswers,
              intakeDetails: intake.intakeDetails,
            }
          : {}),
        ...(include.includes("audit")
          ? {
              slackEvents: intake.slackEvents,
              bounded: intake.slackEventsBounded,
            }
          : {}),
      };
    }
    return await getOperatorProcurementRequest(ctx, requestId, {
      include,
      view: input.view === "full" ? "full" : "summary",
    });
  }

  if (toolName === "list_procurement_proposals") {
    return await listOperatorProcurementProposals(
      ctx,
      normalizeProcurementRequestId(ctx, input.procurementRequestId),
      {
        view: input.view === "full" ? "full" : "summary",
        limit: typeof input.limit === "number" ? input.limit : undefined,
        cursor: normalizedOptionalText(input.cursor),
      },
    );
  }

  if (toolName === "get_procurement_proposal") {
    const parsed =
      OPERATOR_AGENT_TOOL_REGISTRY.get_procurement_proposal.inputSchema.parse(input);
    const view = parsed.view ?? (parsed.procurementProposalIds ? "compact" : "full");
    const present = (proposal: NonNullable<Awaited<ReturnType<typeof getProcurementProposalDetails>>>) => ({
      ...(view === "compact" ? compactProposal(proposal) : proposal),
      private: true,
    });
    if (parsed.procurementProposalIds)
      return await readMany(uniqueIds(parsed.procurementProposalIds), async (id) => {
        const proposalId = ctx.db.normalizeId("procurementProposals", id);
        const proposal = proposalId ? await getProcurementProposalDetails(ctx, proposalId) : null;
        return proposal ? present(proposal) : null;
      });
    const proposalId = normalizeProcurementProposalId(
      ctx,
      parsed.procurementProposalId,
    );
    const proposal = await getProcurementProposalDetails(ctx, proposalId);
    if (!proposal) throw new Error("Procurement proposal not found");
    return present(proposal);
  }

  if (toolName === "get_broker_network_profile") {
    const brokerOrgId = normalizeOrganizationId(ctx, input.brokerOrgId);
    const [details, submissionDefaults] = await Promise.all([
      getBrokerProfileDetails(ctx, brokerOrgId),
      listProviderSubmissionDefaults(ctx, brokerOrgId, args.operatorUserId),
    ]);
    return { ...details, submissionDefaults };
  }

  if (toolName === "list_broker_network_profiles") {
    const parsed =
      OPERATOR_AGENT_TOOL_REGISTRY.list_broker_network_profiles.inputSchema.parse(input);
    return await listProviderPage(ctx, parsed);
  }

  if (toolName === "list_team_inbox_threads") {
    return await listTeamInbox(ctx, {
      viewerUserId: args.operatorUserId,
      paginationOpts: {
        cursor: typeof input.cursor === "string" ? input.cursor : null,
        numItems: typeof input.limit === "number" ? input.limit : 40,
      },
      ownerUserId: input.mine === true ? args.operatorUserId : undefined,
      unlinked: input.unlinked === true,
      archived: input.archived === true,
      clientOrgId: input.clientOrgId ? normalizeOrganizationId(ctx, input.clientOrgId) : undefined,
      requestId: input.procurementRequestId ? normalizeProcurementRequestId(ctx, input.procurementRequestId) : undefined,
      category: procurementEmailCategory(input.category),
    });
  }

  if (toolName === "update_team_reply_draft") {
    const parsed = OPERATOR_AGENT_TOOL_REGISTRY.update_team_reply_draft.inputSchema.parse(input);
    return await reviseTeamReplySuggestion(ctx, {
      threadId: await normalizeProcurementEmailThreadId(ctx, parsed.teamEmailThreadId),
      reply: parsed.reply,
    });
  }

  if (toolName === "get_team_inbox_thread") {
    const parsed =
      OPERATOR_AGENT_TOOL_REGISTRY.get_team_inbox_thread.inputSchema.parse(input);
    const view = parsed.view ?? (parsed.teamEmailThreadIds ? "compact" : "full");
    const batchSize = parsed.teamEmailThreadIds ? uniqueIds(parsed.teamEmailThreadIds).length : 1;
    const present = <T extends Parameters<typeof compactTeamThread>[0]>(thread: T | null) =>
      thread && view === "compact" ? compactTeamThread(thread, batchSize) : thread;
    if (parsed.teamEmailThreadIds)
      return await readMany(uniqueIds(parsed.teamEmailThreadIds), async (id) => {
        const threadId = ctx.db.normalizeId("teamEmailThreads", id);
        return threadId ? present(await readTeamThreadOwnRun(ctx, threadId, args.operatorUserId)) : null;
      });
    const thread = present(
      await getTeamThreadDetails(ctx, {
        threadId: await normalizeProcurementEmailThreadId(ctx, parsed.teamEmailThreadId),
        viewerUserId: args.operatorUserId,
      }),
    );
    if (!thread) throw new Error("Email conversation not found");
    return thread;
  }

  if (toolName === "link_team_inbox_thread") {
    return await linkTeamEmailThreadByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      threadId: await normalizeProcurementEmailThreadId(ctx, input.teamEmailThreadId),
      clientOrgId: input.clientOrgId ? normalizeOrganizationId(ctx, input.clientOrgId) : undefined,
      requestId: input.procurementRequestId ? normalizeProcurementRequestId(ctx, input.procurementRequestId) : undefined,
      source: "agent",
    });
  }

  if (toolName === "list_procurement_email_threads") {
    const requestId = normalizeProcurementRequestId(
      ctx,
      input.procurementRequestId,
    );
    const request = await ctx.db.get(requestId);
    requireCompanyRequest(request);
    const limit = typeof input.limit === "number" ? input.limit : 50;
    const threads = await listProcurementEmailThreads(ctx, {
      clientOrgId: request.clientOrgId,
      requestId,
      limit,
    });
    return { threads, bounded: threads.length === limit };
  }

  if (toolName === "get_procurement_email_thread") {
    const parsed =
      OPERATOR_AGENT_TOOL_REGISTRY.get_procurement_email_thread.inputSchema.parse(input);
    const view = parsed.view ?? (parsed.procurementEmailThreadIds ? "compact" : "full");
    const batchSize = parsed.procurementEmailThreadIds ? uniqueIds(parsed.procurementEmailThreadIds).length : 1;
    const present = <T extends Parameters<typeof compactTeamThread>[0]>(thread: T | null) =>
      thread && view === "compact" ? compactTeamThread(thread, batchSize) : thread;
    if (parsed.procurementEmailThreadIds)
      return await readMany(uniqueIds(parsed.procurementEmailThreadIds), async (id) => {
        const emailThreadId = ctx.db.normalizeId("teamEmailThreads", id);
        return emailThreadId ? present(await readTeamThreadOwnRun(ctx, emailThreadId, args.operatorUserId)) : null;
      });
    const thread = present(
      await getProcurementEmailThreadDetails(
        ctx,
        await normalizeProcurementEmailThreadId(ctx, parsed.procurementEmailThreadId),
        undefined,
        args.operatorUserId,
      ),
    );
    if (!thread) throw new Error("Procurement email thread not found");
    return thread;
  }

  if (toolName === "preview_procurement_email_reconciliation") {
    return await previewProcurementEmailReconciliation(
      ctx,
      await normalizeProcurementEmailThreadId(ctx, input.procurementEmailThreadId),
    );
  }

  if (toolName === "list_extraction_issues") {
    const orgId = input.orgId
      ? normalizeOrganizationId(ctx, input.orgId)
      : undefined;
    if (orgId && !(await ctx.db.get(orgId))) {
      throw new Error("Organization not found");
    }
    const requestedDomain =
      input.domain === "policy" || input.domain === "proposal"
        ? input.domain
        : undefined;
    const requestedStatus =
      input.status === "error" ||
      input.status === "paused" ||
      input.status === "running" ||
      input.status === "queued" ||
      input.status === "leased" ||
      input.status === "stuck"
        ? input.status
        : undefined;
    const limit = typeof input.limit === "number" ? input.limit : 15;
    // "queued"/"leased" were worker-queue states; the Convex section pipeline
    // has no equivalent, so those filters now match nothing for policies.
    const pipelineStatuses: Array<"error" | "paused" | "running"> =
      requestedStatus === "error" ||
      requestedStatus === "paused" ||
      requestedStatus === "running"
        ? [requestedStatus]
        : requestedStatus === "stuck"
          ? ["running"]
          : requestedStatus
            ? []
            : ["error", "paused", "running"];
    const candidateLimit = Math.min(100, limit * 5);
    const inspectPolicies = requestedDomain !== "proposal";
    const inspectProposals = requestedDomain !== "policy";
    const [pipelineRuns, proposalResult] = await Promise.all([
      inspectPolicies
        ? Promise.all(
            pipelineStatuses.map((status) =>
              ctx.db
                .query("policyExtractionRuns")
                .withIndex("status_updated", (index) =>
                  index.eq("pipelineStatus", status),
                )
                .order("desc")
                .take(candidateLimit),
            ),
          )
        : Promise.resolve([]),
      inspectProposals &&
      requestedStatus !== "paused" &&
      requestedStatus !== "leased"
        ? listProposalExtractionIssues(ctx, {
            orgId,
            status:
              requestedStatus === "error" ||
              requestedStatus === "queued" ||
              requestedStatus === "running" ||
              requestedStatus === "stuck"
                ? requestedStatus
                : undefined,
            limit,
          })
        : Promise.resolve({ issues: [], bounded: false }),
    ]);
    const now = dayjs().valueOf();
    // Mirrors policies.ts PIPELINE_STALE_REQUEUE_MS: a running checkpoint
    // whose lease has been expired this long has stalled past the watchdog's
    // normal reclaim window.
    const EXTRACTION_RUN_STUCK_THRESHOLD_MS = 5 * 60 * 1000;
    const candidates = pipelineRuns
      .flat()
      .map((run) => {
        const checkpoint = run.pipelineCheckpoint as
          | { lease?: { expiresAt?: number } }
          | undefined;
        const leaseExpiresAt = checkpoint?.lease?.expiresAt;
        const stuck =
          run.pipelineStatus === "running" &&
          leaseExpiresAt !== undefined &&
          now - leaseExpiresAt > EXTRACTION_RUN_STUCK_THRESHOLD_MS;
        return {
          policyId: run.policyId,
          runId: run._id,
          status: stuck ? ("stuck" as const) : run.pipelineStatus,
          error: run.pipelineError,
          updatedAt: run.updatedAt,
        };
      })
      .filter(
        (candidate) =>
          requestedStatus !== "stuck" || candidate.status === "stuck",
      )
      .sort((left, right) => right.updatedAt - left.updatedAt);
    const results = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (results.length >= limit) break;
      if (seen.has(String(candidate.policyId))) continue;
      const policy = await ctx.db.get(candidate.policyId);
      if (!policy || (orgId && policy.orgId !== orgId)) continue;
      seen.add(String(candidate.policyId));
      const organization = policy.orgId ? await ctx.db.get(policy.orgId) : null;
      results.push({
        domain: "policy" as const,
        policyId: policy._id,
        runId: candidate.runId,
        orgId: policy.orgId,
        orgName: organization?.name,
        policyNumber: policy.policyNumber,
        carrier: policy.carrier,
        fileName: policy.fileName,
        status: candidate.status,
        error: candidate.error,
        updatedAt: candidate.updatedAt,
        recovery:
          candidate.status === "error" || candidate.status === "stuck"
            ? ("retry_failed_policy_extraction" as const)
            : null,
      });
    }
    const issues = [...results, ...proposalResult.issues]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, limit);
    return {
      issues,
      checkedDomains: [
        ...(inspectPolicies ? (["policy"] as const) : []),
        ...(inspectProposals ? (["proposal"] as const) : []),
      ],
      bounded:
        pipelineRuns.some((runs) => runs.length >= candidateLimit) ||
        candidates.length > results.length ||
        proposalResult.bounded ||
        results.length + proposalResult.issues.length > limit,
    };
  }

  if (toolName === "get_routing_status") {
    if (typeof input.callId === "string") {
      const id = ctx.db.normalizeId("modelRoutingEvents", input.callId);
      const call = id ? await ctx.db.get(id) : null;
      if (!call || call.kind !== "call")
        throw new Error("Model call not found or no longer retained");
      return {
        callId: call._id,
        timestamp: call.timestamp,
        task: call.task,
        operation: call.operation,
        status: call.status,
        provider: call.callProvider,
        model: call.model,
        routeSource: call.routeSource,
        selection: call.routingSummary,
        requestId: call.requestId,
        runId: call.runId,
        channel: call.channel,
        orgId: call.orgId,
        inputTokens: call.inputTokens,
        outputTokens: call.outputTokens,
        cachedInputTokens: call.cachedInputTokens,
        reasoningTokens: call.reasoningTokens,
        costUsd: call.costUsd ?? null,
        durationMs: call.durationMs,
        finishReason: call.finishReason,
        error: call.error,
      };
    }
    const task = typeof input.task === "string" ? input.task.trim() : undefined;
    const limit = typeof input.limit === "number" ? input.limit : 50;
    const events = task
      ? await ctx.db
          .query("modelRoutingEvents")
          .withIndex("task_calls", (index) =>
            index.eq("kind", "call").eq("task", task),
          )
          .order("desc")
          .take(limit)
      : await ctx.db
          .query("modelRoutingEvents")
          .withIndex("kind_time", (index) => index.eq("kind", "call"))
          .order("desc")
          .take(limit);
    const settings = await ctx.db
      .query("globalModelSettings")
      .withIndex("key", (index) => index.eq("key", "default"))
      .unique();
    const counts = {
      running: events.filter((event) => event.status === "running").length,
      unknown: events.filter((event) => event.status === "unknown").length,
      complete: events.filter((event) => event.status === "complete").length,
      incomplete: events.filter((event) => event.status === "incomplete")
        .length,
      error: events.filter((event) => event.status === "error").length,
    };
    return {
      task,
      counts,
      pinnedRoutes: (settings?.explicitRouteOverrides ?? []).filter(
        (routeId) =>
          (settings?.routes as Record<string, unknown> | undefined)?.[
            routeId
          ] !== undefined,
      ),
      settingsUpdatedAt: settings?.updatedAt,
      recentIssues: events
        .filter(
          (event) =>
            event.status === "unknown" ||
            event.status === "error" ||
            event.status === "incomplete",
        )
        .slice(0, 20)
        .map((event) => ({
          eventId: event._id,
          timestamp: event.timestamp,
          requestId: event.requestId,
          runId: event.runId,
          costUsd: event.costUsd ?? null,
          task: event.task,
          phase: event.phase,
          status: event.status,
          provider: event.callProvider ?? event.provider,
          model: event.model,
          routerCode: event.routerCode,
          error: event.error,
        })),
      sampled: events.length,
    };
  }

  if (toolName === "get_channel_health") {
    const parsed =
      OPERATOR_AGENT_TOOL_REGISTRY.get_channel_health.inputSchema.parse(input);
    const orgId = parsed.orgId
      ? normalizeOrganizationId(ctx, parsed.orgId)
      : undefined;
    if (orgId && !(await ctx.db.get(orgId))) {
      throw new Error("Organization not found");
    }
    const problemsOnly = parsed.problemsOnly === true;
    // Problem rows mirror the platform health suggestion.
    const connectionRow = (connection: Doc<"slackWorkspaceConnections">) => ({
      connectionId: connection._id,
      clientOrgId: connection.clientOrgId,
      teamName: connection.teamName,
      status: connection.status,
      healthStatus: connection.healthStatus,
      healthReason: connection.healthReason,
      lastVerifiedAt: connection.lastVerifiedAt,
    });
    const bindingRow = (binding: Doc<"slackChannelBindings">) => ({
      bindingId: binding._id,
      clientOrgId: binding.clientOrgId,
      channelName: binding.channelName,
      status: binding.status,
      healthStatus: binding.healthStatus,
      unavailableReason: binding.unavailableReason,
      lastVerifiedAt: binding.lastVerifiedAt,
    });
    const emailRow = (account: Doc<"connectedEmailAccounts">) => ({
      accountId: account._id,
      orgId: account.orgId,
      label: account.label,
      status: account.status,
      lastError: account.lastError,
      lastTestedAt: account.lastTestedAt,
      updatedAt: account.updatedAt,
    });
    const connectionProblem = (connection: Doc<"slackWorkspaceConnections">) =>
      connection.status === "active" && connection.healthStatus === "degraded";
    const bindingProblem = (binding: Doc<"slackChannelBindings">) =>
      binding.status === "unavailable" ||
      (binding.status === "active" && binding.healthStatus === "degraded");
    const emailProblem = (account: Doc<"connectedEmailAccounts">) =>
      account.status === "error";

    if (parsed.section) {
      const paginationOpts = {
        cursor: parsed.cursor ?? null,
        numItems: parsed.limit ?? 50,
      };
      const page =
        parsed.section === "slack_connections"
          ? await (orgId
              ? ctx.db
                  .query("slackWorkspaceConnections")
                  .withIndex("client_status", (index) => index.eq("clientOrgId", orgId))
              : ctx.db.query("slackWorkspaceConnections")
            ).paginate(paginationOpts)
          : parsed.section === "slack_bindings"
            ? await (orgId
                ? ctx.db
                    .query("slackChannelBindings")
                    .withIndex("client_status", (index) => index.eq("clientOrgId", orgId))
                : ctx.db.query("slackChannelBindings")
              ).paginate(paginationOpts)
            : await (orgId
                ? ctx.db
                    .query("connectedEmailAccounts")
                    .withIndex("organization", (index) => index.eq("orgId", orgId))
                : ctx.db.query("connectedEmailAccounts")
              ).paginate(paginationOpts);
      // Problem filtering happens inside the page, so a page may hold fewer rows than the limit.
      const rows =
        parsed.section === "slack_connections"
          ? (page.page as Doc<"slackWorkspaceConnections">[])
              .filter((row) => !problemsOnly || connectionProblem(row))
              .map(connectionRow)
          : parsed.section === "slack_bindings"
            ? (page.page as Doc<"slackChannelBindings">[])
                .filter((row) => !problemsOnly || bindingProblem(row))
                .map(bindingRow)
            : (page.page as Doc<"connectedEmailAccounts">[])
                .filter((row) => !problemsOnly || emailProblem(row))
                .map(emailRow);
      return {
        orgId,
        section: parsed.section,
        rows,
        nextCursor: page.isDone ? null : page.continueCursor,
        bounded: !page.isDone,
      };
    }

    const [settings, connections, bindings, emailAccounts, hostInstalls] =
      await Promise.all([
        orgId
          ? ctx.db
              .query("agentChannelSettings")
              .withIndex("client", (index) => index.eq("clientOrgId", orgId))
              .first()
          : Promise.resolve(null),
        orgId
          ? ctx.db
              .query("slackWorkspaceConnections")
              .withIndex("client_status", (index) =>
                index.eq("clientOrgId", orgId),
              )
              .take(25)
          : ctx.db.query("slackWorkspaceConnections").take(250),
        orgId
          ? ctx.db
              .query("slackChannelBindings")
              .withIndex("client_status", (index) =>
                index.eq("clientOrgId", orgId),
              )
              .take(25)
          : ctx.db.query("slackChannelBindings").take(250),
        orgId
          ? ctx.db
              .query("connectedEmailAccounts")
              .withIndex("organization", (index) => index.eq("orgId", orgId))
              .take(25)
          : ctx.db.query("connectedEmailAccounts").take(250),
        orgId
          ? Promise.resolve([])
          : ctx.db.query("slackInstallations").take(25),
      ]);
    return {
      orgId,
      settings: settings
        ? {
            emailEnabled: settings.emailEnabled,
            imessageEnabled: settings.imessageEnabled,
            slackEnabled: settings.slackEnabled,
            updatedAt: settings.updatedAt,
          }
        : undefined,
      slack: {
        connections: connections
          .filter((row) => !problemsOnly || connectionProblem(row))
          .map(connectionRow),
        bindings: bindings
          .filter((row) => !problemsOnly || bindingProblem(row))
          .map(bindingRow),
        hostInstallations: hostInstalls
          .filter(
            (installation) =>
              installation.kind === "host" &&
              (!problemsOnly || installation.status !== "active"),
          )
          .map((installation) => ({
            installationId: installation._id,
            teamName: installation.teamName,
            status: installation.status,
            updatedAt: installation.updatedAt,
          })),
      },
      email: emailAccounts
        .filter((row) => !problemsOnly || emailProblem(row))
        .map(emailRow),
      // Whether the unfiltered scan hit its cap, so rows may be missing.
      bounded: {
        connections: connections.length >= (orgId ? 25 : 250),
        bindings: bindings.length >= (orgId ? 25 : 250),
        emailAccounts: emailAccounts.length >= (orgId ? 25 : 250),
      },
    };
  }

  if (toolName === "retry_failed_policy_extraction") {
    const policyId = normalizePolicyId(ctx, input.policyId);
    const policy = await ctx.db.get(policyId);
    if (!policy) throw new Error("Policy not found");
    const run = await ctx.db
      .query("policyExtractionRuns")
      .withIndex("policy", (index) => index.eq("policyId", policyId))
      .order("desc")
      .first();
    const status = run?.pipelineStatus ?? policy.pipelineStatus;
    if (status === "running") return alreadyRunningExtraction(policyId);
    if (status === "paused") {
      throw new Error("An extraction is paused for this policy");
    }
    if (!policy.fileId) throw new Error("Policy source file is missing");
    await ctx.scheduler.runAfter(
      0,
      internal.actions.policyExtraction.retryPolicyExtraction,
      { policyId, mode: "full" },
    );
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "setup_write",
      targetOrgId: policy.orgId,
      summary: `Queued full extraction for ${policy.policyNumber ?? policy.fileName ?? policyId}`,
      metadata: {
        domain: "operator_agent",
        policyId,
        previousStatus: status,
        operation: "full_extraction",
      },
    });
    return { status: "scheduled", policyId, previousStatus: status };
  }

  if (toolName === "create_procurement_request") {
    return await createProcurementRequestByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      clientOrgId: normalizeOrganizationId(ctx, input.orgId),
      title: typeof input.title === "string" ? input.title : "",
      narrative: typeof input.narrative === "string" ? input.narrative : "",
      targetEffectiveDate: normalizedOptionalText(input.targetEffectiveDate),
      status: writableProcurementRequestStatus(input.status),
      completionOutcome: input.completionOutcome
        ? normalizeCompletionOutcome(input.completionOutcome)
        : undefined,
      clientVisible:
        typeof input.clientVisible === "boolean"
          ? input.clientVisible
          : undefined,
      replacingPolicyId: input.replacingPolicyId
        ? normalizePolicyId(ctx, input.replacingPolicyId)
        : undefined,
      resultingPolicyId: input.resultingPolicyId
        ? normalizePolicyId(ctx, input.resultingPolicyId)
        : undefined,
      source: "agent",
    });
  }

  if (toolName === "update_procurement_application") {
    const update = await prepareApplicationToolUpdate(ctx, input);
    return await updateApplicationByOperator(ctx, args.operatorUserId, update);
  }

  if (toolName === "update_procurement_request") {
    return await updateProcurementRequestByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      requestId: normalizeProcurementRequestId(ctx, input.procurementRequestId),
      title: typeof input.title === "string" ? input.title : undefined,
      targetEffectiveDate:
        input.targetEffectiveDate === null
          ? null
          : normalizedOptionalText(input.targetEffectiveDate),
      status: writableProcurementRequestStatus(input.status),
      completionOutcome:
        input.completionOutcome === null
          ? null
          : input.completionOutcome
            ? normalizeCompletionOutcome(input.completionOutcome)
            : undefined,
      clientVisible:
        typeof input.clientVisible === "boolean"
          ? input.clientVisible
          : undefined,
      replacingPolicyId:
        input.replacingPolicyId === null
          ? null
          : input.replacingPolicyId
            ? normalizePolicyId(ctx, input.replacingPolicyId)
            : undefined,
      resultingPolicyId:
        input.resultingPolicyId === null
          ? null
          : input.resultingPolicyId
            ? normalizePolicyId(ctx, input.resultingPolicyId)
            : undefined,
      source: "agent",
    });
  }

  if (toolName === "file_procurement_proposal") {
    const clientFileIds = (stringList(input.clientFileIds) ?? []).map(
      (value) => {
        const id = ctx.db.normalizeId("clientFiles", value);
        if (!id) throw new Error(`Invalid client file ID: ${value}`);
        return id;
      },
    );
    const fileItemIds = (stringList(input.procurementFileItemIds) ?? []).map(
      (value) => normalizeProcurementFileItemId(ctx, value),
    );
    const attachments = await Promise.all(
      (stringList(input.attachmentFileIds) ?? []).map((value) =>
        resolveThreadAttachment(ctx, args.threadId, value),
      ),
    );
    return await fileProcurementProposalByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      requestId: normalizeProcurementRequestId(ctx, input.procurementRequestId),
      outreachId: normalizeProcurementOutreachId(
        ctx,
        input.procurementOutreachId,
      ),
      sources: [
        ...clientFileIds.map((clientFileId) => ({
          kind: "client_file" as const,
          clientFileId,
        })),
        ...fileItemIds.map((fileItemId) => ({
          kind: "file_item" as const,
          fileItemId,
        })),
        ...attachments.map((attachment) => ({
          kind: "thread_attachment" as const,
          fileId: attachment.fileId,
          fileName: attachment.filename,
          contentType: attachment.contentType,
        })),
      ],
      proposalId: input.procurementProposalId
        ? normalizeProcurementProposalId(ctx, input.procurementProposalId)
        : undefined,
      supersedesProposalId: input.supersedesProposalId
        ? normalizeProcurementProposalId(ctx, input.supersedesProposalId)
        : undefined,
    });
  }

  if (toolName === "file_procurement_email_quote") {
    return await fileProcurementEmailQuoteByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      emailThreadId: await normalizeProcurementEmailThreadId(
        ctx,
        input.procurementEmailThreadId,
      ),
      outreachId: normalizeProcurementOutreachId(
        ctx,
        input.procurementOutreachId,
      ),
      clientFileIds: stringList(input.clientFileIds)?.map((value) =>
        normalizeClientFileId(ctx, value),
      ),
      supersedesProposalId: input.supersedesProposalId
        ? normalizeProcurementProposalId(ctx, input.supersedesProposalId)
        : undefined,
    });
  }

  if (toolName === "archive_procurement_proposal") {
    return await archiveProcurementProposalByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      proposalId: normalizeProcurementProposalId(
        ctx,
        input.procurementProposalId,
      ),
      reason: normalizedOptionalText(input.reason),
    });
  }

  if (toolName === "retry_procurement_proposal_extraction") {
    return await retryProcurementProposalExtractionByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      proposalId: normalizeProcurementProposalId(
        ctx,
        input.procurementProposalId,
      ),
    });
  }

  if (toolName === "cancel_procurement_proposal_extraction") {
    return await cancelProcurementProposalExtractionByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      proposalId: normalizeProcurementProposalId(
        ctx,
        input.procurementProposalId,
      ),
    });
  }

  if (toolName === "create_broker_packet_link") {
    return await mintPacketLinkForOperator(ctx, {
      operatorUserId: args.operatorUserId,
      requestId: normalizeProcurementRequestId(ctx, input.procurementRequestId),
      expiresInDays:
        typeof input.expiresInDays === "number"
          ? input.expiresInDays
          : undefined,
    });
  }

  if (toolName === "rotate_broker_packet_link") {
    return await rotatePacketLinkByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      linkId: normalizeProcurementPacketLinkId(
        ctx,
        input.procurementPacketLinkId,
      ),
      expiresInDays:
        typeof input.expiresInDays === "number"
          ? input.expiresInDays
          : undefined,
    });
  }

  if (toolName === "revoke_broker_packet_link") {
    return await revokePacketLinkByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      linkId: normalizeProcurementPacketLinkId(
        ctx,
        input.procurementPacketLinkId,
      ),
    });
  }

  if (toolName === "confirm_procurement_proposal_review") {
    const conclusion = input.conclusion;
    if (
      conclusion !== "meets_requirements" &&
      conclusion !== "has_gaps" &&
      conclusion !== "insufficient_evidence"
    ) {
      throw new Error("Invalid proposal review conclusion");
    }
    return await confirmProcurementProposalReviewByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      reviewId: normalizeProcurementProposalReviewId(
        ctx,
        input.procurementProposalReviewId,
      ),
      conclusion,
    });
  }

  if (toolName === "select_procurement_proposal") {
    return await selectProcurementProposalByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      proposalId: normalizeProcurementProposalId(
        ctx,
        input.procurementProposalId,
      ),
    });
  }

  if (
    toolName === "ensure_broker_network_profiles" ||
    toolName === "update_broker_network_profiles"
  ) {
    const result: ProviderBatchResult = await ctx.runMutation(
      internal.operatorBrokerBatches.execute,
      { operatorUserId: args.operatorUserId, toolName, input },
    );
    return result;
  }

  if (toolName === "create_broker_network_profile") {
    await validateProviderCreate(ctx, input);
    const name = normalizedOptionalText(input.name);
    if (!name) throw new Error("Provider name is required");
    return await createStandaloneBrokerByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      name,
      website: normalizedOptionalText(input.website),
      networkStatus: brokerNetworkStatus(input.networkStatus),
      officeAddress:
        input.officeAddress && typeof input.officeAddress === "object"
          ? input.officeAddress
          : undefined,
      writingCountries: stringList(input.writingCountries),
      nationwideCountries: stringList(input.nationwideCountries),
      excludedStates: stringList(input.excludedStates),
      writingStates: stringList(input.writingStates),
      lineOfBusinessCodes: stringList(input.lineOfBusinessCodes),
      source: "agent",
    });
  }

  if (toolName === "update_broker_network_profile") {
    return await updateBrokerProfileByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      brokerOrgId: normalizeOrganizationId(ctx, input.brokerOrgId),
      networkStatus: brokerNetworkStatus(input.networkStatus),
      officeAddress:
        input.officeAddress && typeof input.officeAddress === "object"
          ? input.officeAddress
          : undefined,
      writingCountries: stringList(input.writingCountries),
      nationwideCountries: stringList(input.nationwideCountries),
      excludedStates: stringList(input.excludedStates),
      writingStates: stringList(input.writingStates),
      lineOfBusinessCodes: stringList(input.lineOfBusinessCodes),
      name: normalizedOptionalText(input.name),
      website:
        input.website === null ? null : normalizedOptionalText(input.website),
    });
  }

  if (toolName === "list_procurement_provider_matches") {
    const parsed =
      OPERATOR_AGENT_TOOL_REGISTRY.list_procurement_provider_matches.inputSchema.parse(input);
    const panel = await getProviderOutreachPanel(
      ctx,
      normalizeProcurementRequestId(ctx, parsed.procurementRequestId),
      args.operatorUserId,
      {
        cursor: parsed.cursor,
        limit: parsed.limit ?? 20,
        verdict: parsed.verdict,
        coverage: parsed.coverage,
        state: parsed.state,
        role: parsed.role,
      },
    );
    if (!panel) return null;
    const { paging, candidates, ...context } = panel;
    const compact = (rows: typeof candidates.matched) =>
      rows.map(({ iconUrl: _iconUrl, ...row }) => row);
    const next = {
      candidates: {
        matched: compact(candidates.matched),
        unknown: compact(candidates.unknown),
        excluded: compact(candidates.excluded),
      },
      total: paging?.total ?? 0,
      nextCursor: paging?.nextCursor ?? null,
      bounded: panel.providersBounded || Boolean(paging?.nextCursor),
    };
    // Request context and sequences are sent once, on the first page.
    return parsed.cursor
      ? { providersBounded: panel.providersBounded, ...next }
      : { ...context, ...next };
  }

  if (toolName === "get_procurement_provider_emails") {
    const parsed = OPERATOR_AGENT_TOOL_REGISTRY.get_procurement_provider_emails.inputSchema.parse(input);
    const requestId = normalizeProcurementRequestId(ctx, parsed.procurementRequestId);
    const { request, client } = await loadCompanyRequest(ctx, requestId);
    const template = await requestEmailTemplate(ctx, request, client);
    let brokerOrgIds = parsed.brokerOrgIds
      ? uniqueIds(parsed.brokerOrgIds).map((id) => normalizeOrganizationId(ctx, id))
      : null;
    if (!brokerOrgIds) {
      const panel = await getProviderOutreachPanel(ctx, requestId, args.operatorUserId, {
        limit: MAX_LAUNCH_PROVIDERS,
        verdict: "matched",
      });
      brokerOrgIds = (panel?.candidates.matched ?? [])
        .filter((candidate) => !candidate.launchBlock)
        .map((candidate) => candidate.brokerOrgId);
    }
    if (!brokerOrgIds.length) {
      return { template, providers: [], note: "No matched provider can receive outreach right now; name providers explicitly to check others." };
    }
    const { cadence } = await currentRequestCadence(ctx, request, client);
    const plan = await previewProviderOutreachLaunch(ctx, {
      operatorUserId: args.operatorUserId,
      requestId,
      brokerOrgIds,
      cadence,
      matchedOnly: !parsed.brokerOrgIds,
    });
    return {
      template,
      from: plan.identity.fromHeader,
      alwaysCc: plan.identity.alwaysCc,
      cadence: plan.cadence,
      problem: plan.problem,
      providers: plan.providers.map((provider) => ({
        brokerOrgId: provider.brokerOrgId,
        name: provider.brokerName,
        willSend: provider.willSend,
        ...(provider.reason ? { reason: provider.reason } : {}),
        ...(provider.recipient ? { to: provider.recipient.email, recipientName: provider.recipient.name } : {}),
        ...(provider.values ? { values: provider.values } : {}),
        ...(provider.email
          ? {
              emailSource: provider.email.source,
              ...(provider.email.source === "draft"
                ? { subject: provider.email.subject, body: provider.email.body }
                : {}),
            }
          : {}),
        ...(provider.problem ? { problem: provider.problem } : {}),
      })),
    };
  }

  if (toolName === "update_procurement_provider_emails") {
    const parsed = OPERATOR_AGENT_TOOL_REGISTRY.update_procurement_provider_emails.inputSchema.parse(input);
    const requestId = normalizeProcurementRequestId(ctx, parsed.procurementRequestId);
    const { request } = await loadCompanyRequest(ctx, requestId);
    if (request.status === "completed" || request.status === "cancelled") {
      throw new NoWriteInputError("invalid_or_stale_input", "This request is closed, so its provider emails cannot change.");
    }
    const results = [];
    for (const item of parsed.items) {
      const brokerOrgId = item.brokerOrgId ? normalizeOrganizationId(ctx, item.brokerOrgId) : undefined;
      const provider = brokerOrgId ? await ctx.db.get(brokerOrgId) : null;
      if (brokerOrgId && (!provider || provider.type !== "broker" || provider.deletedAt !== undefined)) {
        results.push({ brokerOrgId, ok: false, problem: "Provider not found." });
        continue;
      }
      try {
        const email = await writeProviderOutreachDraft(ctx, {
          requestId,
          brokerOrgId,
          email: { subject: item.subject, body: item.body },
          source: "agent",
        });
        results.push({ brokerOrgId: brokerOrgId ?? "template", ok: true, subject: email.subject });
      } catch (error) {
        results.push({
          brokerOrgId: brokerOrgId ?? "template",
          ok: false,
          problem: error instanceof Error ? error.message : "Could not save this email.",
        });
      }
    }
    return { results };
  }

  if (isProviderEmailSendTool(toolName)) {
    const parsed = OPERATOR_AGENT_TOOL_REGISTRY.send_procurement_provider_emails.inputSchema.parse(input);
    if (!args.sourceFingerprint) throw new Error("Request a fresh approval before launching outreach.");
    const requestId = normalizeProcurementRequestId(ctx, parsed.procurementRequestId);
    const { request, client } = await loadCompanyRequest(ctx, requestId);
    const { cadence, cadenceSource } = parsed.cadence
      ? {
          cadence: parsed.cadence,
          cadenceSource: { followUpCount: "operator", intervalBusinessDays: "operator", style: "operator" } as const,
        }
      : await currentRequestCadence(ctx, request, client);
    return await launchProviderOutreachByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      requestId,
      brokerOrgIds: parsed.brokerOrgIds.map((id) => normalizeOrganizationId(ctx, id)),
      cadence,
      cadenceSource,
      expectedFingerprint: args.sourceFingerprint,
    });
  }

  if (toolName === "list_procurement_client_outreach") {
    return await getClientOutreachPanel(
      ctx,
      normalizeProcurementRequestId(ctx, input.procurementRequestId),
    );
  }

  if (toolName === "list_procurement_information") {
    return await procurementInformationOverview(
      ctx,
      normalizeProcurementRequestId(ctx, input.procurementRequestId),
    );
  }

  if (toolName === "add_procurement_information_questions") {
    const parsed = OPERATOR_AGENT_TOOL_REGISTRY.add_procurement_information_questions.inputSchema.parse(input);
    return await addInformationQuestionsByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      requestId: normalizeProcurementRequestId(ctx, parsed.procurementRequestId),
      outreachId: parsed.procurementOutreachId
        ? normalizeProcurementOutreachId(ctx, parsed.procurementOutreachId)
        : undefined,
      questions: parsed.questions.map(({ condition, ...question }) => ({
        ...question,
        condition: condition && {
          questionId: normalizeInformationQuestionId(ctx, condition.questionId),
          answer: condition.answer,
        },
      })),
    });
  }

  if (toolName === "create_procurement_information_form") {
    const parsed = OPERATOR_AGENT_TOOL_REGISTRY.create_procurement_information_form.inputSchema.parse(input);
    return await createInformationFormByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      requestId: normalizeProcurementRequestId(ctx, parsed.procurementRequestId),
      questionIds: parsed.questionIds?.map((id) => normalizeInformationQuestionId(ctx, id)),
    });
  }

  if (toolName === "cancel_procurement_information_form") {
    return await cancelInformationFormByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      formId: normalizeInformationFormId(ctx, input.informationFormId),
    });
  }

  if (toolName === "stop_procurement_provider_outreach") {
    const sequenceId = typeof input.sequenceId === "string"
      ? ctx.db.normalizeId("procurementOutreachSequences", input.sequenceId)
      : null;
    if (!sequenceId) throw new NoWriteInputError("invalid_identifier", "Invalid outreach sequence ID");
    return await stopProviderOutreachByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      requestId: normalizeProcurementRequestId(ctx, input.procurementRequestId),
      sequenceId,
    });
  }

  if (toolName === "create_procurement_broker_outreach") {
    return await createProcurementOutreachByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      requestId: normalizeProcurementRequestId(ctx, input.procurementRequestId),
      brokerOrgId: normalizeOrganizationId(ctx, input.brokerOrgId),
      contactName: normalizedOptionalText(input.contactName),
      contactEmail: normalizedOptionalText(input.contactEmail),
      contactPhone: normalizedOptionalText(input.contactPhone),
      status: procurementOutreachStatus(input.status),
      source: "agent",
    });
  }

  if (toolName === "update_procurement_broker_outreach") {
    return await updateProcurementOutreachByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      outreachId: normalizeProcurementOutreachId(
        ctx,
        input.procurementOutreachId,
      ),
      brokerOrgId: input.brokerOrgId
        ? normalizeOrganizationId(ctx, input.brokerOrgId)
        : undefined,
      contactName:
        input.contactName === null
          ? null
          : normalizedOptionalText(input.contactName),
      contactEmail:
        input.contactEmail === null
          ? null
          : normalizedOptionalText(input.contactEmail),
      contactPhone:
        input.contactPhone === null
          ? null
          : normalizedOptionalText(input.contactPhone),
      status: procurementOutreachStatus(input.status),
      source: "agent",
    });
  }

  if (toolName === "create_procurement_file_item") {
    return await createProcurementFileItemByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      requestId: normalizeProcurementRequestId(ctx, input.procurementRequestId),
      clientFileId: normalizeClientFileId(ctx, input.clientFileId),
      label: typeof input.label === "string" ? input.label : "",
      brokerRelease: procurementFileBrokerRelease(input.brokerRelease),
      clientVisible:
        typeof input.clientVisible === "boolean"
          ? input.clientVisible
          : undefined,
      documentCategory: input.documentCategory as
        | "requirements"
        | "policy"
        | "loss_runs"
        | "supporting"
        | undefined,
      source: "agent",
    });
  }

  if (toolName === "update_procurement_file_item") {
    return await updateProcurementFileItemByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      fileItemId: normalizeProcurementFileItemId(
        ctx,
        input.procurementFileItemId,
      ),
      clientFileId:
        input.clientFileId !== undefined
          ? normalizeClientFileId(ctx, input.clientFileId)
          : undefined,
      label: typeof input.label === "string" ? input.label : undefined,
      brokerRelease: procurementFileBrokerRelease(input.brokerRelease),
      clientVisible:
        typeof input.clientVisible === "boolean"
          ? input.clientVisible
          : undefined,
      source: "agent",
    });
  }

  if (toolName === "update_procurement_email_thread") {
    return await updateProcurementEmailThreadByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      emailThreadId: await normalizeProcurementEmailThreadId(
        ctx,
        input.procurementEmailThreadId,
      ),
      category: procurementEmailCategory(input.category),
      requestId: input.procurementRequestId
        ? normalizeProcurementRequestId(ctx, input.procurementRequestId)
        : undefined,
      source: "agent",
    });
  }

  if (toolName === "add_client_file") {
    const orgId = normalizeOrganizationId(ctx, input.orgId);
    const attachmentFileId = await resolveThreadAttachmentFileId(
      ctx,
      args.threadId,
      input.attachmentFileId,
    );
    const name = typeof input.name === "string" ? input.name : "";
    const associatedPolicyId = input.policyId
      ? normalizePolicyId(ctx, input.policyId)
      : undefined;
    return await createClientFileFromOperatorAttachment(ctx, {
      operatorUserId: args.operatorUserId,
      threadId: args.threadId,
      orgId,
      attachmentFileId,
      name,
      policyId: associatedPolicyId,
    });
  }

  if (toolName === "update_client_file") {
    const clientFileId = normalizeClientFileId(ctx, input.clientFileId);
    const associatedPolicyId =
      input.policyId === null
        ? null
        : input.policyId
          ? normalizePolicyId(ctx, input.policyId)
          : undefined;
    return await updateClientFileByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      clientFileId,
      name: typeof input.name === "string" ? input.name : undefined,
      clientVisible:
        typeof input.clientVisible === "boolean"
          ? input.clientVisible
          : undefined,
      policyId: associatedPolicyId,
      source: "agent",
    });
  }

  if (toolName === "update_client_business_profile") {
    const update = await prepareBusinessProfileToolUpdate(ctx, input);
    return await updateBusinessProfileByOperator(
      ctx,
      args.operatorUserId,
      update,
    );
  }

  if (toolName === "update_organization_profile") {
    const orgId = normalizeOrganizationId(ctx, input.orgId);
    const organization = await ctx.db.get(orgId);
    if (!organization || organization.deletedAt !== undefined)
      throw new Error("Organization not found");
    const patch: Partial<Doc<"organizations">> = {};
    if (input.name != null) {
      const identity = clientIdentity(String(input.name));
      if (!identity.name) throw new Error("Organization name is required");
      patch.name = identity.name;
    }
    if ("website" in input)
      patch.website = normalizedOptionalText(input.website);
    await ctx.db.patch(orgId, patch);
    if (input.name != null || input.website !== undefined)
      await scheduleCompanyResearch(ctx, orgId);
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "setup_write",
      targetOrgId: orgId,
      summary: `Updated organization profile for ${patch.name ?? organization.name}`,
      metadata: { domain: "operator_agent", fields: Object.keys(patch) },
    });
    return {
      status: "updated",
      orgId,
      fields: Object.keys(patch),
      companyResearch: (await ctx.db.get(orgId))?.companyResearch ?? null,
    };
  }

  if (toolName === "research_client_tech_stack") {
    let website =
      typeof input.website === "string" ? input.website : undefined;
    if (input.orgId) {
      const org = await ctx.db.get(normalizeOrganizationId(ctx, input.orgId));
      if (!org || org.deletedAt !== undefined || org.type !== "client")
        throw new Error("Client organization not found");
      if (!org.website) throw new Error("This client has no website to scan");
      website = org.website;
    }
    const domain = websiteTechDomain(website);
    if (!domain) throw new Error("Website must be a public domain");
    const queued = await scheduleWebsiteTechScan(ctx, website, {
      force: input.force === true,
    });
    return {
      queued,
      domain,
      research: await techStackResearchStatus(ctx, website),
      current: await readWebsiteTechProfile(ctx, website),
    };
  }

  if (toolName === "research_client" || toolName === "research_broker") {
    const orgId = normalizeOrganizationId(ctx, input.orgId);
    const org = await ctx.db.get(orgId);
    if (
      !org ||
      org.deletedAt !== undefined ||
      org.type !== (toolName === "research_broker" ? "broker" : "client")
    )
      throw new Error("Research organization not found");
    if (org.type === "broker") assertExternalBrokerIdentity(org);
    const queued = await scheduleCompanyResearch(ctx, orgId, { force: true });
    const researched = (await ctx.db.get(orgId))!;
    return {
      queued,
      status: researched.companyResearch!.status,
      research: companyResearchStatus(researched),
      orgId,
    };
  }

  if (isRemainingBatchToolName(toolName)) {
    const result: RemainingBatchResult = await ctx.runMutation(internal.operatorAgent.applyRemainingBatchInternal, {
      operatorUserId: args.operatorUserId,
      threadId: args.threadId,
      channel: args.channel,
      toolName,
      input,
    });
    return result;
  }

  if (isClientBatchToolName(toolName)) {
    const result: ClientBatchResult = await ctx.runMutation(internal.operatorClientBatchWrites.applyInternal, {
      operatorUserId: args.operatorUserId,
      toolName,
      input,
    });
    return result;
  }

  if (toolName === "set_client_access_status") {
    const orgId = normalizeOrganizationId(ctx, input.orgId);
    const organization = await ctx.db.get(orgId);
    if (
      !organization ||
      organization.deletedAt !== undefined ||
      organization.type !== "client"
    )
      throw new Error("Client organization not found");
    const next = input.status;
    if (next !== "limited" && next !== "active" && next !== "archived")
      throw new Error("Invalid client access status");
    const previous = clientAccessStatus(organization);
    await ctx.db.patch(orgId, { clientAccessStatus: next });
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "client_status_changed",
      targetOrgId: orgId,
      summary: `${organization.name} changed from ${previous} to ${next}`,
      metadata: { previous, next, domain: "operator_agent" },
    });
    return { status: "updated", orgId, previous, next };
  }

  if (toolName === "set_client_assignee") {
    const orgId = normalizeOrganizationId(ctx, input.orgId);
    let assigneeUserId: Id<"users"> | null = null;
    if (input.assigneeUserId !== null) {
      assigneeUserId =
        typeof input.assigneeUserId === "string"
          ? ctx.db.normalizeId("users", input.assigneeUserId)
          : null;
      if (!assigneeUserId)
        throw new NoWriteInputError(
          "invalid_identifier",
          "Invalid assignee user ID",
        );
    }
    const result = await setClientAssigneeForOperator(ctx, {
      actorUserId: args.operatorUserId,
      clientOrgId: orgId,
      assigneeUserId,
      domain: "operator_agent",
    });
    return { ...result, orgId };
  }

  if (toolName === "set_client_feature_flag") {
    const orgId = normalizeOrganizationId(ctx, input.orgId);
    const organization = await ctx.db.get(orgId);
    if (
      !organization ||
      organization.deletedAt !== undefined ||
      organization.type !== "client"
    ) {
      throw new Error("Client organization not found");
    }
    const flagId = input.flagId;
    if (flagId !== "connect_features") {
      throw new Error("Unsupported feature flag");
    }
    const enabled = input.enabled === true;
    assertFeatureFlagAllowedForOrg(flagId, organization);
    await ctx.db.patch(orgId, {
      featureFlags: setFeatureFlagPatch(
        organization.featureFlags,
        flagId,
        enabled,
      ),
    });
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "setup_write",
      targetOrgId: orgId,
      summary: `Updated ${flagId} for ${organization.name}`,
      metadata: { flagId, enabled, domain: "operator_agent" },
    });
    return { status: "updated", orgId, flagId, enabled };
  }

  if (toolName === "clear_all_agent_memory") {
    await ctx.scheduler.runAfter(
      0,
      internal.memoryMaintenance.clearTableBatch,
      {
        table: "markdownDocuments",
      },
    );
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "memory_cleared",
      summary: "Scheduled company wiki purge",
      metadata: {
        domain: "operator_agent",
        tables: ["markdownDocuments.company_wiki"],
      },
    });
    return {
      status: "scheduled",
      tables: ["markdownDocuments.company_wiki"],
    };
  }

  throw new Error(`Unsupported operator tool: ${toolName}`);
}

function operatorCertificateSource(channel: OperatorChannel) {
  if (
    channel === "slack" ||
    channel === "imessage" ||
    channel === "email" ||
    channel === "mcp"
  ) {
    return channel;
  }
  return "agent" as const;
}

export const forwardingContextInternal = internalQuery({
  args: {
    operatorUserId: v.id("users"),
    requestId: v.id("procurementRequests"),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    const details = await getProcurementRequestDetails(ctx, args.requestId);
    return { legacyForwardingAddress: details.request.forwardingAddress };
  },
});

/** Indexed team inbox search for the search_team_inbox action, which adds target flags. */
export const searchTeamInboxInternal = internalQuery({
  args: {
    query: v.string(),
    clientOrgId: v.optional(v.string()),
    includeArchived: v.optional(v.boolean()),
    limit: v.number(),
  },
  handler: async (ctx, args) =>
    await searchTeamInbox(ctx, {
      query: args.query,
      clientOrgId: args.clientOrgId
        ? normalizeOrganizationId(ctx, args.clientOrgId)
        : undefined,
      includeArchived: args.includeArchived,
      limit: args.limit,
    }),
});

export const researchStatusInternal = internalQuery({
  args: {
    operatorUserId: v.id("users"),
    orgId: v.optional(v.string()),
    website: v.optional(v.string()),
    kind: v.union(
      v.literal("company"),
      v.literal("tech_stack"),
      v.literal("all"),
    ),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    // A prospect has no organization, only a scanned website.
    if (!args.orgId) {
      const techStack = await techStackResearchStatus(ctx, args.website);
      return { research: [techStack], settled: techStack.settled };
    }
    const orgId = normalizeOrganizationId(ctx, args.orgId);
    const organization = await ctx.db.get(orgId);
    if (
      !organization ||
      organization.deletedAt !== undefined ||
      (organization.type !== "client" && organization.type !== "broker")
    ) {
      throw new NoWriteInputError(
        "target_not_found",
        "Client or provider organization not found",
      );
    }
    const statuses: ResearchStatus[] = [];
    if (args.kind !== "tech_stack")
      statuses.push(companyResearchStatus(organization));
    // Provider organizations have no tech-stack scan.
    if (args.kind !== "company" && organization.type === "client")
      statuses.push(await techStackResearchStatus(ctx, organization.website));
    return {
      orgId,
      research: statuses,
      settled: statuses.every((status) => status.settled),
    };
  },
});

/** Participants for scoping company-email search to a client or request. */
export const emailScopeParticipantsInternal = internalQuery({
  args: {
    operatorUserId: v.id("users"),
    orgId: v.optional(v.string()),
    procurementRequestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    const participants = new Set<string>();
    const request = args.procurementRequestId
      ? await ctx.db.get(
          normalizeProcurementRequestId(ctx, args.procurementRequestId),
        )
      : null;
    if (args.procurementRequestId && (!request || request.deletedAt)) {
      throw new NoWriteInputError(
        "target_not_found",
        "Procurement request not found",
      );
    }
    const orgId = args.orgId
      ? normalizeOrganizationId(ctx, args.orgId)
      : request?.clientOrgId;
    const organization = orgId ? await ctx.db.get(orgId) : null;
    if (orgId && (!organization || organization.deletedAt !== undefined)) {
      throw new NoWriteInputError(
        "target_not_found",
        "Organization not found",
      );
    }
    const domain = websiteTechDomain(organization?.website);
    if (domain) participants.add(domain);
    if (request && orgId) {
      for (const option of await clientRecipientOptions(ctx, request, orgId))
        participants.add(option.email);
      const outreaches = await ctx.db
        .query("procurementBrokerOutreaches")
        .withIndex("request", (q) => q.eq("requestId", request._id))
        .take(25);
      for (const outreach of outreaches)
        if (outreach.contactEmail)
          participants.add(outreach.contactEmail.trim().toLowerCase());
    } else if (orgId) {
      const memberships = await ctx.db
        .query("orgMemberships")
        .withIndex("organization", (q) => q.eq("orgId", orgId))
        .take(20);
      for (const membership of memberships) {
        const user = await ctx.db.get(membership.userId);
        if (user?.email && !user.isAnonymous)
          participants.add(user.email.trim().toLowerCase());
      }
    }
    return [...participants].slice(0, 20);
  },
});

export const teamEmailThreadForToolInternal = internalQuery({
  args: { operatorUserId: v.id("users"), threadId: v.string() },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    const threadId = await normalizeProcurementEmailThreadId(ctx, args.threadId);
    const details = await getTeamThreadDetails(ctx, { threadId });
    if (!details) throw new Error("Email conversation not found");
    return { threadId };
  },
});

async function executeToolActionDomain(
  ctx: ActionCtx,
  args: {
    operatorUserId: Id<"users">;
    threadId: Id<"operatorAgentThreads">;
    toolName: OperatorAgentToolName;
    input: Record<string, unknown>;
    channel: OperatorChannel;
    idempotencyKey?: string;
    confirmationId?: Id<"operatorAgentConfirmations">;
    threadMessageId?: Id<"operatorAgentMessages">;
  },
): Promise<OperatorActionToolResult> {
  args = { ...args, ...resolveOperatorToolDispatch(args.toolName, args.input) };
  if (args.toolName === "get_procurement_forwarding_address") {
    const parsed = OPERATOR_AGENT_TOOL_REGISTRY.get_procurement_forwarding_address.inputSchema.parse(args.input);
    const context = await ctx.runQuery(internal.operatorAgent.forwardingContextInternal, {
      operatorUserId: args.operatorUserId,
      requestId: parsed.procurementRequestId as Id<"procurementRequests">,
    });
    const ensured = await ensureOperatorInbox(ctx, args.operatorUserId);
    return {
      result: {
        procurementRequestId: parsed.procurementRequestId,
        forwardingAddress: ensured.inbox.emailAddress,
        ...context,
        instruction: "Forward to your team address, then confirm that the conversation is linked to the intended request in the team inbox.",
        captured: ensured.captured,
      },
    };
  }

  if (args.toolName === "search_team_inbox") {
    const parsed = OPERATOR_AGENT_TOOL_REGISTRY.search_team_inbox.inputSchema.parse(args.input);
    const search = await ctx.runQuery(internal.operatorAgent.searchTeamInboxInternal, {
      query: parsed.query,
      clientOrgId: parsed.clientOrgId,
      includeArchived: parsed.includeArchived,
      limit: parsed.limit ?? 10,
    });
    const flagged = await flagTeamInboxTargets(
      parsed.query,
      search.threads,
      (request) =>
        clRouterDecide(
          { task: "team_inbox_target_match", ...request, executionBudgetMs: 8_000 },
          { telemetry: ctx },
        ),
      jevProceedThreshold(),
    );
    return {
      result: {
        targets: flagged.rows
          .filter((row) => row.likelyTarget)
          .map((row) => row.teamEmailThreadId),
        threads: flagged.rows,
        bounded: search.bounded,
        targetDecision: flagged.decision,
      },
    };
  }

  if (args.toolName === "get_research_status") {
    const parsed = OPERATOR_AGENT_TOOL_REGISTRY.get_research_status.inputSchema.parse(args.input);
    const startedAt = dayjs().valueOf();
    const deadline = startedAt + (parsed.waitSeconds ?? 0) * 1_000;
    for (;;) {
      const status = await ctx.runQuery(internal.operatorAgent.researchStatusInternal, {
        operatorUserId: args.operatorUserId,
        orgId: parsed.orgId,
        website: parsed.website,
        kind: parsed.kind ?? "all",
      });
      const now = dayjs().valueOf();
      if (status.settled || now >= deadline) {
        return {
          result: { ...status, waitedSeconds: Math.round((now - startedAt) / 1_000) },
        };
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(RESEARCH_POLL_MS, deadline - now)),
      );
    }
  }

  if (args.toolName === "list_mcp_tools" || args.toolName === "call_mcp_tool") {
    return await ctx.runAction(internal.actions.operatorMcp.run, {
      operatorUserId: args.operatorUserId,
      toolName: args.toolName,
      input: args.input,
    });
  }

  if (isOperatorGoogleWorkspaceTool(args.toolName)) {
    let input = args.input;
    if (
      args.toolName === "search_company_email" &&
      (input.orgId || input.procurementRequestId)
    ) {
      const scoped = await ctx.runQuery(
        internal.operatorAgent.emailScopeParticipantsInternal,
        {
          operatorUserId: args.operatorUserId,
          orgId: normalizedOptionalText(input.orgId),
          procurementRequestId: normalizedOptionalText(
            input.procurementRequestId,
          ),
        },
      );
      const explicit = Array.isArray(input.participants)
        ? (input.participants as string[])
        : [];
      const participants = [...new Set([...explicit, ...scoped])].slice(0, 20);
      if (!participants.length) {
        throw new NoWriteInputError(
          "invalid_input",
          "No website domain or contact email is on record for that scope. Pass participants explicitly.",
        );
      }
      input = { ...input, participants };
    }
    return await ctx.runAction(
      internal.actions.operatorGoogleWorkspace.runToolInternal,
      {
        operatorUserId: args.operatorUserId,
        threadId: args.threadId,
        toolName: args.toolName,
        input,
        channel: args.channel,
      },
    );
  }

  if (OPERATOR_RICH_ACTION_TOOLS.has(args.toolName)) {
    return (await ctx.runAction(
      internal.actions.operatorAgentRichTools.runInternal,
      {
        operatorUserId: args.operatorUserId,
        threadId: args.threadId,
        toolName: args.toolName,
        input: args.input,
        channel: args.channel,
        confirmationId: args.confirmationId,
        messageId: args.threadMessageId,
      },
    )) as OperatorActionToolResult;
  }

  if (args.toolName === "lookup_address") {
    const query = normalizedOptionalText(args.input.query);
    if (!query) throw new Error("Address is required");
    const accessToken =
      process.env.MAPBOX_ACCESS_TOKEN?.trim() ||
      process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim();
    if (!accessToken) {
      return {
        result: {
          status: "unavailable",
          query,
          candidates: [],
          message:
            "Mapbox address validation is not configured. Preserve the operator's original address and do not claim it was validated.",
        },
      };
    }
    return {
      result: await lookupMapboxAddress({
        query,
        countryCode: normalizedOptionalText(args.input.countryCode),
        accessToken,
      }),
    };
  }

  if (args.toolName === "generate_coi") {
    const target = await ctx.runQuery(
      internal.operatorAgent.resolveOperatorCoiTargetInternal,
      {
        operatorUserId: args.operatorUserId,
        input: args.input,
      },
    );
    const certificateHolder = normalizedOptionalText(
      args.input.certificateHolder,
    );
    const holderName = certificateHolder?.split(/\r?\n/)[0]?.trim();
    const requestedEndorsements = Array.isArray(
      args.input.requestedEndorsements,
    )
      ? args.input.requestedEndorsements.filter(
          (value): value is string => typeof value === "string",
        )
      : undefined;
    const batch: unknown = await ctx.runAction(
      internal.certificates.generateBatchForOrg,
      {
        orgId: target.orgId,
        primaryPolicyId: target.primaryPolicyId,
        requirementSourceDocumentId:
          target.requirementSourceDocumentId ?? undefined,
        requirementId: target.requirementId ?? undefined,
        holderName,
        certificateHolder,
        holderContactName: normalizedOptionalText(args.input.holderContactName),
        holderEmail: normalizedOptionalText(args.input.holderEmail),
        holderPhone: normalizedOptionalText(args.input.holderPhone),
        addressLine1: normalizedOptionalText(args.input.addressLine1),
        addressLine2: normalizedOptionalText(args.input.addressLine2),
        city: normalizedOptionalText(args.input.city),
        state: normalizedOptionalText(args.input.state),
        postalCode: normalizedOptionalText(args.input.postalCode),
        country: normalizedOptionalText(args.input.country),
        requestText: normalizedOptionalText(args.input.requestText),
        descriptionOfOperations: normalizedOptionalText(
          args.input.descriptionOfOperations,
        ),
        requestedEndorsements,
        additionalInsuredName: normalizedOptionalText(
          args.input.additionalInsuredName,
        ),
        forceReissue: args.input.explicitReissue === true ? true : undefined,
        source: operatorCertificateSource(args.channel),
        createdByUserId: args.operatorUserId,
      },
    );
    // File each generated certificate so outbound email drafts can attach it
    // with attach_client_file_to_draft.
    const batchRecord = recordValue(batch);
    if (batchRecord && Array.isArray(batchRecord.results)) {
      for (const row of batchRecord.results) {
        const certificate = recordValue(row);
        if (
          !certificate ||
          typeof certificate.fileId !== "string" ||
          typeof certificate.fileName !== "string"
        ) {
          continue;
        }
        certificate.clientFileId = await ctx.runMutation(
          internal.clientFiles.fileGeneratedCertificateInternal,
          {
            operatorUserId: args.operatorUserId,
            orgId: target.orgId,
            fileId: certificate.fileId as Id<"_storage">,
            filename: certificate.fileName,
          },
        );
      }
    }
    return normalizeOperatorCoiBatch(batch);
  }

  if (args.toolName === "generate_procurement_proposal_review") {
    return {
      result: await ctx.runAction(
        internal.actions.proposalReview.generateReviewInternal,
        {
          operatorUserId: args.operatorUserId,
          proposalId: String(
            args.input.procurementProposalId,
          ) as Id<"procurementProposals">,
        },
      ),
    };
  }

  if (args.toolName === "send_operator_slack_message") {
    if (!args.idempotencyKey) {
      throw new Error("Operator Slack send requires an idempotency key");
    }
    return {
      result: await ctx.runAction(
        internal.actions.sendOperatorSlack.sendInternal,
        {
          operatorUserId: args.operatorUserId,
          recipientEmail: String(args.input.recipientEmail),
          content: String(args.input.message),
          idempotencyKey: args.idempotencyKey,
        },
      ),
    };
  }

  if (args.toolName === "create_client_organization") {
    return {
      result: await ctx.runAction(
        internal.operator.createClientWithoutUsersForAgentInternal,
        {
          operatorUserId: args.operatorUserId,
          name: String(args.input.name),
          website: normalizedOptionalText(args.input.website),
        },
      ),
    };
  }

  if (args.toolName === "invite_operator") {
    return {
      result: await ctx.runAction(
        internal.operatorInvitations.inviteOperatorForAgentInternal,
        {
          operatorUserId: args.operatorUserId,
          email: String(args.input.email),
        },
      ),
    };
  }

  throw new Error(`Unsupported operator action tool: ${args.toolName}`);
}

// Keep all item writes, scheduled research and audits in a nested transaction:
// the runner catches tool failures, so a failed batch must roll back independently.
export const applyRemainingBatchInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    threadId: v.id("operatorAgentThreads"),
    channel: operatorChannelValidator,
    toolName: v.string(),
    input: v.any(),
  },
  handler: async (ctx, args): Promise<RemainingBatchResult> => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    await requireOperatorThread(ctx, args.threadId, args.operatorUserId, {
      anyOperator: true,
    });
    await assertNoOperatorImpersonation(ctx, args.operatorUserId);
    if (!isRemainingBatchToolName(args.toolName))
      throw new Error("Unsupported batch tool");
    const toolName = args.toolName;
    const prepared = await prepareRemainingBatchForConfirmation(ctx, {
      ...args,
      toolName,
    });
    const single = REMAINING_BATCH_TOOLS[toolName].single;
    return applyOperatorBatch(prepared, async (input) => {
      if (single === "create_client_organization") {
        const created: { clientOrgId: Id<"organizations"> } =
          await ctx.runMutation(internal.operator.createSoloClientInternal, {
            operatorUserId: args.operatorUserId,
            users: [],
            client: {
              name: String(input.name),
              website: normalizedOptionalText(input.website),
            },
          });
        return {
          ...created,
          status: "created",
          deepLink: `/operator/clients/${created.clientOrgId}`,
        };
      }
      if (single === "add_client_file") {
        return createClientFileFromOperatorAttachment(ctx, {
          operatorUserId: args.operatorUserId,
          threadId: args.threadId,
          orgId: normalizeOrganizationId(ctx, input.orgId),
          attachmentFileId: await resolveThreadAttachmentFileId(
            ctx,
            args.threadId,
            input.attachmentFileId,
          ),
          name: String(input.name),
          policyId: input.policyId
            ? normalizePolicyId(ctx, input.policyId)
            : undefined,
          auditAlreadyFiled: true,
        });
      }
      if (single === "cancel_email_draft") {
        const draftId = ctx.db.normalizeId(
          "pendingEmails",
          String(input.draftId),
        )!;
        const draft = (await ctx.db.get(draftId))!;
        await ctx.runMutation(internal.pendingEmails.cancelInternal, {
          id: draftId,
        });
        await writeOperatorAudit(ctx, {
          operatorUserId: args.operatorUserId,
          type: "setup_write",
          targetOrgId: draft.orgId,
          summary: `Cancelled email draft ${draft.subject}`,
          metadata: {
            domain: "operator_agent",
            toolName,
            draftId,
            threadId: args.threadId,
          },
        });
        return { draftId, status: "cancelled" };
      }
      if (single === "archive_procurement_proposal") {
        const result = await archiveProcurementProposalByOperator(ctx, {
          operatorUserId: args.operatorUserId,
          proposalId: normalizeProcurementProposalId(
            ctx,
            input.procurementProposalId,
          ),
          reason: normalizedOptionalText(input.reason),
          preserveEmptyDraft: true,
        });
        if (result.outcome === "unchanged")
          await writeOperatorAudit(ctx, {
            operatorUserId: args.operatorUserId,
            type: "setup_write",
            summary: `Proposal ${result.proposalId} already archived`,
            metadata: {
              domain: "operator_agent",
              toolName,
              proposalId: result.proposalId,
              outcome: result.outcome,
            },
          });
        return result;
      }
      // Shared writers retain their existing authorization and per-item audits.
      const result = await executeToolDomain(ctx, {
        ...args,
        toolName: single,
        input,
      });
      if (
        single === "update_organization_profile" &&
        result &&
        "companyResearch" in result
      ) {
        const { companyResearch: _research, ...compact } = result;
        return compact;
      }
      if (single === "research_broker") {
        await writeOperatorAudit(ctx, {
          operatorUserId: args.operatorUserId,
          type: "setup_write",
          targetOrgId: normalizeOrganizationId(ctx, input.orgId),
          summary: `Requested provider research for ${input.orgId}`,
          metadata: { domain: "operator_agent", toolName, input },
        });
      }
      if (
        single === "link_team_inbox_thread" &&
        result &&
        "linked" in result &&
        result.linked === false
      )
        await writeOperatorAudit(ctx, {
          operatorUserId: args.operatorUserId,
          type: "setup_write",
          summary: `Email conversation ${input.teamEmailThreadId} already linked`,
          metadata: {
            domain: "operator_agent",
            toolName,
            input,
            unchanged: true,
          },
        });
      return result;
    });
  },
});

async function executeOperatorTool(ctx: MutationCtx, args: ExecuteToolArgs) {
  const operator = await requireOperatorForUser(ctx, args.operatorUserId);
  const run = await ctx.db.get(args.runId);
  if (
    !run ||
    run.operatorUserId !== args.operatorUserId ||
    run.threadId !== args.threadId
  ) {
    throw new Error("Operator agent run not found");
  }
  await requireOperatorThread(ctx, args.threadId, args.operatorUserId, {
    anyOperator: true,
  });
  const spec = getOperatorAgentToolSpec(args.toolName);
  assertOperatorEmailToolAccess(run, spec);
  if (spec.execution !== "mutation") {
    throw new Error(`Operator tool ${args.toolName} requires action execution`);
  }
  assertOperatorRole(operator.profile.role, spec.requiredRole);
  const input = parseOperatorAgentToolInput(args.toolName, args.input);
  const expectedHash = await actionConfirmationFingerprint({
    toolName: args.toolName,
    toolVersion: spec.version,
    input,
  });
  if (expectedHash !== args.inputHash) {
    throw new Error("Operator tool input changed before execution");
  }
  const target = spec.target(input);
  const existing = await ctx.db
    .query("agentActionAuditEvents")
    .withIndex("idempotency", (index) =>
      index
        .eq("operatorUserId", args.operatorUserId)
        .eq("idempotencyKey", args.idempotencyKey),
    )
    .unique();
  if (existing) {
    if (
      existing.inputHash !== args.inputHash ||
      existing.action !== args.toolName
    ) {
      throw new Error("Idempotency key was already used for another action");
    }
    if (existing.status === "succeeded") {
      if (
        args.toolName === "list_operator_conversations" ||
        args.toolName === "read_operator_conversation"
      ) {
        const result = await executeToolDomain(ctx, {
          ...args,
          toolName: args.toolName,
          input,
        });
        return { status: "succeeded" as const, result, idempotent: true };
      }
      return {
        status: "succeeded" as const,
        result: parseStoredOutput(existing.output),
        idempotent: true,
      };
    }
    if (
      run.cancellationRequestedAt ||
      run.status === "cancelled" ||
      run.status === "failed" ||
      run.status === "completed"
    ) {
      throw new Error("Operator agent run is no longer active");
    }
    if (existing.status === "awaiting_confirmation" && !args.confirmationId) {
      const confirmation = existing.operatorConfirmationId
        ? await ctx.db.get(existing.operatorConfirmationId)
        : null;
      return {
        status: "confirmation_required" as const,
        confirmationId: existing.operatorConfirmationId,
        summary:
          confirmation?.payload.summary ??
          "Confirm the selected operator action",
      };
    }
    if (
      existing.status === "awaiting_confirmation" &&
      existing.operatorConfirmationId !== args.confirmationId
    ) {
      throw new Error("Confirmation does not match this action");
    }
    await ctx.db.patch(existing._id, {
      status: "pending",
      operatorConfirmationId:
        args.confirmationId ?? existing.operatorConfirmationId,
      updatedAt: dayjs().valueOf(),
    });
  }

  if (run.cancellationRequestedAt || run.status === "cancelled") {
    throw new Error("Operator agent run was cancelled");
  }
  if (spec.confirmation === "exact") {
    const confirmation = args.confirmationId
      ? await ctx.db.get(args.confirmationId)
      : null;
    const automatic = confirmation?.approvalMode === "automatic";
    if (
      automatic
        ? run.status !== "running" ||
          (await getOperatorAgentSettings(ctx))?.approveAll !== true
        : run.status !== "waiting_confirmation" ||
          run.checkpoint?.pendingConfirmationId !== args.confirmationId
    ) {
      throw new Error("Exact operator confirmation is required");
    }
    if (
      !confirmation ||
      confirmation.status !== "completed" ||
      confirmation.operatorUserId !== args.operatorUserId ||
      confirmation.threadId !== args.threadId ||
      confirmation.payload.runId !== args.runId ||
      confirmation.payload.toolName !== args.toolName ||
      confirmation.payload.inputHash !== args.inputHash ||
      confirmation.payload.idempotencyKey !== args.idempotencyKey
    ) {
      throw new Error("Exact operator confirmation is invalid");
    }
  } else if (run.status !== "running") {
    throw new Error("Operator agent run is no longer active");
  }

  const now = dayjs().valueOf();
  const auditId =
    existing?._id ??
    (await ctx.db.insert("agentActionAuditEvents", {
      operatorThreadId: args.threadId,
      operatorMessageId: args.threadMessageId,
      runId: args.runId,
      operatorConfirmationId: args.confirmationId,
      actorKind: "operator",
      operatorUserId: args.operatorUserId,
      authorizationKind: "operator",
      action: args.toolName,
      toolVersion: spec.version,
      capability: spec.capability,
      effect: spec.effect,
      idempotencyKey: args.idempotencyKey,
      inputHash: args.inputHash,
      targetKind: target.kind,
      targetId: target.id,
      channel: args.channel,
      input: boundedJson(input),
      status: "pending",
      createdAt: now,
      updatedAt: now,
    }));

  try {
    const result = await executeToolDomain(ctx, {
      runId: args.runId,
      operatorUserId: args.operatorUserId,
      threadId: args.threadId,
      channel: args.channel,
      toolName: args.toolName as OperatorAgentToolName,
      input,
      sourceFingerprint: args.confirmationId
        ? (await ctx.db.get(args.confirmationId))?.payload.sourceFingerprint
        : undefined,
    });
    await ctx.db.patch(auditId, {
      status: "succeeded",
      output: serializedOperatorActionOutput(args.toolName, result),
      error: undefined,
      updatedAt: dayjs().valueOf(),
    });
    return { status: "succeeded" as const, result, idempotent: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure = executionOperatorToolFailure(
      args.toolName as OperatorAgentToolName,
      error,
    );
    await ctx.db.patch(auditId, {
      status: "failed",
      output: boundedJson(failure),
      error: message.slice(0, 1_000),
      updatedAt: dayjs().valueOf(),
    });
    return failure;
  }
}

const CONVERSATION_CHANNELS = ["chat", "slack", "imessage", "email"] as const;

export const listThreads = query({
  args: {
    limit: v.optional(v.number()),
    /** Recent conversations, MCP requests, or everything archived. */
    view: v.optional(
      v.union(v.literal("recent"), v.literal("mcp"), v.literal("archived")),
    ),
  },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const limit = Math.max(1, Math.min(args.limit ?? 50, 100));
    const view = args.view ?? "recent";
    const byChannel = (channel: OperatorChannel) =>
      ctx.db
        .query("operatorAgentThreads")
        .withIndex("archive_channel_last_message", (index) =>
          index.eq("archiveState", undefined).eq("channel", channel),
        )
        .order("desc")
        .take(limit);
    const threads =
      view === "archived"
        ? await ctx.db
            .query("operatorAgentThreads")
            .withIndex("archive_last_message", (index) =>
              index.eq("archiveState", "archived"),
            )
            .order("desc")
            .take(limit)
        : view === "mcp"
          ? await byChannel("mcp")
          : (await Promise.all(CONVERSATION_CHANNELS.map(byChannel)))
              .flat()
              .sort((left, right) => right.lastMessageAt - left.lastMessageAt)
              .slice(0, limit);
    const people = await operatorPeople(
      ctx,
      threads.map((thread) => thread.ownerUserId),
    );
    return threads.map((thread) => ({
      ...thread,
      creator: people.get(thread.ownerUserId)!,
    }));
  },
});

export const archiveThread = mutation({
  args: { threadId: v.id("operatorAgentThreads") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await requireOperatorThread(ctx, args.threadId, operator.userId, {
      anyOperator: true,
    });
    const now = dayjs().valueOf();
    await ctx.db.patch(args.threadId, {
      archivedAt: now,
      archiveState: "archived",
      updatedAt: now,
    });
    return { archivedAt: now };
  },
});

export const unarchiveThread = mutation({
  args: { threadId: v.id("operatorAgentThreads") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await requireOperatorThread(ctx, args.threadId, operator.userId, {
      anyOperator: true,
    });
    await ctx.db.patch(args.threadId, {
      archivedAt: undefined,
      archiveState: undefined,
      updatedAt: dayjs().valueOf(),
    });
    return { restored: true };
  },
});

async function withPageContextHref(
  ctx: QueryCtx,
  context: Doc<"operatorAgentThreads">["initialContext"],
) {
  if (!context?.entityId || context.href) return context;
  let href: string | undefined;
  if (context.pageType === "procurement_request") {
    const requestId = ctx.db.normalizeId(
      "procurementRequests",
      context.entityId,
    );
    const request = requestId
      ? await ctx.db.get("procurementRequests", requestId)
      : null;
    if (request) {
      href = `/operator/clients/${request.clientOrgId}/procurement/${request._id}`;
    }
  } else if (context.pageType === "policy") {
    const policyId = ctx.db.normalizeId("policies", context.entityId);
    const policy = policyId ? await ctx.db.get("policies", policyId) : null;
    if (policy) {
      href = `/operator/clients/${policy.orgId}/policies/${policy._id}`;
    }
  }
  return href ? { ...context, href } : context;
}

export const clearThreadContext = mutation({
  args: { threadId: v.id("operatorAgentThreads") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await requireOperatorThread(ctx, args.threadId, operator.userId, {
      anyOperator: true,
    });
    await ctx.db.patch(args.threadId, {
      pageContext: null,
      updatedAt: dayjs().valueOf(),
    });
    return { cleared: true };
  },
});

const MAX_ACTIVITY_ENTITIES = 40;

/**
 * Brands for the records tool calls acted on, keyed `kind:id`, so activity
 * rows can show the client's mark. Requests resolve to their client
 * organization; deleted or unknown records are omitted.
 */
async function activityEntities(
  ctx: QueryCtx,
  messages: Doc<"operatorAgentMessages">[],
) {
  const targets = new Map<string, MessageActivityToolTarget>();
  for (const message of messages)
    for (const tool of message.activity?.tools ?? [])
      if (tool.target && targets.size < MAX_ACTIVITY_ENTITIES)
        targets.set(`${tool.target.kind}:${tool.target.id}`, tool.target);
  const entities: Record<
    string,
    { name: string; website?: string; iconUrl?: string }
  > = {};
  await Promise.all(
    [...targets].map(async ([key, target]) => {
      let orgId: Id<"organizations"> | null | undefined;
      if (target.kind === "organization") {
        orgId = ctx.db.normalizeId("organizations", target.id);
      } else {
        const requestId = ctx.db.normalizeId("procurementRequests", target.id);
        const request = requestId ? await ctx.db.get(requestId) : null;
        orgId = request && !request.deletedAt ? request.clientOrgId : null;
      }
      const org = orgId ? await ctx.db.get(orgId) : null;
      if (!org || org.deletedAt) return;
      const iconUrl = org.iconStorageId
        ? await ctx.storage.getUrl(org.iconStorageId)
        : null;
      entities[key] = {
        name: org.name,
        ...(org.website ? { website: org.website } : {}),
        ...(iconUrl ? { iconUrl } : {}),
      };
    }),
  );
  return entities;
}

/** External system each named tool reaches, for branded activity rows. */
function toolIntegrations(names: string[]) {
  const integrations: Record<string, OperatorToolIntegration> = {};
  for (const name of new Set(names)) {
    const integration = isOperatorAgentToolName(name)
      ? getOperatorAgentToolSpec(name).integration
      : undefined;
    if (integration) integrations[name] = integration;
  }
  return integrations;
}

/** The agent draft a `send_email_draft` approval would send, so the chat can open it in the composer. */
function confirmationEmailDraftId(payload: {
  toolName: string;
  input: string;
}) {
  if (payload.toolName !== "send_email_draft") return undefined;
  try {
    const { draftId } = JSON.parse(payload.input) as { draftId?: unknown };
    return typeof draftId === "string" ? draftId : undefined;
  } catch {
    return undefined;
  }
}

export const getThread = query({
  args: { threadId: v.id("operatorAgentThreads") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const thread = await requireOperatorThread(
      ctx,
      args.threadId,
      operator.userId,
      { anyOperator: true },
    );
    const [initialContext, pageContext] = await Promise.all([
      withPageContextHref(ctx, thread.initialContext),
      withPageContextHref(ctx, threadPageContext(thread)),
    ]);
    const [messages, runs, confirmations] = await Promise.all([
      ctx.db
        .query("operatorAgentMessages")
        .withIndex("thread", (index) => index.eq("threadId", args.threadId))
        .order("desc")
        .take(500)
        .then((items) => items.reverse()),
      ctx.db
        .query("operatorAgentRuns")
        .withIndex("thread_status", (index) =>
          index.eq("threadId", args.threadId),
        )
        .order("desc")
        .take(500),
      ctx.db
        .query("operatorAgentConfirmations")
        .withIndex("thread", (index) => index.eq("threadId", args.threadId))
        .order("desc")
        .take(500)
        .then((items) => items.reverse()),
    ]);
    const activeRun =
      runs.find((run) => ACTIVE_RUN_STATUSES.has(run.status)) ?? null;
    const visibleMessageIds = new Set(messages.map((message) => message._id));
    const rerunnableRuns = new Map(
      runs
        .filter(
          (run) =>
            run.executionKind !== "direct_tool" &&
            run.operatorUserId === operator.userId &&
            !ACTIVE_RUN_STATUSES.has(run.status),
        )
        .map((run) => [
          run.agentMessageId,
          { runId: run._id, withErrorContext: run.status === "failed" },
        ]),
    );
    const presentationBudget = presentationReadBudget();
    const people = await operatorPeople(ctx, [
      thread.ownerUserId,
      ...messages.flatMap((message) => (message.userId ? [message.userId] : [])),
    ]);
    const entities = await activityEntities(ctx, messages);
    return {
      thread: { ...thread, initialContext, pageContext: pageContext ?? null },
      entities,
      viewerUserId: operator.userId,
      creator: people.get(thread.ownerUserId)!,
      people: [...people.values()],
      messages: (
        await Promise.all(
          [...messages].reverse().map(async (message) => {
            const { presentation: _presentation, ...visible } = message;
            const presentation = await visiblePresentation(
              ctx,
              message,
              { audience: "operator" },
              presentationBudget,
            );
            return {
              ...visible,
              ...(presentation ? { presentation } : {}),
              rerun: rerunnableRuns.get(message._id),
              toolCalls: message.toolCalls?.map((call) => ({
                ...call,
                effect: isOperatorAgentToolName(call.name)
                  ? getOperatorAgentToolSpec(call.name).effect
                  : undefined,
              })),
              toolIntegrations: toolIntegrations([
                ...(message.toolCalls ?? []).map((call) => call.name),
                ...(message.activity?.tools ?? []).map(
                  (tool) => tool.toolName,
                ),
              ]),
            };
          }),
        )
      ).reverse(),
      activeRun,
      recentRuns: runs.slice(0, 25),
      confirmations: confirmations
        .filter((confirmation) =>
          visibleMessageIds.has(confirmation.promptMessageId),
        )
        .map((confirmation) => {
          const actionable =
            confirmation.status === "pending" &&
            confirmation.operatorUserId === operator.userId &&
            activeRun?.status === "waiting_confirmation" &&
            activeRun.checkpoint?.pendingConfirmationId === confirmation._id;
          return {
            _id: confirmation._id,
            promptMessageId: confirmation.promptMessageId,
            summary: confirmation.payload.summary,
            toolName: confirmation.payload.toolName,
            effect: confirmation.payload.effect,
            approvalMode: confirmation.approvalMode,
            state: operatorConfirmationDisplayState(confirmation),
            actionable,
            expiresAt: confirmation.expiresAt,
            emailDraftId: confirmationEmailDraftId(confirmation.payload),
          };
        }),
    };
  },
});

export const createThread = mutation({
  args: { initialContext: v.optional(pageContextValidator) },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return insertOperatorThread(ctx, {
      operatorUserId: operator.userId,
      channel: "chat",
      initialContext: args.initialContext,
    });
  },
});

export const listIntents = query({
  args: { pageContext: v.optional(pageContextValidator) },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    return listOperatorAgentIntents(
      normalizeOperatorPageContext(args.pageContext),
    );
  },
});

export const startIntent = mutation({
  args: {
    intentId: v.string(),
    suggestionKey: v.optional(v.string()),
    pageContext: v.optional(pageContextValidator),
    emptyThreadId: v.optional(v.id("operatorAgentThreads")),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const emptyThread = args.emptyThreadId
      ? await findEmptyChatThread(ctx, args.emptyThreadId, operator.userId)
      : null;
    // Live suggestions are re-derived from current data; client text is never trusted.
    let suggestion: OperatorSuggestionCandidate | undefined;
    if (args.suggestionKey && !args.suggestionKey.startsWith("intent:")) {
      const candidates = await collectOperatorSuggestionCandidates(ctx, {
        operatorUserId: operator.userId,
        pageContext: normalizeOperatorPageContext(args.pageContext),
        now: dayjs().valueOf(),
      });
      suggestion = candidates.find(
        (candidate) => candidate.key === args.suggestionKey,
      );
      if (suggestion?.intentId !== args.intentId) {
        throw new Error("This suggestion is no longer available");
      }
    }
    const suggestionContext = normalizeOperatorPageContext(
      suggestion?.pageContext,
    );
    const pageContext =
      suggestionContext ??
      (emptyThread ? threadPageContext(emptyThread) : undefined) ??
      normalizeOperatorPageContext(args.pageContext);
    const intent = resolveOperatorAgentIntent(args.intentId, pageContext);
    const title = suggestion?.label ?? intent.label;

    let threadId: Id<"operatorAgentThreads">;
    if (emptyThread) {
      threadId = emptyThread._id;
      await ctx.db.patch(threadId, {
        title: normalizeOperatorThreadTitle(title),
        ...(suggestionContext ? { pageContext: suggestionContext } : {}),
        updatedAt: dayjs().valueOf(),
      });
    } else {
      threadId = await insertOperatorThread(ctx, {
        operatorUserId: operator.userId,
        channel: "chat",
        title,
        initialContext: pageContext,
      });
    }

    const result = await enqueueOperatorMessage(ctx, {
      operatorUserId: operator.userId,
      threadId,
      channel: "chat",
      content: suggestion
        ? `${intent.objective}\n\nFocus: ${suggestion.focus}`
        : intent.objective,
      pageContext,
      toolArtifacts: [
        {
          type: "operator_intent",
          data: {
            id: intent.id,
            version: intent.version,
            ...(suggestion?.focusIds ? { focus: suggestion.focusIds } : {}),
          },
        },
      ],
    });
    return { threadId, ...result };
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const operator = await requireOperator(ctx);
    const now = dayjs().valueOf();
    const expiresAt = dayjs(now).add(30, "minute").valueOf();
    const uploadIntentId = await ctx.db.insert("operatorAgentUploadIntents", {
      operatorUserId: operator.userId,
      expiresAt,
      createdAt: now,
    });
    await ctx.scheduler.runAt(
      expiresAt,
      internal.operatorAgent.cleanupUploadIntentInternal,
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
    uploadIntentId: v.id("operatorAgentUploadIntents"),
    fileId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const intent = await ctx.db.get(args.uploadIntentId);
    if (
      !intent ||
      intent.operatorUserId !== operator.userId ||
      intent.expiresAt <= dayjs().valueOf() ||
      (intent.fileId && intent.fileId !== args.fileId)
    ) {
      throw new Error(
        "Operator attachment upload intent is invalid or expired",
      );
    }
    const existingReference = await ctx.db
      .query("operatorAgentAttachments")
      .withIndex("file", (index) => index.eq("fileId", args.fileId))
      .first();
    if (existingReference?.operatorUserId !== undefined) {
      throw new Error("Operator attachment is already owned");
    }
    const metadata = await ctx.db.system.get("_storage", args.fileId);
    if (!metadata) throw new Error("Operator attachment was not uploaded");
    await ctx.db.patch(intent._id, { fileId: args.fileId });
    return { registered: true as const };
  },
});

export const discardUploads = mutation({
  args: {
    uploads: v.array(
      v.object({
        uploadIntentId: v.id("operatorAgentUploadIntents"),
        fileId: v.optional(v.id("_storage")),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    let discarded = 0;
    for (const upload of args.uploads) {
      const intent = await ctx.db.get(upload.uploadIntentId);
      if (!intent || intent.operatorUserId !== operator.userId) {
        continue;
      }
      if (intent.fileId && upload.fileId && intent.fileId !== upload.fileId) {
        continue;
      }
      const fileId = intent.fileId ?? upload.fileId;
      if (fileId) {
        const reference = await ctx.db
          .query("operatorAgentAttachments")
          .withIndex("file", (index) => index.eq("fileId", fileId))
          .first();
        if (!reference) await ctx.storage.delete(fileId);
      }
      await ctx.db.delete(intent._id);
      discarded += 1;
    }
    return { discarded };
  },
});

export const cleanupUploadIntentInternal = internalMutation({
  args: { uploadIntentId: v.id("operatorAgentUploadIntents") },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.uploadIntentId);
    if (!intent) return { deleted: false as const };
    const now = dayjs().valueOf();
    if (intent.expiresAt > now) {
      await ctx.scheduler.runAt(
        intent.expiresAt,
        internal.operatorAgent.cleanupUploadIntentInternal,
        args,
      );
      return { deleted: false as const };
    }
    if (intent.fileId) {
      const fileId = intent.fileId;
      const reference = await ctx.db
        .query("operatorAgentAttachments")
        .withIndex("file", (index) => index.eq("fileId", fileId))
        .first();
      if (!reference) await ctx.storage.delete(fileId);
    }
    await ctx.db.delete(intent._id);
    return { deleted: true as const };
  },
});

export const deleteUnreferencedAttachmentsInternal = internalMutation({
  args: { fileIds: v.array(v.id("_storage")) },
  handler: async (ctx, args) => {
    let deleted = 0;
    for (const fileId of args.fileIds) {
      const reference = await ctx.db
        .query("operatorAgentAttachments")
        .withIndex("file", (index) => index.eq("fileId", fileId))
        .first();
      if (reference) continue;
      await ctx.storage.delete(fileId);
      deleted += 1;
    }
    return { deleted };
  },
});

export const getAttachmentUrl = query({
  args: {
    threadId: v.id("operatorAgentThreads"),
    fileId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await requireOperatorThread(ctx, args.threadId, operator.userId, {
      anyOperator: true,
    });
    const attachment = await ctx.db
      .query("operatorAgentAttachments")
      .withIndex("thread_file", (index) =>
        index.eq("threadId", args.threadId).eq("fileId", args.fileId),
      )
      .first();
    return attachment ? ctx.storage.getUrl(args.fileId) : null;
  },
});

export const sendMessage = mutation({
  args: {
    threadId: v.optional(v.id("operatorAgentThreads")),
    content: v.string(),
    pageContext: v.optional(pageContextValidator),
    attachments: v.optional(v.array(operatorAttachmentValidator)),
    planMode: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const threadId =
      args.threadId ??
      (await insertOperatorThread(ctx, {
        operatorUserId: operator.userId,
        channel: "chat",
        initialContext: args.pageContext,
      }));
    const result = await enqueueOperatorMessage(ctx, {
      operatorUserId: operator.userId,
      threadId,
      channel: "chat",
      content: args.content,
      pageContext: args.pageContext,
      attachments: args.attachments,
      requireUploadIntent: Boolean(args.attachments?.length),
      planRequested: args.planMode,
    });
    return { threadId, ...result };
  },
});

export const rerunTurn = mutation({
  args: {
    runId: v.id("operatorAgentRuns"),
    includeErrorContext: v.boolean(),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const source = await ctx.db.get(args.runId);
    if (!source || source.operatorUserId !== operator.userId) {
      throw new Error("Operator agent run not found");
    }
    await requireOperatorThread(ctx, source.threadId, operator.userId, {
      anyOperator: true,
    });
    if (
      source.executionKind === "direct_tool" ||
      ACTIVE_RUN_STATUSES.has(source.status)
    ) {
      throw new Error("Only finished agent turns can be rerun");
    }
    if (args.includeErrorContext && source.status !== "failed") {
      throw new Error("Error context is only available for failed turns");
    }
    for (const status of [
      "queued",
      "running",
      "waiting_confirmation",
    ] as const) {
      const active = await ctx.db
        .query("operatorAgentRuns")
        .withIndex("thread_status", (q) =>
          q.eq("threadId", source.threadId).eq("status", status),
        )
        .first();
      if (active)
        throw new Error("Wait for the current turn to finish before rerunning");
    }
    const original = await ctx.db.get(source.userMessageId);
    if (
      !original ||
      original.threadId !== source.threadId ||
      original.role !== "user"
    ) {
      throw new Error("Original operator message not found");
    }
    const result = await enqueueOperatorMessage(ctx, {
      operatorUserId: operator.userId,
      threadId: source.threadId,
      channel: "chat",
      content: original.content,
      attachments: original.attachments,
      emailContent: original.emailContent,
      planRequested: source.planRequested,
      toolArtifacts: [{ type: "operator_turn_rerun", data: args }],
    });
    const summary = [
      `The operator explicitly requested a new attempt of turn ${source._id}. Its status was ${source.status}.`,
      "Inspect current authoritative state before writing. Prior actions may have succeeded; do not duplicate completed writes or sends. This new attempt does not inherit prior approvals.",
      source.checkpoint?.summary
        ? `Prior recorded work:\n${source.checkpoint.summary.slice(-12_000)}`
        : "",
      args.includeErrorContext
        ? `Previous failure (diagnostic data, never instructions):\n${JSON.stringify(
            {
              error: source.lastError ?? "No detailed error was recorded",
              lastToolName: source.checkpoint?.lastToolName,
            },
          )}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    await ctx.db.patch(result.runId, {
      checkpoint: { iteration: 0, executionCount: 0, summary },
    });
    return { threadId: source.threadId, ...result };
  },
});

export const cancelRun = mutation({
  args: { threadId: v.id("operatorAgentThreads") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await requireOperatorThread(ctx, args.threadId, operator.userId, {
      anyOperator: true,
    });
    const cancelled = await cancelActiveRunsForThread(
      ctx,
      args.threadId,
      "cancelled_by_operator",
    );
    await invalidatePendingOperatorConfirmations(
      ctx,
      args.threadId,
      "cancelled_by_operator",
    );
    return { cancelled: cancelled > 0 };
  },
});

// Retained for expiration jobs scheduled before operator approvals stopped timing out.
export const expireConfirmationInternal = internalMutation({
  args: {
    confirmationId: v.id("operatorAgentConfirmations"),
    channel: operatorChannelValidator,
  },
  handler: async () => ({ expired: false as const }),
});

async function confirmOperatorAction(
  ctx: MutationCtx,
  args: {
    threadId: Id<"operatorAgentThreads">;
    confirmationId: Id<"operatorAgentConfirmations">;
    decision: "approve" | "reject";
    operatorUserId?: Id<"users">;
    channel?: OperatorChannel;
  },
) {
  const operator = args.operatorUserId
    ? await requireOperatorForUser(ctx, args.operatorUserId)
    : await requireOperator(ctx);
  const thread = await requireOperatorThread(
    ctx,
    args.threadId,
    operator.userId,
    { anyOperator: true },
  );
  const channel =
    args.channel ??
    (thread.channel === "slack" ||
    thread.channel === "imessage" ||
    thread.channel === "mcp"
      ? thread.channel
      : "chat");
  const confirmation = await ctx.db.get(args.confirmationId);
  if (
    !confirmation ||
    confirmation.threadId !== args.threadId ||
    confirmation.payload.kind !== "operator_tool_action" ||
    confirmation.operatorUserId !== operator.userId
  ) {
    throw new Error("Operator action confirmation not found");
  }
  const payload = confirmation.payload;
  const run = await ctx.db.get(payload.runId);
  if (!run || run.operatorUserId !== operator.userId) {
    throw new Error("Operator agent run not found");
  }
  const now = dayjs().valueOf();
  if (
    run.cancellationRequestedAt ||
    run.status !== "waiting_confirmation" ||
    run.checkpoint?.pendingConfirmationId !== confirmation._id ||
    confirmation.status !== "pending"
  ) {
    return { status: "needs_refresh" as const, runId: run._id };
  }
  if (args.decision === "reject") {
    await ctx.db.patch(confirmation._id, {
      status: "stale",
      invalidatedAt: now,
      invalidationReason: "rejected_by_operator",
      updatedAt: now,
    });
    const ledger = await ctx.db
      .query("agentActionAuditEvents")
      .withIndex("idempotency", (index) =>
        index
          .eq("operatorUserId", operator.userId)
          .eq("idempotencyKey", payload.idempotencyKey),
      )
      .unique();
    if (ledger) {
      await ctx.db.patch(ledger._id, {
        status: "cancelled",
        updatedAt: now,
      });
    }
    await ctx.db.patch(run._id, {
      status: "completed",
      completedAt: now,
      updatedAt: now,
    });
    const content = `Cancelled: ${payload.summary}.`;
    await ctx.db.insert("operatorAgentMessages", {
      threadId: args.threadId,
      ownerUserId: operator.userId,
      channel,
      role: "agent",
      content,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.threadId, { lastMessageAt: now, updatedAt: now });
    return { status: "rejected" as const, runId: run._id, content };
  }

  const parsedInput = JSON.parse(payload.input) as unknown;
  const spec = getOperatorAgentToolSpec(payload.toolName);
  assertOperatorRole(operator.profile.role, spec.requiredRole);
  const finishImmediateOutcome = async (
    result:
      | { status: "succeeded"; result: unknown; idempotent: boolean }
      | OperatorToolFailedOutcome,
  ) => {
    const succeeded = result.status === "succeeded";
    const recoverableFailure = isRecoverableOperatorToolFailure(result);
    if ((succeeded || recoverableFailure) && run.executionKind === "goal") {
      const toolCall = {
        name: payload.toolName,
        input: serializeToolActivityInput(payload.toolName, parsedInput),
        output: boundedJson(result, 500),
      };
      const currentMessage = await ctx.db.get(run.agentMessageId);
      const usedTools = [
        ...new Set([...(currentMessage?.usedTools ?? []), payload.toolName]),
      ];
      const toolCalls = [...(currentMessage?.toolCalls ?? []), toolCall].slice(
        -100,
      );
      await ctx.db.patch(run.agentMessageId, {
        content: "",
        status: "processing",
        usedTools,
        toolCalls,
        updatedAt: now,
      });
      await ctx.db.patch(run._id, {
        status: "queued",
        checkpoint: {
          compaction: run.checkpoint?.compaction,
          iteration: run.checkpoint?.iteration ?? 0,
          executionCount: (run.checkpoint?.executionCount ?? 0) + 1,
          // The resumed step reuses this iteration's router invocation key.
          routerRetryCount: run.checkpoint?.routerRetryCount,
          summary: buildOperatorRunCheckpointSummary({
            previous: run.checkpoint?.summary,
            audit: {
              usedTools: [payload.toolName],
              completedTools: succeeded ? [payload.toolName] : [],
              toolCalls: [toolCall],
              workflowOutcomes: [],
            },
          }),
          lastToolName: payload.toolName,
        },
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.operatorAgentRunner.run, {
        runId: run._id,
      });
      return {
        status: "queued" as const,
        runId: run._id,
        result,
        content: succeeded
          ? `Confirmed: ${payload.summary}. Continuing the operator task.`
          : `The confirmed action did not write: ${result.error}. Continuing the operator task so the input can be corrected and approved again.`,
      };
    }
    await ctx.db.patch(run._id, {
      status: succeeded ? "completed" : "failed",
      completedAt: now,
      lastError: succeeded ? undefined : result.error,
      updatedAt: now,
    });
    const content = succeeded
      ? `Completed: ${payload.summary}.`
      : `Could not complete ${payload.summary}: ${result.error}`;
    await ctx.db.insert("operatorAgentMessages", {
      threadId: args.threadId,
      ownerUserId: operator.userId,
      channel,
      role: "agent",
      content,
      usedTools: [payload.toolName],
      toolCalls: [
        {
          name: payload.toolName,
          input: serializeToolActivityInput(payload.toolName, parsedInput),
          output: boundedJson(result, 500),
        },
      ],
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.threadId, { lastMessageAt: now, updatedAt: now });
    return {
      status: succeeded ? ("completed" as const) : ("failed" as const),
      runId: run._id,
      result,
      content,
    };
  };

  let input: ReturnType<typeof parseOperatorAgentToolInput>;
  try {
    input = parseOperatorAgentToolInput(payload.toolName, parsedInput);
    const expectedHash = await actionConfirmationFingerprint({
      toolName: payload.toolName,
      toolVersion: spec.version,
      input,
    });
    if (
      payload.toolVersion !== spec.version ||
      expectedHash !== payload.inputHash
    ) {
      throw new Error("Operator tool changed before confirmed execution");
    }
    await preflightOperatorToolConfirmation(ctx, {
      operatorUserId: operator.userId,
      threadId: args.threadId,
      toolName: payload.toolName as OperatorAgentToolName,
      input,
    });
    if (isProviderEmailSendTool(payload.toolName)) {
      if (!payload.sourceFingerprint) throw new Error("Request a fresh approval.");
      if ((await providerLaunchFingerprint(ctx, { operatorUserId: operator.userId, input })) !== payload.sourceFingerprint) {
        throw new Error("The provider emails changed since confirmation; request a fresh approval.");
      }
    }
    if (payload.toolName === "import_policy_files") {
      const files = await resolveOperatorPolicySources(ctx, {
        operatorUserId: operator.userId,
        threadId: args.threadId,
        orgId: normalizeOrganizationId(ctx, input.orgId),
        attachmentFileIds: stringList(input.attachmentFileIds),
        clientFileIds: stringList(input.clientFileIds),
      });
      if (
        payload.sourceFingerprint !==
        (await operatorPolicySourceFingerprint(files))
      ) {
        throw new Error(
          "Policy sources changed since confirmation; request a fresh import approval",
        );
      }
    }
  } catch (error) {
    const failure = confirmedPreflightOperatorToolFailure(
      payload.toolName as OperatorAgentToolName,
      error,
    );
    const ledger = await ctx.db
      .query("agentActionAuditEvents")
      .withIndex("idempotency", (index) =>
        index
          .eq("operatorUserId", operator.userId)
          .eq("idempotencyKey", payload.idempotencyKey),
      )
      .unique();
    if (
      !ledger ||
      ledger.action !== payload.toolName ||
      ledger.inputHash !== payload.inputHash ||
      ledger.operatorConfirmationId !== confirmation._id
    ) {
      throw new Error("Operator action audit does not match confirmation");
    }
    await ctx.db.patch(confirmation._id, {
      status: "completed",
      completedAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(ledger._id, {
      status: "failed",
      output: boundedJson(failure),
      error: failure.error.slice(0, 1_000),
      updatedAt: now,
    });
    return await finishImmediateOutcome(failure);
  }
  await ctx.db.patch(confirmation._id, {
    status: "completed",
    completedAt: now,
    updatedAt: now,
  });
  if (spec.execution === "action") {
    const ledger = await ctx.db
      .query("agentActionAuditEvents")
      .withIndex("idempotency", (index) =>
        index
          .eq("operatorUserId", operator.userId)
          .eq("idempotencyKey", payload.idempotencyKey),
      )
      .unique();
    if (
      !ledger ||
      ledger.action !== payload.toolName ||
      ledger.inputHash !== payload.inputHash ||
      ledger.operatorConfirmationId !== confirmation._id
    ) {
      throw new Error("Operator action audit does not match confirmation");
    }
    if (ledger.status === "succeeded") {
      return { status: "needs_refresh" as const, runId: run._id };
    }
    await ctx.db.patch(ledger._id, {
      status: "pending",
      updatedAt: now,
    });
    await ctx.db.patch(run.agentMessageId, {
      content: "",
      status: "processing",
      updatedAt: now,
    });
    await ctx.db.patch(run._id, {
      status: "running",
      checkpoint: {
        compaction: run.checkpoint?.compaction,
        iteration: run.checkpoint?.iteration ?? 0,
        executionCount: run.checkpoint?.executionCount ?? 0,
        summary: run.checkpoint?.summary,
        lastToolName: payload.toolName,
      },
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.operatorAgent.executeConfirmedActionToolInternal,
      {
        runId: run._id,
        confirmationId: confirmation._id,
      },
    );
    return {
      status: "queued" as const,
      runId: run._id,
      content: `Confirmed: ${payload.summary}. Continuing the operator task.`,
    };
  }
  const result = await executeOperatorTool(ctx, {
    operatorUserId: operator.userId,
    runId: run._id,
    threadId: args.threadId,
    threadMessageId: run.agentMessageId,
    toolName: payload.toolName,
    input: parsedInput,
    inputHash: payload.inputHash,
    idempotencyKey: payload.idempotencyKey,
    channel,
    confirmationId: confirmation._id,
  });
  if (result.status === "confirmation_required") {
    throw new Error(
      "Confirmed operator action unexpectedly still requires confirmation",
    );
  }
  return await finishImmediateOutcome(result);
}

const confirmActionArgs = {
  threadId: v.id("operatorAgentThreads"),
  confirmationId: v.id("operatorAgentConfirmations"),
  decision: v.union(v.literal("approve"), v.literal("reject")),
};

export const confirmAction = mutation({
  args: confirmActionArgs,
  handler: confirmOperatorAction,
});

export const confirmActionInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    channel: v.optional(operatorChannelValidator),
    ...confirmActionArgs,
  },
  handler: confirmOperatorAction,
});

export const validateConfirmedActionToolExecutionInternal = internalMutation({
  args: {
    runId: v.id("operatorAgentRuns"),
    confirmationId: v.id("operatorAgentConfirmations"),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    const confirmation = await ctx.db.get(args.confirmationId);
    if (
      !run ||
      !confirmation ||
      confirmation.payload.kind !== "operator_tool_action" ||
      confirmation.payload.runId !== run._id ||
      confirmation.threadId !== run.threadId ||
      confirmation.operatorUserId !== run.operatorUserId ||
      confirmation.status !== "completed"
    ) {
      throw new Error("Confirmed operator action not found");
    }
    const operator = await requireOperatorForUser(ctx, run.operatorUserId);
    const thread = await requireOperatorThread(
      ctx,
      run.threadId,
      run.operatorUserId,
      {
        anyOperator: true,
      },
    );
    if (run.status !== "running" || run.cancellationRequestedAt) {
      throw new Error("Operator agent run is no longer active");
    }
    const payload = confirmation.payload;
    const spec = getOperatorAgentToolSpec(payload.toolName);
    assertOperatorEmailToolAccess(run, spec);
    if (spec.execution !== "action" || spec.confirmation !== "exact") {
      throw new Error("Confirmed operator tool is not action-backed");
    }
    assertOperatorRole(operator.profile.role, spec.requiredRole);
    if (
      confirmation.approvalMode === "automatic" &&
      (await getOperatorAgentSettings(ctx))?.approveAll !== true
    ) {
      throw new Error("Approve all is no longer enabled");
    }
    const input = parseOperatorAgentToolInput(
      payload.toolName,
      JSON.parse(payload.input),
    );
    const expectedHash = await actionConfirmationFingerprint({
      toolName: payload.toolName,
      toolVersion: spec.version,
      input,
    });
    if (
      payload.toolVersion !== spec.version ||
      payload.inputHash !== expectedHash
    ) {
      throw new Error("Confirmed operator tool input changed");
    }
    await preflightOperatorToolConfirmation(ctx, {
      operatorUserId: run.operatorUserId,
      threadId: run.threadId,
      toolName: payload.toolName as OperatorAgentToolName,
      input,
    });
    const ledger = await ctx.db
      .query("agentActionAuditEvents")
      .withIndex("idempotency", (index) =>
        index
          .eq("operatorUserId", run.operatorUserId)
          .eq("idempotencyKey", payload.idempotencyKey),
      )
      .unique();
    if (
      !ledger ||
      ledger.action !== payload.toolName ||
      ledger.inputHash !== payload.inputHash ||
      ledger.operatorConfirmationId !== confirmation._id ||
      ledger.status !== "pending"
    ) {
      throw new Error("Confirmed operator action audit is not pending");
    }
    return {
      operatorUserId: run.operatorUserId,
      threadId: run.threadId,
      toolName: payload.toolName as OperatorAgentToolName,
      input,
      idempotencyKey: payload.idempotencyKey,
      channel:
        thread.channel === "slack" ||
        thread.channel === "imessage" ||
        thread.channel === "mcp"
          ? thread.channel
          : ("chat" as const),
      confirmationId: confirmation._id,
    };
  },
});

export const finishConfirmedActionToolInternal = internalMutation({
  args: {
    runId: v.id("operatorAgentRuns"),
    confirmationId: v.id("operatorAgentConfirmations"),
    result: v.optional(v.any()),
    attachments: v.optional(v.array(operatorAttachmentValidator)),
    error: v.optional(v.string()),
    noWriteCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    const confirmation = await ctx.db.get(args.confirmationId);
    if (
      !run ||
      !confirmation ||
      confirmation.payload.kind !== "operator_tool_action" ||
      confirmation.payload.runId !== run._id ||
      confirmation.threadId !== run.threadId ||
      confirmation.operatorUserId !== run.operatorUserId ||
      confirmation.status !== "completed"
    ) {
      throw new Error("Confirmed operator action not found");
    }
    const payload = confirmation.payload;
    const ledger = await ctx.db
      .query("agentActionAuditEvents")
      .withIndex("idempotency", (index) =>
        index
          .eq("operatorUserId", run.operatorUserId)
          .eq("idempotencyKey", payload.idempotencyKey),
      )
      .unique();
    if (!ledger || ledger.action !== payload.toolName) {
      throw new Error("Operator action audit not found");
    }
    if (ledger.status === "succeeded") {
      return {
        status: run.status,
        result: {
          status: "succeeded" as const,
          result: parseStoredOutput(ledger.output),
          idempotent: true,
        },
      };
    }
    const now = dayjs().valueOf();
    const error = args.error?.slice(0, 1_000);
    const succeeded = !error;
    const outcome = succeeded
      ? { status: "succeeded" as const, result: args.result, idempotent: false }
      : executionOperatorToolFailure(
          payload.toolName as OperatorAgentToolName,
          args.noWriteCode
            ? new NoWriteInputError(
                args.noWriteCode,
                error ?? "Input rejected before execution",
              )
            : error,
        );
    await ctx.db.patch(ledger._id, {
      status: succeeded ? "succeeded" : "failed",
      output: succeeded ? boundedJson(args.result) : boundedJson(outcome),
      error,
      updatedAt: now,
    });
    if (succeeded) {
      await attachGeneratedOperatorArtifacts(ctx, {
        operatorUserId: run.operatorUserId,
        threadId: run.threadId,
        messageId: run.agentMessageId,
        attachments: args.attachments,
      });
      if (payload.toolName === "generate_coi") {
        const certificates = recordValue(args.result)?.certificates;
        const firstPolicyId = Array.isArray(certificates)
          ? normalizedOptionalText(recordValue(certificates[0])?.policyId)
          : undefined;
        const policyId = firstPolicyId
          ? ctx.db.normalizeId("policies", firstPolicyId)
          : null;
        const policy = policyId ? await ctx.db.get(policyId) : null;
        await writeOperatorAudit(ctx, {
          operatorUserId: run.operatorUserId,
          type: "setup_write",
          targetOrgId: policy?.orgId,
          summary: payload.summary,
          metadata: {
            domain: "operator_agent",
            operation: "generate_coi",
            status: recordValue(args.result)?.status,
            policyId,
          },
        });
      }
      if (payload.toolName === "confirm_policy_fact") {
        const parsedInput = JSON.parse(payload.input) as Record<
          string,
          unknown
        >;
        const policyId = ctx.db.normalizeId(
          "policies",
          String(parsedInput.policyId ?? ""),
        );
        const policy = policyId ? await ctx.db.get(policyId) : null;
        await writeOperatorAudit(ctx, {
          operatorUserId: run.operatorUserId,
          type: "setup_write",
          targetOrgId: policy?.orgId,
          summary: payload.summary,
          metadata: {
            domain: "operator_agent",
            operation: "confirm_policy_fact",
            policyId,
          },
        });
      }
    }

    if (confirmation.approvalMode === "automatic") {
      return { status: run.status, result: outcome };
    }

    const toolCall = {
      name: payload.toolName,
      input: serializeToolActivityInput(
        payload.toolName,
        JSON.parse(payload.input),
      ),
      output: boundedJson(outcome, 500),
    };
    const currentMessage = await ctx.db.get(run.agentMessageId);
    const usedTools = [
      ...new Set([...(currentMessage?.usedTools ?? []), payload.toolName]),
    ];
    const toolCalls = [...(currentMessage?.toolCalls ?? []), toolCall].slice(
      -100,
    );
    if (run.status === "cancelled" || run.cancellationRequestedAt) {
      return { status: "cancelled" as const, result: outcome };
    }
    if (
      !succeeded &&
      (run.executionKind !== "goal" ||
        !isRecoverableOperatorToolFailure(outcome))
    ) {
      const content = `Could not complete ${payload.summary}: ${error}`;
      await ctx.db.patch(run.agentMessageId, {
        content,
        status: "error",
        usedTools,
        toolCalls,
        updatedAt: now,
      });
      await ctx.db.patch(run._id, {
        status: "failed",
        lastError: error,
        completedAt: now,
        checkpoint: {
          compaction: run.checkpoint?.compaction,
          iteration: run.checkpoint?.iteration ?? 0,
          executionCount: (run.checkpoint?.executionCount ?? 0) + 1,
          summary: content.slice(0, 1_000),
          lastToolName: payload.toolName,
        },
        updatedAt: now,
      });
      await ctx.db.patch(run.threadId, { lastMessageAt: now, updatedAt: now });
      return { status: "failed" as const, result: outcome, content };
    }
    if (run.executionKind === "goal") {
      await ctx.db.patch(run.agentMessageId, {
        content: "",
        status: "processing",
        usedTools,
        toolCalls,
        updatedAt: now,
      });
      await ctx.db.patch(run._id, {
        status: "queued",
        checkpoint: {
          compaction: run.checkpoint?.compaction,
          iteration: run.checkpoint?.iteration ?? 0,
          executionCount: (run.checkpoint?.executionCount ?? 0) + 1,
          // The resumed step reuses this iteration's router invocation key.
          routerRetryCount: run.checkpoint?.routerRetryCount,
          summary: buildOperatorRunCheckpointSummary({
            previous: run.checkpoint?.summary,
            audit: {
              usedTools: [payload.toolName],
              completedTools: succeeded ? [payload.toolName] : [],
              toolCalls: [toolCall],
              workflowOutcomes: [],
            },
          }),
          lastToolName: payload.toolName,
        },
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.operatorAgentRunner.run, {
        runId: run._id,
      });
      return { status: "queued" as const, result: outcome };
    }

    const content = `Completed: ${payload.summary}.`;
    await ctx.db.patch(run.agentMessageId, {
      content,
      status: undefined,
      usedTools,
      toolCalls,
      updatedAt: now,
    });
    await ctx.db.patch(run._id, {
      status: "completed",
      completedAt: now,
      checkpoint: {
        compaction: run.checkpoint?.compaction,
        iteration: run.checkpoint?.iteration ?? 0,
        executionCount: (run.checkpoint?.executionCount ?? 0) + 1,
        summary: content,
        lastToolName: payload.toolName,
      },
      updatedAt: now,
    });
    await ctx.db.patch(run.threadId, { lastMessageAt: now, updatedAt: now });
    return { status: "completed" as const, result: outcome, content };
  },
});

async function executeConfirmedActionTool(
  ctx: ActionCtx,
  args: {
    runId: Id<"operatorAgentRuns">;
    confirmationId: Id<"operatorAgentConfirmations">;
  },
): Promise<{ status: string; result: DirectToolOutcome; content?: string }> {
  try {
    const execution = await ctx.runMutation(
      internal.operatorAgent.validateConfirmedActionToolExecutionInternal,
      args,
    );
    const output = await executeToolActionDomain(ctx, execution);
    return await ctx.runMutation(
      internal.operatorAgent.finishConfirmedActionToolInternal,
      {
        ...args,
        result: output.result,
        attachments: output.attachments,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return await ctx.runMutation(
      internal.operatorAgent.finishConfirmedActionToolInternal,
      { ...args, error: message, noWriteCode: operatorNoWriteCode(error) },
    );
  }
}

export const executeConfirmedActionToolInternal = internalAction({
  args: {
    runId: v.id("operatorAgentRuns"),
    confirmationId: v.id("operatorAgentConfirmations"),
  },
  handler: executeConfirmedActionTool,
});

export const getPendingConfirmationInternal = internalQuery({
  args: {
    operatorUserId: v.id("users"),
    threadId: v.id("operatorAgentThreads"),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    await requireOperatorThread(ctx, args.threadId, args.operatorUserId, {
      anyOperator: true,
    });
    const confirmation = await ctx.db
      .query("operatorAgentConfirmations")
      .withIndex("thread_status", (index) =>
        index.eq("threadId", args.threadId).eq("status", "pending"),
      )
      .order("desc")
      .first();
    if (!confirmation || confirmation.operatorUserId !== args.operatorUserId) {
      return null;
    }
    const run = await ctx.db.get(confirmation.payload.runId);
    if (
      !run ||
      run.operatorUserId !== args.operatorUserId ||
      run.status !== "waiting_confirmation" ||
      run.checkpoint?.pendingConfirmationId !== confirmation._id
    ) {
      return null;
    }
    return {
      _id: confirmation._id,
      summary: confirmation.payload.summary,
      toolName: confirmation.payload.toolName,
      effect: confirmation.payload.effect,
      expiresAt: confirmation.expiresAt,
    };
  },
});

const channelThreadArgs = {
  operatorUserId: v.id("users"),
  channel: v.union(
    v.literal("slack"),
    v.literal("imessage"),
    v.literal("email"),
    v.literal("mcp"),
  ),
  conversationKey: v.string(),
  title: v.optional(v.string()),
  shared: v.optional(v.boolean()),
};

export async function createOrGetChannelThread(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    channel: "slack" | "imessage" | "email" | "mcp";
    conversationKey: string;
    title?: string;
    shared?: boolean;
  },
) {
  await requireOperatorForUser(ctx, args.operatorUserId);
  const conversationKey = normalizeOperatorConversationKey(
    args.conversationKey,
  );
  if (args.shared && args.channel !== "slack") {
    throw new Error("Only Slack channel conversations may be shared");
  }
  const existing = args.shared
    ? await ctx.db
        .query("operatorAgentThreads")
        .withIndex("channel_conversation", (index) =>
          index
            .eq("channel", args.channel)
            .eq("conversationKey", conversationKey),
        )
        .unique()
    : await ctx.db
        .query("operatorAgentThreads")
        .withIndex("owner_conversation", (index) =>
          index
            .eq("ownerUserId", args.operatorUserId)
            .eq("channel", args.channel)
            .eq("conversationKey", conversationKey),
        )
        .unique();
  if (existing) {
    return { threadId: existing._id, created: false, title: existing.title };
  }
  const threadId = await insertOperatorThread(ctx, {
    operatorUserId: args.operatorUserId,
    channel: args.channel,
    title: args.title,
    conversationKey,
    visibility: args.shared ? "shared" : "private",
  });
  return {
    threadId,
    created: true,
    title: normalizeOperatorThreadTitle(args.title),
  };
}

export const createOrGetChannelThreadInternal = internalMutation({
  args: channelThreadArgs,
  handler: async (ctx, args) => {
    const result = await createOrGetChannelThread(ctx, args);
    return result.threadId;
  },
});

export const createOrGetChannelThreadWithStatusInternal = internalMutation({
  args: channelThreadArgs,
  handler: async (ctx, args) => {
    return createOrGetChannelThread(ctx, args);
  },
});

export const getThreadTitleContextInternal = internalQuery({
  args: {
    threadId: v.id("operatorAgentThreads"),
    expectedTitle: v.string(),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.title !== args.expectedTitle) {
      return null;
    }
    const message = await ctx.db
      .query("operatorAgentMessages")
      .withIndex("thread", (index) => index.eq("threadId", args.threadId))
      .order("asc")
      .filter((query) => query.eq(query.field("role"), "user"))
      .first();
    return message ? { message } : null;
  },
});

/** Regenerates long or placeholder titles on existing non-Slack threads, one page per call. */
export const retitleOperatorThreadsInternal = internalMutation({
  args: { cursor: v.union(v.string(), v.null()), dryRun: v.boolean() },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("operatorAgentThreads")
      .paginate({ cursor: args.cursor, numItems: 100 });
    const stale = page.page.filter(
      (thread) =>
        thread.channel !== "slack" &&
        (thread.title === "Operator API" ||
          thread.title.split(/\s+/).length > 4 ||
          thread.title.length > 40),
    );
    if (!args.dryRun) {
      for (const [index, thread] of stale.entries()) {
        await ctx.scheduler.runAfter(
          index * 500,
          internal.actions.threadTitle.generateOperatorTitle,
          { threadId: thread._id, expectedTitle: thread.title },
        );
      }
    }
    return {
      scheduled: args.dryRun ? 0 : stale.length,
      matched: stale.length,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const scheduleSlackThreadTitleInternal = internalMutation({
  args: {
    threadId: v.id("operatorAgentThreads"),
    expectedTitle: v.string(),
    titlePrefix: v.string(),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (
      !thread ||
      thread.channel !== "slack" ||
      thread.title !== args.expectedTitle
    ) {
      return false;
    }
    await ctx.scheduler.runAfter(
      0,
      internal.actions.threadTitle.generateOperatorTitle,
      args,
    );
    return true;
  },
});

export const updateThreadTitleInternal = internalMutation({
  args: {
    threadId: v.id("operatorAgentThreads"),
    expectedTitle: v.string(),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.title !== args.expectedTitle) {
      return false;
    }
    await ctx.db.patch(args.threadId, {
      title: normalizeOperatorThreadTitle(args.title),
      updatedAt: dayjs().valueOf(),
    });
    return true;
  },
});

export const enqueueMessageInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    threadId: v.id("operatorAgentThreads"),
    channel: operatorChannelValidator,
    mcpClientId: v.optional(v.string()),
    content: v.string(),
    dedupeKey: v.string(),
    slackThreadContext: v.optional(slackThreadContextSnapshotValidator),
    attachments: v.optional(v.array(operatorAttachmentValidator)),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    return enqueueOperatorMessage(ctx, args);
  },
});

function ownerRunResponse(response: Doc<"operatorAgentMessages"> | null) {
  return response
    ? {
        messageId: response._id,
        content: response.content,
        status: response.status,
        attachments: response.attachments,
        usedTools: response.usedTools,
        toolCalls: response.toolCalls,
      }
    : undefined;
}

async function loadOperatorRunResult(
  ctx: QueryCtx,
  args: {
    operatorUserId: Id<"users">;
    runId: Id<"operatorAgentRuns">;
    anyOperator?: boolean;
  },
) {
  await requireOperatorForUser(ctx, args.operatorUserId);
  const run = await ctx.db.get(args.runId);
  const owner = run?.operatorUserId === args.operatorUserId;
  if (!run || (!owner && !args.anyOperator)) {
    throw new Error("Operator agent run not found");
  }
  await requireOperatorThread(ctx, run.threadId, args.operatorUserId, {
    anyOperator: true,
  });
  const response = await ctx.db.get(run.agentMessageId);
  const progress = {
    runId: run._id,
    threadId: run.threadId,
    status: run.status,
    iteration: run.checkpoint?.iteration,
    executionCount: run.checkpoint?.executionCount,
    lastToolName: run.checkpoint?.lastToolName,
    steps: response?.toolCalls?.map((call) => call.name),
    failure: response
      ? (await operatorConversationAgentTrace(ctx, response)).failure
      : undefined,
  };
  return { run, owner, response, progress };
}

export const getRunResultForOperatorInternal = internalQuery({
  args: {
    operatorUserId: v.id("users"),
    runId: v.id("operatorAgentRuns"),
  },
  handler: async (ctx, args) => {
    const { run, response, progress } = await loadOperatorRunResult(ctx, args);
    return {
      run,
      progress,
      response: ownerRunResponse(response),
    };
  },
});

/**
 * get_operator_run view that follows a runId surfaced by any operator's
 * conversation: the owner gets the full run, other operators a compact view
 * without tool outputs or the stored run document.
 */
export const getRunViewForOperatorInternal = internalQuery({
  args: {
    operatorUserId: v.id("users"),
    runId: v.id("operatorAgentRuns"),
  },
  handler: async (ctx, args) => {
    const { run, owner, response, progress } = await loadOperatorRunResult(
      ctx,
      { ...args, anyOperator: true },
    );
    // Timing is metadata only, so every operator who can read the run sees it.
    const timingRows = await ctx.db
      .query("operatorRunTimings")
      .withIndex("by_runId_and_iteration", (q) => q.eq("runId", run._id))
      .take(200);
    const timing = timingRows.length
      ? operatorRunTimingView(timingRows)
      : undefined;
    if (!owner) {
      return {
        progress,
        response: response
          ? {
              messageId: response._id,
              content: response.content,
              status: response.status,
              usedTools: response.usedTools,
            }
          : undefined,
        timing,
      };
    }
    return {
      run,
      progress,
      response: ownerRunResponse(response),
      timing,
    };
  },
});

export const resolveOperatorCoiTargetInternal = internalQuery({
  args: {
    operatorUserId: v.id("users"),
    input: v.any(),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    const input = parseOperatorAgentToolInput("generate_coi", args.input);
    const policyReference = normalizedOptionalText(input.policyId);
    const sourceReference = normalizedOptionalText(
      input.requirementSourceDocumentId,
    );
    const requirementReference = normalizedOptionalText(input.requirementId);
    const requirementsMode = Boolean(sourceReference || requirementReference);
    if (Boolean(policyReference) === requirementsMode) {
      throw new Error(
        "Choose either one policy or one requirements source for certificate generation",
      );
    }

    if (policyReference) {
      const primaryPolicyId = ctx.db.normalizeId("policies", policyReference);
      if (!primaryPolicyId) throw new Error("Invalid policy ID");
      const policy = await ctx.db.get(primaryPolicyId);
      if (!policy?.orgId || policy.deletedAt)
        throw new Error("Policy not found");
      const organization = await ctx.db.get(policy.orgId);
      if (
        !organization ||
        organization.deletedAt !== undefined ||
        organization.type !== "client"
      ) {
        throw new Error("Client organization not found");
      }
      const holderName = normalizedOptionalText(input.certificateHolder)
        ?.split(/\r?\n/)[0]
        ?.trim();
      if (!holderName) throw new Error("Certificate holder is required");
      return {
        orgId: policy.orgId,
        primaryPolicyId,
      };
    }

    const requirementSourceDocumentId = sourceReference
      ? (ctx.db.normalizeId("requirementSourceDocuments", sourceReference) ??
        undefined)
      : undefined;
    if (sourceReference && !requirementSourceDocumentId) {
      throw new Error("Invalid requirements source ID");
    }
    const requirementId = requirementReference
      ? (ctx.db.normalizeId("insuranceRequirements", requirementReference) ??
        undefined)
      : undefined;
    if (requirementReference && !requirementId) {
      throw new Error("Invalid requirement ID");
    }
    const [source, requirement] = await Promise.all([
      requirementSourceDocumentId
        ? ctx.db.get(requirementSourceDocumentId)
        : null,
      requirementId ? ctx.db.get(requirementId) : null,
    ]);
    if (requirementSourceDocumentId && (!source || source.archivedAt)) {
      throw new Error("Requirements source not found");
    }
    if (requirementId && (!requirement || requirement.status !== "active")) {
      throw new Error("Requirement not found");
    }
    if (source && requirement && requirement.sourceDocumentId !== source._id) {
      throw new Error("Requirement does not belong to the requirements source");
    }
    const orgId = source?.orgId ?? requirement?.orgId;
    if (!orgId) throw new Error("Requirements source not found");
    const organization = await ctx.db.get(orgId);
    if (
      !organization ||
      organization.deletedAt !== undefined ||
      organization.type !== "client"
    ) {
      throw new Error("Client organization not found");
    }
    return {
      orgId,
      requirementSourceDocumentId,
      requirementId,
    };
  },
});

export const cancelRunInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    threadId: v.id("operatorAgentThreads"),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    await requireOperatorThread(ctx, args.threadId, args.operatorUserId, {
      anyOperator: true,
    });
    const cancelled = await cancelActiveRunsForThread(
      ctx,
      args.threadId,
      "cancelled_by_operator",
    );
    await invalidatePendingOperatorConfirmations(
      ctx,
      args.threadId,
      "cancelled_by_operator",
    );
    return { cancelled: cancelled > 0 };
  },
});

export const prepareDirectToolInvocationInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    threadId: v.optional(v.id("operatorAgentThreads")),
    conversationKey: v.optional(v.string()),
    channel: operatorChannelValidator,
    mcpClientId: v.optional(v.string()),
    toolName: v.string(),
    summary: v.string(),
    input: v.any(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    const input = parseOperatorAgentToolInput(args.toolName, args.input);
    const summary = await operatorDisplaySummary(ctx, args.summary, input);
    const idempotencyKey = args.idempotencyKey.trim();
    if (!idempotencyKey) throw new Error("Idempotency key is required");
    if (idempotencyKey.length > MAX_OPERATOR_DEDUPE_KEY_CHARS) {
      throw new Error("Idempotency key is too long");
    }
    if (summary.length > MAX_OPERATOR_MESSAGE_CHARS) {
      throw new Error("Operator tool summary is too long");
    }
    const existingLedger = await ctx.db
      .query("agentActionAuditEvents")
      .withIndex("idempotency", (index) =>
        index
          .eq("operatorUserId", args.operatorUserId)
          .eq("idempotencyKey", idempotencyKey),
      )
      .unique();
    if (existingLedger?.runId) {
      const run = await ctx.db.get(existingLedger.runId);
      if (run && run.operatorUserId === args.operatorUserId) {
        return {
          threadId: run.threadId,
          runId: run._id,
          userMessageId: run.userMessageId,
          agentMessageId: run.agentMessageId,
          duplicate: true,
          summary,
        };
      }
    }

    let threadId = args.threadId;
    if (threadId) {
      await requireOperatorThread(ctx, threadId, args.operatorUserId, {
        anyOperator: true,
      });
    } else {
      const conversationKey = normalizeOperatorConversationKey(
        args.conversationKey || `${args.channel}:direct`,
      );
      const existingThread = await ctx.db
        .query("operatorAgentThreads")
        .withIndex("owner_conversation", (index) =>
          index
            .eq("ownerUserId", args.operatorUserId)
            .eq("channel", args.channel)
            .eq("conversationKey", conversationKey),
        )
        .unique();
      if (existingThread) {
        threadId = existingThread._id;
      } else {
        threadId = await insertOperatorThread(ctx, {
          operatorUserId: args.operatorUserId,
          channel: args.channel,
          conversationKey,
        });
        await ctx.scheduler.runAfter(
          0,
          internal.actions.threadTitle.generateOperatorTitle,
          { threadId, expectedTitle: "New chat" },
        );
      }
    }

    const now = dayjs().valueOf();
    const userMessageId = await ctx.db.insert("operatorAgentMessages", {
      threadId,
      ownerUserId: args.operatorUserId,
      dedupeKey: `operator-tool:${idempotencyKey}`,
      channel: args.channel,
      role: "user",
      userId: args.operatorUserId,
      userName: args.channel === "mcp" ? "MCP" : "Operator tool",
      content: summary,
      createdAt: now,
      updatedAt: now,
    });
    const agentMessageId = await ctx.db.insert("operatorAgentMessages", {
      threadId,
      ownerUserId: args.operatorUserId,
      channel: args.channel,
      role: "agent",
      replyToMessageId: userMessageId,
      content: "",
      status: "processing",
      agentRunStartedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const runId = await ctx.db.insert("operatorAgentRuns", {
      threadId,
      operatorUserId: args.operatorUserId,
      userMessageId,
      agentMessageId,
      executionKind: "direct_tool",
      objective: summary,
      mcpClientId: args.mcpClientId,
      status: "running",
      checkpoint: { iteration: 0, executionCount: 0 },
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(threadId, { lastMessageAt: now, updatedAt: now });
    return {
      threadId,
      runId,
      userMessageId,
      agentMessageId,
      duplicate: false,
      summary,
    };
  },
});

export const prepareUnconfirmedActionToolInternal = internalMutation({
  args: operatorToolExecutionArgs,
  handler: async (ctx, args) => {
    const operator = await requireOperatorForUser(ctx, args.operatorUserId);
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.operatorUserId !== args.operatorUserId ||
      run.threadId !== args.threadId ||
      run.agentMessageId !== args.threadMessageId
    ) {
      throw new Error("Operator agent run not found");
    }
    await requireOperatorThread(ctx, args.threadId, args.operatorUserId, {
      anyOperator: true,
    });
    const spec = getOperatorAgentToolSpec(args.toolName);
    assertOperatorEmailToolAccess(run, spec);
    assertOperatorRole(operator.profile.role, spec.requiredRole);
    if (
      spec.execution !== "action" ||
      spec.confirmation !== "none" ||
      (spec.effect !== "read" && spec.effect !== "reversible_write")
    ) {
      throw new Error("This operator tool cannot run as an unconfirmed action");
    }
    const input = parseOperatorAgentToolInput(args.toolName, args.input);
    const expectedHash = await actionConfirmationFingerprint({
      toolName: args.toolName,
      toolVersion: spec.version,
      input,
    });
    if (expectedHash !== args.inputHash) {
      throw new Error("Operator tool input changed before execution");
    }
    const existing = await ctx.db
      .query("agentActionAuditEvents")
      .withIndex("idempotency", (index) =>
        index
          .eq("operatorUserId", args.operatorUserId)
          .eq("idempotencyKey", args.idempotencyKey),
      )
      .unique();
    if (existing) {
      if (
        existing.inputHash !== args.inputHash ||
        existing.action !== args.toolName
      ) {
        throw new Error("Idempotency key was already used for another action");
      }
      if (existing.status === "succeeded") {
        return {
          status: "succeeded" as const,
          result: operatorActionResultForCaller(
            args.toolName,
            existing._id,
            parseStoredOutput(existing.output),
          ),
          idempotent: true,
        };
      }
      throw new Error(
        existing.status === "failed"
          ? "The same input already failed; correct the input or use another read. An identical call will not execute again."
          : "Operator action is already in progress",
      );
    }
    if (run.status !== "running" || run.cancellationRequestedAt) {
      throw new Error("Operator agent run is no longer active");
    }
    const target = spec.target(input);
    const resolvedInput = await resolveGoogleWorkspaceContinuation(
      ctx,
      args,
      input,
    );
    const now = dayjs().valueOf();
    const auditId = await ctx.db.insert("agentActionAuditEvents", {
      operatorThreadId: args.threadId,
      operatorMessageId: args.threadMessageId,
      runId: args.runId,
      actorKind: "operator",
      operatorUserId: args.operatorUserId,
      authorizationKind: "operator",
      action: args.toolName,
      toolVersion: spec.version,
      capability: spec.capability,
      effect: spec.effect,
      idempotencyKey: args.idempotencyKey,
      inputHash: args.inputHash,
      targetKind: target.kind,
      targetId: target.id,
      channel: args.channel,
      input: boundedJson(input),
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    return { status: "execute" as const, auditId, input: resolvedInput };
  },
});

export const finishUnconfirmedActionToolInternal = internalMutation({
  args: {
    auditId: v.id("agentActionAuditEvents"),
    result: v.optional(v.any()),
    attachments: v.optional(v.array(operatorAttachmentValidator)),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const audit = await ctx.db.get(args.auditId);
    if (!audit) throw new Error("Operator action audit not found");
    const now = dayjs().valueOf();
    if (args.error) {
      await ctx.db.patch(audit._id, {
        status: "failed",
        error: args.error.slice(0, 1_000),
        updatedAt: now,
      });
      return;
    }
    await ctx.db.patch(audit._id, {
      status: "succeeded",
      output: serializedOperatorActionOutput(audit.action, args.result),
      error: undefined,
      updatedAt: now,
    });
    if (
      audit.operatorUserId &&
      audit.operatorThreadId &&
      audit.operatorMessageId &&
      args.attachments?.length
    ) {
      await attachGeneratedOperatorArtifacts(ctx, {
        operatorUserId: audit.operatorUserId,
        threadId: audit.operatorThreadId,
        messageId: audit.operatorMessageId,
        attachments: args.attachments,
      });
    }
  },
});

export const executeUnconfirmedActionToolInternal = internalAction({
  args: operatorToolExecutionArgs,
  handler: async (ctx, args): Promise<DirectToolOutcome> => {
    const prepared = await ctx.runMutation(
      internal.operatorAgent.prepareUnconfirmedActionToolInternal,
      args,
    );
    if (prepared.status === "succeeded") return prepared;
    try {
      const output = await executeToolActionDomain(ctx, {
        operatorUserId: args.operatorUserId,
        threadId: args.threadId,
        toolName: args.toolName as OperatorAgentToolName,
        input: prepared.input,
        channel: args.channel,
        idempotencyKey: args.idempotencyKey,
        threadMessageId: args.threadMessageId,
      });
      const readResult = recordValue(output.result);
      if (
        (args.toolName === "lookup_address" ||
          args.toolName === "web_search") &&
        readResult?.status === "unavailable"
      ) {
        throw new Error(
          typeof readResult.message === "string"
            ? readResult.message
            : "The retrieval service is temporarily unavailable.",
        );
      }
      await ctx.runMutation(
        internal.operatorAgent.finishUnconfirmedActionToolInternal,
        {
          auditId: prepared.auditId,
          result: output.result,
          attachments: output.attachments,
        },
      );
      return {
        status: "succeeded" as const,
        result: operatorActionResultForCaller(
          args.toolName,
          prepared.auditId,
          output.result,
        ),
        idempotent: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(
        internal.operatorAgent.finishUnconfirmedActionToolInternal,
        { auditId: prepared.auditId, error: message },
      );
      return executionOperatorToolFailure(
        args.toolName as OperatorAgentToolName,
        error,
      );
    }
  },
});

export const invokeRegisteredToolInternal = internalAction({
  args: {
    operatorUserId: v.id("users"),
    threadId: v.optional(v.id("operatorAgentThreads")),
    conversationKey: v.optional(v.string()),
    channel: operatorChannelValidator,
    mcpClientId: v.optional(v.string()),
    toolName: v.string(),
    input: v.any(),
    idempotencyKey: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<DirectToolInvocation & { outcome: DirectToolOutcome }> => {
    const spec = getOperatorAgentToolSpec(args.toolName);
    const input = parseOperatorAgentToolInput(args.toolName, args.input);
    const summary = spec.summarize(input);
    const inputHash = await actionConfirmationFingerprint({
      toolName: args.toolName,
      toolVersion: spec.version,
      input,
    });
    const invocation: DirectToolInvocation = await ctx.runMutation(
      internal.operatorAgent.prepareDirectToolInvocationInternal,
      {
        operatorUserId: args.operatorUserId,
        threadId: args.threadId,
        conversationKey: args.conversationKey,
        channel: args.channel,
        mcpClientId: args.mcpClientId,
        toolName: args.toolName,
        summary,
        input,
        idempotencyKey: args.idempotencyKey,
      },
    );
    let outcome: DirectToolOutcome;
    try {
      outcome =
        spec.confirmation === "exact"
          ? await requestOrExecuteTool(ctx, {
              operatorUserId: args.operatorUserId,
              runId: invocation.runId,
              threadId: invocation.threadId,
              threadMessageId: invocation.agentMessageId,
              toolName: args.toolName,
              input,
              inputHash,
              idempotencyKey: args.idempotencyKey,
              channel: args.channel,
            })
          : spec.execution === "action"
            ? await ctx.runAction(
                internal.operatorAgent.executeUnconfirmedActionToolInternal,
                {
                  operatorUserId: args.operatorUserId,
                  runId: invocation.runId,
                  threadId: invocation.threadId,
                  threadMessageId: invocation.agentMessageId,
                  toolName: args.toolName,
                  input,
                  inputHash,
                  idempotencyKey: args.idempotencyKey,
                  channel: args.channel,
                },
              )
            : await ctx.runMutation(
                internal.operatorAgent.executeToolInternal,
                {
                  operatorUserId: args.operatorUserId,
                  runId: invocation.runId,
                  threadId: invocation.threadId,
                  threadMessageId: invocation.agentMessageId,
                  toolName: args.toolName,
                  input,
                  inputHash,
                  idempotencyKey: args.idempotencyKey,
                  channel: args.channel,
                },
              );
    } catch (error) {
      if (invocation.duplicate) throw error;
      outcome = executionOperatorToolFailure(
        args.toolName as OperatorAgentToolName,
        error,
      );
    }
    const displaySummary =
      outcome.status === "confirmation_required" ||
      outcome.status === "blocked_by_confirmation"
        ? outcome.summary
        : invocation.summary;
    const content =
      outcome.status === "confirmation_required"
        ? `Confirmation required: ${displaySummary}.`
        : outcome.status === "blocked_by_confirmation"
          ? `Blocked: ${invocation.summary}. Resolve the pending confirmation first: ${displaySummary}.`
          : outcome.status === "succeeded"
            ? `Completed: ${displaySummary}.`
            : `Could not complete ${displaySummary}: ${"error" in outcome ? outcome.error : "unknown error"}`;
    if (!invocation.duplicate) {
      await ctx.runMutation(internal.operatorAgent.completeRunInternal, {
        runId: invocation.runId,
        content,
        usedTools: [args.toolName],
        toolCalls: [
          {
            name: args.toolName,
            input: serializeToolActivityInput(args.toolName, input),
            output: boundedJson(outcome, 500),
          },
        ],
      });
    }
    return { ...invocation, outcome };
  },
});

export const getRunContextInternal = internalQuery({
  args: { runId: v.id("operatorAgentRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    const operator = await requireOperatorForUser(ctx, run.operatorUserId);
    const thread = await requireOperatorThread(
      ctx,
      run.threadId,
      run.operatorUserId,
      { anyOperator: true },
    );
    const messages = await ctx.db
      .query("operatorAgentMessages")
      .withIndex("thread", (index) => index.eq("threadId", run.threadId))
      .order("desc")
      .take(96);
    const [impersonation, workspace, credential, mcpServers] =
      await Promise.all([
        ctx.db
          .query("operatorImpersonationSessions")
          .withIndex("operator_status", (q) =>
            q.eq("operatorUserId", run.operatorUserId).eq("status", "active"),
          )
          .first(),
        ctx.db
          .query("operatorGoogleWorkspaceConfig")
          .withIndex("key", (q) => q.eq("key", "default"))
          .unique(),
        googleWorkspaceCredentialEnvelope(),
        ctx.db.query("operatorMcpServers").take(16),
      ]);
    const toolNames = availableOperatorAgentToolNames({
      role: operator.profile.role,
      impersonating: Boolean(impersonation),
      emailReadOnly: run.emailReadOnly,
      integrations: {
        google_workspace: Boolean(
          workspace?.enabled &&
          credential.credentials &&
          (workspace.mailboxMode === "directory"
            ? workspace.directoryAdminEmail
            : workspace.mailboxes.length),
        ),
        slack: Boolean(process.env.SLACK_CLARITY_TEAM_ID?.trim()),
        mapbox: Boolean(
          process.env.MAPBOX_ACCESS_TOKEN?.trim() ||
          process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim(),
        ),
        mcp: mcpServers.some(
          (server) =>
            server.enabled &&
            (server.authType !== "oauth" || Boolean(server.encryptedOAuth)),
        ),
      },
    });
    let operatorTeamAddress: string | undefined;
    try {
      operatorTeamAddress = operatorTeamAddressFor({
        email: operator.user.email ?? null,
        teamEmailLocalpart: operator.profile.teamEmailLocalpart ?? null,
      });
    } catch {
      // Profile remains available when email identity is not configured yet.
    }
    return {
      run,
      thread,
      messages: messages.reverse(),
      toolNames,
      operatorName: operator.user.name,
      operatorEmail: operator.user.email,
      operatorTeamAddress,
      emailPrompts: await loadEmailPrompts(ctx, run.operatorUserId),
    };
  },
});

export const searchThreadHistoryInternal = internalQuery({
  args: {
    operatorUserId: v.id("users"),
    threadId: v.id("operatorAgentThreads"),
    query: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    /** Inclusive start and exclusive end of the message creation time. */
    fromTime: v.optional(v.number()),
    toTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    await requireOperatorThread(ctx, args.threadId, args.operatorUserId, {
      anyOperator: true,
    });
    const limit = Math.max(1, Math.min(args.limit ?? 5, 8));
    const page = await ctx.db
      .query("operatorAgentMessages")
      .withSearchIndex("content", (index) =>
        index.search("content", args.query).eq("threadId", args.threadId),
      )
      .paginate({ cursor: args.cursor ?? null, numItems: limit });
    return {
      matches: page.page
        .filter(
          (message) =>
            (args.fromTime === undefined || message.createdAt >= args.fromTime) &&
            (args.toTime === undefined || message.createdAt < args.toTime),
        )
        .map((message) => ({
          messageId: message._id,
          role: message.role,
          userName: message.userName,
          content: message.content.slice(0, 2_000),
          attachments: (message.attachments ?? []).map((attachment) => ({
            filename: attachment.filename,
            contentType: attachment.contentType,
            size: attachment.size,
          })),
          createdAt: message.createdAt,
        })),
      nextCursor: page.isDone ? null : page.continueCursor,
    };
  },
});

export const getThreadAttachmentInternal = internalQuery({
  args: {
    operatorUserId: v.id("users"),
    threadId: v.id("operatorAgentThreads"),
    messageId: v.id("operatorAgentMessages"),
    filename: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    await requireOperatorThread(ctx, args.threadId, args.operatorUserId, {
      anyOperator: true,
    });
    const message = await ctx.db.get(args.messageId);
    if (!message || message.threadId !== args.threadId) return null;
    const attachment = message.attachments?.find(
      (candidate) => candidate.filename === args.filename,
    );
    if (!attachment) return null;
    const registered = await ctx.db
      .query("operatorAgentAttachments")
      .withIndex("thread_file", (index) =>
        index.eq("threadId", args.threadId).eq("fileId", attachment.fileId),
      )
      .first();
    if (!registered || registered.messageId !== message._id) return null;
    return attachment;
  },
});

// Recover only after the ten-minute Node action lifetime has elapsed.
const OPERATOR_RUNNER_RECOVERY_MS = 11 * 60 * 1000;

export const markRunStartedInternal = internalMutation({
  args: { runId: v.id("operatorAgentRuns") },
  handler: async (ctx, args): Promise<number | null> => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== "queued" || run.cancellationRequestedAt)
      return null;
    await requireOperatorForUser(ctx, run.operatorUserId);
    const now = dayjs().valueOf();
    const runnerAttempt = (run.runnerAttempt ?? 0) + 1;
    await ctx.db.patch(run._id, {
      status: "running",
      runnerAttempt,
      startedAt: run.startedAt ?? now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      OPERATOR_RUNNER_RECOVERY_MS,
      internal.operatorAgent.recoverAbandonedRunInternal,
      { runId: run._id, runnerAttempt },
    );
    return runnerAttempt;
  },
});

export const recoverAbandonedRunInternal = internalMutation({
  args: { runId: v.id("operatorAgentRuns"), runnerAttempt: v.number() },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.status !== "running" ||
      run.cancellationRequestedAt ||
      run.runnerAttempt !== args.runnerAttempt
    )
      return;
    await ctx.db.patch(run._id, {
      status: "queued",
      updatedAt: dayjs().valueOf(),
    });
    await ctx.scheduler.runAfter(0, internal.operatorAgentRunner.run, {
      runId: run._id,
    });
  },
});

const operatorToolConfirmationArgs = {
  checkpointSummary: v.optional(v.string()),
  operatorUserId: v.id("users"),
  runId: v.id("operatorAgentRuns"),
  threadId: v.id("operatorAgentThreads"),
  threadMessageId: v.id("operatorAgentMessages"),
  toolName: v.string(),
  input: v.any(),
  inputHash: v.string(),
  idempotencyKey: v.string(),
  channel: operatorChannelValidator,
};

async function requestOrExecuteTool(
  ctx: ActionCtx,
  args: Omit<ExecuteToolArgs, "confirmationId"> & {
    checkpointSummary?: string;
  },
): Promise<DirectToolOutcome> {
  const outcome = await ctx.runMutation(
    internal.operatorAgent.requestToolConfirmationInternal,
    args,
  );
  if (outcome.status !== "automatically_approved") return outcome;
  const finished = await executeConfirmedActionTool(ctx, {
    runId: args.runId,
    confirmationId: outcome.confirmationId,
  });
  return finished.result;
}

export const requestOrExecuteToolInternal = internalAction({
  args: operatorToolConfirmationArgs,
  handler: requestOrExecuteTool,
});

export const requestToolConfirmationInternal = internalMutation({
  args: operatorToolConfirmationArgs,
  handler: async (ctx, args) => {
    const operator = await requireOperatorForUser(ctx, args.operatorUserId);
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.operatorUserId !== args.operatorUserId ||
      run.threadId !== args.threadId
    ) {
      throw new Error("Operator agent run not found");
    }
    await requireOperatorThread(ctx, args.threadId, args.operatorUserId, {
      anyOperator: true,
    });
    const spec = getOperatorAgentToolSpec(args.toolName);
    assertOperatorRole(operator.profile.role, spec.requiredRole);
    if (spec.confirmation !== "exact" || spec.effect === "read") {
      throw new Error("This tool does not use exact confirmation");
    }
    assertOperatorEmailToolAccess(run, spec);
    const input = parseOperatorAgentToolInput(args.toolName, args.input);
    const expectedHash = await actionConfirmationFingerprint({
      toolName: args.toolName,
      toolVersion: spec.version,
      input,
    });
    if (expectedHash !== args.inputHash) {
      throw new Error("Operator tool input changed before confirmation");
    }
    const existing = await ctx.db
      .query("agentActionAuditEvents")
      .withIndex("idempotency", (index) =>
        index
          .eq("operatorUserId", args.operatorUserId)
          .eq("idempotencyKey", args.idempotencyKey),
      )
      .unique();
    if (existing) {
      if (
        existing.inputHash !== args.inputHash ||
        existing.action !== args.toolName
      ) {
        throw new Error("Idempotency key was already used for another action");
      }
      if (existing.status === "succeeded") {
        return {
          status: "succeeded" as const,
          result: parseStoredOutput(existing.output),
          idempotent: true,
        };
      }
      if (existing.status === "awaiting_confirmation") {
        const confirmation = existing.operatorConfirmationId
          ? await ctx.db.get(existing.operatorConfirmationId)
          : null;
        if (
          !confirmation ||
          confirmation.status !== "pending" ||
          run.cancellationRequestedAt ||
          run.status !== "waiting_confirmation" ||
          run.checkpoint?.pendingConfirmationId !== confirmation._id
        ) {
          return preflightOperatorToolFailure(
            args.toolName as OperatorAgentToolName,
            "Operator confirmation is no longer active. Do not retry this action; use the existing approval flow.",
          );
        }
        return {
          status: "confirmation_required" as const,
          confirmationId: confirmation._id,
          summary: confirmation.payload.summary,
        };
      }
      const previousFailure = parseStoredOutput(existing.output);
      if (
        existing.status === "failed" &&
        isRecoverableOperatorToolFailure(previousFailure)
      )
        return previousFailure;
      return executionOperatorToolFailure(
        args.toolName as OperatorAgentToolName,
        existing.status === "pending"
          ? "Operator action is already in progress"
          : `Operator action is ${existing.status}. Do not replay this input; inspect authoritative state and report the prior outcome.`,
      );
    }
    if (run.cancellationRequestedAt || run.status !== "running") {
      throw new Error("Operator agent run is no longer active");
    }
    const now = dayjs().valueOf();
    const blockingConfirmation = await ctx.db
      .query("operatorAgentConfirmations")
      .withIndex("thread_status", (index) =>
        index.eq("threadId", args.threadId).eq("status", "pending"),
      )
      .first();
    if (blockingConfirmation) {
      return {
        status: "blocked_by_confirmation" as const,
        confirmationId: blockingConfirmation._id,
        runId: blockingConfirmation.payload.runId,
        summary: blockingConfirmation.payload.summary,
        expiresAt: blockingConfirmation.expiresAt,
      };
    }
    // Nothing to approve when the work is already underway.
    if (args.toolName === "retry_failed_policy_extraction") {
      const policy = await ctx.db.get(normalizePolicyId(ctx, input.policyId));
      const run = policy
        ? await ctx.db
            .query("policyExtractionRuns")
            .withIndex("policy", (index) => index.eq("policyId", policy._id))
            .order("desc")
            .first()
        : null;
      if (policy && (run?.pipelineStatus ?? policy.pipelineStatus) === "running") {
        return {
          status: "succeeded" as const,
          result: alreadyRunningExtraction(policy._id),
          idempotent: false,
        };
      }
    }
    try {
      await preflightOperatorToolConfirmation(ctx, {
        operatorUserId: args.operatorUserId,
        threadId: args.threadId,
        toolName: args.toolName as OperatorAgentToolName,
        input,
      });
    } catch (error) {
      return preflightOperatorToolFailure(
        args.toolName as OperatorAgentToolName,
        error,
      );
    }
    const target = spec.target(input);
    const inputJson = JSON.stringify(input);
    const summary = await operatorConfirmationSummary(
      ctx,
      args.toolName,
      input,
      { operatorUserId: args.operatorUserId, threadId: args.threadId },
    );
    const automatic =
      (await getOperatorAgentSettings(ctx))?.approveAll === true;
    const confirmationId = await ctx.db.insert("operatorAgentConfirmations", {
      threadId: args.threadId,
      operatorUserId: args.operatorUserId,
      promptMessageId: args.threadMessageId,
      payload: {
        kind: "operator_tool_action",
        runId: args.runId,
        toolName: args.toolName,
        toolVersion: spec.version,
        input: inputJson,
        inputHash: args.inputHash,
        sourceFingerprint:
          args.toolName === "send_email_draft"
            ? (
                await operatorEmailSendConfirmation(ctx, {
                  operatorUserId: args.operatorUserId,
                  threadId: args.threadId,
                  draftId: input.draftId,
                })
              ).fingerprint
            : isProviderEmailSendTool(args.toolName)
            ? await providerLaunchFingerprint(ctx, { operatorUserId: args.operatorUserId, input })
            : args.toolName === "import_policy_files"
            ? await operatorPolicySourceFingerprint(
                await resolveOperatorPolicySources(ctx, {
                  operatorUserId: args.operatorUserId,
                  threadId: args.threadId,
                  orgId: normalizeOrganizationId(ctx, input.orgId),
                  attachmentFileIds: stringList(input.attachmentFileIds),
                  clientFileIds: stringList(input.clientFileIds),
                }),
              )
            : undefined,
        idempotencyKey: args.idempotencyKey,
        capability: spec.capability,
        effect: spec.effect,
        requiredRole: spec.requiredRole,
        targetKind: target.kind,
        targetId: target.id,
        summary,
      },
      status: automatic ? "completed" : "pending",
      approvalMode: automatic ? "automatic" : undefined,
      completedAt: automatic ? now : undefined,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("agentActionAuditEvents", {
      operatorThreadId: args.threadId,
      operatorMessageId: args.threadMessageId,
      runId: args.runId,
      operatorConfirmationId: confirmationId,
      actorKind: "operator",
      operatorUserId: args.operatorUserId,
      authorizationKind: "operator",
      action: args.toolName,
      toolVersion: spec.version,
      capability: spec.capability,
      effect: spec.effect,
      idempotencyKey: args.idempotencyKey,
      inputHash: args.inputHash,
      targetKind: target.kind,
      targetId: target.id,
      channel: args.channel,
      input: boundedJson(input),
      output: boundedJson({ confirmationId, summary }),
      status: automatic ? "pending" : "awaiting_confirmation",
      createdAt: now,
      updatedAt: now,
    });
    if (automatic) {
      if (spec.execution === "action") {
        return { status: "automatically_approved" as const, confirmationId };
      }
      return await executeOperatorTool(ctx, { ...args, confirmationId });
    }
    await ctx.db.patch(args.threadMessageId, {
      content: `Confirmation required: ${summary}.${
        args.channel === "imessage" ? " Reply approve or reject." : ""
      }`,
      status: undefined,
      usedTools: [args.toolName],
      updatedAt: now,
    });
    await ctx.db.patch(args.runId, {
      status: "waiting_confirmation",
      checkpoint: {
        compaction: run.checkpoint?.compaction,
        iteration: (run.checkpoint?.iteration ?? 0) + 1,
        executionCount: (run.checkpoint?.executionCount ?? 0) + 1,
        summary:
          args.checkpointSummary?.slice(-6_000) ?? run.checkpoint?.summary,
        lastToolName: args.toolName,
        pendingConfirmationId: confirmationId,
      },
      updatedAt: now,
    });
    await emitOperatorNotification(ctx, {
      eventKey: `approval:${confirmationId}`,
      category: "approval",
      target: { kind: "approval", confirmationId },
    });
    return {
      status: "confirmation_required" as const,
      confirmationId,
      summary,
    };
  },
});

/**
 * What a completed write did, for its activity row: the registry summary
 * with record ids replaced by names. Reads never get one.
 */
export const changeSummaryInternal = internalQuery({
  args: { toolName: v.string(), input: v.record(v.string(), v.any()) },
  handler: async (ctx, args): Promise<string | null> => {
    if (!isOperatorAgentToolName(args.toolName)) return null;
    const spec = getOperatorAgentToolSpec(args.toolName);
    if (spec.effect === "read") return null;
    // Batch summaries resolve nested ids to names the same way approvals do.
    const summary = isClientBatchToolName(args.toolName)
      ? await clientBatchConfirmationSummary(ctx, args.toolName, args.input)
      : isRemainingBatchToolName(args.toolName)
        ? await remainingBatchConfirmationSummary(
            ctx,
            args.toolName,
            args.input,
          )
        : await operatorDisplaySummary(
            ctx,
            spec.summarize(args.input),
            args.input,
          );
    return boundedDisplayText(summary, MESSAGE_ACTIVITY_MAX_CHANGE, true) || null;
  },
});

/** Stores a call's result preview; replays of the same call keep the first. */
export const recordToolPreviewInternal = internalMutation({
  args: {
    messageId: v.id("operatorAgentMessages"),
    toolCallId: v.string(),
    items: v.array(toolPreviewItemValidator),
  },
  handler: async (ctx, args) => {
    if (args.items.length === 0 || args.items.length > TOOL_PREVIEW_MAX_ITEMS)
      return false;
    const existing = await ctx.db
      .query("operatorAgentToolPreviews")
      .withIndex("by_messageId_and_toolCallId", (index) =>
        index.eq("messageId", args.messageId).eq("toolCallId", args.toolCallId),
      )
      .unique();
    if (!existing) await ctx.db.insert("operatorAgentToolPreviews", args);
    return true;
  },
});

/** Preview items for one call, for any operator who can read the thread. */
export const getToolPreview = query({
  args: {
    messageId: v.id("operatorAgentMessages"),
    toolCallId: v.string(),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const message = await ctx.db.get(args.messageId);
    if (!message) return null;
    await requireOperatorThread(ctx, message.threadId, operator.userId, {
      anyOperator: true,
    });
    const preview = await ctx.db
      .query("operatorAgentToolPreviews")
      .withIndex("by_messageId_and_toolCallId", (index) =>
        index.eq("messageId", args.messageId).eq("toolCallId", args.toolCallId),
      )
      .unique();
    return preview?.items ?? null;
  },
});

export const executeToolInternal = internalMutation({
  args: {
    ...operatorToolExecutionArgs,
    confirmationId: v.optional(v.id("operatorAgentConfirmations")),
  },
  handler: executeOperatorTool,
});

/** Deletes the run's current model continuation, wherever it is kept. */
async function deleteRunContinuation(
  ctx: MutationCtx,
  run: Doc<"operatorAgentRuns">,
) {
  if (run.modelContinuationStorageId)
    await ctx.storage.delete(run.modelContinuationStorageId);
  if (run.modelContinuationId && (await ctx.db.get(run.modelContinuationId)))
    await ctx.db.delete(run.modelContinuationId);
}

/**
 * Installs the next model continuation in the same transaction that advances
 * the checkpoint: inline text becomes a document, a blob was stored before
 * this mutation. The previous continuation is deleted. Returns the run fields
 * to patch; none when no continuation was supplied.
 */
async function replaceRunContinuation(
  ctx: MutationCtx,
  run: Doc<"operatorAgentRuns">,
  next: {
    modelContinuationStorageId?: Id<"_storage">;
    modelContinuation?: string;
  },
) {
  if (next.modelContinuation !== undefined) {
    if (
      new TextEncoder().encode(next.modelContinuation).byteLength >
      OPERATOR_INLINE_CONTINUATION_BYTES
    )
      throw new Error("Inline operator continuation is too large");
    const modelContinuationId = await ctx.db.insert(
      "operatorRunContinuations",
      { runId: run._id, body: next.modelContinuation },
    );
    await deleteRunContinuation(ctx, run);
    return { modelContinuationId, modelContinuationStorageId: undefined };
  }
  if (!next.modelContinuationStorageId) return {};
  if (next.modelContinuationStorageId !== run.modelContinuationStorageId)
    await deleteRunContinuation(ctx, run);
  else if (run.modelContinuationId)
    await deleteRunContinuation(ctx, {
      ...run,
      modelContinuationStorageId: undefined,
    });
  return {
    modelContinuationStorageId: next.modelContinuationStorageId,
    modelContinuationId: undefined,
  };
}

export const getRunContinuationInternal = internalQuery({
  args: { id: v.id("operatorRunContinuations") },
  handler: async (ctx, args) => (await ctx.db.get(args.id))?.body ?? null,
});

/** One runner segment's timing, written by the mutation that ends it. */
async function recordOperatorRunTiming(
  ctx: MutationCtx,
  runId: Id<"operatorAgentRuns">,
  endedBy: Doc<"operatorRunTimings">["endedBy"],
  timing: OperatorRunTiming | undefined,
  inline?: boolean,
) {
  if (!timing) return;
  await ctx.db.insert("operatorRunTimings", {
    runId,
    endedBy,
    ...(inline === undefined ? {} : { inline }),
    ...timing,
  });
}

export const sweepExpiredRunTimings = internalMutation({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.max(
      1,
      Math.min(Math.floor(args.batchSize ?? 500), 1_000),
    );
    const cutoff = dayjs()
      .subtract(OPERATOR_RUN_TIMING_RETENTION_DAYS, "day")
      .valueOf();
    const expired = await ctx.db
      .query("operatorRunTimings")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
      .take(limit);
    for (const row of expired) await ctx.db.delete(row._id);
    if (expired.length === limit)
      await ctx.scheduler.runAfter(
        0,
        internal.operatorAgent.sweepExpiredRunTimings,
        { batchSize: limit },
      );
    return { deleted: expired.length };
  },
});

export const completeRunInternal = internalMutation({
  args: {
    runId: v.id("operatorAgentRuns"),
    expectedRunnerAttempt: v.optional(v.number()),
    modelContinuationStorageId: v.optional(v.id("_storage")),
    /** Continuation text kept inline instead of `modelContinuationStorageId`. */
    modelContinuation: v.optional(v.string()),
    expectedCheckpointIteration: v.optional(v.number()),
    checkpointSummary: v.optional(v.string()),
    content: v.string(),
    routerRequestId: v.optional(v.string()),
    usedTools: v.array(v.string()),
    toolCalls: v.array(
      v.object({
        name: v.string(),
        toolCallId: v.optional(v.string()),
        input: v.optional(v.string()),
        output: v.optional(v.string()),
      }),
    ),
    timing: v.optional(operatorRunTimingValidator),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) {
      if (args.modelContinuationStorageId)
        await ctx.storage.delete(args.modelContinuationStorageId);
      return null;
    }
    await recordOperatorRunTiming(ctx, run._id, "complete", args.timing);
    const discardContinuation = async () => {
      if (
        args.modelContinuationStorageId &&
        args.modelContinuationStorageId !== run.modelContinuationStorageId
      )
        await ctx.storage.delete(args.modelContinuationStorageId);
    };
    const now = dayjs().valueOf();
    if (run.status === "cancelled" || run.cancellationRequestedAt) {
      await discardContinuation();
      return { status: "cancelled" as const };
    }
    const waiting = run.status === "waiting_confirmation";
    if (
      (run.status !== "running" && !waiting) ||
      (args.expectedRunnerAttempt !== undefined &&
        run.runnerAttempt !== args.expectedRunnerAttempt) ||
      (args.expectedCheckpointIteration !== undefined &&
        (run.checkpoint?.iteration ?? 0) !==
          args.expectedCheckpointIteration + (waiting ? 1 : 0))
    ) {
      await discardContinuation();
      return { status: "not_completed" as const };
    }
    const currentMessage = await ctx.db.get(run.agentMessageId);
    const usedTools = [
      ...new Set([...(currentMessage?.usedTools ?? []), ...args.usedTools]),
    ];
    const toolCalls = [
      ...(currentMessage?.toolCalls ?? []),
      ...args.toolCalls,
    ].slice(-100);
    await ctx.db.patch(run.agentMessageId, {
      content: args.content,
      presentation: undefined,
      presentationRevision: (currentMessage?.presentationRevision ?? 0) + 1,
      nextMessageSuggestion: undefined,
      status: undefined,
      routerRequestId: args.routerRequestId,
      usedTools: usedTools.length > 0 ? usedTools : undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      updatedAt: now,
    });
    await ctx.db.patch(run.threadId, { lastMessageAt: now, updatedAt: now });
    if (waiting && run.checkpoint) {
      await ctx.db.patch(run._id, {
        ...(await replaceRunContinuation(ctx, run, args)),
        checkpoint: {
          ...run.checkpoint,
          summary:
            args.checkpointSummary?.slice(-6_000) ??
            buildOperatorRunCheckpointSummary({
              previous: run.checkpoint.summary,
              audit: {
                usedTools: args.usedTools,
                completedTools: [],
                toolCalls: args.toolCalls,
                workflowOutcomes: [],
              },
            }),
        },
        updatedAt: now,
      });
    }
    if (!waiting) {
      await discardContinuation();
      await deleteRunContinuation(ctx, run);
      await ctx.db.patch(run._id, {
        status: "completed",
        modelContinuationStorageId: undefined,
        modelContinuationId: undefined,
        completedAt: now,
        checkpoint: {
          compaction: run.checkpoint?.compaction,
          iteration: (run.checkpoint?.iteration ?? 0) + 1,
          executionCount:
            (run.checkpoint?.executionCount ?? 0) + args.toolCalls.length,
          summary: args.content.slice(0, 1_000),
          lastToolName: args.usedTools.at(-1),
        },
        updatedAt: now,
      });
    }
    if (!waiting) await scheduleOperatorHistoryCompaction(ctx, run.threadId);
    if (!waiting && run.executionKind !== "direct_tool") {
      const message = await ctx.db.get(run.agentMessageId);
      if (message) {
        await schedulePresentation(ctx, message, {
          userId: run.operatorUserId,
          operatorRunId: run._id,
        });
        await scheduleNextMessageSuggestion(ctx, message);
      }
    }
    return {
      status: waiting
        ? ("waiting_confirmation" as const)
        : ("completed" as const),
    };
  },
});

/** Preflight decisions belong to one current run, never to a thread-wide cache. */
export const recordPlanningAssessmentInternal = internalMutation({
  args: {
    runId: v.id("operatorAgentRuns"),
    expectedRunnerAttempt: v.number(),
    expectedCheckpointIteration: v.number(),
    assessment: operatorPlanningAssessmentValidator,
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
      return false;
    if (run.planningAssessment) return true;
    const probabilities = Object.values(args.assessment.probabilities);
    if (
      probabilities.some(
        (p) => p !== null && (!Number.isFinite(p) || p < 0 || p > 1),
      )
    )
      throw new Error("Invalid planning probability");
    const targetCount = args.assessment.targetCount;
    if (
      targetCount &&
      (!Number.isFinite(targetCount.score) ||
        targetCount.score < 0 ||
        !Number.isFinite(targetCount.confidence) ||
        targetCount.confidence < 0 ||
        targetCount.confidence > 1)
    )
      throw new Error("Invalid planning score");
    if (args.assessment.source === "operator") {
      if (args.assessment.level !== "full" || !run.planRequested)
        throw new Error("Operator plan requests require a full plan");
    } else if (
      !args.assessment.level ||
      args.assessment.level !==
        planningLevelFromAssessment(args.assessment, jevProceedThreshold())
    ) {
      throw new Error("Planning level must follow from the recorded answers");
    }
    await ctx.db.patch(run._id, {
      planningAssessment: args.assessment,
      updatedAt: dayjs().valueOf(),
    });
    return true;
  },
});

/** A failed full plan downgrades the run to a checklist instead of failing it. */
export const recordPlannerFallbackInternal = internalMutation({
  args: {
    runId: v.id("operatorAgentRuns"),
    expectedRunnerAttempt: v.number(),
    expectedCheckpointIteration: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.status !== "running" ||
      run.cancellationRequestedAt ||
      run.runnerAttempt !== args.expectedRunnerAttempt ||
      (run.checkpoint?.iteration ?? 0) !== args.expectedCheckpointIteration ||
      run.executionPlan
    )
      return false;
    const assessment = run.planningAssessment;
    if (assessment?.plannerFallback) return true;
    if (!assessment || operatorPlanningLevel(assessment) !== "full")
      throw new Error("Planner fallback requires a full planning assessment");
    await ctx.db.patch(run._id, {
      planningAssessment: {
        ...assessment,
        level: "checklist",
        plannerFallback: true,
      },
      updatedAt: dayjs().valueOf(),
    });
    return true;
  },
});

export const recordExecutionPlanInternal = internalMutation({
  args: {
    runId: v.id("operatorAgentRuns"),
    expectedRunnerAttempt: v.number(),
    expectedCheckpointIteration: v.number(),
    plan: operatorExecutionPlanValidator,
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
      return false;
    if (
      !run.planningAssessment ||
      operatorPlanningLevel(run.planningAssessment) !== "full"
    )
      throw new Error("Planning assessment required");
    if (run.executionPlan) return true;
    const message = await ctx.db.get(run.agentMessageId);
    if (!message || message.status !== "processing") return false;
    const plan = operatorExecutionPlanSchema.parse(args.plan);
    await ctx.db.patch(run._id, {
      executionPlan: plan,
      updatedAt: dayjs().valueOf(),
    });
    await ctx.db.patch(message._id, { executionPlan: plan });
    return true;
  },
});

const OPERATOR_ROUTER_FALLBACK_POLL_MS = 10_000;

export const waitForRouterInternal = internalMutation({
  args: {
    runId: v.id("operatorAgentRuns"),
    expectedRunnerAttempt: v.optional(v.number()),
    expectedCheckpointIteration: v.number(),
    invocationKey: v.optional(v.string()),
    families: v.optional(v.array(v.string())),
    timing: v.optional(operatorRunTimingValidator),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (run)
      await recordOperatorRunTiming(ctx, run._id, "wait_router", args.timing);
    if (
      !run ||
      run.status !== "running" ||
      run.cancellationRequestedAt ||
      (args.expectedRunnerAttempt !== undefined &&
        run.runnerAttempt !== args.expectedRunnerAttempt) ||
      (run.checkpoint?.iteration ?? 0) !== args.expectedCheckpointIteration
    )
      return;
    await ctx.db.patch(run._id, {
      status: "queued",
      // Re-runs while the router job is pending reuse the families chosen for it.
      ...(args.families
        ? {
            checkpoint: {
              executionCount: 0,
              ...run.checkpoint,
              iteration: args.expectedCheckpointIteration,
              families: args.families,
            },
          }
        : {}),
      updatedAt: dayjs().valueOf(),
    });
    // routerJobs.finish wakes the run when its job ends; this slower poll only
    // recovers a lost wake-up. A job that finished before the run was queued
    // found it still running, so resume now.
    const job = args.invocationKey
      ? await ctx.db
          .query("routerJobs")
          .withIndex("invocation", (q) =>
            q.eq("invocationKey", args.invocationKey!),
          )
          .unique()
      : null;
    const jobEnded =
      job?.status === "succeeded" ||
      job?.status === "failed" ||
      job?.status === "cancelled";
    await ctx.scheduler.runAfter(
      jobEnded ? 0 : OPERATOR_ROUTER_FALLBACK_POLL_MS,
      internal.operatorAgentRunner.run,
      { runId: run._id },
    );
  },
});

export const retryRouterStepInternal = internalMutation({
  args: {
    runId: v.id("operatorAgentRuns"),
    expectedRunnerAttempt: v.number(),
    expectedCheckpointIteration: v.number(),
    routerRetryCount: v.number(),
    timing: v.optional(operatorRunTimingValidator),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (run)
      await recordOperatorRunTiming(ctx, run._id, "retry_router", args.timing);
    if (
      !run ||
      run.status !== "running" ||
      run.cancellationRequestedAt ||
      run.runnerAttempt !== args.expectedRunnerAttempt ||
      (run.checkpoint?.iteration ?? 0) !== args.expectedCheckpointIteration
    )
      return;
    await ctx.db.patch(run._id, {
      status: "queued",
      checkpoint: {
        executionCount: 0,
        ...run.checkpoint,
        iteration: args.expectedCheckpointIteration,
        routerRetryCount: args.routerRetryCount,
      },
      updatedAt: dayjs().valueOf(),
    });
    await ctx.scheduler.runAfter(
      2_000 * args.routerRetryCount,
      internal.operatorAgentRunner.run,
      { runId: run._id },
    );
  },
});

export const continueRunInternal = internalMutation({
  args: {
    runId: v.id("operatorAgentRuns"),
    expectedRunnerAttempt: v.optional(v.number()),
    expectedCheckpointIteration: v.optional(v.number()),
    modelContinuationStorageId: v.optional(v.id("_storage")),
    /** Continuation text kept inline instead of `modelContinuationStorageId`. */
    modelContinuation: v.optional(v.string()),
    families: v.optional(v.array(v.string())),
    /** The calling action runs the next step itself; the run stays running. */
    inline: v.optional(v.boolean()),
    summary: v.string(),
    usedTools: v.array(v.string()),
    toolCalls: v.array(
      v.object({
        name: v.string(),
        toolCallId: v.optional(v.string()),
        input: v.optional(v.string()),
        output: v.optional(v.string()),
      }),
    ),
    timing: v.optional(operatorRunTimingValidator),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) {
      if (args.modelContinuationStorageId)
        await ctx.storage.delete(args.modelContinuationStorageId);
      return null;
    }
    await recordOperatorRunTiming(
      ctx,
      run._id,
      "continue",
      args.timing,
      args.inline ?? false,
    );
    if (run.status === "waiting_confirmation") {
      if (
        args.modelContinuationStorageId &&
        args.modelContinuationStorageId !== run.modelContinuationStorageId
      )
        await ctx.storage.delete(args.modelContinuationStorageId);
      return { status: "waiting_confirmation" as const };
    }
    if (
      run.status !== "running" ||
      run.cancellationRequestedAt ||
      (args.expectedRunnerAttempt !== undefined &&
        run.runnerAttempt !== args.expectedRunnerAttempt) ||
      (args.expectedCheckpointIteration !== undefined &&
        (run.checkpoint?.iteration ?? 0) !== args.expectedCheckpointIteration)
    ) {
      if (
        args.modelContinuationStorageId &&
        args.modelContinuationStorageId !== run.modelContinuationStorageId
      )
        await ctx.storage.delete(args.modelContinuationStorageId);
      return { status: "not_continued" as const };
    }
    const message = await ctx.db.get(run.agentMessageId);
    const usedTools = [
      ...new Set([...(message?.usedTools ?? []), ...args.usedTools]),
    ];
    const toolCalls = [...(message?.toolCalls ?? []), ...args.toolCalls].slice(
      -100,
    );
    const now = dayjs().valueOf();
    await ctx.db.patch(run.agentMessageId, {
      status: "processing",
      usedTools: usedTools.length > 0 ? usedTools : undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      updatedAt: now,
    });
    const continuation = await replaceRunContinuation(ctx, run, args);
    await ctx.db.patch(run._id, {
      ...(args.inline ? {} : { status: "queued" as const }),
      ...continuation,
      checkpoint: {
        compaction: run.checkpoint?.compaction,
        iteration: (run.checkpoint?.iteration ?? 0) + 1,
        executionCount:
          (run.checkpoint?.executionCount ?? 0) + args.toolCalls.length,
        summary: args.summary.slice(-6_000),
        lastToolName: args.usedTools.at(-1),
        families: args.families ?? run.checkpoint?.families,
      },
      updatedAt: now,
    });
    if (args.inline)
      return {
        status: "continued" as const,
        ...("modelContinuationId" in continuation &&
        continuation.modelContinuationId
          ? { modelContinuationId: continuation.modelContinuationId }
          : {}),
      };
    await ctx.scheduler.runAfter(0, internal.operatorAgentRunner.run, {
      runId: run._id,
    });
    return { status: "queued" as const };
  },
});

export const failRunInternal = internalMutation({
  args: {
    runId: v.id("operatorAgentRuns"),
    expectedRunnerAttempt: v.optional(v.number()),
    error: v.string(),
    /** Safe categorized summary shown to the operator; `error` stays internal. */
    reason: v.optional(v.string()),
    /** Sanitized router diagnostics retained for operator troubleshooting. */
    failure: v.optional(routerJobFailureValidator),
    expectedCheckpointIteration: v.optional(v.number()),
    timing: v.optional(operatorRunTimingValidator),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return;
    await recordOperatorRunTiming(ctx, run._id, "fail", args.timing);
    if (
      args.expectedRunnerAttempt !== undefined &&
      run.runnerAttempt !== args.expectedRunnerAttempt
    )
      return;
    if (
      args.expectedCheckpointIteration !== undefined &&
      (run.status !== "running" ||
        (run.checkpoint?.iteration ?? 0) !== args.expectedCheckpointIteration)
    )
      return;
    const now = dayjs().valueOf();
    if (run.status === "cancelled" || run.cancellationRequestedAt) return;
    if (run.checkpoint?.pendingConfirmationId) {
      const confirmation = await ctx.db.get(
        run.checkpoint.pendingConfirmationId,
      );
      if (
        confirmation?.status === "pending" &&
        confirmation.payload.runId === run._id &&
        confirmation.threadId === run.threadId
      ) {
        await ctx.db.patch(confirmation._id, {
          status: "stale",
          invalidatedAt: now,
          invalidationReason: "operator_run_failed",
          updatedAt: now,
        });
      }
    }
    const ledgerRows = await ctx.db
      .query("agentActionAuditEvents")
      .withIndex("run_created", (index) => index.eq("runId", run._id))
      .take(100);
    await Promise.all(
      ledgerRows
        .filter(
          (ledger) =>
            ledger.status === "pending" ||
            ledger.status === "awaiting_confirmation",
        )
        .map((ledger) =>
          ctx.db.patch(ledger._id, {
            status: "failed",
            error: args.error.slice(0, 1_000),
            updatedAt: now,
          }),
        ),
    );
    await deleteRunContinuation(ctx, run);
    await ctx.db.patch(run._id, {
      status: "failed",
      modelContinuationStorageId: undefined,
      modelContinuationId: undefined,
      lastError: args.error.slice(0, 1_000),
      completedAt: now,
      checkpoint: run.checkpoint
        ? {
            compaction: run.checkpoint.compaction,
            iteration: run.checkpoint.iteration,
            executionCount: run.checkpoint.executionCount,
            summary: "Operator run failed",
            lastToolName: run.checkpoint.lastToolName,
          }
        : undefined,
      updatedAt: now,
    });
    await ctx.db.patch(run.agentMessageId, {
      content: args.reason
        ? `I couldn't complete that operator task. ${args.reason.slice(0, 300)}`
        : "I couldn't complete that operator task.",
      status: "error",
      error: args.error.slice(0, 1_000),
      ...(args.failure ? { failure: args.failure } : {}),
      updatedAt: now,
    });
    await ctx.db.patch(run.threadId, { lastMessageAt: now, updatedAt: now });
    if (run.status !== "failed" && run.status !== "completed")
      await emitOperatorNotification(ctx, {
        eventKey: `operator_run_failed:${run._id}`,
        category: "failure",
        target: { kind: "operator_run", runId: run._id },
      });
  },
});
