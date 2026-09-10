import dayjs from "dayjs";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
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
import { actionConfirmationFingerprint } from "./lib/actionConfirmationFingerprint";
import {
  MAX_AGENT_ATTACHMENT_AGGREGATE_BYTES,
  MAX_AGENT_ATTACHMENT_BYTES,
  MAX_AGENT_ATTACHMENT_FILES,
  normalizeAgentAttachmentContentType,
  normalizeAgentAttachmentFilename,
} from "./lib/agentAttachmentLimits";
import {
  assertFeatureFlagAllowedForOrg,
  setFeatureFlagPatch,
} from "./lib/featureFlags";
import {
  getOperatorAgentToolSpec,
  parseOperatorAgentToolInput,
  type OperatorAgentToolName,
  type OperatorToolRole,
} from "./lib/operatorAgentToolRegistry";
import type { OperatorGoogleWorkspaceToolName } from "./lib/googleWorkspace";
import {
  listOperatorAgentIntents,
  resolveOperatorAgentIntent,
} from "./lib/operatorAgentIntentRegistry";
import { buildOperatorRunCheckpointSummary } from "./lib/operatorAgentContinuation";
import { lookupMapboxAddress } from "./lib/mapboxAddress";
import {
  requireOperator,
  requireOperatorForUser,
  writeOperatorAudit,
} from "./lib/operatorIdentity";
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
  listProcurementRequestSummaries,
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
  listProcurementProposals,
  retryProcurementProposalExtractionByOperator,
  selectProcurementProposalByOperator,
} from "./procurementProposals";
import {
  getBrokerProfileDetails,
  listBrokerProfiles,
  createStandaloneBrokerByOperator,
  updateBrokerProfileByOperator,
} from "./brokerProfiles";
import { readOrgWiki, upsertOrgWikiSectionByOperator } from "./orgWiki";
import {
  listPacketLinksForOperator,
  listPacketSections,
  mintPacketLinkForOperator,
  previewBrokerPacket,
  revokePacketLinkByOperator,
  rotatePacketLinkByOperator,
  upsertPacketSectionByOperator,
} from "./procurementPacket";
import type { PacketAudience } from "./lib/procurementPacket";
import { isOrgWikiSectionKey } from "./lib/orgWiki";
import { normalizedSearchText, uniqueSearchTerms } from "./lib/searchTokenizer";
import { preflightOperatorToolConfirmation } from "./lib/operatorAgentConfirmationPreflight";
import {
  createSlackThreadContextArtifact,
  slackThreadContextMessageTimestamps,
  slackThreadContextSnapshotValidator,
  type SlackThreadContextSnapshot,
} from "./lib/slackThreadContext";

