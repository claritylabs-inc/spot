import { z } from "zod";
import {
  lookupPolicy,
  lookupCompanyContext,
  lookupClientRequests,
  lookupClientFiles,
  readClientFile,
  compareCoverages,
  lookupComplianceRequirements,
  listCertificates,
  listPolicyVersions,
  updateCompanyWiki,
  createComplianceRequirement,
  lookupConnectedVendors,
  lookupVendorPolicies,
  lookupVendorCompliance,
  lookupPolicySection,
  lookupAddress,
  saveNote,
  confirmPolicyFact,
  generateCoi,
  searchConnectedEmail,
  readConnectedEmail,
  readConnectedEmailAttachment,
  importConnectedEmailPolicyAttachments,
  importConnectedEmailRequirementAttachments,
  saveConnectedEmailAttachmentsToThread,
  saveConnectedEmailMessageToThread,
  sendConnectedVendorInvite,
  webResearch,
} from "./chatTools";
import { MCP_CHAT_WRITE_TOOL_NAMES } from "./mcpAgentToolAccess";

type Effect = "read" | "write";
type CatalogEntry = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  effect?: Effect;
  openWorld?: boolean;
  destructive?: boolean;
  idempotent?: boolean;
};

const SHARED_TOOLS = {
  lookup_policy: lookupPolicy,
  lookup_company_context: lookupCompanyContext,
  lookup_client_requests: lookupClientRequests,
  lookup_client_files: lookupClientFiles,
  read_client_file: readClientFile,
  compare_coverages: compareCoverages,
  lookup_compliance_requirements: lookupComplianceRequirements,
  list_certificates: listCertificates,
  list_policy_versions: listPolicyVersions,
  update_company_wiki: updateCompanyWiki,
  create_compliance_requirement: createComplianceRequirement,
  lookup_connected_vendors: lookupConnectedVendors,
  lookup_vendor_policies: lookupVendorPolicies,
  lookup_vendor_compliance: lookupVendorCompliance,
  lookup_policy_section: lookupPolicySection,
  lookup_address: lookupAddress,
  save_note: saveNote,
  confirm_policy_fact: confirmPolicyFact,
  generate_coi: generateCoi,
  search_connected_email: searchConnectedEmail,
  read_connected_email: readConnectedEmail,
  read_connected_email_attachment: readConnectedEmailAttachment,
  import_connected_email_policy_attachments:
    importConnectedEmailPolicyAttachments,
  import_connected_email_requirement_attachments:
    importConnectedEmailRequirementAttachments,
  save_connected_email_attachments_to_thread:
    saveConnectedEmailAttachmentsToThread,
  save_connected_email_message_to_thread: saveConnectedEmailMessageToThread,
  send_connected_vendor_invite: sendConnectedVendorInvite,
  web_research: webResearch,
} as const;

