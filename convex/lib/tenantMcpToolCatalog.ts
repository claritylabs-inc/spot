import { z } from "zod";
import {
  lookupPolicy,
  lookupCompanyContext,
  lookupClientRequests,
  lookupClientFiles,
  readClientFile,
  compareCoverages,
  lookupComplianceRequirements,
  lookupConnectedVendors,
  lookupVendorPolicies,
  lookupVendorCompliance,
  lookupPolicySection,
  lookupAddress,
  saveNote,
  confirmPolicyFact,
  generateCoi,
  coordinateMailboxTask,
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
  lookup_connected_vendors: lookupConnectedVendors,
  lookup_vendor_policies: lookupVendorPolicies,
  lookup_vendor_compliance: lookupVendorCompliance,
  lookup_policy_section: lookupPolicySection,
  lookup_address: lookupAddress,
  save_note: saveNote,
  confirm_policy_fact: confirmPolicyFact,
  generate_coi: generateCoi,
  coordinate_mailbox_task: coordinateMailboxTask,
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
      effect:
        MCP_CHAT_WRITE_TOOL_NAMES.has(name) ||
        name === "coordinate_mailbox_task"
          ? "write"
          : "read",
      openWorld: name === "web_research" || name === "coordinate_mailbox_task",
    };
  },
);

const entries = [...COMPATIBILITY_TOOLS, ...sharedEntries];
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
  return {
    name,
    sharedName: alias?.sharedName ?? (name in SHARED_TOOLS ? name : undefined),
    input: alias ? alias.mapInput(input) : input,
    compatibility: COMPATIBILITY_TOOLS.some((entry) => entry.name === name),
  };
}
