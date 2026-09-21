import { tool } from "ai";
import { z } from "zod";

import { ORG_WIKI_SECTION_KEYS } from "./orgWiki";

/**
 * Tool definitions for agentic chat.
 * These schemas are shared between processThreadChat (Convex) and /api/chat (Next.js).
 * Execute functions are wired up in each action separately.
 */

export const lookupPolicy = tool({
  description:
    "Look up insurance policies on demand by exact policy IDs, expiration window, carrier name, policy number, ACORD line of business, or keywords. Returns fresh policy summaries with source-backed client facts and policy-scoped Producer, insurer, carrier, and General Agent parties when available.",
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe("Search query — carrier name, policy number, or keywords"),
    policyIds: z
      .array(z.string())
      .max(5)
      .optional()
      .describe(
        "Up to five exact policy IDs supplied by the current request or policy-focus hints. Use this to refresh those policies before answering; IDs are routing hints, not policy facts.",
      ),
    expiringWithinDays: z
      .number()
      .int()
      .min(1)
      .max(365)
      .optional()
      .describe(
        "Return policies expiring between today and this many days from now.",
      ),
    lineOfBusiness: z
      .string()
      .optional()
      .describe(
        "Filter by ACORD LOB code or label (e.g., CGL, AUTOB, WORK, Commercial General Liability)",
      ),
    policyType: z
      .string()
      .optional()
      .describe("Deprecated alias for lineOfBusiness."),
    carrier: z.string().optional().describe("Filter by carrier/insurer name"),
  }),
});

export const searchThreadHistory = tool({
  description:
    "Search older messages in this exact conversation. Use only when the user explicitly refers to earlier wording, a prior decision, or context that is not present in the supplied recent history. Results are conversational context, not authoritative policy evidence.",
  inputSchema: z.object({
    query: z
      .string()
      .min(2)
      .max(500)
      .describe(
        "Specific words, decision, person, or topic to find in this thread.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(8)
      .optional()
      .describe(
        "Maximum excerpts to return. Defaults to 5 and never exceeds 8.",
      ),
  }),
});

export const readThreadAttachment = tool({
  description:
    "Reopen one attachment from an older message in this exact conversation after search_thread_history identifies it. Use the exact message ID and filename returned by that search. Do not use attachment content as authoritative policy evidence.",
  inputSchema: z.object({
    messageId: z
      .string()
      .describe("Exact thread message ID returned by search_thread_history."),
    filename: z
      .string()
      .min(1)
      .max(500)
      .describe("Exact attachment filename returned by search_thread_history."),
  }),
});

export const presentPolicyCard = tool({
  description:
    "Present one exact policy card in the current response. Use only after another policy tool successfully resolved that policy during this turn and only when the user explicitly asks to open, show, send, or link the policy record. Policy lookup, factual questions, summaries, comparisons, and policy inventories do not by themselves justify a card.",
  inputSchema: z.object({
    policyId: z
      .string()
      .describe(
        "The exact policy ID returned by a successful policy tool in this turn.",
      ),
    allowMultiple: z
      .boolean()
      .optional()
      .describe(
        "Set true only when the user explicitly asks for multiple policy cards or links. Otherwise omit it, and the response is limited to one card.",
      ),
    repeatRequested: z
      .boolean()
      .optional()
      .describe(
        "Set true only when the user explicitly asks to receive this same policy card again. Otherwise recent duplicate cards are suppressed.",
      ),
  }),
});

export const lookupCompanyContext = tool({
  description:
    "Read the whole company wiki for the readable organizations: durable company-profile facts and preferences as one markdown document each. Use this for company operations, identity, stable preferences, or saved risk context. Never use the company wiki for policy terms, limits, endorsements, coverage, certificates, or other policy facts; use policy tools for those.",
  inputSchema: z.object({
    orgId: z
      .string()
      .optional()
      .describe(
        "Readable organization ID when the request targets a specific company.",
      ),
    query: z
      .string()
      .optional()
      .describe(
        "Company name to narrow which readable organizations are returned. The whole wiki is returned either way.",
      ),
  }),
});

export const lookupClientRequests = tool({
  description:
    "Read client-visible insurance requests, current client-facing stage, target dates, shared notes, and shared file metadata. Returns only the client request view, never private proposals or market activity.",
  inputSchema: z.object({
    requestId: z
      .string()
      .min(1)
      .optional()
      .describe("Optional exact request ID from an earlier request lookup."),
    limit: z.number().int().min(1).max(20).optional(),
  }),
});

export const lookupClientFiles = tool({
  description:
    "List client-visible files from the readable client organizations. Use this for shared contracts, schedules, reports, forms, and other miscellaneous documents that are not bound policy PDFs.",
  inputSchema: z.object({
    orgId: z
      .string()
      .optional()
      .describe("Optional exact readable client organization ID."),
    query: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(20).optional(),
  }),
});

export const readClientFile = tool({
  description:
    "Read one exact client-visible shared file after lookup_client_files identifies it. Returns bounded extracted text for supported documents.",
  inputSchema: z.object({
    clientFileId: z.string().min(1).describe("Exact client file ID."),
  }),
});

export const attachClientFile = tool({
  description:
    "Attach one exact client-visible shared file to the response after lookup_client_files identifies it.",
  inputSchema: z.object({
    clientFileId: z.string().min(1).describe("Exact client file ID."),
  }),
});

export const compareCoverages = tool({
  description:
    "Compare two policies side by side — lines of business, limits, deductibles, and premium.",
  inputSchema: z.object({
    policyId1: z
      .string()
      .describe("Policy reference for the first policy to compare"),
    policyId2: z
      .string()
      .describe("Policy reference for the second policy to compare"),
  }),
});

export const lookupComplianceRequirements = tool({
  description:
    "Look up the organization's saved insurance coverage requirements. Use this when the user asks what contractors/vendors must carry, asks about my requirements, minimum required limits, deductibles, endorsements, or compliance checklist requirements. Results distinguish scope.",
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe(
        "Requirement topic to search for, such as contractors, general liability, cyber, auto, workers comp, additional insured, waiver, or a limit amount.",
      ),
    scope: z
      .enum(["vendors", "own_org", "all"])
      .optional()
      .describe(
        "Filter by scope. Use vendors for contractor/vendor obligations, own_org for requirements owned by this org, or all to search every requirement.",
      ),
  }),
});