const COMPATIBILITY_TOOLS: CatalogEntry[] = [
  {
    name: "list_policies",
    description:
      "List insurance policies. Optionally filter by carrier, year, or line of business.",
    inputSchema: {
      type: "object" as const,
      properties: {
        carrier: { type: "string", description: "Filter by carrier name" },
        year: {
          type: "string",
          description: "Filter by policy year (e.g. '2024')",
        },
        type: {
          type: "string",
          description:
            "Filter by ACORD line of business code or label (e.g. 'CGL', 'Commercial General Liability')",
        },
      },
    },
  },
  {
    name: "get_policy",
    description:
      "Get full details of a specific insurance policy by ID, including coverages, document sections, and metadata.",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string", description: "The policy ID" } },
      required: ["id"],
    },
  },
  {
    name: "get_policy_pdf",
    description:
      "Get a temporary download URL for the original full policy PDF document by policy ID.",
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string", description: "The policy ID" } },
      required: ["id"],
    },
  },
  {
    name: "search_policies",
    description:
      "Search across policies by text query. Searches carrier, policy number, insured name, summary, and lines of business.",
    inputSchema: {
      type: "object" as const,
      properties: { q: { type: "string", description: "Search query text" } },
      required: ["q"],
    },
  },
  {
    name: "ask_spot",
    description:
      "Ask the Spot AI assistant a question about the organization's insurance portfolio, bound policies, renewals, or coverage details. Spot answers within the selected organization. Optionally pass a threadId to continue an existing conversation.",
    inputSchema: {
      type: "object" as const,
      properties: {
        message: {
          type: "string",
          description: "The question or message to send to Spot",
        },
        threadId: {
          type: "string",
          description:
            "Optional thread ID to continue an existing conversation",
        },
      },
      required: ["message"],
    },
    openWorld: true,
  },
  {
    name: "list_email_drafts",
    description:
      "List durable outbound email drafts for the organization. Returns a compact text summary by default, with a sample and draft IDs. Optionally filter by threadId or set showAll to see every draft.",
    inputSchema: {
      type: "object" as const,
      properties: {
        threadId: { type: "string", description: "Optional thread ID" },
        showAll: {
          type: "boolean",
          description: "Show every draft instead of a short sample",
        },
      },
    },
  },
  {
    name: "draft_email",
    description:
      "Create a durable outbound email draft using the same Spot email artifact used by web chat. Requires write scope. Returns a draft ID that can be updated, sent, or cancelled.",
    inputSchema: {
      type: "object" as const,
      properties: {
        threadId: {
          type: "string",
          description: "Optional thread ID to attach the draft to",
        },
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Email subject" },
        body: { type: "string", description: "Plain text email body" },
        cc: {
          type: "array",
          items: { type: "string" },
          description: "CC email addresses",
        },
        bcc: {
          type: "array",
          items: { type: "string" },
          description: "BCC email addresses",
        },
        originalPolicyIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Policy IDs whose original full policy PDFs should be attached",
        },
      },
      required: ["to", "subject", "body"],
    },
    effect: "write",
  },
  {
    name: "update_email_draft",
    description:
      "Update an existing durable outbound email draft in place. Requires write scope.",
    inputSchema: {
      type: "object" as const,
      properties: {
        draftId: {
          type: "string",
          description: "Draft ID returned by draft_email or list_email_drafts",
        },
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Email subject" },
        body: { type: "string", description: "Plain text email body" },
        cc: {
          type: "array",
          items: { type: "string" },
          description: "CC email addresses",
        },
        bcc: {
          type: "array",
          items: { type: "string" },
          description: "BCC email addresses",
        },
        originalPolicyIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Policy IDs whose original full policy PDFs should be attached",
        },
      },
      required: ["draftId", "to", "subject", "body"],
    },
    effect: "write",
  },
  {
    name: "send_email_draft",
    description: "Send a durable outbound email draft. Requires write scope.",
    inputSchema: {
      type: "object" as const,
      properties: {
        draftId: {
          type: "string",
          description: "Draft ID returned by draft_email or list_email_drafts",
        },
      },
      required: ["draftId"],
    },
    effect: "write",
    openWorld: true,
    idempotent: false,
  },
  {
    name: "send_email_drafts",
    description:
      "Send multiple durable outbound email drafts in one batch. Requires write scope.",
    inputSchema: {
      type: "object" as const,
      properties: {
        draftIds: {
          type: "array",
          items: { type: "string" },
          description: "Draft IDs returned by list_email_drafts",
        },
      },
      required: ["draftIds"],
    },
    effect: "write",
    openWorld: true,
    idempotent: false,
  },
  {
    name: "cancel_email_draft",
    description: "Cancel a durable outbound email draft. Requires write scope.",
    inputSchema: {
      type: "object" as const,
      properties: {
        draftId: {
          type: "string",
          description: "Draft ID returned by draft_email or list_email_drafts",
        },
      },
      required: ["draftId"],
    },
    effect: "write",
  },
  {
    name: "list_connected_vendors",
    description:
      "List vendor organizations that have approved read-only insurance access for the caller's org.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_connected_vendor",
    description: "Get a connected vendor org profile and policy count.",
    inputSchema: {
      type: "object" as const,
      properties: {
        vendor_org_id: {
          type: "string",
          description: "Connected vendor org ID",
        },
      },
      required: ["vendor_org_id"],
    },
  },
  {
    name: "list_connected_vendor_policies",
    description:
      "List policies for a connected vendor org that approved access.",
    inputSchema: {
      type: "object" as const,
      properties: {
        vendor_org_id: {
          type: "string",
          description: "Connected vendor org ID",
        },
      },
      required: ["vendor_org_id"],
    },
  },
  {
    name: "list_vendor_compliance",
    description:
      "List connected vendor compliance status against the caller org's insurance requirements.",
    inputSchema: { type: "object" as const, properties: {} },
  },
];

