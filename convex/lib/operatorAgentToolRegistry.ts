import { z } from "zod";

import { ORG_WIKI_SECTION_KEYS } from "./orgWiki";
import {
  GENERATE_COI_DESCRIPTION,
  generateCoiInputSchema,
  LOOKUP_ADDRESS_DESCRIPTION,
  lookupAddressInputSchema,
} from "./chatTools";

export type OperatorToolEffect =
  | "read"
  | "reversible_write"
  | "external_send"
  | "access_change"
  | "global_change"
  | "destructive";

export type OperatorToolRole = "operator" | "owner";
export type OperatorToolExecution = "mutation" | "action";

export type OperatorToolTarget = {
  kind?: string;
  id?: string;
};

type OperatorToolSpec<TSchema extends z.ZodType> = {
  version: number;
  description: string;
  inputSchema: TSchema;
  capability: string;
  effect: OperatorToolEffect;
  requiredRole: OperatorToolRole;
  confirmation: "none" | "exact";
  execution?: OperatorToolExecution;
  target: (input: z.infer<TSchema>) => OperatorToolTarget;
  summarize: (input: z.infer<TSchema>) => string;
};

function defineOperatorTool<TSchema extends z.ZodType>(
  spec: OperatorToolSpec<TSchema>,
) {
  return { ...spec, execution: spec.execution ?? "mutation" };
}

// Models routinely emit `null` for a field they have no value for instead of
// leaving the key out, and a plain `.optional()` turns that into a type error
// the model reads as "this field is required". Both helpers accept null; they
// differ only in what consumers do with it.

/** Absent input: null and omission both mean "not provided". */
function omittable<TSchema extends z.ZodType>(schema: TSchema) {
  return schema.nullish();
}

/** Update input where null erases the stored value and omission leaves it. */
function clearable<TSchema extends z.ZodType>(schema: TSchema) {
  return schema.nullish();
}

const organizationId = z.string().min(1).describe("Exact organization ID");
const policyId = z.string().min(1).describe("Exact policy ID");
const clientFileId = z.string().min(1).describe("Exact client file ID");
const orgWikiSectionKey = z
  .enum(ORG_WIKI_SECTION_KEYS)
  .describe("Company wiki section key");
const procurementPacketSectionKey = z
  .string()
  .min(1)
  .describe("Canonical packet section key");
const procurementRequestId = z
  .string()
  .min(1)
  .describe("Exact procurement request ID");
const procurementOutreachId = z
  .string()
  .min(1)
  .describe("Exact procurement broker outreach ID");
const procurementFileItemId = z
  .string()
  .min(1)
  .describe("Exact procurement file item ID");
const procurementEmailThreadId = z
  .string()
  .min(1)
  .describe("Exact procurement email thread ID");
const procurementProposalId = z
  .string()
  .min(1)
  .describe("Exact private procurement proposal ID");
const procurementProposalReviewId = z
  .string()
  .min(1)
  .describe("Exact procurement proposal review ID");
const procurementPacketLinkId = z
  .string()
  .min(1)
  .describe("Exact broker packet magic-link ID");
const emailAddress = z
  .string()
  .trim()
  .min(3)
  .max(320)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Enter a valid email address");
const procurementRequestStatus = z.enum([
  "draft",
  "submitted",
  "gathering_information",
  "marketing",
  "proposal_review",
  "binding",
  "completed",
  "cancelled",
]);
const procurementProposalConclusion = z.enum([
  "meets_requirements",
  "has_gaps",
  "insufficient_evidence",
]);
const brokerNetworkStatus = z.enum([
  "prospect",
  "active",
  "inactive",
  "blacklisted",
]);
const brokerOfficeAddress = z.object({
  street1: omittable(z.string().max(300)),
  street2: omittable(z.string().max(300)),
  city: omittable(z.string().max(200)),
  state: omittable(z.string().max(100)),
  postalCode: omittable(z.string().max(40)),
  country: omittable(z.string().max(100)),
});
const procurementOutreachStatus = z.enum([
  "request_sent",
  "can_handle",
  "cannot_handle",
  "quote_received",
  "quote_accepted",
  "quote_rejected",
]);
const procurementFilePurpose = z.enum([
  "requirements",
  "application",
  "requested_document",
  "quote",
  "correspondence",
  "other",
]);
const procurementFileStatus = z.enum([
  "requested",
  "available",
  "sent",
  "received",
]);
const procurementFileBrokerRelease = z.enum(["hidden", "listed", "attached"]);
const procurementEmailCategory = z.enum([
  "broker",
  "client",
  "internal",
  "mixed",
  "other",
]);
const packetAudience = z.enum(["operator", "client", "broker"]);