export const importRequirementAttachments = tool({
  description:
    "Persist the new requirement documents identified by the server in the current message as canonical compliance sources and run structured requirement extraction. Use this before answering from a newly supplied agreement, contract, lease, insurance schedule, or requirement packet. The server owns file selection, source classification, and requirement scope.",
  inputSchema: z.object({}),
});

export const lookupConnectedVendors = tool({
  description:
    "Look up connected vendor organizations and their compliance status. Use this when the user asks which vendors are non-compliant, compliant, waiting on policies, invited, or asks for vendor status.",
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe(
        "Vendor name, website, email, or relationship label to filter by.",
      ),
    status: z
      .enum([
        "all",
        "compliant",
        "non_compliant",
        "attention",
        "waiting_on_policies",
      ])
      .optional()
      .describe("Optional compliance/status filter."),
  }),
});

export const lookupVendorPolicies = tool({
  description:
    "List policies for a specific connected vendor. Use this before answering questions about a vendor's current insurance, carriers, policy numbers, limits, named insured, or expiration dates.",
  inputSchema: z.object({
    vendorOrgId: z
      .string()
      .optional()
      .describe("Connected vendor organization ID."),
    vendorName: z
      .string()
      .optional()
      .describe("Vendor name if the ID is not known."),
    query: z
      .string()
      .optional()
      .describe(
        "Optional carrier, policy number, coverage, or line-of-business filter.",
      ),
  }),
});

export const lookupVendorCompliance = tool({
  description:
    "Return the requirement-by-requirement compliance checklist for connected vendors, including matched policy details, expiration dates, limits, named insured, and the reason each requirement is met or not met. Use this for non-compliant vendor questions and vendor compliance diffs.",
  inputSchema: z.object({
    vendorOrgId: z
      .string()
      .optional()
      .describe("Connected vendor organization ID."),
    vendorName: z
      .string()
      .optional()
      .describe("Vendor name if the ID is not known."),
    includeCompliant: z
      .boolean()
      .optional()
      .describe(
        "Include met requirements as well as open issues. Defaults to true for specific vendors and false for all vendors.",
      ),
  }),
});