const COMPATIBILITY_ALIASES: Record<
  string,
  {
    sharedName: keyof typeof SHARED_TOOLS;
    mapInput: (input: Record<string, unknown>) => Record<string, unknown>;
  }
> = {
  list_policies: {
    sharedName: "lookup_policy",
    mapInput: (input) => ({
      carrier: input.carrier,
      lineOfBusiness: input.type,
    }),
  },
  get_policy: {
    sharedName: "lookup_policy",
    mapInput: (input) => ({ policyIds: [input.id] }),
  },
  get_policy_pdf: {
    sharedName: "lookup_policy",
    mapInput: (input) => ({ policyIds: [input.id] }),
  },
  search_policies: {
    sharedName: "lookup_policy",
    mapInput: (input) => ({ query: input.q }),
  },
  list_connected_vendors: {
    sharedName: "lookup_connected_vendors",
    mapInput: () => ({}),
  },
  get_connected_vendor: {
    sharedName: "lookup_connected_vendors",
    mapInput: (input) => ({ query: input.vendor_org_id }),
  },
  list_connected_vendor_policies: {
    sharedName: "lookup_vendor_policies",
    mapInput: (input) => ({ vendorOrgId: input.vendor_org_id }),
  },
  list_vendor_compliance: {
    sharedName: "lookup_vendor_compliance",
    mapInput: () => ({}),
  },
};

const EMAIL_TOOL_NAMES = new Set([
  "draft_email",
  "update_email_draft",
  "list_email_drafts",
  "send_email_draft",
  "send_email_drafts",
  "cancel_email_draft",
]);

export function isTenantMcpEmailTool(name: string): boolean {
  return EMAIL_TOOL_NAMES.has(name);
}

