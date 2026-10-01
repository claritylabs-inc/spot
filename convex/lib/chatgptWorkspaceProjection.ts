/**
 * Small, version-stable display projection for the ChatGPT workspace.
 *
 * Tool executors remain the authorization boundary. This module is a second
 * boundary: it prevents an accidentally broad executor result from becoming
 * part of the external workspace contract.
 */

export type WorkspacePrincipalKind = "client" | "broker" | "operator";

const MAX_DEPTH = 12;
const MAX_ITEMS = 512;
const MAX_ARRAY_ITEMS = 100;
const MAX_STRING_LENGTH = 20_000;

const BROKER_VIEWS = new Set(["profile", "team", "settings"]);

// These fields are intentionally shared by the existing MCP DTOs and the
// display projections. Names not in this set are dropped unless they are an
// ID/citation/action/revision field or belong to a coverage map.
const COMMON_DISPLAY_FIELDS = new Set(
  [
    "_id",
    "id",
    "orgId",
    "org_id",
    "organizationId",
    "organization_id",
    "clientOrgId",
    "client_org_id",
    "brokerOrgId",
    "broker_org_id",
    "policyId",
    "policy_id",
    "policyVersionId",
    "policy_version_id",
    "certificateId",
    "certificate_id",
    "certificateVersionId",
    "certificate_version_id",
    "holderId",
    "holder_id",
    "requestId",
    "request_id",
    "procurementRequestId",
    "procurement_request_id",
    "fileId",
    "file_id",
    "clientFileId",
    "client_file_id",
    "fileItemId",
    "file_item_id",
    "threadId",
    "thread_id",
    "messageId",
    "message_id",
    "runId",
    "run_id",
    "jobId",
    "job_id",
    "actionId",
    "action_id",
    "confirmationId",
    "confirmation_id",
    "sourceDocumentId",
    "source_document_id",
    "sourceNodeIds",
    "source_node_ids",
    "sourceSpanIds",
    "source_span_ids",
    "sourceRef",
    "source_ref",
    "sourceRefs",
    "source_refs",
    "sourceUrl",
    "source_url",
    "sourceUrls",
    "source_urls",
    "citation",
    "citations",
    "evidence",
    "evidenceText",
    "evidence_text",
    "quote",
    "page",
    "pageNumber",
    "page_number",
    "pageStart",
    "page_start",
    "pageEnd",
    "page_end",
    "confidence",
    "revision",
    "revisionId",
    "revision_id",
    "version",
    "versionNumber",
    "version_number",
    "createdAt",
    "created_at",
    "updatedAt",
    "updated_at",
    "issuedAt",
    "issued_at",
    "supersededAt",
    "superseded_at",
    "voidedAt",
    "voided_at",
    "status",
    "state",
    "kind",
    "type",
    "title",
    "name",
    "displayName",
    "display_name",
    "label",
    "description",
    "summary",
    "message",
    "body",
    "text",
    "content",
    "source",
    "carrier",
    "insured",
    "insuredName",
    "insured_name",
    "policyNumber",
    "policy_number",
    "policyTypes",
    "policy_types",
    "linesOfBusiness",
    "lines_of_business",
    "lineOfBusiness",
    "line_of_business",
    "policyYear",
    "policy_year",
    "effectiveDate",
    "effective_date",
    "expirationDate",
    "expiration_date",
    "premium",
    "isRenewal",
    "is_renewal",
    "pipelineStatus",
    "pipeline_status",
    "extractionDataStage",
    "extraction_data_stage",
    "provisional",
    "networkStatus",
    "network_status",
    "writingStates",
    "writing_states",
    "lineOfBusinessCodes",
    "line_of_business_codes",
    "officeAddress",
    "office_address",
    "contacts",
    "members",
    "memberCount",
    "member_count",
    "contactName",
    "contact_name",
    "email",
    "phone",
    "role",
    "website",
    "websiteTitle",
    "website_title",
    "address",
    "formatted",
    "street1",
    "street2",
    "city",
    "state",
    "postalCode",
    "postal_code",
    "zip",
    "country",
    "team",
    "profile",
    "brokerProfile",
    "broker_profile",
    "organizations",
    "organization",
    "policies",
    "certificates",
    "requirements",
    "compliance",
    "requests",
    "files",
    "file",
    "fileName",
    "file_name",
    "originalName",
    "original_name",
    "contentType",
    "content_type",
    "size",
    "uploadedBySide",
    "uploaded_by_side",
    "clientVisible",
    "client_visible",
    "brokerRelease",
    "broker_release",
    "release",
    "attachments",
    "attachmentIds",
    "attachment_ids",
    "attachmentCount",
    "attachment_count",
    "subject",
    "from",
    "to",
    "cc",
    "snippet",
    "sentAt",
    "sent_at",
    "receivedAt",
    "received_at",
    "packet",
    "sections",
    "company",
    "companyResearch",
    "company_research",
    "profileFacts",
    "profile_facts",
    "operationsDescription",
    "operations_description",
    "mailbox",
    "messages",
    "threads",
    "activity",
    "settings",
    "chatEmailNotifications",
    "chat_email_notifications",
    "bccRequesterOnAgentEmails",
    "bcc_requester_on_agent_emails",
    "emailSendDelay",
    "email_send_delay",
    "integrations",
    "mailboxes",
    "data",
    "result",
    "items",
    "records",
    "total",
    "count",
    "nextAction",
    "next_action",
    "nextActions",
    "next_actions",
    "action",
    "actions",
    "tool",
    "why",
    "reason",
    "reasons",
    "matchedPolicyIds",
    "matched_policy_ids",
    "matchedPolicy",
    "matched_policy",
    "matchedSummary",
    "matched_summary",
    "met",
    "satisfied",
    "missing",
    "uncertain",
    "bounded",
    "expiresAt",
    "expires_at",
    "daysUntilExpiration",
    "days_until_expiration",
    "completionOutcome",
    "completion_outcome",
    "resultingPolicy",
    "resulting_policy",
    "publicMarkdown",
    "public_markdown",
    "markdown",
    "currentComplianceStatus",
    "current_compliance_status",
    "currentComplianceReasons",
    "current_compliance_reasons",
    "requiredLimits",
    "required_limits",
    "requiredProvisions",
    "required_provisions",
    "coverage",
    "coverages",
    "coverageBreakdown",
    "coverage_breakdown",
    "limits",
    "limit",
    "limitAmount",
    "limit_amount",
    "deductible",
    "forms",
    "provisions",
    "conditions",
    "subjectivities",
    "exclusions",
    "endorsements",
    "documents",
    "reviews",
    "findings",
    "conclusion",
    "modelConclusion",
    "model_conclusion",
    "staffConclusion",
    "staff_conclusion",
    "extractionFingerprint",
    "extraction_fingerprint",
    "packetRevision",
    "packet_revision",
    "proposalDocumentId",
    "proposal_document_id",
    "proposalMarkdown",
    "proposal_markdown",
    "extractedOffer",
    "extracted_offer",
    "quoteNumber",
    "quote_number",
    "proposedEffectiveDate",
    "proposed_effective_date",
    "quoteExpirationDate",
    "quote_expiration_date",
    "privateMarkdown",
    "private_markdown",
  ].map((field) => field.toLowerCase().replaceAll("_", "")),
);