export const saveNote = tool({
  description:
    "Add an explicit stable company-profile fact to the company wiki, only when the user asks Spot to remember it. Do not save policy details, endorsements, COI/certificate details, draft/email metadata, agent capabilities, tool limitations, workflow status, or one-off requests.",
  inputSchema: z.object({
    content: z.string().describe("The company fact to write into the wiki"),
    section: z
      .enum(ORG_WIKI_SECTION_KEYS)
      .describe("The company-wiki section this fact belongs in"),
    policyId: z
      .string()
      .optional()
      .describe(
        "Deprecated. Policy-specific notes are rejected by wiki policy.",
      ),
  }),
});

export const confirmPolicyFact = tool({
  description:
    "Confirm a policy fact from original PDF source evidence and optionally update a small set of top-level extracted policy fields. Use only after lookup_policy_section returns original-PDF sourceSpanIds that directly support the fact. This does not save policy details to long-term org memory.",
  inputSchema: z.object({
    policyId: z
      .string()
      .describe("Policy reference for the fact being confirmed"),
    fact: z
      .string()
      .describe("Concise policy fact confirmed from the original PDF"),
    sourceSpanIds: z
      .array(z.string())
      .min(1)
      .describe("Stable source span IDs returned by lookup_policy_section"),
    fieldUpdates: z
      .object({
        carrier: z.string().optional(),
        security: z.string().optional(),
        generalAgentName: z.string().optional(),
        broker: z.string().optional(),
        policyNumber: z.string().optional(),
        effectiveDate: z.string().optional(),
        expirationDate: z.string().optional(),
        insuredName: z.string().optional(),
        premium: z.string().optional(),
        totalCost: z.string().optional(),
        minPremium: z.string().optional(),
        depositPremium: z.string().optional(),
        summary: z.string().optional(),
      })
      .optional()
      .describe(
        "Optional top-level extracted fields to update when directly supported by the cited PDF evidence",
      ),
  }),
});

export const lookupPolicySection = tool({
  description:
    "Search within a specific policy's source-native document outline and original PDF evidence for detailed content about a topic. Use this for coverage wording, declarations, forms, endorsements, exclusions, conditions, definitions, certificate wording, or any exact policy language that is not answered by summary data. Returns matching outline entries, source evidence, and sourceSpanIds for original-PDF evidence when available.",
  inputSchema: z.object({
    policyId: z
      .string()
      .describe(
        "The policy reference to search within. This may be a policy number, exact policy ID, filename, carrier, or other policy reference returned by lookup_policy.",
      ),
    query: z
      .string()
      .describe(
        "What to search for — coverage name, form number, original heading, topic, clause label, or keywords",
      ),
  }),
});

export const LOOKUP_ADDRESS_DESCRIPTION =
  "Validate and standardize a user-provided postal address with Mapbox before saving it or passing it to generate_coi. Use the returned structured fields only when Mapbox validates the first candidate. If the result is ambiguous or not found, ask the user to confirm a complete address instead of guessing.";

export const lookupAddressInputSchema = z.object({
  query: z
    .string()
    .min(3)
    .max(256)
    .describe(
      "Full address exactly as the user supplied it, including city, region, postal code, and country when available.",
    ),
  countryCode: z
    .string()
    .regex(/^[A-Za-z]{2}$/)
    .optional()
    .describe(
      "Optional ISO 3166-1 alpha-2 country code used only to disambiguate the lookup, such as US or CA.",
    ),
});

export const lookupAddress = tool({
  description: LOOKUP_ADDRESS_DESCRIPTION,
  inputSchema: lookupAddressInputSchema,
});

export const attachPolicyDocument = tool({
  description:
    "Attach or send the original full policy PDF document for a specific policy. Use this when the user asks for a copy of the policy, policy PDF, full policy, declarations PDF, wording, or original policy document in chat/iMessage/SMS. For email delivery, prefer the email_expert tool so it can attach the original policy PDF to the email.",
  inputSchema: z.object({
    policyId: z
      .string()
      .describe(
        "The policy reference whose original PDF should be attached. This may be a policy number, exact policy ID, filename, carrier, or other policy reference returned by lookup_policy.",
      ),
  }),
});