const RETIRED_NAME_ALIASES = {
  list_my_policies: {
    sharedName: "lookup_policy",
    schema: z.object({}),
    mapInput: () => ({}),
  },
  get_org_info: {
    sharedName: "lookup_company_context",
    schema: z.object({}),
    mapInput: () => ({}),
  },
  read_company_wiki: {
    sharedName: "lookup_company_context",
    schema: z.object({}),
    mapInput: () => ({}),
  },
  list_client_files: {
    sharedName: "lookup_client_files",
    schema: z.object({
      client_org_id: z.string().optional(),
      query: z.string().optional(),
      limit: z.number().optional(),
    }),
    mapInput: (input: Record<string, unknown>) => ({
      orgId: input.client_org_id,
      query: input.query,
      limit: input.limit,
    }),
  },
  get_client_file: {
    sharedName: "read_client_file",
    schema: z.object({ client_file_id: z.string() }),
    mapInput: (input: Record<string, unknown>) => ({
      clientFileId: input.client_file_id,
    }),
  },
  list_insurance_requirements: {
    sharedName: "lookup_compliance_requirements",
    schema: z.object({}),
    mapInput: () => ({}),
  },
  generate_policy_certificate: {
    sharedName: "generate_coi",
    schema: z.object({
      policyId: z.string().optional(),
      policy_id: z.string().optional(),
      requirementSourceDocumentId: z.string().optional(),
      requirement_source_document_id: z.string().optional(),
      requirementId: z.string().optional(),
      requirement_id: z.string().optional(),
      certificateHolder: z.string().optional(),
      certificate_holder: z.string().optional(),
      holderName: z.string().optional(),
      certificate_holder_name: z.string().optional(),
      holderEmail: z.string().optional(),
      holder_email: z.string().optional(),
      certificate_holder_email: z.string().optional(),
      recipient_email: z.string().optional(),
      holderContactName: z.string().optional(),
      holder_contact_name: z.string().optional(),
      certificate_holder_contact_name: z.string().optional(),
      holderPhone: z.string().optional(),
      holder_phone: z.string().optional(),
      certificate_holder_phone: z.string().optional(),
      recipient_phone: z.string().optional(),
      addressLine1: z.string().optional(),
      address_line_1: z.string().optional(),
      addressLine2: z.string().optional(),
      address_line_2: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      postalCode: z.string().optional(),
      postal_code: z.string().optional(),
      country: z.string().optional(),
      country_code: z.string().optional(),
      certificate_holder_country: z.string().optional(),
      requestText: z.string().optional(),
      request_text: z.string().optional(),
      descriptionOfOperations: z.string().optional(),
      description_of_operations: z.string().optional(),
      requestedEndorsements: z.array(z.string()).optional(),
      requested_endorsements: z.array(z.string()).optional(),
      additionalInsuredName: z.string().optional(),
      additional_insured_name: z.string().optional(),
      forceReissue: z.boolean().optional(),
      explicitReissue: z.boolean().optional(),
      explicit_reissue: z.boolean().optional(),
      reissue: z.boolean().optional(),
    }),
    mapInput: (input: Record<string, unknown>) => {
      const holderBlock = String(input.certificate_holder ?? "").trim();
      const holderLines = holderBlock
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const addressLines = holderLines
        .slice(1)
        .filter(
          (line) =>
            !/^(attn|attention|email|e-mail|phone|tel|telephone)\s*:/i.test(
              line,
            ),
        );
      return {
        policyId: input.policyId ?? input.policy_id,
        requirementSourceDocumentId:
          input.requirementSourceDocumentId ??
          input.requirement_source_document_id,
        requirementId: input.requirementId ?? input.requirement_id,
        certificateHolder:
          input.certificateHolder ??
          input.holderName ??
          input.certificate_holder_name ??
          holderLines[0],
        holderContactName:
          input.holderContactName ??
          input.holder_contact_name ??
          input.certificate_holder_contact_name,
        holderEmail:
          input.holderEmail ??
          input.holder_email ??
          input.certificate_holder_email ??
          input.recipient_email,
        holderPhone:
          input.holderPhone ??
          input.holder_phone ??
          input.certificate_holder_phone ??
          input.recipient_phone,
        addressLine1:
          input.addressLine1 ?? input.address_line_1 ?? addressLines[0],
        addressLine2:
          input.addressLine2 ?? input.address_line_2 ?? addressLines[1],
        city: input.city,
        state: input.state,
        postalCode: input.postalCode ?? input.postal_code,
        country:
          input.country ??
          input.country_code ??
          input.certificate_holder_country,
        requestText: input.requestText ?? input.request_text,
        descriptionOfOperations:
          input.descriptionOfOperations ?? input.description_of_operations,
        requestedEndorsements:
          input.requestedEndorsements ?? input.requested_endorsements,
        additionalInsuredName:
          input.additionalInsuredName ?? input.additional_insured_name,
        explicitReissue:
          input.forceReissue === true ||
          input.explicitReissue === true ||
          input.explicit_reissue === true ||
          input.reissue === true,
      };
    },
  },
  get_policy_stats: {
    sharedName: "lookup_policy",
    schema: z.object({}),
    mapInput: () => ({}),
  },
  list_policy_certificates: {
    sharedName: "list_certificates",
    schema: z.object({
      policyId: z.string().optional(),
      policy_id: z.string().optional(),
    }),
    mapInput: (input: Record<string, unknown>) => ({
      policyId: input.policyId ?? input.policy_id,
    }),
  },
  list_certificate_holders: {
    sharedName: "list_certificates",
    schema: z.object({
      query: z.string().optional(),
      q: z.string().optional(),
    }),
    mapInput: (input: Record<string, unknown>) => ({
      holderQuery: input.query ?? input.q,
    }),
  },
  list_certificate_versions: {
    sharedName: "list_certificates",
    schema: z.object({
      policyId: z.string().optional(),
      policy_id: z.string().optional(),
      certificateId: z.string().optional(),
      certificate_id: z.string().optional(),
      holderId: z.string().optional(),
      holder_id: z.string().optional(),
      certificateHolderId: z.string().optional(),
      certificate_holder_id: z.string().optional(),
    }),
    mapInput: (input: Record<string, unknown>) => ({
      policyId: input.policyId ?? input.policy_id,
      certificateId: input.certificateId ?? input.certificate_id,
      holderId:
        input.holderId ??
        input.holder_id ??
        input.certificateHolderId ??
        input.certificate_holder_id,
    }),
  },
  write_company_wiki: {
    sharedName: "update_company_wiki",
    schema: z.object({
      markdown: z.string(),
      expected_revision: z.number().int().min(0),
    }),
    mapInput: (input: Record<string, unknown>) => ({
      markdown: input.markdown,
      expectedRevision: input.expected_revision,
    }),
  },
  create_insurance_requirement: {
    sharedName: "create_compliance_requirement",
    schema: z.object({
      kind: z.literal("coverage"),
      scope: z.enum(["own_org", "vendors"]),
      title: z.string(),
      requirement_text: z.string(),
      line_of_business: z.string(),
      limits: z
        .array(
          z.object({
            kind: z.string(),
            amount: z.number(),
            label: z.string().optional(),
          }),
        )
        .optional(),
      source_document_name: z.string().optional(),
      source_excerpt: z.string().optional(),
    }),
    mapInput: (input: Record<string, unknown>) => ({
      kind: input.kind,
      scope: input.scope,
      title: input.title,
      requirementText: input.requirement_text,
      lineOfBusiness: input.line_of_business,
      limits: input.limits,
      sourceDocumentName: input.source_document_name,
      sourceExcerpt: input.source_excerpt,
    }),
  },
} satisfies Record<
  string,
  {
    sharedName: keyof typeof SHARED_TOOLS;
    schema: z.ZodType;
    mapInput: (input: Record<string, unknown>) => Record<string, unknown>;
  }