const CLIENT_PRIVATE_FIELDS = new Set([
  "private",
  "privatemd",
  "privatemarkdown",
  "operatorprivate",
  "internalnotes",
  "proposal",
  "proposals",
  "procurementproposal",
  "procurementproposals",
  "market",
  "marketactivity",
  "brokeroutreach",
  "outreach",
  "outreaches",
]);

const COVERAGE_FIELD = /^(?:coverage|coverages|coveragebreakdown|limits?|requiredlimits|requiredprovisions|provisions|conditions|subjectivities|exclusions|endorsements|declarations?)$/i;

function normalizedKey(key: string) {
  return key.toLowerCase().replace(/[\s_-]/g, "");
}

function isCredentialOrStorageField(key: string) {
  const normalized = normalizedKey(key);
  return (
    /(?:secret|password|credential|privatekey|apikey|encrypted|accesskey)/i.test(
      normalized,
    ) ||
    normalized === "token" ||
    normalized.endsWith("token") ||
    normalized === "storageurl" ||
    normalized === "signedurl" ||
    normalized === "downloadurl" ||
    normalized === "fileurl" ||
    normalized === "iconurl"
  );
}

function isClientPrivateField(key: string) {
  return CLIENT_PRIVATE_FIELDS.has(normalizedKey(key));
}

