import { z } from "zod";

export const SPOT_APP_RESOURCE_URI = "ui://spot/workspace/v2.html";
const LEGACY_SPOT_APP_RESOURCE_URIS = ["ui://spot/workspace/v1.html"] as const;
export const SPOT_APP_MIME_TYPE = "text/html;profile=mcp-app";
export const SPOT_MCP_DISCOVERY_VERSION = "2026-07-28";

export function isSpotAppResourceUri(uri: unknown): uri is string {
  return (
    uri === SPOT_APP_RESOURCE_URI ||
    LEGACY_SPOT_APP_RESOURCE_URIS.some((legacyUri) => uri === legacyUri)
  );
}

const workspaceSchema = z
  .object({
    view: z
      .enum([
        "policies",
        "certificates",
        "compliance",
        "requests",
        "files",
        "company",
        "mailbox",
        "proposals",
        "activity",
        "settings",
        "profile",
        "team",
      ])
      .default("policies"),
    recordId: z.string().trim().min(1).max(256).optional(),
    organizationId: z.string().trim().min(1).max(256).optional(),
    organizationCursor: z.string().trim().min(1).max(8192).optional(),
  })
  .strict();

const taskSchema = z
  .object({
    organizationId: z.string().trim().min(1).max(256).optional(),
    organizationCursor: z.string().trim().min(1).max(8192).optional(),
  })
  .strict();

const fileSchema = z
  .object({
    file: z
      .object({
        name: z
          .string()
          .trim()
          .min(1)
          .max(255)
          .regex(/^[^/\\\u0000-\u001f]+$/)
          .refine((name) => /\.(pdf|md|txt)$/i.test(name)),
        resourceUri: z.string().trim().min(1).max(8192),
      })
      .strict(),
  })
  .strict();

const taskTools = [
  {
    name: "find_insurance_quotes",
    title: "Find insurance quotes",
    description:
      "Open Spot’s authorized requests workspace when the user wants new insurance quotes or wants to find or manage a quote request. This opens the appropriate Spot workflow; it does not contact brokers, bind coverage, or change records.",
    view: "requests",
  },
  {
    name: "create_insurance_certificate",
    title: "Create an insurance certificate",
    description:
      "Open Spot’s certificate workspace when the user wants to create or issue a certificate of insurance (COI). This opens the authorized workspace and reads available certificate context; it does not generate or send a certificate. Any later change uses Spot’s separately authorized certificate tools and approval flow.",
    view: "certificates",
  },
  {
    name: "compare_insurance_coverage",
    title: "Compare insurance coverage",
    description:
      "Open Spot’s policy evidence workspace when the user wants to review or compare bound coverage, limits, endorsements, or policy evidence against a requirement. This reads authorized policy information and does not determine eligibility or change coverage.",
    view: "policies",
  },
  {
    name: "check_insurance_compliance",
    title: "Check insurance compliance",
    description:
      "Open Spot’s compliance workspace when the user wants to review insurance requirements, compliance status, or certificates against a contract. This reads authorized compliance information and does not issue or send a certificate.",
    view: "compliance",
  },
] as const;

type SpotTaskToolName = (typeof taskTools)[number]["name"];

export type SpotPrincipalKind = "client" | "broker" | "operator";
export type SpotWorkspaceInput = z.infer<typeof workspaceSchema> & {
  file?: z.infer<typeof fileSchema>["file"];
};
export type SpotCatalogTool = {
  name: string;
  annotations?: { readOnlyHint?: boolean };
};

function isSpotTaskTool(name: string): name is SpotTaskToolName {
  return taskTools.some((tool) => tool.name === name);
}

export function isSpotAppTool(name: string): boolean {
  return (
    name === "open_spot_workspace" ||
    name === "open_spot_record" ||
    name === "open_spot_file" ||
    name === "read_spot_workspace" ||
    isSpotTaskTool(name)
  );
}

export function parseSpotAppInput(
  name: string,
  input: unknown,
): SpotWorkspaceInput {
  if (!isSpotAppTool(name)) throw new Error("Unknown Spot app tool");
  if (name === "open_spot_file") {
    return { view: "files", ...fileSchema.parse(input) };
  }
  if (isSpotTaskTool(name)) {
    const task = taskTools.find((tool) => tool.name === name);
    if (!task) throw new Error("Unknown Spot task tool");
    const args = taskSchema.parse(input);
    return { ...args, view: task.view };
  }
  return workspaceSchema.parse(input);
}