const operatorChannelValidator = v.union(
  v.literal("chat"),
  v.literal("slack"),
  v.literal("imessage"),
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

type OperatorChannel = "chat" | "slack" | "imessage" | "mcp";

type OperatorConfirmationDisplayState =
  | "pending"
  | "approved"
  | "cancelled"
  | "expired"
  | "superseded"
  | "unavailable";

function operatorConfirmationDisplayState(
  confirmation: {
    status: "pending" | "completed" | "stale" | "expired";
    expiresAt: number;
    invalidationReason?: string;
  },
  now: number,
): OperatorConfirmationDisplayState {
  if (confirmation.status === "completed") return "approved";
  if (
    confirmation.status === "expired" ||
    (confirmation.status === "pending" && confirmation.expiresAt <= now)
  ) {
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
      expiresAt: number;
    }
  | {
      status: "succeeded";
      result: unknown;
      idempotent: boolean;
    }
  | { status: "failed"; error: string };

type OperatorActionToolResult = {
  result: unknown;
  attachments?: OperatorAttachment[];
};

const OPERATOR_RICH_ACTION_TOOLS = new Set<OperatorAgentToolName>([
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
    toolName === "get_company_email_attachment"
  );
}

function serializedOperatorActionOutput(toolName: string, result: unknown) {
  return isOperatorGoogleWorkspaceTool(toolName)
    ? JSON.stringify(result)
    : boundedJson(result);
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function boundedDisplayText(value: string, maximum = 160) {
  const normalized = value.trim().replace(/\s+/g, " ");
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
  brokerOrgId: "the selected broker",
  policyId: "the selected policy",
  policyId1: "the first selected policy",
  policyId2: "the second selected policy",
  replacingPolicyId: "the policy being replaced",
  resultingPolicyId: "the resulting policy",
  clientFileId: "the selected client file",
  procurementRequestId: "the selected procurement request",
  procurementOutreachId: "the selected broker outreach",
  procurementFileItemId: "the selected procurement file",
  procurementEmailThreadId: "the selected email thread",
  requirementId: "the selected requirement",
  requirementSourceDocumentId: "the selected requirements source",
};

async function referenceDisplayName(
  ctx: MutationCtx,
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
  if (key === "procurementEmailThreadId") {
    const id = ctx.db.normalizeId("procurementEmailThreads", value);
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
  ctx: MutationCtx,
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
  return boundedDisplayText(displaySummary, 1_000);
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
  if (attachments.length > MAX_AGENT_ATTACHMENT_FILES) {
    throw new Error(
      `Operator messages support at most ${MAX_AGENT_ATTACHMENT_FILES} files`,
    );
  }

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
  for (const attachment of args.attachments.slice(
    0,
    MAX_AGENT_ATTACHMENT_FILES,
  )) {
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
  if (required === "owner" && actual !== "owner") {
    throw new Error("This operator action requires an owner");
  }
}

function packetSectionKey(value: unknown) {
  const key = typeof value === "string" ? value.trim() : "";
  if (!key) throw new Error("Packet section key is required");
  return key;
}

function normalizedOptionalText(value: unknown) {
  if (value === null) return undefined;
  if (typeof value !== "string") return undefined;
  return value.trim() || undefined;
}

function normalizeOperatorPageContext(
  context:
    | { pageType: string; entityId?: string; summary?: string }
    | undefined,
) {
  if (!context) return undefined;
  const pageType = context.pageType.trim();
  const entityId = context.entityId?.trim() || undefined;
  const summary = context.summary?.trim() || undefined;
  if (!pageType || pageType.length > 100) {
    throw new Error("Operator page type must be 1–100 characters");
  }
  if (entityId && entityId.length > 200) {
    throw new Error("Operator page entity ID must be at most 200 characters");
  }
  if (summary && summary.length > 500) {
    throw new Error("Operator page summary must be at most 500 characters");
  }
  return {
    pageType,
    ...(entityId ? { entityId } : {}),
    ...(summary ? { summary } : {}),
  };
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
  if (typeof value !== "string") throw new Error("Organization ID is required");
  const orgId = ctx.db.normalizeId("organizations", value);
  if (!orgId) throw new Error("Invalid organization ID");
  return orgId;
}

function normalizePolicyId(ctx: QueryCtx | MutationCtx, value: unknown) {
  if (typeof value !== "string") throw new Error("Policy ID is required");
  const policyId = ctx.db.normalizeId("policies", value);
  if (!policyId) throw new Error("Invalid policy ID");
  return policyId;
}

function normalizeClientFileId(ctx: QueryCtx | MutationCtx, value: unknown) {
  if (typeof value !== "string") throw new Error("Client file ID is required");
  const clientFileId = ctx.db.normalizeId("clientFiles", value);
  if (!clientFileId) throw new Error("Invalid client file ID");
  return clientFileId;
}

function normalizeProcurementRequestId(
  ctx: QueryCtx | MutationCtx,
  value: unknown,
) {
  if (typeof value !== "string") {
    throw new Error("Procurement request ID is required");
  }
  const requestId = ctx.db.normalizeId("procurementRequests", value);
  if (!requestId) throw new Error("Invalid procurement request ID");
  return requestId;
}

function normalizeProcurementOutreachId(
  ctx: QueryCtx | MutationCtx,
  value: unknown,
) {
  if (typeof value !== "string") {
    throw new Error("Procurement broker outreach ID is required");
  }
  const outreachId = ctx.db.normalizeId("procurementBrokerOutreaches", value);
  if (!outreachId) throw new Error("Invalid procurement broker outreach ID");
  return outreachId;
}

function normalizeProcurementFileItemId(
  ctx: QueryCtx | MutationCtx,
  value: unknown,
) {
  if (typeof value !== "string") {
    throw new Error("Procurement file item ID is required");
  }
  const fileItemId = ctx.db.normalizeId("procurementFileItems", value);
  if (!fileItemId) throw new Error("Invalid procurement file item ID");
  return fileItemId;
}

function normalizeProcurementEmailThreadId(
  ctx: QueryCtx | MutationCtx,
  value: unknown,
) {
  if (typeof value !== "string") {
    throw new Error("Procurement email thread ID is required");
  }
  const emailThreadId = ctx.db.normalizeId("procurementEmailThreads", value);
  if (!emailThreadId) throw new Error("Invalid procurement email thread ID");
  return emailThreadId;
}

function normalizeProcurementProposalId(
  ctx: QueryCtx | MutationCtx,
  value: unknown,
) {
  if (typeof value !== "string") {
    throw new Error("Procurement proposal ID is required");
  }
  const id = ctx.db.normalizeId("procurementProposals", value);
  if (!id) throw new Error("Invalid procurement proposal ID");
  return id;
}

function normalizeProcurementProposalReviewId(
  ctx: QueryCtx | MutationCtx,
  value: unknown,
) {
  if (typeof value !== "string") {
    throw new Error("Procurement proposal review ID is required");
  }
  const id = ctx.db.normalizeId("procurementProposalReviews", value);
  if (!id) throw new Error("Invalid procurement proposal review ID");
  return id;
}

function normalizeProcurementPacketLinkId(
  ctx: QueryCtx | MutationCtx,
  value: unknown,
) {
  if (typeof value !== "string") {
    throw new Error("Procurement packet link ID is required");
  }
  const id = ctx.db.normalizeId("procurementPacketLinks", value);
  if (!id) throw new Error("Invalid procurement packet link ID");
  return id;
}

function procurementOutreachStatus(value: unknown) {
  switch (value) {
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

function procurementFilePurpose(value: unknown) {
  switch (value) {
    case "requirements":
    case "application":
    case "requested_document":
    case "quote":
    case "correspondence":
    case "other":
      return value;
    default:
      throw new Error("Invalid procurement file purpose");
  }
}

function procurementFileStatus(value: unknown) {
  switch (value) {
    case "requested":
    case "available":
    case "sent":
    case "received":
      return value;
    default:
      return undefined;
  }
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

function packetAudience(value: unknown): PacketAudience | undefined {
  switch (value) {
    case "operator":
    case "client":
    case "broker":
      return value;
    case undefined:
    case null:
      return undefined;
    default:
      throw new Error("Invalid packet audience");
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
  options: { allowShared?: boolean } = {},
) {
  const thread = await ctx.db.get(threadId);
  if (
    !thread ||
    (!options.allowShared && thread.ownerUserId !== operatorUserId) ||
    (options.allowShared &&
      thread.ownerUserId !== operatorUserId &&
      thread.visibility !== "shared")
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

async function cancelActiveRunsForThread(
  ctx: MutationCtx,
  threadId: Id<"operatorAgentThreads">,
  reason: string,
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
  ).flat();
  const now = dayjs().valueOf();
  for (const run of runs) {
    await ctx.db.patch(run._id, {
      status: "cancelled",
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

async function enqueueOperatorMessage(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    threadId: Id<"operatorAgentThreads">;
    channel: OperatorChannel;
    content: string;
    dedupeKey?: string;
    attachments?: OperatorAttachment[];
    pageContext?: {
      pageType: string;
      entityId?: string;
      summary?: string;
    };
    slackThreadContext?: SlackThreadContextSnapshot;
    toolArtifacts?: Array<{ type: string; data: unknown }>;
    requireUploadIntent?: boolean;
  },
) {
  const thread = await requireOperatorThread(
    ctx,
    args.threadId,
    args.operatorUserId,
    { allowShared: true },
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

  await cancelActiveRunsForThread(ctx, args.threadId, "superseded");
  await invalidatePendingOperatorConfirmations(
    ctx,
    args.threadId,
    "superseded",
  );

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
    attachments,
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
    status: "queued",
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
    ...(thread.title === "New chat"
      ? { title: normalizeOperatorThreadTitle(content).slice(0, 80) }
      : {}),
  });
  await ctx.scheduler.runAfter(0, internal.operatorAgentRunner.run, { runId });
  return { messageId: userMessageId, runId, duplicate: false };
}

async function executeToolDomain(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    threadId: Id<"operatorAgentThreads">;
    channel: OperatorChannel;
    toolName: OperatorAgentToolName;
    input: Record<string, unknown>;
  },
) {
  const { toolName, input } = args;
  if (toolName === "search_organizations") {
    const queryText = typeof input.query === "string" ? input.query.trim() : "";
    const requestedType =
      input.type === "broker" || input.type === "client"
        ? input.type
        : undefined;
    const limit = typeof input.limit === "number" ? input.limit : 15;
    const organizations = requestedType
      ? requestedType === "client"
        ? (
            await Promise.all([
              ctx.db
                .query("organizations")
                .withIndex("type", (index) => index.eq("type", "client"))
                .take(500),
              ctx.db
                .query("organizations")
                .withIndex("type", (index) => index.eq("type", undefined))
                .take(500),
            ])
          ).flat()
        : await ctx.db
            .query("organizations")
            .withIndex("type", (index) => index.eq("type", "broker"))
            .take(500)
      : await ctx.db.query("organizations").take(1_000);
    return organizations
      .map((organization) => ({
        organization,
        score: organizationSearchScore(organization, queryText),
      }))
      .filter(({ score }) => score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.organization.name.localeCompare(right.organization.name),
      )
      .slice(0, limit)
      .map(({ organization }) => ({
        orgId: organization._id,
        name: organization.name,
        type: organization.type ?? "client",
        status: organization.operatorStatus ?? "live",
        slug: organization.slug,
        website: organization.website,
        brokerOrgId: organization.brokerOrgId,
      }));
  }

  if (toolName === "get_organization") {
    const orgId = normalizeOrganizationId(ctx, input.orgId);
    const organization = await ctx.db.get(orgId);
    if (!organization) throw new Error("Organization not found");
    const [memberships, policies] = await Promise.all([
      ctx.db
        .query("orgMemberships")
        .withIndex("organization", (index) => index.eq("orgId", orgId))
        .take(5_001),
      ctx.db
        .query("policies")
        .withIndex("organization", (index) => index.eq("orgId", orgId))
        .take(5_001),
    ]);
    return {
      orgId,
      name: organization.name,
      type: organization.type ?? "client",
      status: organization.operatorStatus ?? "live",
      slug: organization.slug,
      website: organization.website,
      industry: organization.industry,
      industryVertical: organization.industryVertical,
      brokerOrgId: organization.brokerOrgId,
      featureFlags: organization.featureFlags,
      onboardingComplete: organization.onboardingComplete,
      memberCount: Math.min(memberships.length, 5_000),
      policyCount: policies
        .slice(0, 5_000)
        .filter((policy) => !policy.deletedAt).length,
      archivedPolicyCount: policies
        .slice(0, 5_000)
        .filter((policy) => policy.deletedAt).length,
      countsAreLowerBounds:
        memberships.length > 5_000 || policies.length > 5_000,
    };
  }

  if (toolName === "get_operator_overview") {
    const [organizations, policies, extractionRuns, agentRuns] =
      await Promise.all([
        ctx.db.query("organizations").take(2_000),
        ctx.db.query("policies").take(5_000),
        ctx.db.query("policyExtractionRuns").take(5_000),
        ctx.db.query("operatorAgentRuns").take(2_000),
      ]);
    return {
      organizations: {
        total: organizations.length,
        brokers: organizations.filter((org) => org.type === "broker").length,
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
    if (!organization) throw new Error("Organization not found");
    const queryText =
      typeof input.query === "string" ? input.query.trim().toLowerCase() : "";
    const limit = typeof input.limit === "number" ? input.limit : 15;
    const includeArchived = input.includeArchived === true;
    const policies = await ctx.db
      .query("policies")
      .withIndex("organization", (index) => index.eq("orgId", orgId))
      .take(2_000);
    return policies
      .filter((policy) => includeArchived || !policy.deletedAt)
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
      })
      .slice(0, limit)
      .map((policy) => ({
        policyId: policy._id,
        policyNumber: policy.policyNumber,
        carrier: policy.carrier,
        insuredName: policy.insuredName,
        effectiveDate: policy.effectiveDate,
        expirationDate: policy.expirationDate,
        linesOfBusiness: policy.linesOfBusiness,
        extractionDataStage: policy.extractionDataStage,
        pipelineStatus: policy.pipelineStatus,
        archived: Boolean(policy.deletedAt),
      }));
  }

  if (toolName === "get_policy_status") {
    const policyId = normalizePolicyId(ctx, input.policyId);
    const policy = await ctx.db.get(policyId);
    if (!policy) throw new Error("Policy not found");
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
      reconciliationStatus: policy.reconciliationStatus,
      archived: Boolean(policy.deletedAt),
      fileName: policy.fileName,
    };
  }

  if (toolName === "list_client_files") {
    const orgId = normalizeOrganizationId(ctx, input.orgId);
    const organization = await ctx.db.get(orgId);
    if (!organization || organization.type !== "client") {
      throw new Error("Client organization not found");
    }
    const limit = typeof input.limit === "number" ? input.limit : 25;
    const files = await ctx.db
      .query("clientFiles")
      .withIndex("organization", (index) => index.eq("orgId", orgId))
      .order("desc")
      .take(limit);
    return {
      files: await Promise.all(
        files.map(async (file) => {
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
      bounded: files.length === limit,
    };
  }

  if (toolName === "lookup_client_wiki") {
    const orgId = normalizeOrganizationId(ctx, input.orgId);
    const organization = await ctx.db.get(orgId);
    if (!organization || organization.type !== "client") {
      throw new Error("Client organization not found");
    }
    return await readOrgWiki(ctx, orgId);
  }

  if (toolName === "update_client_wiki_section") {
    if (!isOrgWikiSectionKey(input.key)) {
      throw new Error("Unknown company wiki section");
    }
    return await upsertOrgWikiSectionByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      orgId: normalizeOrganizationId(ctx, input.orgId),
      key: input.key,
      body: typeof input.body === "string" ? input.body : "",
      source: args.channel === "mcp" ? "mcp" : "operator",
    });
  }

  if (toolName === "lookup_procurement_packet") {
    return await listPacketSections(ctx, {
      requestId: normalizeProcurementRequestId(ctx, input.procurementRequestId),
      audience: packetAudience(input.audience),
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

  if (toolName === "update_procurement_packet_section") {
    return await upsertPacketSectionByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      requestId: normalizeProcurementRequestId(ctx, input.procurementRequestId),
      key: packetSectionKey(input.key),
      body: typeof input.body === "string" ? input.body : "",
      audience: packetAudience(input.audience),
      source: "operator_agent",
    });
  }

  if (toolName === "list_procurement_requests") {
    const clientOrgId = normalizeOrganizationId(ctx, input.orgId);
    const limit = typeof input.limit === "number" ? input.limit : 50;
    const requests = await listProcurementRequestSummaries(ctx, {
      clientOrgId,
      query: normalizedOptionalText(input.query),
      status: writableProcurementRequestStatus(input.status),
      limit,
    });
    return { requests, bounded: requests.length === limit };
  }

  if (toolName === "get_procurement_request") {
    const requestId = normalizeProcurementRequestId(
      ctx,
      input.procurementRequestId,
    );
    return await getProcurementRequestDetails(ctx, requestId);
  }

  if (toolName === "list_procurement_proposals") {
    const requestId = normalizeProcurementRequestId(
      ctx,
      input.procurementRequestId,
    );
    return {
      proposals: await listProcurementProposals(ctx, requestId),
      private: true,
    };
  }

  if (toolName === "get_procurement_proposal") {
    const proposalId = normalizeProcurementProposalId(
      ctx,
      input.procurementProposalId,
    );
    const proposal = await getProcurementProposalDetails(ctx, proposalId);
    if (!proposal) throw new Error("Procurement proposal not found");
    return { ...proposal, private: true };
  }

  if (toolName === "get_broker_network_profile") {
    return await getBrokerProfileDetails(
      ctx,
      normalizeOrganizationId(ctx, input.brokerOrgId),
    );
  }

  if (toolName === "list_broker_network_profiles") {
    const limit = typeof input.limit === "number" ? input.limit : 50;
    const profiles = await listBrokerProfiles(ctx, {
      search: normalizedOptionalText(input.query),
      status:
        input.status === "prospect" ||
        input.status === "active" ||
        input.status === "inactive" ||
        input.status === "blacklisted"
          ? input.status
          : undefined,
      writingState: normalizedOptionalText(input.writingState),
      lineOfBusinessCode: normalizedOptionalText(input.lineOfBusinessCode),
      limit,
    });
    return { profiles, bounded: profiles.length === limit };
  }

  if (toolName === "get_procurement_forwarding_address") {
    const requestId = normalizeProcurementRequestId(
      ctx,
      input.procurementRequestId,
    );
    const details = await getProcurementRequestDetails(ctx, requestId);
    return {
      procurementRequestId: requestId,
      forwardingAddress: details.request.forwardingAddress,
    };
  }

  if (toolName === "list_procurement_email_threads") {
    const requestId = normalizeProcurementRequestId(
      ctx,
      input.procurementRequestId,
    );
    const request = await ctx.db.get(requestId);
    if (!request) throw new Error("Procurement request not found");
    const limit = typeof input.limit === "number" ? input.limit : 50;
    const threads = await listProcurementEmailThreads(ctx, {
      clientOrgId: request.clientOrgId,
      requestId,
      limit,
    });
    return { threads, bounded: threads.length === limit };
  }

  if (toolName === "get_procurement_email_thread") {
    const emailThreadId = normalizeProcurementEmailThreadId(
      ctx,
      input.procurementEmailThreadId,
    );
    const thread = await getProcurementEmailThreadDetails(ctx, emailThreadId);
    if (!thread) throw new Error("Procurement email thread not found");
    return thread;
  }

  if (toolName === "preview_procurement_email_reconciliation") {
    return await previewProcurementEmailReconciliation(
      ctx,
      normalizeProcurementEmailThreadId(ctx, input.procurementEmailThreadId),
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
    const queueStatus =
      requestedStatus === "queued" || requestedStatus === "leased"
        ? requestedStatus
        : undefined;
    const pipelineStatuses: Array<"error" | "paused" | "running"> =
      requestedStatus === "error" ||
      requestedStatus === "paused" ||
      requestedStatus === "running"
        ? [requestedStatus]
        : requestedStatus
          ? []
          : ["error", "paused"];
    const candidateLimit = Math.min(100, limit * 5);
    const inspectPolicies = requestedDomain !== "proposal";
    const inspectProposals = requestedDomain !== "policy";
    const [pipelineRuns, queueRows, proposalResult] = await Promise.all([
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
      inspectPolicies
        ? requestedStatus === "stuck"
          ? ctx.db
              .query("policyExtractionQueue")
              .withIndex("status_updated", (index) =>
                index.eq("status", "leased"),
              )
              .order("desc")
              .take(candidateLimit)
          : queueStatus
            ? ctx.db
                .query("policyExtractionQueue")
                .withIndex("status_updated", (index) =>
                  index.eq("status", queueStatus),
                )
                .order("desc")
                .take(candidateLimit)
            : requestedStatus
              ? Promise.resolve([])
              : Promise.all([
                  ctx.db
                    .query("policyExtractionQueue")
                    .withIndex("status_updated", (index) =>
                      index.eq("status", "queued"),
                    )
                    .order("desc")
                    .take(candidateLimit),
                  ctx.db
                    .query("policyExtractionQueue")
                    .withIndex("status_updated", (index) =>
                      index.eq("status", "leased"),
                    )
                    .order("desc")
                    .take(candidateLimit),
                ]).then((rows) => rows.flat())
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
    const candidates = [
      ...pipelineRuns.flat().map((run) => ({
        policyId: run.policyId,
        runId: run._id,
        status: run.pipelineStatus,
        error: run.pipelineError,
        updatedAt: run.updatedAt,
        queue: undefined as
          | undefined
          | { status: string; leaseExpiresAt?: number },
      })),
      ...queueRows.map((row) => ({
        policyId: row.policyId,
        runId: row.runId,
        status:
          row.status === "leased" &&
          (row.leaseExpiresAt ?? Number.MAX_SAFE_INTEGER) <= now
            ? ("stuck" as const)
            : row.status,
        error: undefined,
        updatedAt: row.updatedAt,
        queue: { status: row.status, leaseExpiresAt: row.leaseExpiresAt },
      })),
    ]
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
        queue: candidate.queue,
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
        candidates.length > results.length ||
        proposalResult.bounded ||
        results.length + proposalResult.issues.length > limit,
    };
  }

  if (toolName === "get_routing_status") {
    const task = typeof input.task === "string" ? input.task.trim() : undefined;
    const limit = typeof input.limit === "number" ? input.limit : 50;
    const events = task
      ? await ctx.db
          .query("modelRoutingEvents")
          .withIndex("task_time", (index) => index.eq("task", task))
          .order("desc")
          .take(limit)
      : await ctx.db
          .query("modelRoutingEvents")
          .withIndex("time")
          .order("desc")
          .take(limit);
    const settings = await ctx.db
      .query("globalModelSettings")
      .withIndex("key", (index) => index.eq("key", "default"))
      .unique();
    const counts = {
      complete: events.filter((event) => event.status === "complete").length,
      incomplete: events.filter((event) => event.status === "incomplete")
        .length,
      error: events.filter((event) => event.status === "error").length,
      fallback: events.filter(
        (event) =>
          event.kind === "direct_fallback" || event.status === "fallback",
      ).length,
    };
    return {
      task,
      counts,
      configuredRoutes: Object.keys(settings?.routes ?? {}),
      settingsUpdatedAt: settings?.updatedAt,
      recentIssues: events
        .filter(
          (event) =>
            event.status === "error" ||
            event.status === "incomplete" ||
            event.status === "fallback" ||
            event.kind === "direct_fallback",
        )
        .slice(0, 20)
        .map((event) => ({
          eventId: event._id,
          timestamp: event.timestamp,
          task: event.task,
          phase: event.phase,
          status: event.status,
          provider: event.provider,
          model: event.model,
          transport: event.transport,
          fallbackReason: event.fallbackReason,
          routerCode: event.routerCode,
          error: event.error,
        })),
      sampled: events.length,
    };
  }

  if (toolName === "get_channel_health") {
    const orgId = input.orgId
      ? normalizeOrganizationId(ctx, input.orgId)
      : undefined;
    if (orgId && !(await ctx.db.get(orgId))) {
      throw new Error("Organization not found");
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
        connections: connections.map((connection) => ({
          connectionId: connection._id,
          clientOrgId: connection.clientOrgId,
          teamName: connection.teamName,
          status: connection.status,
          healthStatus: connection.healthStatus,
          healthReason: connection.healthReason,
          lastVerifiedAt: connection.lastVerifiedAt,
        })),
        bindings: bindings.map((binding) => ({
          bindingId: binding._id,
          clientOrgId: binding.clientOrgId,
          channelName: binding.channelName,
          status: binding.status,
          healthStatus: binding.healthStatus,
          unavailableReason: binding.unavailableReason,
          lastVerifiedAt: binding.lastVerifiedAt,
        })),
        hostInstallations: hostInstalls
          .filter((installation) => installation.kind === "host")
          .map((installation) => ({
            installationId: installation._id,
            teamName: installation.teamName,
            status: installation.status,
            updatedAt: installation.updatedAt,
          })),
      },
      email: emailAccounts.map((account) => ({
        accountId: account._id,
        orgId: account.orgId,
        label: account.label,
        status: account.status,
        lastError: account.lastError,
        lastTestedAt: account.lastTestedAt,
        updatedAt: account.updatedAt,
      })),
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
    if (status === "running" || status === "paused") {
      throw new Error(
        "An extraction is already running or paused for this policy",
      );
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

  if (toolName === "update_procurement_request") {
    return await updateProcurementRequestByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      requestId: normalizeProcurementRequestId(ctx, input.procurementRequestId),
      title: typeof input.title === "string" ? input.title : undefined,
      narrative:
        typeof input.narrative === "string" ? input.narrative : undefined,
      targetEffectiveDate:
        input.targetEffectiveDate === null
          ? null
          : normalizedOptionalText(input.targetEffectiveDate),
      status: writableProcurementRequestStatus(input.status),
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
      emailThreadId: normalizeProcurementEmailThreadId(
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

  if (toolName === "create_broker_network_profile") {
    const name = normalizedOptionalText(input.name);
    if (!name) throw new Error("Broker name is required");
    return await createStandaloneBrokerByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      name,
      website: normalizedOptionalText(input.website),
      networkStatus: brokerNetworkStatus(input.networkStatus),
      officeAddress:
        input.officeAddress && typeof input.officeAddress === "object"
          ? input.officeAddress
          : undefined,
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
      writingStates: stringList(input.writingStates),
      lineOfBusinessCodes: stringList(input.lineOfBusinessCodes),
      name: normalizedOptionalText(input.name),
      website:
        input.website === null ? null : normalizedOptionalText(input.website),
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
      log: normalizedOptionalText(input.log),
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
      log: input.log === null ? null : normalizedOptionalText(input.log),
      source: "agent",
    });
  }

  if (toolName === "create_procurement_file_item") {
    return await createProcurementFileItemByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      requestId: normalizeProcurementRequestId(ctx, input.procurementRequestId),
      outreachId: input.procurementOutreachId
        ? normalizeProcurementOutreachId(ctx, input.procurementOutreachId)
        : undefined,
      clientFileId: input.clientFileId
        ? normalizeClientFileId(ctx, input.clientFileId)
        : undefined,
      purpose: procurementFilePurpose(input.purpose),
      label: typeof input.label === "string" ? input.label : "",
      status: procurementFileStatus(input.status),
      brokerRelease: procurementFileBrokerRelease(input.brokerRelease),
      clientVisible:
        typeof input.clientVisible === "boolean"
          ? input.clientVisible
          : undefined,
      notes: normalizedOptionalText(input.notes),
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
      outreachId:
        input.procurementOutreachId === null
          ? null
          : input.procurementOutreachId
            ? normalizeProcurementOutreachId(ctx, input.procurementOutreachId)
            : undefined,
      clientFileId:
        input.clientFileId === null
          ? null
          : input.clientFileId
            ? normalizeClientFileId(ctx, input.clientFileId)
            : undefined,
      purpose:
        input.purpose === undefined
          ? undefined
          : procurementFilePurpose(input.purpose),
      label: typeof input.label === "string" ? input.label : undefined,
      status: procurementFileStatus(input.status),
      brokerRelease: procurementFileBrokerRelease(input.brokerRelease),
      clientVisible:
        typeof input.clientVisible === "boolean"
          ? input.clientVisible
          : undefined,
      notes: input.notes === null ? null : normalizedOptionalText(input.notes),
      source: "agent",
    });
  }

  if (toolName === "update_procurement_email_thread") {
    return await updateProcurementEmailThreadByOperator(ctx, {
      operatorUserId: args.operatorUserId,
      emailThreadId: normalizeProcurementEmailThreadId(
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

  if (toolName === "update_organization_profile") {
    const orgId = normalizeOrganizationId(ctx, input.orgId);
    const organization = await ctx.db.get(orgId);
    if (!organization) throw new Error("Organization not found");
    const patch: {
      name?: string;
      website?: string;
      industry?: string;
      industryVertical?: string;
    } = {};
    if (input.name != null) {
      const name = normalizedOptionalText(input.name);
      if (!name) throw new Error("Organization name is required");
      patch.name = name;
    }
    if ("website" in input)
      patch.website = normalizedOptionalText(input.website);
    if ("industry" in input)
      patch.industry = normalizedOptionalText(input.industry);
    if ("industryVertical" in input) {
      patch.industryVertical = normalizedOptionalText(input.industryVertical);
    }
    await ctx.db.patch(orgId, patch);
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "setup_write",
      targetOrgId: orgId,
      summary: `Updated organization profile for ${patch.name ?? organization.name}`,
      metadata: { domain: "operator_agent", fields: Object.keys(patch) },
    });
    return { status: "updated", orgId, fields: Object.keys(patch) };
  }

  if (toolName === "set_organization_status") {
    const orgId = normalizeOrganizationId(ctx, input.orgId);
    const organization = await ctx.db.get(orgId);
    if (!organization) throw new Error("Organization not found");
    const status = input.status;
    if (status !== "onboarding" && status !== "live") {
      throw new Error("Invalid organization status");
    }
    const previous = organization.operatorStatus ?? "live";
    await ctx.db.patch(orgId, { operatorStatus: status });
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type:
        organization.type === "broker"
          ? "broker_status_changed"
          : "client_status_changed",
      targetOrgId: orgId,
      summary: `${organization.name} changed from ${previous} to ${status}`,
      metadata: { previous, next: status, domain: "operator_agent" },
    });
    return { status: "updated", orgId, previous, next: status };
  }

  if (toolName === "set_client_feature_flag") {
    const orgId = normalizeOrganizationId(ctx, input.orgId);
    const organization = await ctx.db.get(orgId);
    if (!organization || organization.type !== "client") {
      throw new Error("Client organization not found");
    }
    const flagId = input.flagId;
    if (
      flagId !== "connect_features" &&
      flagId !== "coverage_recovery_v2" &&
      flagId !== "imessage_app_cards"
    ) {
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
        table: "orgWikiSections",
      },
    );
    await ctx.scheduler.runAfter(
      0,
      internal.memoryMaintenance.clearTableBatch,
      {
        table: "conversationTurns",
      },
    );
    await writeOperatorAudit(ctx, {
      operatorUserId: args.operatorUserId,
      type: "memory_cleared",
      summary: "Scheduled company wiki and raw conversation memory purge",
      metadata: {
        domain: "operator_agent",
        tables: ["orgWikiSections", "conversationTurns"],
      },
    });
    return {
      status: "scheduled",
      tables: ["orgWikiSections", "conversationTurns"],
    };
  }

  throw new Error(`Unsupported operator tool: ${toolName}`);
}

function operatorCertificateSource(channel: OperatorChannel) {
  if (channel === "slack" || channel === "imessage" || channel === "mcp") {
    return channel;
  }
  return "agent" as const;
}

async function executeToolActionDomain(
  ctx: ActionCtx,
  args: {
    operatorUserId: Id<"users">;
    threadId: Id<"operatorAgentThreads">;
    toolName: OperatorAgentToolName;
    input: Record<string, unknown>;
    channel: OperatorChannel;
    idempotencyKey?: string;
  },
): Promise<OperatorActionToolResult> {
  if (isOperatorGoogleWorkspaceTool(args.toolName)) {
    return await ctx.runAction(
      internal.actions.operatorGoogleWorkspace.runToolInternal,
      {
        operatorUserId: args.operatorUserId,
        threadId: args.threadId,
        toolName: args.toolName,
        input: args.input,
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

  throw new Error(`Unsupported operator action tool: ${args.toolName}`);
}

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
    allowShared: true,
  });
  const spec = getOperatorAgentToolSpec(args.toolName);
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
    if (
      !args.confirmationId ||
      run.status !== "waiting_confirmation" ||
      run.checkpoint?.pendingConfirmationId !== args.confirmationId
    ) {
      throw new Error("Exact operator confirmation is required");
    }
    const confirmation = await ctx.db.get(args.confirmationId);
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
      operatorUserId: args.operatorUserId,
      threadId: args.threadId,
      channel: args.channel,
      toolName: args.toolName as OperatorAgentToolName,
      input,
    });
    await ctx.db.patch(auditId, {
      status: "succeeded",
      output: boundedJson(result),
      error: undefined,
      updatedAt: dayjs().valueOf(),
    });
    return { status: "succeeded" as const, result, idempotent: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ctx.db.patch(auditId, {
      status: "failed",
      error: message.slice(0, 1_000),
      updatedAt: dayjs().valueOf(),
    });
    return { status: "failed" as const, error: message };
  }
}

export const listThreads = query({
  args: {
    limit: v.optional(v.number()),
    archived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const limit = Math.max(1, Math.min(args.limit ?? 50, 100));
    const archived = args.archived === true;
    const [owned, shared] = await Promise.all([
      ctx.db
        .query("operatorAgentThreads")
        .withIndex("owner_archive", (index) =>
          index
            .eq("ownerUserId", operator.userId)
            .eq("archiveState", archived ? "archived" : undefined),
        )
        .order("desc")
        .take(limit),
      ctx.db
        .query("operatorAgentThreads")
        .withIndex("visibility_archive", (index) =>
          index
            .eq("visibility", "shared")
            .eq("archiveState", archived ? "archived" : undefined),
        )
        .order("desc")
        .take(limit),
    ]);
    return [
      ...new Map(
        [...owned, ...shared].map((thread) => [thread._id, thread]),
      ).values(),
    ]
      .sort((left, right) => right.lastMessageAt - left.lastMessageAt)
      .slice(0, limit);
  },
});

export const archiveThread = mutation({
  args: { threadId: v.id("operatorAgentThreads") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await requireOperatorThread(ctx, args.threadId, operator.userId, {
      allowShared: true,
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
      allowShared: true,
    });
    await ctx.db.patch(args.threadId, {
      archivedAt: undefined,
      archiveState: undefined,
      updatedAt: dayjs().valueOf(),
    });
    return { restored: true };
  },
});

export const getThread = query({
  args: { threadId: v.id("operatorAgentThreads") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const thread = await requireOperatorThread(
      ctx,
      args.threadId,
      operator.userId,
      { allowShared: true },
    );
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
        .take(25),
      ctx.db
        .query("operatorAgentConfirmations")
        .withIndex("thread", (index) => index.eq("threadId", args.threadId))
        .order("desc")
        .take(500)
        .then((items) => items.reverse()),
    ]);
    const activeRun =
      runs.find((run) => ACTIVE_RUN_STATUSES.has(run.status)) ?? null;
    const now = dayjs().valueOf();
    const visibleMessageIds = new Set(messages.map((message) => message._id));
    return {
      thread,
      messages,
      activeRun,
      recentRuns: runs,
      confirmations: confirmations
        .filter((confirmation) =>
          visibleMessageIds.has(confirmation.promptMessageId),
        )
        .map((confirmation) => {
          const actionable =
            confirmation.status === "pending" &&
            confirmation.operatorUserId === operator.userId &&
            confirmation.expiresAt > now &&
            activeRun?.status === "waiting_confirmation" &&
            activeRun.checkpoint?.pendingConfirmationId === confirmation._id;
          return {
            _id: confirmation._id,
            promptMessageId: confirmation.promptMessageId,
            summary: confirmation.payload.summary,
            toolName: confirmation.payload.toolName,
            effect: confirmation.payload.effect,
            state: operatorConfirmationDisplayState(confirmation, now),
            actionable,
            expiresAt: confirmation.expiresAt,
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
    pageContext: v.optional(pageContextValidator),
    emptyThreadId: v.optional(v.id("operatorAgentThreads")),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const emptyThread = args.emptyThreadId
      ? await findEmptyChatThread(ctx, args.emptyThreadId, operator.userId)
      : null;
    const pageContext =
      emptyThread?.initialContext ??
      normalizeOperatorPageContext(args.pageContext);
    const intent = resolveOperatorAgentIntent(args.intentId, pageContext);

    let threadId: Id<"operatorAgentThreads">;
    if (emptyThread) {
      threadId = emptyThread._id;
      await ctx.db.patch(threadId, {
        title: normalizeOperatorThreadTitle(intent.label),
        updatedAt: dayjs().valueOf(),
      });
    } else {
      threadId = await insertOperatorThread(ctx, {
        operatorUserId: operator.userId,
        channel: "chat",
        title: intent.label,
        initialContext: pageContext,
      });
    }

    const result = await enqueueOperatorMessage(ctx, {
      operatorUserId: operator.userId,
      threadId,
      channel: "chat",
      content: intent.objective,
      pageContext,
      toolArtifacts: [
        {
          type: "operator_intent",
          data: { id: intent.id, version: intent.version },
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
    for (const upload of args.uploads.slice(0, 10)) {
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
    for (const fileId of args.fileIds.slice(0, MAX_AGENT_ATTACHMENT_FILES)) {
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
      allowShared: true,
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
    });
    return { threadId, ...result };
  },
});

export const cancelRun = mutation({
  args: { threadId: v.id("operatorAgentThreads") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await requireOperatorThread(ctx, args.threadId, operator.userId, {
      allowShared: true,
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

async function expireOperatorConfirmation(
  ctx: MutationCtx,
  confirmation: Doc<"operatorAgentConfirmations">,
  now: number,
  channel: OperatorChannel,
) {
  if (confirmation.status !== "pending" || confirmation.expiresAt > now) {
    return false;
  }

  await ctx.db.patch(confirmation._id, {
    status: "expired",
    completedAt: now,
    updatedAt: now,
  });

  const ledger = await ctx.db
    .query("agentActionAuditEvents")
    .withIndex("idempotency", (index) =>
      index
        .eq("operatorUserId", confirmation.operatorUserId)
        .eq("idempotencyKey", confirmation.payload.idempotencyKey),
    )
    .unique();
  if (
    ledger?.operatorConfirmationId === confirmation._id &&
    ledger.status === "awaiting_confirmation"
  ) {
    await ctx.db.patch(ledger._id, {
      status: "cancelled",
      error: "Operator confirmation expired",
      updatedAt: now,
    });
  }

  const run = await ctx.db.get(confirmation.payload.runId);
  if (
    !run ||
    run.operatorUserId !== confirmation.operatorUserId ||
    run.threadId !== confirmation.threadId ||
    !ACTIVE_RUN_STATUSES.has(run.status)
  ) {
    return true;
  }

  const content = `Confirmation expired: ${confirmation.payload.summary}.`;
  await ctx.db.patch(run._id, {
    status: "completed",
    completedAt: now,
    checkpoint: {
      iteration: run.checkpoint?.iteration ?? 0,
      executionCount: run.checkpoint?.executionCount ?? 0,
      summary: "Operator confirmation expired",
      lastToolName: run.checkpoint?.lastToolName,
    },
    updatedAt: now,
  });
  await ctx.db.insert("operatorAgentMessages", {
    threadId: confirmation.threadId,
    ownerUserId: confirmation.operatorUserId,
    channel,
    role: "agent",
    content,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.patch(confirmation.threadId, {
    lastMessageAt: now,
    updatedAt: now,
  });
  return true;
}

export const expireConfirmationInternal = internalMutation({
  args: {
    confirmationId: v.id("operatorAgentConfirmations"),
    channel: operatorChannelValidator,
  },
  handler: async (ctx, args) => {
    const confirmation = await ctx.db.get(args.confirmationId);
    if (!confirmation || confirmation.status !== "pending") {
      return { expired: false as const };
    }
    const now = dayjs().valueOf();
    if (confirmation.expiresAt > now) {
      await ctx.scheduler.runAt(
        confirmation.expiresAt,
        internal.operatorAgent.expireConfirmationInternal,
        args,
      );
      return { expired: false as const };
    }
    const expired = await expireOperatorConfirmation(
      ctx,
      confirmation,
      now,
      args.channel,
    );
    return { expired };
  },
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
    { allowShared: true },
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
  if (confirmation.expiresAt <= now) {
    const content = `Confirmation expired: ${payload.summary}.`;
    await expireOperatorConfirmation(ctx, confirmation, now, channel);
    return { status: "expired" as const, runId: run._id, content };
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

  await ctx.db.patch(confirmation._id, {
    status: "completed",
    completedAt: now,
    updatedAt: now,
  });
  const parsedInput = JSON.parse(payload.input) as unknown;
  const spec = getOperatorAgentToolSpec(payload.toolName);
  assertOperatorRole(operator.profile.role, spec.requiredRole);
  if (spec.execution === "action") {
    const input = parseOperatorAgentToolInput(payload.toolName, parsedInput);
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
  const succeeded = result.status === "succeeded";
  if (succeeded && run.executionKind === "goal") {
    const toolCall = {
      name: payload.toolName,
      input: boundedJson(parsedInput, 500),
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
        iteration: run.checkpoint?.iteration ?? 0,
        executionCount: (run.checkpoint?.executionCount ?? 0) + 1,
        summary: buildOperatorRunCheckpointSummary({
          previous: run.checkpoint?.summary,
          audit: {
            usedTools: [payload.toolName],
            completedTools: [payload.toolName],
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
      content: `Confirmed: ${payload.summary}. Continuing the operator task.`,
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
        input: boundedJson(parsedInput, 500),
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

export const validateConfirmedActionToolExecutionInternal = internalQuery({
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
    await requireOperatorForUser(ctx, run.operatorUserId);
    const thread = await requireOperatorThread(
      ctx,
      run.threadId,
      run.operatorUserId,
      {
        allowShared: true,
      },
    );
    if (run.status !== "running" || run.cancellationRequestedAt) {
      throw new Error("Operator agent run is no longer active");
    }
    const payload = confirmation.payload;
    const spec = getOperatorAgentToolSpec(payload.toolName);
    if (spec.execution !== "action" || spec.confirmation !== "exact") {
      throw new Error("Confirmed operator tool is not action-backed");
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
      : { status: "failed" as const, error };
    await ctx.db.patch(ledger._id, {
      status: succeeded ? "succeeded" : "failed",
      output: succeeded ? boundedJson(args.result) : ledger.output,
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

    const toolCall = {
      name: payload.toolName,
      input: boundedJson(JSON.parse(payload.input), 500),
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
    if (!succeeded) {
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
          iteration: run.checkpoint?.iteration ?? 0,
          executionCount: (run.checkpoint?.executionCount ?? 0) + 1,
          summary: buildOperatorRunCheckpointSummary({
            previous: run.checkpoint?.summary,
            audit: {
              usedTools: [payload.toolName],
              completedTools: [payload.toolName],
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

export const executeConfirmedActionToolInternal = internalAction({
  args: {
    runId: v.id("operatorAgentRuns"),
    confirmationId: v.id("operatorAgentConfirmations"),
  },
  handler: async (ctx, args): Promise<unknown> => {
    try {
      const execution = await ctx.runQuery(
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
        { ...args, error: message },
      );
    }
  },
});

export const getPendingConfirmationInternal = internalQuery({
  args: {
    operatorUserId: v.id("users"),
    threadId: v.id("operatorAgentThreads"),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    await requireOperatorThread(ctx, args.threadId, args.operatorUserId, {
      allowShared: true,
    });
    const confirmation = await ctx.db
      .query("operatorAgentConfirmations")
      .withIndex("thread_status", (index) =>
        index.eq("threadId", args.threadId).eq("status", "pending"),
      )
      .order("desc")
      .first();
    if (
      !confirmation ||
      confirmation.operatorUserId !== args.operatorUserId ||
      confirmation.expiresAt <= dayjs().valueOf()
    ) {
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
  channel: v.union(v.literal("slack"), v.literal("imessage"), v.literal("mcp")),
  conversationKey: v.string(),
  title: v.optional(v.string()),
  shared: v.optional(v.boolean()),
};

async function createOrGetChannelThread(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    channel: "slack" | "imessage" | "mcp";
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

export const getSlackThreadTitleContextInternal = internalQuery({
  args: {
    threadId: v.id("operatorAgentThreads"),
    expectedTitle: v.string(),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (
      !thread ||
      thread.channel !== "slack" ||
      thread.title !== args.expectedTitle
    ) {
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
      internal.actions.threadTitle.generateOperatorSlack,
      args,
    );
    return true;
  },
});

export const updateSlackThreadTitleInternal = internalMutation({
  args: {
    threadId: v.id("operatorAgentThreads"),
    expectedTitle: v.string(),
    title: v.string(),
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

export const getRunResultForOperatorInternal = internalQuery({
  args: {
    operatorUserId: v.id("users"),
    runId: v.id("operatorAgentRuns"),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    const run = await ctx.db.get(args.runId);
    if (!run || run.operatorUserId !== args.operatorUserId) {
      throw new Error("Operator agent run not found");
    }
    await requireOperatorThread(ctx, run.threadId, args.operatorUserId, {
      allowShared: true,
    });
    const response = await ctx.db.get(run.agentMessageId);
    return {
      run,
      response: response
        ? {
            messageId: response._id,
            content: response.content,
            status: response.status,
            attachments: response.attachments,
            usedTools: response.usedTools,
            toolCalls: response.toolCalls,
          }
        : undefined,
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
      if (!organization || organization.type !== "client") {
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
    if (!organization || organization.type !== "client") {
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
      allowShared: true,
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
        allowShared: true,
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
      threadId =
        existingThread?._id ??
        (await insertOperatorThread(ctx, {
          operatorUserId: args.operatorUserId,
          channel: args.channel,
          title: "Operator API",
          conversationKey,
        }));
    }

    const now = dayjs().valueOf();
    const userMessageId = await ctx.db.insert("operatorAgentMessages", {
      threadId,
      ownerUserId: args.operatorUserId,
      dedupeKey: `operator-tool:${idempotencyKey}`,
      channel: args.channel,
      role: "user",
      userId: args.operatorUserId,
      userName: "Operator API",
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
      allowShared: true,
    });
    const spec = getOperatorAgentToolSpec(args.toolName);
    assertOperatorRole(operator.profile.role, spec.requiredRole);
    if (
      spec.execution !== "action" ||
      spec.confirmation !== "none" ||
      spec.effect !== "read"
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
          result: parseStoredOutput(existing.output),
          idempotent: true,
        };
      }
      throw new Error("Operator action is already in progress");
    }
    if (run.status !== "running" || run.cancellationRequestedAt) {
      throw new Error("Operator agent run is no longer active");
    }
    const target = spec.target(input);
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
    return { status: "execute" as const, auditId, input };
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
      });
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
        result: output.result,
        idempotent: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(
        internal.operatorAgent.finishUnconfirmedActionToolInternal,
        { auditId: prepared.auditId, error: message },
      );
      return { status: "failed" as const, error: message };
    }
  },
});

export const invokeRegisteredToolInternal = internalAction({
  args: {
    operatorUserId: v.id("users"),
    threadId: v.optional(v.id("operatorAgentThreads")),
    conversationKey: v.optional(v.string()),
    channel: operatorChannelValidator,
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
          ? await ctx.runMutation(
              internal.operatorAgent.requestToolConfirmationInternal,
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
      outcome = {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
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
            input: boundedJson(input, 500),
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
    await requireOperatorForUser(ctx, run.operatorUserId);
    const thread = await requireOperatorThread(
      ctx,
      run.threadId,
      run.operatorUserId,
      { allowShared: true },
    );
    const messages = await ctx.db
      .query("operatorAgentMessages")
      .withIndex("thread", (index) => index.eq("threadId", run.threadId))
      .order("desc")
      .take(96);
    return { run, thread, messages: messages.reverse() };
  },
});

export const searchThreadHistoryInternal = internalQuery({
  args: {
    operatorUserId: v.id("users"),
    threadId: v.id("operatorAgentThreads"),
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    await requireOperatorThread(ctx, args.threadId, args.operatorUserId, {
      allowShared: true,
    });
    const limit = Math.max(1, Math.min(args.limit ?? 5, 8));
    const messages = await ctx.db
      .query("operatorAgentMessages")
      .withSearchIndex("content", (index) =>
        index.search("content", args.query).eq("threadId", args.threadId),
      )
      .take(limit);
    return messages.map((message) => ({
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
    }));
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
      allowShared: true,
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

export const markRunStartedInternal = internalMutation({
  args: { runId: v.id("operatorAgentRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== "queued" || run.cancellationRequestedAt) {
      return false;
    }
    await requireOperatorForUser(ctx, run.operatorUserId);
    const now = dayjs().valueOf();
    await ctx.db.patch(run._id, {
      status: "running",
      startedAt: run.startedAt ?? now,
      updatedAt: now,
    });
    return true;
  },
});

export const requestToolConfirmationInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    runId: v.id("operatorAgentRuns"),
    threadId: v.id("operatorAgentThreads"),
    threadMessageId: v.id("operatorAgentMessages"),
    toolName: v.string(),
    input: v.any(),
    inputHash: v.string(),
    idempotencyKey: v.string(),
    channel: operatorChannelValidator,
  },
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
      allowShared: true,
    });
    const spec = getOperatorAgentToolSpec(args.toolName);
    assertOperatorRole(operator.profile.role, spec.requiredRole);
    if (spec.confirmation !== "exact" || spec.effect === "read") {
      throw new Error("This tool does not use exact confirmation");
    }
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
        const now = dayjs().valueOf();
        if (
          confirmation &&
          (await expireOperatorConfirmation(
            ctx,
            confirmation,
            now,
            args.channel,
          ))
        ) {
          return {
            status: "failed" as const,
            error:
              "Operator confirmation expired; retry with a new idempotency key",
          };
        }
        if (
          !confirmation ||
          confirmation.status !== "pending" ||
          run.cancellationRequestedAt ||
          run.status !== "waiting_confirmation" ||
          run.checkpoint?.pendingConfirmationId !== confirmation._id
        ) {
          return {
            status: "failed" as const,
            error:
              "Operator confirmation is no longer active; retry with a new idempotency key",
          };
        }
        return {
          status: "confirmation_required" as const,
          confirmationId: confirmation._id,
          summary: confirmation.payload.summary,
        };
      }
      return {
        status: "failed" as const,
        error:
          existing.status === "pending"
            ? "Operator action is already in progress"
            : `Operator action is ${existing.status}; retry with a new idempotency key`,
      };
    }
    if (run.cancellationRequestedAt || run.status !== "running") {
      throw new Error("Operator agent run is no longer active");
    }
    const now = dayjs().valueOf();
    const pendingConfirmations = await ctx.db
      .query("operatorAgentConfirmations")
      .withIndex("thread_status", (index) =>
        index.eq("threadId", args.threadId).eq("status", "pending"),
      )
      .take(25);
    let blockingConfirmation: Doc<"operatorAgentConfirmations"> | null = null;
    for (const confirmation of pendingConfirmations) {
      const expired = await expireOperatorConfirmation(
        ctx,
        confirmation,
        now,
        args.channel,
      );
      if (!expired && !blockingConfirmation) {
        blockingConfirmation = confirmation;
      }
    }
    if (blockingConfirmation) {
      return {
        status: "blocked_by_confirmation" as const,
        confirmationId: blockingConfirmation._id,
        runId: blockingConfirmation.payload.runId,
        summary: blockingConfirmation.payload.summary,
        expiresAt: blockingConfirmation.expiresAt,
      };
    }
    try {
      await preflightOperatorToolConfirmation(ctx, {
        operatorUserId: args.operatorUserId,
        threadId: args.threadId,
        toolName: args.toolName as OperatorAgentToolName,
        input,
      });
    } catch (error) {
      return {
        status: "failed" as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const target = spec.target(input);
    const inputJson = JSON.stringify(input);
    const summary = await operatorDisplaySummary(
      ctx,
      spec.summarize(input),
      input,
    );
    const expiresAt = dayjs(now).add(10, "minute").valueOf();
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
        idempotencyKey: args.idempotencyKey,
        capability: spec.capability,
        effect: spec.effect,
        requiredRole: spec.requiredRole,
        targetKind: target.kind,
        targetId: target.id,
        summary,
      },
      status: "pending",
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAt(
      expiresAt,
      internal.operatorAgent.expireConfirmationInternal,
      { confirmationId, channel: args.channel },
    );
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
      status: "awaiting_confirmation",
      createdAt: now,
      updatedAt: now,
    });
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
        iteration: (run.checkpoint?.iteration ?? 0) + 1,
        executionCount: (run.checkpoint?.executionCount ?? 0) + 1,
        summary: run.checkpoint?.summary,
        lastToolName: args.toolName,
        pendingConfirmationId: confirmationId,
      },
      updatedAt: now,
    });
    return {
      status: "confirmation_required" as const,
      confirmationId,
      summary,
    };
  },
});

export const executeToolInternal = internalMutation({
  args: {
    ...operatorToolExecutionArgs,
    confirmationId: v.optional(v.id("operatorAgentConfirmations")),
  },
  handler: executeOperatorTool,
});

export const completeRunInternal = internalMutation({
  args: {
    runId: v.id("operatorAgentRuns"),
    content: v.string(),
    routerRequestId: v.optional(v.string()),
    usedTools: v.array(v.string()),
    toolCalls: v.array(
      v.object({
        name: v.string(),
        input: v.optional(v.string()),
        output: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    const now = dayjs().valueOf();
    if (run.status === "cancelled" || run.cancellationRequestedAt) {
      return { status: "cancelled" as const };
    }
    const waiting = run.status === "waiting_confirmation";
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
      status: undefined,
      routerRequestId: args.routerRequestId,
      usedTools: usedTools.length > 0 ? usedTools : undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      updatedAt: now,
    });
    await ctx.db.patch(run.threadId, { lastMessageAt: now, updatedAt: now });
    if (!waiting) {
      await ctx.db.patch(run._id, {
        status: "completed",
        completedAt: now,
        checkpoint: {
          iteration: (run.checkpoint?.iteration ?? 0) + 1,
          executionCount:
            (run.checkpoint?.executionCount ?? 0) + args.toolCalls.length,
          summary: args.content.slice(0, 1_000),
          lastToolName: args.usedTools.at(-1),
        },
        updatedAt: now,
      });
    }
    return {
      status: waiting
        ? ("waiting_confirmation" as const)
        : ("completed" as const),
    };
  },
});

export const continueRunInternal = internalMutation({
  args: {
    runId: v.id("operatorAgentRuns"),
    summary: v.string(),
    usedTools: v.array(v.string()),
    toolCalls: v.array(
      v.object({
        name: v.string(),
        input: v.optional(v.string()),
        output: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    if (run.status === "waiting_confirmation") {
      return { status: "waiting_confirmation" as const };
    }
    if (run.status !== "running" || run.cancellationRequestedAt) {
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
    await ctx.db.patch(run._id, {
      status: "queued",
      checkpoint: {
        iteration: (run.checkpoint?.iteration ?? 0) + 1,
        executionCount:
          (run.checkpoint?.executionCount ?? 0) + args.toolCalls.length,
        summary: args.summary.slice(-6_000),
        lastToolName: args.usedTools.at(-1),
      },
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.operatorAgentRunner.run, {
      runId: run._id,
    });
    return { status: "queued" as const };
  },
});

export const failRunInternal = internalMutation({
  args: { runId: v.id("operatorAgentRuns"), error: v.string() },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return;
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
    await ctx.db.patch(run._id, {
      status: "failed",
      lastError: args.error.slice(0, 1_000),
      completedAt: now,
      checkpoint: run.checkpoint
        ? {
            iteration: run.checkpoint.iteration,
            executionCount: run.checkpoint.executionCount,
            summary: "Operator run failed",
            lastToolName: run.checkpoint.lastToolName,
          }
        : undefined,
      updatedAt: now,
    });
    await ctx.db.patch(run.agentMessageId, {
      content: "I couldn't complete that operator task.",
      status: "error",
      error: args.error.slice(0, 1_000),
      updatedAt: now,
    });
    await ctx.db.patch(run.threadId, { lastMessageAt: now, updatedAt: now });
  },
});

export const recordImessageAttachmentDeliveryFailureInternal = internalMutation(
  {
    args: {
      operatorMessageId: v.id("operatorAgentMessages"),
      stage: v.union(v.literal("url_resolution"), v.literal("worker_delivery")),
      failures: v.array(
        v.object({
          filename: v.string(),
          error: v.optional(v.string()),
        }),
      ),
    },
    handler: async (ctx, args) => {
      const message = await ctx.db.get(args.operatorMessageId);
      if (
        !message ||
        message.channel !== "imessage" ||
        message.role !== "agent"
      ) {
        return false;
      }
      const existingArtifacts = message.toolArtifacts ?? [];
      const existingKeys = new Set(
        existingArtifacts.flatMap((artifact) => {
          if (artifact.type !== "imessage_attachment_delivery") return [];
          const data = artifact.data as {
            stage?: unknown;
            failures?: Array<{ filename?: unknown }>;
          };
          if (data.stage !== args.stage || !Array.isArray(data.failures)) {
            return [];
          }
          return data.failures.flatMap((failure) =>
            typeof failure.filename === "string"
              ? [`${args.stage}:${failure.filename.trim().toLowerCase()}`]
              : [],
          );
        }),
      );
      const failures = args.failures.flatMap((failure) => {
        const filename = failure.filename.trim();
        if (!filename) return [];
        const key = `${args.stage}:${filename.toLowerCase()}`;
        if (existingKeys.has(key)) return [];
        const error = failure.error?.trim();
        return [{ filename, ...(error ? { error } : {}) }];
      });
      if (failures.length === 0) return false;
      const names = failures
        .slice(0, 3)
        .map((failure) => `“${failure.filename.replace(/[“”"]/g, "'")}”`)
        .join(", ");
      const notice = `Attachment delivery update: ${names || "the attachment"} did not attach in iMessage. Open this operator thread in the portal to access the preserved file.`;
      const now = dayjs().valueOf();
      await ctx.db.patch(message._id, {
        content: message.content.includes(notice)
          ? message.content
          : `${message.content.trim()}\n\n${notice}`.trim(),
        toolArtifacts: [
          ...existingArtifacts.slice(-24),
          {
            type: "imessage_attachment_delivery",
            data: { status: "failed", stage: args.stage, failures },
          },
        ],
        updatedAt: now,
      });
      return true;
    },
  },
);