export const OPERATOR_AGENT_TOOL_REGISTRY = {
  search_organizations: defineOperatorTool({
    version: 1,
    description:
      "Search Spot customer and broker organizations. Use this to resolve an exact organization ID before any organization write.",
    inputSchema: z.object({
      query: omittable(z.string().max(200)),
      type: omittable(z.enum(["broker", "client"])),
      limit: omittable(z.number().int().min(1).max(25)),
    }),
    capability: "operator.organizations.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: () => ({}),
    summarize: (input) =>
      `Search organizations${input.query ? ` for “${input.query}”` : ""}`,
  }),
  get_organization: defineOperatorTool({
    version: 1,
    description:
      "Get current organization profile, lifecycle, feature flags, membership count, and policy count by exact organization ID.",
    inputSchema: z.object({ orgId: organizationId }),
    capability: "operator.organizations.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) => ({ kind: "organization", id: input.orgId }),
    summarize: (input) => `Read organization ${input.orgId}`,
  }),
  get_operator_overview: defineOperatorTool({
    version: 1,
    description:
      "Get a compact platform overview with organization, policy, extraction, and operator-agent run counts.",
    inputSchema: z.object({}),
    capability: "operator.platform.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: () => ({ kind: "platform", id: "spot" }),
    summarize: () => "Read the operator platform overview",
  }),
  list_policies: defineOperatorTool({
    version: 1,
    description:
      "List or search policies for one exact organization, including extraction stage and operational status.",
    inputSchema: z.object({
      orgId: organizationId,
      query: omittable(z.string().max(200)),
      limit: omittable(z.number().int().min(1).max(25)),
      includeArchived: omittable(z.boolean()),
    }),
    capability: "operator.policies.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) => ({ kind: "organization", id: input.orgId }),
    summarize: (input) => `List policies for organization ${input.orgId}`,
  }),
  lookup_policy: defineOperatorTool({
    version: 1,
    description:
      "Look up rich, current policy summaries for one exact client organization by exact IDs, carrier, policy number, line of business, keywords, or expiration window.",
    inputSchema: z.object({
      orgId: organizationId,
      query: omittable(z.string().max(200)),
      policyIds: omittable(z.array(policyId).max(5)),
      expiringWithinDays: omittable(z.number().int().min(1).max(365)),
      lineOfBusiness: omittable(z.string().max(200)),
      carrier: omittable(z.string().max(200)),
    }),
    capability: "operator.policies.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    execution: "action",
    target: (input) => ({ kind: "organization", id: input.orgId }),
    summarize: (input) => `Look up policies for organization ${input.orgId}`,
  }),
  compare_coverages: defineOperatorTool({
    version: 1,
    description:
      "Compare two policies in one exact client organization side by side, including lines of business, limits, deductibles, and premium.",
    inputSchema: z.object({
      orgId: organizationId,
      policyId1: policyId,
      policyId2: policyId,
    }),
    capability: "operator.policies.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    execution: "action",
    target: (input) => ({ kind: "organization", id: input.orgId }),
    summarize: (input) =>
      `Compare policies ${input.policyId1} and ${input.policyId2}`,
  }),
  lookup_policy_section: defineOperatorTool({
    version: 1,
    description:
      "Search one final policy's source-native outline and original PDF evidence for exact wording, forms, endorsements, exclusions, conditions, definitions, or declarations.",
    inputSchema: z.object({
      orgId: organizationId,
      policyId,
      query: z.string().min(1).max(500),
    }),
    capability: "operator.policies.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    execution: "action",
    target: (input) => ({ kind: "policy", id: input.policyId }),
    summarize: (input) => `Search source evidence for policy ${input.policyId}`,
  }),
  attach_policy_document: defineOperatorTool({
    version: 1,
    description:
      "Attach the original full PDF for one exact final policy to the operator conversation.",
    inputSchema: z.object({ orgId: organizationId, policyId }),
    capability: "operator.policies.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    execution: "action",
    target: (input) => ({ kind: "policy", id: input.policyId }),
    summarize: (input) => `Attach original policy ${input.policyId}`,
  }),
  confirm_policy_fact: defineOperatorTool({
    version: 1,
    description:
      "Confirm a policy fact from exact original-PDF source span IDs and optionally update the supported top-level extracted fields.",
    inputSchema: z.object({
      orgId: organizationId,
      policyId,
      fact: z.string().min(1).max(2_000),
      sourceSpanIds: z.array(z.string().min(1)).min(1).max(50),
      fieldUpdates: omittable(
        z.object({
          carrier: omittable(z.string()),
          security: omittable(z.string()),
          generalAgentName: omittable(z.string()),
          broker: omittable(z.string()),
          policyNumber: omittable(z.string()),
          effectiveDate: omittable(z.string()),
          expirationDate: omittable(z.string()),
          insuredName: omittable(z.string()),
          premium: omittable(z.string()),
          totalCost: omittable(z.string()),
          minPremium: omittable(z.string()),
          depositPremium: omittable(z.string()),
          summary: omittable(z.string()),
        }),
      ),
    }),
    capability: "operator.policies.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    execution: "action",
    target: (input) => ({ kind: "policy", id: input.policyId }),
    summarize: (input) =>
      `Confirm source-backed fact for policy ${input.policyId}`,
  }),
  lookup_compliance_requirements: defineOperatorTool({
    version: 1,
    description:
      "Look up saved insurance coverage requirements for one exact client organization, including requirement and source IDs usable for certificate generation.",
    inputSchema: z.object({
      orgId: organizationId,
      query: omittable(z.string().max(500)),
      scope: omittable(z.enum(["vendors", "own_org", "all"])),
    }),
    capability: "operator.compliance.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    execution: "action",
    target: (input) => ({ kind: "organization", id: input.orgId }),
    summarize: (input) =>
      `Look up compliance requirements for organization ${input.orgId}`,
  }),
  search_thread_history: defineOperatorTool({
    version: 1,
    description:
      "Search older messages in this exact operator conversation when relevant context is outside the recent prompt window.",
    inputSchema: z.object({
      query: z.string().min(2).max(500),
      limit: omittable(z.number().int().min(1).max(8)),
    }),
    capability: "operator.threads.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    execution: "action",
    target: () => ({ kind: "operator_thread" }),
    summarize: (input) =>
      `Search this operator thread for ${JSON.stringify(input.query)}`,
  }),
  read_thread_attachment: defineOperatorTool({
    version: 1,
    description:
      "Reopen one attachment from an older message in this exact operator conversation using the exact message ID and filename returned by search_thread_history.",
    inputSchema: z.object({
      messageId: z.string().min(1),
      filename: z.string().min(1).max(500),
    }),
    capability: "operator.threads.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    execution: "action",
    target: (input) => ({ kind: "operator_message", id: input.messageId }),
    summarize: (input) =>
      `Read ${JSON.stringify(input.filename)} from operator history`,
  }),
  list_client_files: defineOperatorTool({
    version: 1,
    description:
      "List the files held for one exact client organization, including provenance, client visibility, and optional policy association.",
    inputSchema: z.object({
      orgId: organizationId,
      limit: omittable(z.number().int().min(1).max(100)),
    }),
    capability: "operator.client_files.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) => ({ kind: "organization", id: input.orgId }),
    summarize: (input) => `List client files for organization ${input.orgId}`,
  }),
  read_client_file: defineOperatorTool({
    version: 1,
    description:
      "Read bounded extracted text from one exact client file, including private operator-only files.",
    inputSchema: z.object({ clientFileId }),
    capability: "operator.client_files.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    execution: "action",
    target: (input) => ({ kind: "client_file", id: input.clientFileId }),
    summarize: (input) => `Read client file ${input.clientFileId}`,
  }),
  attach_client_file: defineOperatorTool({
    version: 1,
    description:
      "Attach one exact client file to the operator conversation, including private operator-only files.",
    inputSchema: z.object({ clientFileId }),
    capability: "operator.client_files.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    execution: "action",
    target: (input) => ({ kind: "client_file", id: input.clientFileId }),
    summarize: (input) => `Attach client file ${input.clientFileId}`,
  }),
  lookup_client_wiki: defineOperatorTool({
    version: 1,
    description:
      "Read the whole company wiki for one exact client organization: the assembled markdown, its sections, and the sections still empty. Never use this for policy or workflow facts.",
    inputSchema: z.object({ orgId: organizationId }),
    capability: "operator.wiki.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) => ({ kind: "organization", id: input.orgId }),
    summarize: (input) =>
      `Read the company wiki for organization ${input.orgId}`,
  }),
  update_client_wiki_section: defineOperatorTool({
    version: 1,
    description:
      "Rewrite one section of a client's company wiki. Send the whole section body as markdown; an empty body clears the section. Policy, certificate, email, and workflow facts are rejected.",
    inputSchema: z.object({
      orgId: organizationId,
      key: orgWikiSectionKey,
      body: z.string().max(20_000),
    }),
    capability: "operator.wiki.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({ kind: "organization", id: input.orgId }),
    summarize: (input) =>
      `Update company wiki section ${input.key} for organization ${input.orgId}`,
  }),
  lookup_procurement_packet: defineOperatorTool({
    version: 2,
    description:
      "Read one procurement request packet as assembled Markdown. Client and broker audiences resolve to the same shared document; operator-only context is never shared.",
    inputSchema: z.object({
      procurementRequestId,
      audience: omittable(packetAudience),
    }),
    capability: "operator.procurement.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) => ({
      kind: "procurement_request",
      id: input.procurementRequestId,
    }),
    summarize: (input) =>
      `Read the packet for procurement request ${input.procurementRequestId}`,
  }),
  preview_broker_packet: defineOperatorTool({
    version: 2,
    description:
      "Preview the one shared broker-market packet and request-wide released artifacts without creating a magic link.",
    inputSchema: z.object({ procurementRequestId }),
    capability: "operator.procurement.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) => ({
      kind: "procurement_request",
      id: input.procurementRequestId,
    }),
    summarize: (input) =>
      `Preview the shared broker packet for request ${input.procurementRequestId}`,
  }),
  list_broker_packet_links: defineOperatorTool({
    version: 1,
    description:
      "List broker packet magic links for one procurement request, including recipient, snapshot counts, expiry, revocation, delivery, staleness, and view activity. Link secrets are never returned after creation.",
    inputSchema: z.object({ procurementRequestId }),
    capability: "operator.procurement.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) => ({
      kind: "procurement_request",
      id: input.procurementRequestId,
    }),
    summarize: (input) =>
      `List broker packet links for request ${input.procurementRequestId}`,
  }),
  update_procurement_packet_section: defineOperatorTool({
    version: 1,
    description:
      "Rewrite one section of a procurement request packet. Send the whole section body as markdown; an empty body clears the section.",
    inputSchema: z.object({
      procurementRequestId,
      key: procurementPacketSectionKey,
      body: z.string().max(20_000),
      audience: omittable(packetAudience),
    }),
    capability: "operator.procurement.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({
      kind: "procurement_request",
      id: input.procurementRequestId,
    }),
    summarize: (input) =>
      `Update procurement packet section ${input.key} on request ${input.procurementRequestId}`,
  }),
  list_procurement_requests: defineOperatorTool({
    version: 1,
    description:
      "List new-policy procurement requests for one exact client organization, including the intake narrative, request-specific forwarding addresses, policy links, broker progress, files, and imported-email counts.",
    inputSchema: z.object({
      orgId: organizationId,
      query: omittable(z.string().max(200)),
      status: omittable(procurementRequestStatus),
      limit: omittable(z.number().int().min(1).max(100)),
    }),
    capability: "operator.procurement.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) => ({ kind: "organization", id: input.orgId }),
    summarize: (input) =>
      `List procurement requests for organization ${input.orgId}`,
  }),
  get_procurement_request: defineOperatorTool({
    version: 1,
    description:
      "Get one exact procurement request with client requirements, replacement/result policy links, request forwarding address, broker outreach/application/quote state, requested files, linked client files with upload or procurement-email provenance, and imported email threads.",
    inputSchema: z.object({ procurementRequestId }),
    capability: "operator.procurement.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) => ({
      kind: "procurement_request",
      id: input.procurementRequestId,
    }),
    summarize: (input) =>
      `Read procurement request ${input.procurementRequestId}`,
  }),
  list_procurement_proposals: defineOperatorTool({
    version: 1,
    description:
      "List every operator-private proposal for one exact procurement request, including broker, documents, extracted offer facts, revision lineage, and reviews. Never expose this output to a client or broker.",
    inputSchema: z.object({ procurementRequestId }),
    capability: "operator.procurement.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) => ({
      kind: "procurement_request",
      id: input.procurementRequestId,
    }),
    summarize: (input) =>
      `List private proposals for procurement request ${input.procurementRequestId}`,
  }),
  get_procurement_proposal: defineOperatorTool({
    version: 1,
    description:
      "Read one exact operator-private proposal with its broker, outreach, documents, extracted offer, source-backed reviews, and revision lineage.",
    inputSchema: z.object({ procurementProposalId }),
    capability: "operator.procurement.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) => ({
      kind: "procurement_proposal",
      id: input.procurementProposalId,
    }),
    summarize: (input) =>
      `Read private procurement proposal ${input.procurementProposalId}`,
  }),
  get_broker_network_profile: defineOperatorTool({
    version: 1,
    description:
      "Read one exact supplier-network broker profile, including neutral organization identity, office, writing states, exact ACORD LOBCd values, portal contacts, last outreach, and proposal count.",
    inputSchema: z.object({ brokerOrgId: organizationId }),
    capability: "operator.organizations.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) => ({ kind: "organization", id: input.brokerOrgId }),
    summarize: (input) => `Read broker network profile ${input.brokerOrgId}`,
  }),
  list_broker_network_profiles: defineOperatorTool({
    version: 1,
    description:
      "Search the supplier-network broker directory by neutral identity, status, USPS writing state, or exact ACORD LOBCd value.",
    inputSchema: z.object({
      query: omittable(z.string().max(200)),
      status: omittable(brokerNetworkStatus),
      writingState: omittable(z.string().min(2).max(2)),
      lineOfBusinessCode: omittable(z.string().min(1).max(40)),
      limit: omittable(z.number().int().min(1).max(100)),
    }),
    capability: "operator.organizations.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: () => ({ kind: "platform", id: "broker-network" }),
    summarize: (input) =>
      `Search broker network${input.query ? ` for ${JSON.stringify(input.query)}` : ""}`,
  }),
  get_procurement_forwarding_address: defineOperatorTool({
    version: 1,
    description:
      "Get the unique forwarding address for one exact procurement request. Email forwarded to this address imports into that request without invoking the client email agent.",
    inputSchema: z.object({ procurementRequestId }),
    capability: "operator.procurement.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) => ({
      kind: "procurement_request",
      id: input.procurementRequestId,
    }),
    summarize: (input) =>
      `Read the forwarding address for procurement request ${input.procurementRequestId}`,
  }),
  list_procurement_email_threads: defineOperatorTool({
    version: 1,
    description:
      "List imported forwarding-email threads for one exact procurement request, including recipient-based category, original addressed request, current request, participants, and message counts.",
    inputSchema: z.object({
      procurementRequestId,
      limit: omittable(z.number().int().min(1).max(100)),
    }),
    capability: "operator.procurement.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) => ({
      kind: "procurement_request",
      id: input.procurementRequestId,
    }),
    summarize: (input) =>
      `List email threads for procurement request ${input.procurementRequestId}`,
  }),
  get_procurement_email_thread: defineOperatorTool({
    version: 1,
    description:
      "Get one imported procurement email thread with bounded message bodies, envelope and forwarded participants, recipient category, original request address, and linked client-file attachments.",
    inputSchema: z.object({ procurementEmailThreadId }),
    capability: "operator.procurement.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) => ({
      kind: "procurement_email_thread",
      id: input.procurementEmailThreadId,
    }),
    summarize: (input) =>
      `Read procurement email thread ${input.procurementEmailThreadId}`,
  }),
  preview_procurement_email_reconciliation: defineOperatorTool({
    version: 1,
    description:
      "Preview how one imported procurement email thread maps to its request, canonical attachments, and broker outreach contacts. Returns only an exact filing next action when one contact match is unambiguous; it never files a proposal by itself.",
    inputSchema: z.object({ procurementEmailThreadId }),
    capability: "operator.procurement.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) => ({
      kind: "procurement_email_thread",
      id: input.procurementEmailThreadId,
    }),
    summarize: (input) =>
      `Preview reconciliation for procurement email thread ${input.procurementEmailThreadId}`,
  }),
  get_policy_status: defineOperatorTool({
    version: 1,
    description:
      "Get one policy's current extraction, source-tree, reconciliation, and archive status by exact policy ID.",
    inputSchema: z.object({ policyId }),
    capability: "operator.policies.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) => ({ kind: "policy", id: input.policyId }),
    summarize: (input) => `Read policy status ${input.policyId}`,
  }),
  lookup_address: defineOperatorTool({
    version: 1,
    description: LOOKUP_ADDRESS_DESCRIPTION,
    inputSchema: lookupAddressInputSchema,
    capability: "operator.addresses.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    execution: "action",
    target: () => ({ kind: "address" }),
    summarize: (input) => `Validate address ${JSON.stringify(input.query)}`,
  }),
  list_extraction_issues: defineOperatorTool({
    version: 2,
    description:
      "List bounded policy and procurement-proposal extraction failures, paused work, expired leases, or active queue work. The response identifies every checked extraction domain.",
    inputSchema: z.object({
      orgId: omittable(organizationId),
      domain: omittable(z.enum(["policy", "proposal"])),
      status: omittable(
        z.enum(["error", "paused", "running", "queued", "leased", "stuck"]),
      ),
      limit: omittable(z.number().int().min(1).max(25)),
    }),
    capability: "operator.extractions.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) =>
      input.orgId
        ? { kind: "organization", id: input.orgId }
        : { kind: "platform", id: "extractions" },
    summarize: (input) =>
      `List ${input.status ?? "problematic"} ${input.domain ?? "all-domain"} extraction work${input.orgId ? ` for organization ${input.orgId}` : ""}`,
  }),
  get_routing_status: defineOperatorTool({
    version: 1,
    description:
      "Get a bounded operational summary of recent model routing outcomes, fallbacks, errors, and configured route freshness without returning provider secrets.",
    inputSchema: z.object({
      task: omittable(z.string().min(1).max(100)),
      limit: omittable(z.number().int().min(1).max(100)),
    }),
    capability: "operator.routing.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: () => ({ kind: "platform", id: "model-routing" }),
    summarize: (input) =>
      `Read recent model routing status${input.task ? ` for ${input.task}` : ""}`,
  }),
  get_channel_health: defineOperatorTool({
    version: 1,
    description:
      "Get bounded Slack and connected-email configuration health without returning credentials or message contents. Omit orgId for platform-wide health, or provide one exact organization ID for a client-scoped result.",
    inputSchema: z.object({
      orgId: omittable(organizationId).describe(
        "Omit for platform-wide health; provide an exact organization ID to scope the result",
      ),
    }),
    capability: "operator.channels.read",
    effect: "read",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) =>
      input.orgId
        ? { kind: "organization", id: input.orgId }
        : { kind: "platform", id: "channels" },
    summarize: (input) =>
      `Read channel health${input.orgId ? ` for organization ${input.orgId}` : ""}`,
  }),
  send_operator_slack_message: defineOperatorTool({
    version: 1,
    description:
      "Send one direct Slack message from Spot to an active operator whose exact email is linked to the configured host workspace. Use this only for a concrete operator-requested communication; delivery is externally visible and requires exact confirmation.",
    inputSchema: z.object({
      recipientEmail: emailAddress.describe(
        "Exact email of the active Spot operator to message",
      ),
      message: z
        .string()
        .trim()
        .min(1)
        .max(4_000)
        .describe("Complete Slack message in mrkdwn"),
    }),
    capability: "operator.channels.write",
    effect: "external_send",
    requiredRole: "operator",
    confirmation: "exact",
    execution: "action",
    target: (input) => ({
      kind: "operator_slack_recipient",
      id: input.recipientEmail,
    }),
    summarize: (input) =>
      `Send a Slack direct message to ${input.recipientEmail}`,
  }),
  retry_failed_policy_extraction: defineOperatorTool({
    version: 1,
    description:
      "Queue a fresh full extraction for one exact failed or idle policy. Refuses policies with running or paused extraction work.",
    inputSchema: z.object({ policyId }),
    capability: "operator.extractions.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({ kind: "policy", id: input.policyId }),
    summarize: (input) =>
      `Queue a fresh full extraction for policy ${input.policyId}`,
  }),
  generate_coi: defineOperatorTool({
    version: 1,
    description: GENERATE_COI_DESCRIPTION,
    inputSchema: generateCoiInputSchema,
    capability: "operator.certificates.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    execution: "action",
    target: (input) =>
      input.policyId
        ? { kind: "policy", id: input.policyId }
        : input.requirementSourceDocumentId
          ? {
              kind: "requirement_source",
              id: input.requirementSourceDocumentId,
            }
          : { kind: "requirement", id: input.requirementId },
    summarize: (input) => {
      const holder = input.certificateHolder?.split(/\r?\n/)[0]?.trim();
      const source = input.policyId
        ? `policy ${input.policyId}`
        : input.requirementSourceDocumentId
          ? `requirements source ${input.requirementSourceDocumentId}`
          : `requirement ${input.requirementId ?? "unknown"}`;
      return `Generate COI${holder ? ` for ${JSON.stringify(holder)}` : ""} from ${source}`;
    },
  }),
  add_client_file: defineOperatorTool({
    version: 1,
    description:
      "File one attachment from this operator thread in an exact client organization's shared dropbox, hidden from the client. Use the exact attachment file ID shown in attachment metadata. Infer a concise factual name from the parsed file contents and the operator's prompt, while preserving the original extension. Filing runs immediately; use update_client_file when the operator asks to show a filed document to the client.",
    inputSchema: z.object({
      orgId: organizationId,
      attachmentFileId: z
        .string()
        .min(1)
        .describe(
          "Exact storage ID from this operator thread's attachment metadata, or the exact filename of one attachment in this thread",
        ),
      name: z
        .string()
        .min(1)
        .max(220)
        .describe(
          "Concise factual document name inferred from the file contents and operator prompt",
        ),
      policyId: clearable(policyId),
    }),
    capability: "operator.client_files.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "none",
    target: (input) => ({ kind: "organization", id: input.orgId }),
    summarize: (input) =>
      `Add ${JSON.stringify(input.name)} to organization ${input.orgId}${input.policyId ? ` for policy ${input.policyId}` : ""} hidden from the client`,
  }),
  update_client_file: defineOperatorTool({
    version: 1,
    description:
      "Rename a filed client document, change whether the client can see it, or change its optional policy association. Only supplied fields change; null removes a policy association.",
    inputSchema: z
      .object({
        clientFileId,
        name: omittable(z.string().min(1).max(220)),
        clientVisible: omittable(z.boolean()),
        policyId: clearable(policyId),
      })
      .refine(
        (input) =>
          input.name !== undefined ||
          input.clientVisible !== undefined ||
          input.policyId !== undefined,
        "At least one client file field is required",
      ),
    capability: "operator.client_files.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({ kind: "client_file", id: input.clientFileId }),
    summarize: (input) => {
      const fields = [
        input.name !== undefined ? `name=${JSON.stringify(input.name)}` : null,
        input.clientVisible !== undefined
          ? `clientVisible=${input.clientVisible}`
          : null,
        input.policyId !== undefined
          ? `policyId=${input.policyId ?? "none"}`
          : null,
      ].filter(Boolean);
      return `Update client file ${input.clientFileId}: ${fields.join(", ")}`;
    },
  }),
  create_procurement_request: defineOperatorTool({
    // Invalidates pending confirmations created against the retired fields.
    version: 3,
    description:
      "Create a new-policy procurement request for an exact client and generate its unique forwarding address and initial shared packet link. The narrative is the client's own words and seeds the packet's client-narrative section. Resolve exact policy IDs first when linking a policy being replaced or a resulting policy.",
    inputSchema: z.object({
      orgId: organizationId,
      title: z.string().min(1).max(200),
      narrative: z.string().min(1).max(20_000),
      targetEffectiveDate: omittable(z.string().max(10)),
      status: omittable(procurementRequestStatus),
      clientVisible: omittable(z.boolean()),
      replacingPolicyId: omittable(policyId).describe(
        "Exact existing policy ID returned by a policy read tool. Omit it or send null for a new purchase or when no policy is being replaced; never use an organization ID.",
      ),
      resultingPolicyId: omittable(policyId).describe(
        "Exact bound policy ID returned by a policy read tool. Omit it or send null until this procurement request has produced a policy; never use an organization ID.",
      ),
    }),
    capability: "operator.procurement.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({ kind: "organization", id: input.orgId }),
    summarize: (input) => {
      const policyLinks = [
        input.replacingPolicyId
          ? `replacing policy ${input.replacingPolicyId}`
          : null,
        input.resultingPolicyId
          ? `resulting policy ${input.resultingPolicyId}`
          : null,
      ].filter(Boolean);
      return `Create procurement request ${JSON.stringify(input.title)} for organization ${input.orgId}${policyLinks.length ? ` with ${policyLinks.join(" and ")}` : ""}`;
    },
  }),
  update_procurement_request: defineOperatorTool({
    version: 2,
    description:
      "Update supplied fields on one exact procurement request. Null clears an effective date or policy link; omitted fields stay unchanged.",
    inputSchema: z
      .object({
        procurementRequestId,
        title: omittable(z.string().min(1).max(200)),
        narrative: omittable(z.string().min(1).max(20_000)),
        targetEffectiveDate: clearable(z.string().max(10)),
        status: omittable(procurementRequestStatus),
        clientVisible: omittable(z.boolean()),
        replacingPolicyId: clearable(policyId),
        resultingPolicyId: clearable(policyId),
      })
      .refine(
        (input) =>
          Object.keys(input).some((key) => key !== "procurementRequestId"),
        "At least one procurement request field is required",
      ),
    capability: "operator.procurement.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({
      kind: "procurement_request",
      id: input.procurementRequestId,
    }),
    summarize: (input) =>
      `Update procurement request ${input.procurementRequestId}`,
  }),
  file_procurement_proposal: defineOperatorTool({
    version: 1,
    description:
      "Atomically file one broker quote from existing client artifacts, procurement file items, or attachments in this Spot-agent conversation. The command reuses one active proposal per outreach, deduplicates documents by content, creates canonical artifact associations, queues extraction, and safely converges when replayed.",
    inputSchema: z
      .object({
        procurementRequestId,
        procurementOutreachId,
        clientFileIds: omittable(z.array(clientFileId).max(20)),
        procurementFileItemIds: omittable(
          z.array(procurementFileItemId).max(20),
        ),
        attachmentFileIds: omittable(
          z
            .array(z.string().min(1))
            .max(20)
            .describe(
              "Exact storage IDs or filenames of attachments in this Spot-agent conversation",
            ),
        ),
        procurementProposalId: omittable(procurementProposalId),
        supersedesProposalId: omittable(procurementProposalId),
      })
      .refine(
        (input) =>
          (input.clientFileIds?.length ?? 0) +
            (input.procurementFileItemIds?.length ?? 0) +
            (input.attachmentFileIds?.length ?? 0) >
          0,
        "At least one proposal artifact or conversation attachment is required",
      ),
    capability: "operator.procurement.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({
      kind: "procurement_request",
      id: input.procurementRequestId,
    }),
    summarize: (input) =>
      `File a private proposal for outreach ${input.procurementOutreachId} on request ${input.procurementRequestId}`,
  }),
  file_procurement_email_quote: defineOperatorTool({
    version: 1,
    description:
      "Atomically file the active canonical attachments from one imported procurement email thread as the quote for an exact outreach, optionally narrowed to chosen attachments. The command preserves email provenance, deduplicates artifacts, queues extraction, and converges on replay.",
    inputSchema: z.object({
      procurementEmailThreadId,
      procurementOutreachId,
      clientFileIds: omittable(
        z
          .array(clientFileId)
          .max(20)
          .describe(
            "Attachments to file. Omit to file every active attachment on the thread; narrow it to skip signatures and logos.",
          ),
      ),
      supersedesProposalId: omittable(procurementProposalId),
    }),
    capability: "operator.procurement.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({
      kind: "procurement_email_thread",
      id: input.procurementEmailThreadId,
    }),
    summarize: (input) =>
      `File attachments from procurement email thread ${input.procurementEmailThreadId} for outreach ${input.procurementOutreachId}`,
  }),
  archive_procurement_proposal: defineOperatorTool({
    version: 1,
    description:
      "Archive one private procurement proposal, or delete it when it is an empty draft with no extraction history. Selected proposals must be deselected by selecting another reviewed proposal first.",
    inputSchema: z.object({
      procurementProposalId,
      reason: omittable(z.string().max(1_000)),
    }),
    capability: "operator.procurement.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({
      kind: "procurement_proposal",
      id: input.procurementProposalId,
    }),
    summarize: (input) =>
      `Archive procurement proposal ${input.procurementProposalId}`,
  }),
  retry_procurement_proposal_extraction: defineOperatorTool({
    version: 1,
    description:
      "Queue a fresh extraction job for one draft, failed, stuck, or review-ready procurement proposal, preserving prior attempt history.",
    inputSchema: z.object({ procurementProposalId }),
    capability: "operator.extractions.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({
      kind: "procurement_proposal",
      id: input.procurementProposalId,
    }),
    summarize: (input) =>
      `Retry extraction for procurement proposal ${input.procurementProposalId}`,
  }),
  cancel_procurement_proposal_extraction: defineOperatorTool({
    version: 1,
    description:
      "Cancel pending or running extraction jobs for one procurement proposal and return it to draft for a later retry.",
    inputSchema: z.object({ procurementProposalId }),
    capability: "operator.extractions.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({
      kind: "procurement_proposal",
      id: input.procurementProposalId,
    }),
    summarize: (input) =>
      `Cancel extraction for procurement proposal ${input.procurementProposalId}`,
  }),
  generate_procurement_proposal_review: defineOperatorTool({
    version: 1,
    description:
      "Generate and save a source-backed review of one extracted procurement proposal against the exact current broker-visible packet.",
    inputSchema: z.object({ procurementProposalId }),
    capability: "operator.procurement.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    execution: "action",
    target: (input) => ({
      kind: "procurement_proposal",
      id: input.procurementProposalId,
    }),
    summarize: (input) =>
      `Generate a packet review for procurement proposal ${input.procurementProposalId}`,
  }),
  create_broker_packet_link: defineOperatorTool({
    version: 2,
    description:
      "Create the single revocable, expiring link for an immutable snapshot of the shared broker-market packet. A new link replaces any active request-wide link; the URL is shown only once.",
    inputSchema: z.object({
      procurementRequestId,
      expiresInDays: omittable(z.number().int().min(1).max(90)),
    }),
    capability: "operator.procurement.write",
    effect: "access_change",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({
      kind: "procurement_request",
      id: input.procurementRequestId,
    }),
    summarize: (input) =>
      `Create the shared broker packet link for request ${input.procurementRequestId}`,
  }),
  rotate_broker_packet_link: defineOperatorTool({
    version: 1,
    description:
      "Revoke one broker packet magic link and create a replacement snapshot-bound link. The new URL is shown only once and is not emailed.",
    inputSchema: z.object({
      procurementPacketLinkId,
      expiresInDays: omittable(z.number().int().min(1).max(90)),
    }),
    capability: "operator.procurement.write",
    effect: "access_change",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({
      kind: "procurement_packet_link",
      id: input.procurementPacketLinkId,
    }),
    summarize: (input) =>
      `Rotate broker packet link ${input.procurementPacketLinkId}`,
  }),
  revoke_broker_packet_link: defineOperatorTool({
    version: 1,
    description:
      "Immediately revoke one exact broker packet magic link. Every packet and attachment request revalidates revocation.",
    inputSchema: z.object({ procurementPacketLinkId }),
    capability: "operator.procurement.write",
    effect: "access_change",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({
      kind: "procurement_packet_link",
      id: input.procurementPacketLinkId,
    }),
    summarize: (input) =>
      `Revoke broker packet link ${input.procurementPacketLinkId}`,
  }),
  confirm_procurement_proposal_review: defineOperatorTool({
    version: 1,
    description:
      "Confirm or override only the overall conclusion of one exact current source-backed proposal review. Findings and evidence remain model-authored and auditable.",
    inputSchema: z.object({
      procurementProposalReviewId,
      conclusion: procurementProposalConclusion,
    }),
    capability: "operator.procurement.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({
      kind: "procurement_proposal_review",
      id: input.procurementProposalReviewId,
    }),
    summarize: (input) =>
      `Confirm proposal review ${input.procurementProposalReviewId} as ${input.conclusion}`,
  }),
  select_procurement_proposal: defineOperatorTool({
    version: 1,
    description:
      "Select one exact private proposal only after revalidating a current staff-confirmed review that meets every requirement; prior selected proposals on the request are cleared atomically.",
    inputSchema: z.object({ procurementProposalId }),
    capability: "operator.procurement.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({
      kind: "procurement_proposal",
      id: input.procurementProposalId,
    }),
    summarize: (input) =>
      `Select procurement proposal ${input.procurementProposalId}`,
  }),
  create_broker_network_profile: defineOperatorTool({
    version: 1,
    description:
      "Register a new supplier-network broker organization and its network profile with no portal users and no invites. Search the broker network first and update the existing profile instead when the broker is already registered. Writing states use USPS abbreviations and lines use exact ACORD LOBCd values.",
    inputSchema: z.object({
      name: z.string().min(1).max(200),
      website: omittable(z.string().max(2_000)),
      networkStatus: omittable(brokerNetworkStatus).describe(
        "Defaults to prospect for a broker that has not yet placed business",
      ),
      officeAddress: omittable(brokerOfficeAddress),
      writingStates: omittable(z.array(z.string().min(2).max(2)).max(60)),
      lineOfBusinessCodes: omittable(
        z.array(z.string().min(1).max(40)).max(100),
      ),
    }),
    capability: "operator.organizations.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: () => ({ kind: "platform", id: "broker-network" }),
    summarize: (input) =>
      `Create broker network profile ${JSON.stringify(input.name)} with no portal users`,
  }),
  update_broker_network_profile: defineOperatorTool({
    version: 1,
    description:
      "Update supplied fields on one exact supplier-network broker profile. Writing states use USPS abbreviations and lines use exact ACORD LOBCd values; omitted fields remain unchanged.",
    inputSchema: z
      .object({
        brokerOrgId: organizationId,
        networkStatus: omittable(brokerNetworkStatus),
        officeAddress: omittable(brokerOfficeAddress),
        writingStates: omittable(z.array(z.string().min(2).max(2)).max(60)),
        lineOfBusinessCodes: omittable(
          z.array(z.string().min(1).max(40)).max(100),
        ),
        name: omittable(z.string().min(1).max(200)),
        website: clearable(z.string().max(2_000)),
      })
      .refine(
        (input) => Object.keys(input).some((key) => key !== "brokerOrgId"),
        "At least one broker profile field is required",
      ),
    capability: "operator.organizations.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({ kind: "organization", id: input.brokerOrgId }),
    summarize: (input) => `Update broker network profile ${input.brokerOrgId}`,
  }),
  create_procurement_broker_outreach: defineOperatorTool({
    version: 2,
    description:
      "Add a real broker-network organization to an exact procurement request with a selected contact, workflow status, and optional Markdown log.",
    inputSchema: z.object({
      procurementRequestId,
      brokerOrgId: organizationId,
      contactName: omittable(z.string().max(200)),
      contactEmail: omittable(z.string().max(320)),
      contactPhone: omittable(z.string().max(100)),
      status: omittable(procurementOutreachStatus),
      log: omittable(z.string().max(20_000)),
    }),
    capability: "operator.procurement.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({
      kind: "procurement_request",
      id: input.procurementRequestId,
    }),
    summarize: (input) =>
      `Add broker ${input.brokerOrgId} to procurement request ${input.procurementRequestId}`,
  }),
  update_procurement_broker_outreach: defineOperatorTool({
    version: 2,
    description:
      "Update supplied broker outreach identity, exact workflow status, or its single Markdown log. File quote documents as private proposals.",
    inputSchema: z
      .object({
        procurementOutreachId,
        brokerOrgId: omittable(organizationId),
        contactName: clearable(z.string().max(200)),
        contactEmail: clearable(z.string().max(320)),
        contactPhone: clearable(z.string().max(100)),
        status: omittable(procurementOutreachStatus),
        log: clearable(z.string().max(20_000)),
      })
      .refine(
        (input) =>
          Object.keys(input).some((key) => key !== "procurementOutreachId"),
        "At least one broker outreach field is required",
      ),
    capability: "operator.procurement.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({
      kind: "procurement_broker_outreach",
      id: input.procurementOutreachId,
    }),
    summarize: (input) =>
      `Update procurement broker outreach ${input.procurementOutreachId}`,
  }),
  create_procurement_file_item: defineOperatorTool({
    version: 1,
    description:
      "Track an application, outstanding broker-requested document, quote, requirements file, or other procurement file. A client file ID is optional so requested documents can be tracked before they are available.",
    inputSchema: z.object({
      procurementRequestId,
      procurementOutreachId: omittable(procurementOutreachId),
      clientFileId: omittable(clientFileId),
      purpose: procurementFilePurpose,
      label: z.string().min(1).max(300),
      status: omittable(procurementFileStatus),
      brokerRelease: omittable(procurementFileBrokerRelease),
      clientVisible: omittable(z.boolean()),
      notes: omittable(z.string().max(20_000)),
    }),
    capability: "operator.procurement.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({
      kind: "procurement_request",
      id: input.procurementRequestId,
    }),
    summarize: (input) =>
      `Add ${input.purpose} ${JSON.stringify(input.label)} to procurement request ${input.procurementRequestId}`,
  }),
  update_procurement_file_item: defineOperatorTool({
    version: 1,
    description:
      "Update a procurement file requirement or link. Null removes the linked outreach, shared client file, or notes without deleting the underlying client file.",
    inputSchema: z
      .object({
        procurementFileItemId,
        procurementOutreachId: clearable(procurementOutreachId),
        clientFileId: clearable(clientFileId),
        purpose: omittable(procurementFilePurpose),
        label: omittable(z.string().min(1).max(300)),
        status: omittable(procurementFileStatus),
        brokerRelease: omittable(procurementFileBrokerRelease),
        clientVisible: omittable(z.boolean()),
        notes: clearable(z.string().max(20_000)),
      })
      .refine(
        (input) =>
          Object.keys(input).some((key) => key !== "procurementFileItemId"),
        "At least one procurement file field is required",
      ),
    capability: "operator.procurement.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({
      kind: "procurement_file_item",
      id: input.procurementFileItemId,
    }),
    summarize: (input) =>
      `Update procurement file item ${input.procurementFileItemId}`,
  }),
  update_procurement_email_thread: defineOperatorTool({
    version: 1,
    description:
      "Correct the recipient-based category or assigned request for an imported procurement email thread. Request moves are limited to another request for the same client; the originally addressed request remains immutable.",
    inputSchema: z
      .object({
        procurementEmailThreadId,
        category: omittable(procurementEmailCategory),
        procurementRequestId: omittable(procurementRequestId),
      })
      .refine(
        (input) =>
          input.category !== undefined ||
          input.procurementRequestId !== undefined,
        "A category or procurement request is required",
      ),
    capability: "operator.procurement.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({
      kind: "procurement_email_thread",
      id: input.procurementEmailThreadId,
    }),
    summarize: (input) =>
      `Update procurement email thread ${input.procurementEmailThreadId}`,
  }),
  create_client_organization: defineOperatorTool({
    version: 1,
    description:
      "Create one standalone client organization without provisioning users. Use the returned exact organization ID to create its procurement request. Exact-name duplicates are rejected.",
    inputSchema: z.object({
      name: z.string().min(1).max(200),
      website: omittable(z.string().max(500)),
    }),
    capability: "operator.organizations.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    execution: "action",
    target: () => ({ kind: "platform", id: "clients" }),
    summarize: (input) =>
      `Create standalone client ${JSON.stringify(input.name)}`,
  }),
  update_organization_profile: defineOperatorTool({
    version: 1,
    description:
      "Update selected editable profile fields for one exact organization. Only supplied fields change.",
    inputSchema: z
      .object({
        orgId: organizationId,
        name: omittable(z.string().min(1).max(200)),
        website: clearable(z.string().max(500)),
        industry: clearable(z.string().max(200)),
        industryVertical: clearable(z.string().max(200)),
      })
      .refine(
        (input) =>
          input.name !== undefined ||
          input.website !== undefined ||
          input.industry !== undefined ||
          input.industryVertical !== undefined,
        "At least one profile field is required",
      ),
    capability: "operator.organizations.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({ kind: "organization", id: input.orgId }),
    summarize: (input) => {
      const fields = [
        input.name !== undefined ? `name=${JSON.stringify(input.name)}` : null,
        input.website !== undefined
          ? `website=${JSON.stringify(input.website)}`
          : null,
        input.industry !== undefined
          ? `industry=${JSON.stringify(input.industry)}`
          : null,
        input.industryVertical !== undefined
          ? `industryVertical=${JSON.stringify(input.industryVertical)}`
          : null,
      ].filter(Boolean);
      return `Update organization ${input.orgId}: ${fields.join(", ")}`;
    },
  }),
  set_organization_status: defineOperatorTool({
    version: 1,
    description:
      "Set the internal operator lifecycle of one exact broker or client organization.",
    inputSchema: z.object({
      orgId: organizationId,
      status: z.enum(["onboarding", "live"]),
    }),
    capability: "operator.organizations.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({ kind: "organization", id: input.orgId }),
    summarize: (input) =>
      `Set organization ${input.orgId} status to ${input.status}`,
  }),
  set_client_feature_flag: defineOperatorTool({
    version: 1,
    description:
      "Enable or disable one supported Spot feature flag for an exact client organization.",
    inputSchema: z.object({
      orgId: organizationId,
      flagId: z.enum([
        "connect_features",
        "coverage_recovery_v2",
        "imessage_app_cards",
      ]),
      enabled: z.boolean(),
    }),
    capability: "operator.organizations.write",
    effect: "reversible_write",
    requiredRole: "operator",
    confirmation: "exact",
    target: (input) => ({ kind: "organization", id: input.orgId }),
    summarize: (input) =>
      `${input.enabled ? "Enable" : "Disable"} ${input.flagId} for organization ${input.orgId}`,
  }),
  clear_all_agent_memory: defineOperatorTool({
    version: 1,
    description:
      "Schedule a global purge of organization memory and raw conversation memory. This is owner-only and destructive.",
    inputSchema: z.object({}),
    capability: "operator.platform.destructive",
    effect: "destructive",
    requiredRole: "owner",
    confirmation: "exact",
    target: () => ({ kind: "platform", id: "agent-memory" }),
    summarize: () => "Clear all organization and raw conversation memory",
  }),
} as const;

