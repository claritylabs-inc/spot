/**
 * Source of truth for every WebMCP tool Spot registers in the browser.
 * Forms, imperative registration, `/llms.txt`, and docs/architecture/webmcp.md
 * all read names and descriptions from here.
 */

export type WebMcpJsonSchema = {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
  additionalProperties?: boolean;
};

type ToolBase = {
  title: string;
  description: string;
  /** Where the tool is registered, for agents and docs. */
  registeredOn: string;
  readOnly: boolean;
  consequential?: boolean;
  untrustedContent?: boolean;
};

type DeclarativeTool = ToolBase & {
  surface: "declarative";
  /** Named form fields and their `toolparamdescription`. */
  params?: Record<string, string>;
};

type ImperativeTool = ToolBase & {
  surface: "imperative";
  inputSchema: WebMcpJsonSchema;
  params?: undefined;
};

export type WebMcpToolDefinition = DeclarativeTool | ImperativeTool;

const noInput: WebMcpJsonSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

const SIGNED_IN = "Every signed-in client workspace page";

export const WEBMCP_CLIENT_PAGES = [
  "policies",
  "certificates",
  "compliance",
  "requests",
  "files",
  "agent",
] as const;

export const WEBMCP_TOOLS = {
  request_signup_code: {
    surface: "declarative",
    title: "Request signup code",
    description:
      "Start self-serve Spot signup for a business: emails a 6-digit verification code to the given work email. Use this first when creating a new client account; then call verify_signup_code with the code the account owner receives.",
    registeredOn: "/signup/client and /signup (email step)",
    readOnly: false,
    params: {
      email:
        "Work email address of the person who will own the Spot account. The code is sent to this inbox.",
    },
  },
  verify_signup_code: {
    surface: "declarative",
    title: "Verify signup code",
    description:
      "Complete Spot signup by submitting the 6-digit code emailed by request_signup_code. Only use a code supplied by the account owner or read from a mailbox you are authorized to access; never guess. On success Spot opens account setup.",
    registeredOn: "/signup/client and /signup (code step, after request_signup_code)",
    readOnly: false,
    params: {
      code: "The 6-digit verification code from the Spot sign-in email.",
    },
  },
  request_login_code: {
    surface: "declarative",
    title: "Request login code",
    description:
      "Sign in to an existing Spot account: emails a 6-digit verification code to the account's email. Then call verify_login_code.",
    registeredOn: "/login (email step)",
    readOnly: false,
    params: {
      email: "Email address of the existing Spot account.",
    },
  },
  verify_login_code: {
    surface: "declarative",
    title: "Verify login code",
    description:
      "Finish signing in by submitting the 6-digit code emailed by request_login_code. Only use a code supplied by the account owner or read from a mailbox you are authorized to access.",
    registeredOn: "/login (code step, after request_login_code)",
    readOnly: false,
    params: {
      code: "The 6-digit verification code from the Spot sign-in email.",
    },
  },
  submit_user_profile: {
    surface: "declarative",
    title: "Submit your profile",
    description:
      "Onboarding step 1 of 3 for a new client account: saves the signed-in person's name, job title, and optional mobile number. Then call submit_company_profile.",
    registeredOn: "/onboarding/setup (step 1)",
    readOnly: false,
    params: {
      name: "Full name of the signed-in person.",
      title: "Their job title or role at the business, for example Head of Operations.",
      phone:
        "Optional mobile number in international format, for example +14155550123. Enables texting Spot via iMessage. Leave empty if unknown.",
    },
  },
  submit_company_profile: {
    surface: "declarative",
    title: "Submit company profile",
    description:
      "Onboarding step 2 of 3: creates (or updates) the client organization with its legal or trading name and optional website, which Spot uses to research the company. Then call finish_onboarding.",
    registeredOn: "/onboarding/setup (step 2)",
    readOnly: false,
    params: {
      organization_name: "Name of the business Spot will manage insurance for.",
      website: "Optional company website, for example https://example.com.",
    },
  },
  finish_onboarding: {
    surface: "declarative",
    title: "Finish onboarding",
    description:
      "Onboarding step 3 of 3: completes setup and opens the Spot client workspace, where the signed-in insurance tools (list_policies and others) become available.",
    registeredOn: "/onboarding/setup (step 3)",
    readOnly: false,
  },

  list_policies: {
    surface: "imperative",
    title: "List policies",
    description:
      "List the signed-in client's insurance policies with carrier, policy number, lines of business, term dates, and extraction status. Use to find a policy_id for get_policy, search_policy_wording, or generate_certificate.",
    registeredOn: SIGNED_IN,
    readOnly: true,
    inputSchema: noInput,
  },
  get_policy: {
    surface: "imperative",
    title: "Get policy",
    description:
      "Get one policy's extracted details: carrier, insured, term, premium, limits, deductibles, coverages, and summary. Use for coverage questions after list_policies.",
    registeredOn: SIGNED_IN,
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        policy_id: { type: "string", description: "Policy ID from list_policies." },
      },
      required: ["policy_id"],
      additionalProperties: false,
    },
  },
  search_policy_wording: {
    surface: "imperative",
    title: "Search policy wording",
    description:
      "Search a policy document's extracted sections (forms, endorsements, conditions, exclusions) for words or phrases and return matching excerpts with page numbers. Use to check exact wording before answering coverage questions.",
    registeredOn: SIGNED_IN,
    readOnly: true,
    untrustedContent: true,
    inputSchema: {
      type: "object",
      properties: {
        policy_id: { type: "string", description: "Policy ID from list_policies." },
        query: {
          type: "string",
          description: "Words or phrase to find, for example \"additional insured\" or \"cyber exclusion\".",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 25,
          description: "Maximum sections to return (default 8).",
        },
      },
      required: ["policy_id", "query"],
      additionalProperties: false,
    },
  },
  list_certificates: {
    surface: "imperative",
    title: "List certificates",
    description:
      "List certificates of insurance already issued for the client, with holder, policy, current version, and PDF link.",
    registeredOn: SIGNED_IN,
    readOnly: true,
    inputSchema: noInput,
  },
  list_insurance_requests: {
    surface: "imperative",
    title: "List insurance requests",
    description:
      "List the client's insurance requests (new coverage, renewals, contract requirements) with status, target effective date, shared request details, and resulting policy.",
    registeredOn: SIGNED_IN,
    readOnly: true,
    inputSchema: noInput,
  },
  get_insurance_request: {
    surface: "imperative",
    title: "Get insurance request",
    description:
      "Check one insurance request's status, shared details, attached files, and resulting policy.",
    registeredOn: SIGNED_IN,
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        request_id: { type: "string", description: "Request ID from list_insurance_requests or create_insurance_request." },
      },
      required: ["request_id"],
      additionalProperties: false,
    },
  },
  list_compliance_requirements: {
    surface: "imperative",
    title: "List compliance requirements",
    description:
      "List insurance requirements from the client's contracts and leases with their compliance status (met, not_met, expiring_soon, expired, unverified), reasons, and matched policies.",
    registeredOn: SIGNED_IN,
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["met", "not_met", "expiring_soon", "expired", "unverified"],
          description: "Optional status filter.",
        },
      },
      additionalProperties: false,
    },
  },
  open_spot_page: {
    surface: "imperative",
    title: "Open Spot page",
    description:
      "Navigate the workspace to a page. Page-specific tools (generate_certificate, create_insurance_request, attach_request_document, recheck_compliance_requirement) register only on their pages, so open the page first.",
    registeredOn: SIGNED_IN,
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        page: {
          type: "string",
          enum: [...WEBMCP_CLIENT_PAGES],
          description: "Workspace page to open.",
        },
        record_id: {
          type: "string",
          description: "Optional policy ID (page policies) or request ID (page requests) to open its detail page.",
        },
      },
      required: ["page"],
      additionalProperties: false,
    },
  },
  start_spot_agent_thread: {
    surface: "imperative",
    title: "Ask the Spot agent",
    description:
      "Start a new Spot agent conversation with a question or task, for example summarizing coverage gaps. Opens the thread page and returns its URL; the agent's answer appears there. Any email the agent drafts still waits for the user's explicit send confirmation.",
    registeredOn: SIGNED_IN,
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "The question or task for the Spot agent." },
      },
      required: ["message"],
      additionalProperties: false,
    },
  },
  generate_certificate: {
    surface: "imperative",
    title: "Generate certificate of insurance",
    description:
      "Generate (or reuse) a certificate of insurance PDF for one policy and one certificate holder. Returns the PDF link. Requests needing endorsements or additional-insured changes are held for broker review instead of generated; nothing is emailed.",
    registeredOn: "/certificates, /compliance, /policies and /policies/:id",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        policy_id: { type: "string", description: "Policy ID from list_policies." },
        holder_name: { type: "string", description: "Certificate holder's legal name." },
        holder_contact_name: { type: "string", description: "Optional holder contact person." },
        holder_email: { type: "string", description: "Optional holder email (stored on the certificate; not emailed)." },
        holder_phone: { type: "string", description: "Optional holder phone." },
        address_line1: { type: "string", description: "Optional holder street address." },
        address_line2: { type: "string", description: "Optional suite or unit." },
        city: { type: "string" },
        state: { type: "string", description: "State or province code." },
        postal_code: { type: "string" },
        country: { type: "string" },
      },
      required: ["policy_id", "holder_name"],
      additionalProperties: false,
    },
  },
  create_insurance_request: {
    surface: "imperative",
    title: "Create insurance request",
    description:
      "Submit a new insurance request to the Spot team: new coverage, a renewal, a policy change, or coverage needed to meet a contract requirement. Describe the need in the narrative. Spot staff review it before contacting any broker.",
    registeredOn: "/requests",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short request title, for example \"Cyber liability for new SaaS contract\"." },
        narrative: {
          type: "string",
          description: "What is needed and why: coverage type, limits, deadlines, contract requirements, and business context.",
        },
        target_effective_date: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description: "Optional date coverage should start, YYYY-MM-DD.",
        },
      },
      required: ["title", "narrative"],
      additionalProperties: false,
    },
  },
  attach_request_document: {
    surface: "imperative",
    title: "Attach request document",
    description:
      "Upload a supporting document (contract, prior policy, loss runs, application) to an insurance request. Clients share documents through requests; policy uploads themselves are handled by Spot staff.",
    registeredOn: "/requests and /requests/:id",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        request_id: { type: "string", description: "Request ID from list_insurance_requests or create_insurance_request." },
        file_name: { type: "string", description: "File name including extension, for example lease.pdf." },
        content_type: { type: "string", description: "MIME type, for example application/pdf." },
        content_base64: { type: "string", description: "File contents, base64-encoded (max 20 MB decoded)." },
      },
      required: ["request_id", "file_name", "content_type", "content_base64"],
      additionalProperties: false,
    },
  },
  recheck_compliance_requirement: {
    surface: "imperative",
    title: "Recheck compliance requirement",
    description:
      "Re-evaluate one compliance requirement against the client's current policies and return its status, matched policies, and notes.",
    registeredOn: "/compliance",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        requirement_id: { type: "string", description: "Requirement ID from list_compliance_requirements." },
      },
      required: ["requirement_id"],
      additionalProperties: false,
    },
  },
} satisfies Record<string, WebMcpToolDefinition>;

export type WebMcpToolName = keyof typeof WEBMCP_TOOLS;

export function getWebMcpTool(name: WebMcpToolName): WebMcpToolDefinition {
  return WEBMCP_TOOLS[name];
}