>;

const retiredAliasEntries: CatalogEntry[] = Object.entries(
  RETIRED_NAME_ALIASES,
).map(([name, alias]) => {
  const inputSchema = z.toJSONSchema(alias.schema, { io: "input" }) as Record<
    string,
    unknown
  >;
  delete inputSchema.$schema;
  return {
    name,
    description: `Deprecated alias of ${alias.sharedName}.`,
    inputSchema,
    effect: MCP_CHAT_WRITE_TOOL_NAMES.has(alias.sharedName) ? "write" : "read",
  };
});

const sharedEntries: CatalogEntry[] = Object.entries(SHARED_TOOLS).map(
  ([name, definition]) => {
    const inputSchema = z.toJSONSchema(definition.inputSchema as z.ZodType, {
      io: "input",
    }) as Record<string, unknown>;
    delete inputSchema.$schema;
    return {
      name,
      description: definition.description ?? name,
      inputSchema,
      effect: MCP_CHAT_WRITE_TOOL_NAMES.has(name) ? "write" : "read",
      openWorld:
        name === "web_research" || name === "send_connected_vendor_invite",
    };
  },
);

const entries = [
  ...COMPATIBILITY_TOOLS,
  ...retiredAliasEntries,
  ...sharedEntries,
];
const byName = new Map(entries.map((entry) => [entry.name, entry]));

export function tenantMcpToolNames() {
  return entries.map((entry) => entry.name);
}

export function tenantMcpToolAccess(name: string) {
  const entry = byName.get(name);
  if (!entry) return null;
  return {
    effect: entry.effect ?? ("read" as Effect),
    openWorld: entry.openWorld ?? false,
    destructive: entry.destructive ?? false,
  };
}

export function buildTenantMcpToolCatalog() {
  return entries.map((entry) => {
    const access = tenantMcpToolAccess(entry.name)!;
    const write = access.effect === "write";
    return {
      name: entry.name,
      title: entry.description.split(".")[0],
      description: entry.description,
      inputSchema: entry.inputSchema,
      securitySchemes: [
        {
          type: "oauth2" as const,
          scopes: write ? ["read", "write"] : ["read"],
        },
      ],
      annotations: {
        readOnlyHint: !write,
        destructiveHint: access.destructive,
        idempotentHint: entry.idempotent ?? !write,
        openWorldHint: access.openWorld,
      },
    };
  });
}

export function resolveTenantMcpToolCall(
  name: string,
  input: Record<string, unknown>,
  canWrite: boolean,
) {
  const access = tenantMcpToolAccess(name);
  if (!access) throw new Error(`Unknown tool: ${name}`);
  if (access.effect === "write" && !canWrite)
    throw new Error("MCP token requires write scope");
  const alias = COMPATIBILITY_ALIASES[name];
  const retiredAlias =
    RETIRED_NAME_ALIASES[name as keyof typeof RETIRED_NAME_ALIASES];
  return {
    name,
    sharedName:
      alias?.sharedName ??
      retiredAlias?.sharedName ??
      (isTenantMcpEmailTool(name)
        ? name === "send_email_drafts"
          ? "send_email_draft"
          : name
        : undefined) ??
      (name in SHARED_TOOLS ? name : undefined),
    input: alias
      ? alias.mapInput(input)
      : retiredAlias
        ? retiredAlias.mapInput(
            retiredAlias.schema.parse(input) as Record<string, unknown>,
          )
        : input,
    compatibility:
      !isTenantMcpEmailTool(name) &&
      COMPATIBILITY_TOOLS.some((entry) => entry.name === name),
    retiredAlias: Boolean(retiredAlias),
  };
}