export type OperatorAgentToolName = keyof typeof OPERATOR_AGENT_TOOL_REGISTRY;

export type ResolvedOperatorToolSpec = {
  version: number;
  description: string;
  inputSchema: z.ZodType;
  capability: string;
  effect: OperatorToolEffect;
  requiredRole: OperatorToolRole;
  confirmation: "none" | "exact";
  execution: OperatorToolExecution;
  target: (input: Record<string, unknown>) => OperatorToolTarget;
  summarize: (input: Record<string, unknown>) => string;
};

export function isOperatorAgentToolName(
  value: string,
): value is OperatorAgentToolName {
  return value in OPERATOR_AGENT_TOOL_REGISTRY;
}

export function getOperatorAgentToolSpec(
  name: string,
): ResolvedOperatorToolSpec {
  if (!isOperatorAgentToolName(name)) {
    throw new Error(`Unknown operator tool: ${name}`);
  }
  return OPERATOR_AGENT_TOOL_REGISTRY[
    name
  ] as unknown as ResolvedOperatorToolSpec;
}

// Nested tool objects are written straight into Convex validators that reject
// `null`, and no nested field carries clear-on-null meaning, so drop nulls below
// the top level. Top-level nulls survive for `clearable` fields.
function stripNestedNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNestedNulls);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== null)
      .map(([key, entry]) => [key, stripNestedNulls(entry)]),
  );
}

export function parseOperatorAgentToolInput(
  name: string,
  input: unknown,
): Record<string, unknown> {
  const parsed = getOperatorAgentToolSpec(name).inputSchema.parse(
    input,
  ) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [
      key,
      stripNestedNulls(value),
    ]),
  );
}

export function operatorAgentToolCatalog() {
  return Object.entries(OPERATOR_AGENT_TOOL_REGISTRY).map(([name, spec]) => ({
    name: name as OperatorAgentToolName,
    version: spec.version,
    description: spec.description,
    capability: spec.capability,
    effect: spec.effect,
    requiredRole: spec.requiredRole,
    confirmation: spec.confirmation,
    execution: spec.execution,
  }));
}

export function operatorAgentToolJsonCatalog() {
  return Object.entries(OPERATOR_AGENT_TOOL_REGISTRY).map(([name, spec]) => ({
    name: name as OperatorAgentToolName,
    version: spec.version,
    description: spec.description,
    inputSchema: z.toJSONSchema(spec.inputSchema) as Record<string, unknown>,
    capability: spec.capability,
    effect: spec.effect,
    requiredRole: spec.requiredRole,
    confirmation: spec.confirmation,
    execution: spec.execution,
  }));
}