export const GENERATE_COI_DESCRIPTION =
  "Generate certificate PDFs in exactly one of two modes. Policy mode uses policyId plus a holder and includes all available policy coverages; when the user provides an address, call lookup_address first. Requirements mode uses requirementSourceDocumentId or one requirementId; the saved source supplies the holder and Spot creates the necessary certificates from matching policies with only the relevant coverages. Do not combine these modes. Additional-insured, waiver, primary/non-contributory, loss payee, and mortgagee requests issue only when existing policy evidence supports them; otherwise Spot gates the certificate and returns a drafted broker email.";

export const generateCoiInputSchema = z.object({
  policyId: z
    .string()
    .optional()
    .describe("Policy-mode reference. Omit in requirements mode."),
  requirementSourceDocumentId: z
    .string()
    .optional()
    .describe(
      "Requirements-mode source ID returned by lookup_compliance_requirements. The source provides the holder and all active requirements.",
    ),
  requirementId: z
    .string()
    .optional()
    .describe(
      "Requirements-mode exact requirement ID. Spot uses its connected source and generates only for this requirement.",
    ),
  certificateHolder: z
    .string()
    .optional()
    .describe(
      "Certificate holder name. Include the address in this block only when the user already provided it.",
    ),
  holderContactName: z
    .string()
    .optional()
    .describe(
      "Specific certificate holder contact name or attention line when the user provides one",
    ),
  holderEmail: z
    .string()
    .optional()
    .describe(
      "Certificate holder email address only when the user explicitly asks Spot to email/send the certificate or already provides the email. Do not ask for this for ordinary certificate generation.",
    ),
  holderPhone: z
    .string()
    .optional()
    .describe(
      "Certificate holder phone number only when the user provides one",
    ),
  addressLine1: z
    .string()
    .optional()
    .describe(
      "Certificate holder street address line 1 when the user provides it.",
    ),
  addressLine2: z
    .string()
    .optional()
    .describe(
      "Certificate holder street address line 2 when the user provides it.",
    ),
  city: z
    .string()
    .optional()
    .describe("Certificate holder city when provided."),
  state: z
    .string()
    .optional()
    .describe("Certificate holder state/province when provided."),
  postalCode: z
    .string()
    .optional()
    .describe("Certificate holder postal code when provided."),
  country: z
    .string()
    .optional()
    .describe("Certificate holder country when provided."),
  requestText: z
    .string()
    .optional()
    .describe(
      "The user's full certificate request. Include explicit endorsement-bearing wording only if the user asked for it.",
    ),
  descriptionOfOperations: z
    .string()
    .optional()
    .describe(
      "Source-backed description-of-operations wording to place in the certificate description box when the user explicitly provides wording or the policy source facts clearly support operations, locations, covered autos, or special items. Do not invent this wording. Do not use this for generic policy summaries, carrier names, policy numbers, limits, terms, or unsupported endorsement status.",
    ),
  requestedEndorsements: z
    .array(z.string())
    .optional()
    .describe(
      "Specific endorsement requests only when the user explicitly asks for them, such as additional insured, waiver of subrogation, primary and non-contributory, loss payee, or mortgagee. Do not invent extra wording.",
    ),
  additionalInsuredName: z
    .string()
    .optional()
    .describe(
      "Name of the requested additional insured when the user asks to add or show one on the certificate.",
    ),
  explicitReissue: z
    .boolean()
    .optional()
    .describe(
      "Set true only when the user explicitly asks to reissue/regenerate a new certificate version even if one already exists for this holder and current policy version",
    ),
});

export const generateCoi = tool({
  description: GENERATE_COI_DESCRIPTION,
  inputSchema: generateCoiInputSchema,
});

export const createImessageGroupChat = tool({
  description:
    "Create a new iMessage group chat after the user explicitly asks for it or clearly approves the assistant's suggestion. Include the current user automatically; recipients can be teammate names, broker/client/vendor names, or explicit phone numbers. If any recipient is ambiguous or lacks a phone number, ask for clarification instead of guessing.",
  inputSchema: z.object({
    recipients: z
      .array(z.string())
      .min(1)
      .describe(
        "People or phone numbers to include besides the current user, such as Adyan, my broker, or +12025550123.",
      ),
    openingMessage: z
      .string()
      .min(1)
      .describe("The first message Spot should send into the new group chat."),
    title: z
      .string()
      .optional()
      .describe(
        "Optional concise group title. Leave unset unless the user requested a title.",
      ),
    confirmed: z
      .boolean()
      .describe(
        "True only when the user has explicitly asked to create the group or has approved a prior suggestion.",
      ),
  }),
});