function isDurableOrEvidenceField(key: string) {
  const normalized = normalizedKey(key);
  return (
    normalized === "id" ||
    normalized.endsWith("id") ||
    normalized.includes("citation") ||
    normalized.includes("evidence") ||
    normalized.includes("source") ||
    normalized.includes("revision") ||
    normalized.includes("version") ||
    normalized.includes("action") ||
    normalized.includes("confirmation")
  );
}

function isAllowedField(key: string, principalKind: WorkspacePrincipalKind) {
  const normalized = normalizedKey(key);
  if (isCredentialOrStorageField(key)) return false;
  if (principalKind !== "operator" && isClientPrivateField(key)) return false;
  if (COMMON_DISPLAY_FIELDS.has(normalized)) return true;
  return isDurableOrEvidenceField(key);
}

type ProjectionBudget = { remaining: number; bounded: boolean };

function projectCoverageValue(
  value: unknown,
  principalKind: WorkspacePrincipalKind,
  budget: ProjectionBudget,
  depth: number,
): unknown {
  if (depth > MAX_DEPTH || budget.remaining-- <= 0) {
    budget.bounded = true;
    return undefined;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    if (value.length <= MAX_STRING_LENGTH) return value;
    budget.bounded = true;
    return value.slice(0, MAX_STRING_LENGTH);
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) budget.bounded = true;
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => projectCoverageValue(item, principalKind, budget, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (!value || typeof value !== "object") return undefined;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      if (isCredentialOrStorageField(key)) return [];
      if (principalKind !== "operator" && isClientPrivateField(key)) return [];
      const projected = projectCoverageValue(item, principalKind, budget, depth + 1);
      return projected === undefined ? [] : [[key, projected]];
    }),
  );
}

function projectValue(
  value: unknown,
  view: string,
  principalKind: WorkspacePrincipalKind,
  budget: ProjectionBudget,
  depth = 0,
): unknown {
  if (depth > MAX_DEPTH || budget.remaining-- <= 0) {
    budget.bounded = true;
    return undefined;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    if (value.length <= MAX_STRING_LENGTH) return value;
    budget.bounded = true;
    return value.slice(0, MAX_STRING_LENGTH);
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) budget.bounded = true;
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => projectValue(item, view, principalKind, budget, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (!value || typeof value !== "object") return undefined;

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      if (!isAllowedField(key, principalKind)) return [];
      if (view === "company" && normalizedKey(key) === "markdown") return [];
      if (COVERAGE_FIELD.test(key)) {
        const projected = projectCoverageValue(item, principalKind, budget, depth + 1);
        return projected === undefined ? [] : [[key, projected]];
      }
      const projected = projectValue(item, view, principalKind, budget, depth + 1);
      return projected === undefined ? [] : [[key, projected]];
    }),
  );
}

/**
 * Parse the result shape emitted by MCP CallToolResult/mcpTextResult.
 * Error envelopes are intentionally represented as null so callers cannot
 * accidentally project an error's diagnostic payload as workspace data.
 */
export function parseMcpToolResult(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const envelope = result as Record<string, unknown>;
  if (envelope.isError === true) return null;
  if (envelope.structuredContent !== undefined) return envelope.structuredContent;
  if (!Array.isArray(envelope.content)) return result;

  const textParts = envelope.content.flatMap((part) => {
    if (!part || typeof part !== "object") return [];
    const text = (part as Record<string, unknown>).text;
    return typeof text === "string" ? [text] : [];
  });
  if (!textParts.length) return null;
  if (textParts.length === 1) {
    const text = textParts[0]!.trim();
    if (!text) return "";
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return textParts.join("\n");
}

/**
 * Return a version-stable, allowlisted display DTO for one workspace view.
 * The caller must already have selected an authorized executor and tenant.
 */
export function projectSpotWorkspaceData(
  view: string,
  value: unknown,
  principalKind: WorkspacePrincipalKind,
): unknown {
  const normalizedView = view.trim().toLowerCase().replace(/[\s_-]/g, "");
  if (principalKind === "broker" && !BROKER_VIEWS.has(normalizedView)) return null;
  const parsed = parseMcpToolResult(value);
  if (parsed === null) return null;
  const budget: ProjectionBudget = { remaining: MAX_ITEMS, bounded: false };
  const projected = projectValue(parsed, normalizedView, principalKind, budget);
  return projected === undefined ? null : projected;
}