export function buildSpotAppTools(principal: SpotPrincipalKind = "client") {
  const entryTools = [
    {
      name: "open_spot_workspace",
      title: "Spot",
      description: "Open the authenticated Spot insurance workspace.",
      entrypoints: [{ type: "global" }],
      schema: workspaceSchema,
    },
    {
      name: "open_spot_record",
      title: "Insurance workspace",
      description:
        "Inspect authorized insurance records in the current conversation.",
      entrypoints: [{ type: "thread" }],
      schema: workspaceSchema,
    },
    {
      name: "open_spot_file",
      title: "Inspect insurance document",
      description:
        "Inspect a host-selected PDF or Markdown/text document. Reading does not import, release, or send it.",
      entrypoints: [{ type: "file", extensions: [".pdf", ".md", ".txt"] }],
      schema: fileSchema,
    },
    {
      name: "read_spot_workspace",
      title: "Refresh workspace",
      description:
        "Read an authorized workspace view without starting a workflow or changing records.",
      entrypoints: [],
      schema: workspaceSchema,
    },
  ];
  const availableTaskTools = principal === "broker" ? [] : taskTools;

  return [...entryTools, ...availableTaskTools].map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: z.toJSONSchema(
      "schema" in tool ? tool.schema : taskSchema,
    ),
    securitySchemes: [{ type: "oauth2" as const, scopes: ["read"] }],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    _meta: {
      ui: {
        resourceUri: SPOT_APP_RESOURCE_URI,
        visibility:
          tool.name === "read_spot_workspace" ? ["app"] : ["model", "app"],
      },
      "openai/outputTemplate": SPOT_APP_RESOURCE_URI,
      "openai/ui": {
        ...( "entrypoints" in tool ? { entrypoints: tool.entrypoints } : {}),
        displayModes: ["inline", "fullscreen"],
      },
    },
  }));
}

export function filterSpotAppCatalog<Tool extends SpotCatalogTool>(
  catalog: Tool[],
  principal: SpotPrincipalKind,
  canWrite: boolean,
): Tool[] {
  if (principal === "broker") return [];
  return catalog.filter(
    (tool) => canWrite || tool.annotations?.readOnlyHint === true,
  );
}

export function buildRoleScopedSpotToolCatalog<Tool extends SpotCatalogTool>(
  catalog: Tool[],
  principal: SpotPrincipalKind,
  canWrite: boolean,
) {
  return [
    ...buildSpotAppTools(principal),
    ...filterSpotAppCatalog(catalog, principal, canWrite),
  ];
}

export function getSpotWorkspaceReadCall(
  principal: SpotPrincipalKind,
  view: string,
  recordId?: string,
  organizationId?: string,
): { name: string; arguments: Record<string, unknown> } | null {
  if (principal === "broker") return null;
  if (principal === "operator") {
    if (view === "activity") {
      return recordId
        ? { name: "get_operator_run", arguments: { run_id: recordId } }
        : null;
    }
    if (view === "mailbox") {
      return { name: "list_company_mailboxes", arguments: {} };
    }
    if (!organizationId) return null;
    switch (view) {
      case "policies":
        return recordId
          ? {
              name: "lookup_policy",
              arguments: { orgId: organizationId, policyIds: [recordId] },
            }
          : { name: "list_policies", arguments: { orgId: organizationId } };
      case "compliance":
        return {
          name: "lookup_compliance_requirements",
          arguments: { orgId: organizationId },
        };
      case "requests":
        return recordId
          ? {
              name: "get_procurement_request",
              arguments: { procurementRequestId: recordId },
            }
          : {
              name: "list_procurement_requests",
              arguments: { orgId: organizationId },
            };
      case "proposals":
        return recordId
          ? {
              name: "get_procurement_proposal",
              arguments: { procurementProposalId: recordId },
            }
          : null;
      case "files":
        return recordId
          ? {
              name: "read_client_file",
              arguments: { clientFileId: recordId },
            }
          : { name: "list_client_files", arguments: { orgId: organizationId } };
      case "company":
        return { name: "lookup_client_wiki", arguments: { orgId: organizationId } };
      default:
        return null;
    }
  }

  switch (view) {
    case "policies":
      return recordId
        ? { name: "get_policy", arguments: { id: recordId } }
        : { name: "list_policies", arguments: {} };
    case "certificates":
      return {
        name: "list_certificates",
        arguments: recordId ? { policyId: recordId } : {},
      };
    case "compliance":
      return { name: "lookup_compliance_requirements", arguments: {} };
    case "requests":
      return {
        name: "lookup_client_requests",
        arguments: recordId ? { requestId: recordId } : {},
      };
    case "files":
      return recordId
        ? { name: "read_client_file", arguments: { clientFileId: recordId } }
        : { name: "lookup_client_files", arguments: {} };
    case "company":
      return { name: "lookup_company_context", arguments: {} };
    case "mailbox":
      return { name: "list_email_drafts", arguments: {} };
    default:
      return null;
  }
}