export const searchConnectedEmail = tool({
  description:
    "Search connected IMAP email accounts live without persisting mailbox contents. Use this iteratively with targeted search terms and date windows when the user asks to find emails, policies, leases, vendor messages, requirements, receipts, or attachments in connected mailboxes.",
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe(
        "Text to search for in subject, sender, recipients, or message body.",
      ),
    mailbox: z
      .string()
      .optional()
      .describe("Mailbox/folder name. Defaults to INBOX."),
    sinceDays: z
      .number()
      .int()
      .min(1)
      .max(90)
      .optional()
      .describe(
        "Fallback rolling lookback when dateFrom/dateTo are not known. Defaults to 14.",
      ),
    dateFrom: z
      .string()
      .optional()
      .describe(
        "Inclusive start date for a targeted search window in YYYY-MM-DD format.",
      ),
    dateTo: z
      .string()
      .optional()
      .describe(
        "Inclusive end date for a targeted search window in YYYY-MM-DD format.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(25)
      .optional()
      .describe("Maximum matching emails to return."),
  }),
});

export const readConnectedEmail = tool({
  description:
    "Read one connected-email message returned by search_connected_email, including bounded body text and attachment metadata.",
  inputSchema: z.object({
    emailRef: z
      .string()
      .describe("Opaque emailRef returned by search_connected_email."),
  }),
});

export const readConnectedEmailAttachment = tool({
  description:
    "Read text from a specific PDF, DOCX, TXT, Markdown, CSV, or JSON attachment on a connected-email message without persisting the mailbox message. Use after read_connected_email returns attachment metadata and the user needs the attachment contents inspected before deciding whether to import it.",
  inputSchema: z.object({
    emailRef: z
      .string()
      .describe("Opaque emailRef returned by search_connected_email."),
    filename: z
      .string()
      .describe("Exact attachment filename returned by read_connected_email."),
  }),
});

export const importConnectedEmailPolicyAttachments = tool({
  description:
    "Import PDF attachments from a connected-email message into the Spot policy library. Use after search/read confirms the attachments are bound policies, declarations, binders, endorsements, COIs, or other post-binding insurance documents.",
  inputSchema: z.object({
    emailRef: z
      .string()
      .describe("Opaque emailRef returned by search_connected_email."),
    filenames: z
      .array(z.string())
      .optional()
      .describe(
        "Specific PDF filenames to import. Omit to import all PDF attachments on the email as one policy package.",
      ),
  }),
});

export const importConnectedEmailRequirementAttachments = tool({
  description:
    "Import PDF/DOCX/TXT/CSV/JSON attachments and optionally the email body from a connected-email message as source-backed insurance compliance requirements. Use after search/read confirms the email or attachments contain leases, contracts, vendor requirement packets, or other insurance requirement language.",
  inputSchema: z.object({
    emailRef: z
      .string()
      .describe("Opaque emailRef returned by search_connected_email."),
    filenames: z
      .array(z.string())
      .optional()
      .describe(
        "Specific attachment filenames to import. Omit to import all requirement-like attachments on the email.",
      ),
    includeEmailBody: z
      .boolean()
      .optional()
      .describe(
        "Set true when the email body itself contains requirement language that should be imported.",
      ),
    sourceType: z
      .enum([
        "lease_agreement",
        "client_contract",
        "vendor_requirements",
        "other",
      ])
      .optional()
      .describe(
        "Source document type. Infer lease_agreement for leases and client_contract for customer/client contracts.",
      ),
    scope: z
      .enum(["vendors", "own_org"])
      .optional()
      .describe(
        "Requirement scope. Use own_org for the org's lease/client obligations or vendors for vendor/customer standards.",
      ),
  }),
});

export const saveConnectedEmailAttachmentsToThread = tool({
  description:
    "Save attachments from a connected-email message into the current Spot thread so they can be reused later and attached to outbound email drafts without searching the mailbox again. Use after search/read identifies documents that are relevant to the user's task.",
  inputSchema: z.object({
    emailRef: z
      .string()
      .describe("Opaque emailRef returned by search_connected_email."),
    filenames: z
      .array(z.string())
      .optional()
      .describe(
        "Specific attachment filenames to save. Omit to save all attachments on the email that fit size limits.",
      ),
  }),
});

