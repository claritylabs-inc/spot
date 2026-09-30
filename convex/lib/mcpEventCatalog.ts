export const MCP_EVENT_NAMES = [
  "compliance.status_changed",
  "vendor.policy_expiring",
  "policy.ready",
  "policy.review_required",
  "proposal.review_ready",
  "procurement.request_updated",
] as const;

export type McpEventName = (typeof MCP_EVENT_NAMES)[number];

const definitions = {
  "compliance.status_changed": {
    description: "Spot detected an own-insurance or connected-vendor compliance transition. Detection follows Spot's compliance monitoring schedule, not live carrier monitoring.",
    filters: ["org_id", "vendor_org_id"],
    payload: ["org_id", "status", "vendor_org_id", "notification_type"],
    required: ["org_id", "status", "notification_type"],
  },
  "vendor.policy_expiring": {
    description: "Spot's scheduled compliance monitor detected an expiring or expired policy for an authorized connected vendor.",
    filters: ["org_id", "vendor_org_id"],
    payload: ["org_id", "vendor_org_id", "status", "notification_type"],
    required: ["org_id", "vendor_org_id", "status", "notification_type"],
  },
  "policy.ready": {
    description: "A policy extraction has been promoted to its final evidence-backed state, not merely uploaded or previewed.",
    filters: ["org_id", "policy_id"],
    payload: ["org_id", "policy_id"],
    required: ["org_id", "policy_id"],
  },
  "policy.review_required": {
    description: "Spot detected incomplete policy extraction or coverage details requiring review. This does not approve or resolve those terms.",
    filters: ["org_id", "policy_id"],
    payload: ["org_id", "policy_id"],
    required: ["org_id", "policy_id"],
  },
  "proposal.review_ready": {
    description: "An operator-private procurement proposal review is ready. Only active Spot operators may subscribe. Review readiness is not staff approval or proposal selection.",
    filters: ["org_id", "request_id"],
    payload: ["org_id", "request_id", "proposal_id", "review_id"],
    required: ["org_id", "request_id", "proposal_id", "review_id"],
  },
  "procurement.request_updated": {
    description: "A client-visible procurement request's public workflow status, target effective date, or title changed. Does not include private notes, proposals, or market activity.",
    filters: ["org_id", "request_id"],
    payload: ["org_id", "request_id", "status"],
    required: ["org_id", "request_id", "status"],
  },
} satisfies Record<McpEventName, { description: string; filters: string[]; payload: string[]; required: string[] }>;

export function mcpEventDefinition(name: string) {
  if (!MCP_EVENT_NAMES.includes(name as McpEventName)) throw new Error("Unsupported event");
  return definitions[name as McpEventName];
}

export function validateMcpEventFilters(name: string, values: Record<string, unknown>): Record<string, string> {
  const definition = mcpEventDefinition(name);
  const filters: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!definition.filters.includes(key) || typeof value !== "string" || !value || value.length > 128) {
      throw new Error("Invalid event filters");
    }
    filters[key] = value;
  }
  return filters;
}

export function validateMcpEventData(name: string, values: Record<string, string>) {
  const definition = mcpEventDefinition(name);
  if (definition.required.some((key) => !values[key])) throw new Error("Missing event data");
  if (Object.entries(values).some(([key, value]) => !definition.payload.includes(key) || typeof value !== "string" || value.length > 256)) {
    throw new Error("Invalid event data");
  }
}

export function listMcpEventDefinitions(principalKind: "organization" | "operator") {
  return MCP_EVENT_NAMES.filter((name) => principalKind === "operator" || name !== "proposal.review_ready").map((name) => {
    const definition = definitions[name];
    return {
      name,
      description: definition.description,
      delivery: ["webhook"],
      inputSchema: {
        type: "object",
        properties: Object.fromEntries(definition.filters.map((key) => [key, { type: "string", description: `Restrict updates to this ${key.replaceAll("_", " ")}.` }])),
        additionalProperties: false,
      },
      payloadSchema: {
        type: "object",
        properties: Object.fromEntries(definition.payload.map((key) => [key, { type: "string" }])),
        required: definition.required,
        additionalProperties: false,
      },
    };
  });
}