export const saveConnectedEmailMessageToThread = tool({
  description:
    "Export the connected-email message itself into the current Spot thread as an attachable .eml proof document. Use this when the user asks to attach, forward, preserve, or provide proof of an email whose relevant content is in the email body rather than an attachment, such as a cancellation email, receipt, confirmation, notice, or correspondence.",
  inputSchema: z.object({
    emailRef: z
      .string()
      .describe(
        "Opaque emailRef returned by search_connected_email or read_connected_email.",
      ),
    filename: z
      .string()
      .optional()
      .describe(
        "Optional filename for the saved email export. Defaults to a subject-based .eml name.",
      ),
  }),
});

export const sendConnectedVendorInvite = tool({
  description:
    "Send a connected-vendor access invitation to a vendor email address so the org can monitor that vendor's insurance records. Use only when the user asks to invite or connect a vendor, or explicitly approves doing so.",
  inputSchema: z.object({
    vendorEmail: z
      .string()
      .email()
      .describe("Vendor contact email address to invite."),
    relationshipLabel: z
      .string()
      .optional()
      .describe(
        "Optional vendor/company label for the connected-org relationship.",
      ),
    note: z
      .string()
      .optional()
      .describe("Optional note to include in the vendor invitation email."),
  }),
});

export const coordinateMailboxTask = tool({
  description:
    "Delegate a complex connected-mailbox workflow to the Spot mailbox coordinator. Use this for multi-step requests like finding policies and importing them, finding a lease and extracting insurance requirements, or investigating vendor email history.",
  inputSchema: z.object({
    task: z
      .string()
      .min(1)
      .describe(
        "The full mailbox task to complete, including any target vendor, address, policy, lease, or date details.",
      ),
  }),
});

export const webResearch = tool({
  description:
    "Search or retrieve public web content using the operator-configured browsing provider. Use only for public/current web facts, company websites, news, or source-backed public research. Do not include private policy text, mailbox bodies, policy numbers, source spans, personal data, or confidential customer data in the query.",
  inputSchema: z.object({
    query: z
      .string()
      .max(500)
      .optional()
      .describe(
        "Public web search query. Omit when retrieving a specific URL.",
      ),
    url: z
      .string()
      .optional()
      .describe(
        "Specific public http(s) URL to retrieve. Use this for known public pages.",
      ),
    goal: z
      .string()
      .max(500)
      .optional()
      .describe(
        "Short public research goal, such as verifying company services or recent public news.",
      ),
    allowedDomains: z
      .array(z.string())
      .max(5)
      .optional()
      .describe("Optional public domains to restrict search results to."),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .describe("Maximum public sources to return. Defaults to 5."),
  }),
});

export const renderEmailPreview = tool({
  description:
    "Render an outbound email draft as a visual artifact using a browser renderer. Use this when the user asks to screenshot, print, preview, inspect formatting, verify layout, or see what an email draft will look like. Returns a PNG screenshot or PDF printout attached to the current thread.",
  inputSchema: z.object({
    draftId: z
      .string()
      .optional()
      .describe(
        "Specific pending email draft ID. Omit to render the current draft in this thread.",
      ),
    format: z
      .enum(["png", "pdf"])
      .optional()
      .describe(
        "Render format. Use png for screenshots and pdf for printouts. Defaults to png.",
      ),
  }),
});

export const extractPolicyAttachment = tool({
  description:
    "Extract a policy from one OR MORE PDF attachments that were included with the email. " +
    "When multiple PDFs appear in the same email and together describe the same policy " +
    "(e.g. COI + declarations + policy wording), pass ALL of them in a single call so they " +
    "are combined into one policy record. Only split into separate calls if the email contains " +
    "attachments for DIFFERENT policies.",
  inputSchema: z.object({
    files: z
      .array(
        z.object({
          storageId: z
            .string()
            .describe("Convex storage ID of the PDF attachment"),
          fileName: z.string().describe("Original filename of the attachment"),
        }),
      )
      .min(1)
      .describe("One entry per PDF that belongs to this policy"),
  }),
});
