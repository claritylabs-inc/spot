import {
  ACORD_LOB_CODES,
  ACORD_LOB_LABELS,
  EXCLUDED_ACORD_LOB_CODES,
} from "@claritylabs/cl-sdk/policy-taxonomy";
import {
  fileParams,
  holderAddressParams,
  imperative,
  param,
  schema,
} from "@/lib/webmcp/types";

const policyId = param.string("Policy ID from list_policies.");
const requirementSourceTypes = [
  "lease_agreement",
  "client_contract",
  "vendor_requirements",
  "other",
] as const;
const holderObject = param.object(
  "Certificate holder or counterparty named by the source.",
  {
    display_name: param.string("Holder legal name."),
    contact_name: param.string("Optional contact person."),
    email: param.string("Optional email."),
    phone: param.string("Optional phone."),
    address_line1: param.string("Optional street address."),
    address_line2: param.string("Optional suite or unit."),
    city: param.string("Optional city."),
    state: param.string("Optional state or province."),
    postal_code: param.string("Optional postal code."),
    country: param.string("Optional country."),
  },
  ["display_name"],
);
const LINE_OF_BUSINESS_CODES = ACORD_LOB_CODES.filter(
  (code) => code !== "UN" && !EXCLUDED_ACORD_LOB_CODES.has(code),
);
const requirementFields = {
  scope: param.enum(
    ["own_org", "vendors"],
    "own_org: insurance this business must carry. vendors: insurance its vendors must carry.",
  ),
  title: param.string("Short title, for example General liability $1M per occurrence."),
  requirement_text: param.string("Full requirement wording."),
  line_of_business: param.enum(
    LINE_OF_BUSINESS_CODES,
    `ACORD line of business code, for example CGL (${ACORD_LOB_LABELS.CGL}), AUTOB (${ACORD_LOB_LABELS.AUTOB}), WORK, CYBER, or UMBRC.`,
  ),
  limits: param.array(
    "Optional required limits.",
    param.object(
      "Limit.",
      {
        kind: param.string("Limit kind, for example per_occurrence or aggregate."),
        amount: param.number("Amount in dollars."),
        label: param.string("Optional label."),
      },
      ["kind", "amount"],
    ),
  ),
  max_deductible: param.number("Optional maximum deductible in dollars."),
  coverage_form: param.enum(["occurrence", "claims_made"], "Optional coverage form."),
  retroactive_date_on_or_before: param.date("Optional latest acceptable retroactive date"),
  provisions: {
    type: "array",
    items: {
      type: "string",
      enum: ["additional_insured", "waiver_of_subrogation", "primary_non_contributory"],
    },
    description: "Optional required provisions.",
  },
  required_forms: param.stringArray("Optional required form numbers."),
};

/** Policies, certificates, compliance, requests, and shared files. */
export const insuranceTools = {
  list_policies: imperative({
    title: "List policies",
    description:
      "List the client's insurance policies with carrier, policy number, lines of business, term dates, and extraction status. Use to find a policy_id for other policy and certificate tools.",
    readOnly: true,
    inputSchema: schema({
      archived: param.boolean("List archived policies instead of active ones."),
    }),
  }),
  get_policy: imperative({
    title: "Get policy",
    description:
      "Get one policy's extracted details: carrier, insured, term, premium, limits, deductibles, coverages, and summary. Also works for connected vendors' policies.",
    readOnly: true,
    inputSchema: schema({ policy_id: policyId }, ["policy_id"]),
  }),
  search_policy_wording: imperative({
    title: "Search policy wording",
    description:
      "Search a policy document's extracted sections (forms, endorsements, conditions, exclusions) for words or phrases and return matching excerpts with page numbers.",
    readOnly: true,
    untrustedContent: true,
    inputSchema: schema(
      {
        policy_id: policyId,
        query: param.string('Words or phrase to find, for example "additional insured".'),
        limit: param.integer("Maximum sections to return (default 8).", { minimum: 1, maximum: 25 }),
      },
      ["policy_id", "query"],
    ),
  }),
  get_policy_source_evidence: imperative({
    title: "Get policy source evidence",
    description:
      "Read the exact source text behind a policy fact: the spans or sections cited by sourceSpanIds / sourceNodeIds on get_policy coverages.",
    readOnly: true,
    untrustedContent: true,
    inputSchema: schema(
      {
        policy_id: policyId,
        span_ids: param.stringArray("Source span IDs (max 256)."),
        node_ids: param.stringArray("Source section node IDs (max 128)."),
      },
      ["policy_id"],
    ),
  }),
  get_policy_document_url: imperative({
    title: "Get policy PDF link",
    description: "Get a temporary download link for a policy's original PDF.",
    readOnly: true,
    inputSchema: schema({ policy_id: policyId }, ["policy_id"]),
  }),
  list_policy_versions: imperative({
    title: "List policy versions",
    description: "List a policy's document history (original, renewals, endorsements) newest first.",
    readOnly: true,
    inputSchema: schema({ policy_id: policyId }, ["policy_id"]),
  }),
  upload_policy: imperative({
    title: "Upload policy",
    description:
      "Upload policy PDFs into the client's workspace and start AI extraction. combined (default) merges all files into one policy, for example a declarations page plus forms; separate creates one policy per file. Files matching an existing policy are skipped unless allow_duplicates is true. Returns the new policy IDs; follow up with get_policy, or retry_policy_extraction if extraction fails.",
    readOnly: false,
    consequential: true,
    pages: ["/policies"],
    inputSchema: schema(
      {
        files: param.array(
          "One or more PDF files.",
          param.object("PDF file.", fileParams, ["file_name", "content_base64"]),
        ),
        mode: param.enum(["combined", "separate"], "combined (default) or separate."),
        allow_duplicates: param.boolean(
          "Upload even when a file matches an existing policy, as the UI's Continue upload does.",
        ),
      },
      ["files"],
    ),
  }),
  archive_policy: imperative({
    title: "Archive policy",
    description:
      "Archive a policy the client uploaded so it no longer counts in coverage, compliance, or certificates. Policies added by Spot staff can't be archived here. Restore with restore_policy.",
    readOnly: false,
    pages: ["/policies"],
    inputSchema: schema({ policy_id: policyId }, ["policy_id"]),
  }),
  restore_policy: imperative({
    title: "Restore policy",
    description: "Restore an archived policy the client uploaded.",
    readOnly: false,
    pages: ["/policies"],
    inputSchema: schema({ policy_id: policyId }, ["policy_id"]),
  }),
  cancel_policy_extraction: imperative({
    title: "Cancel policy extraction",
    description: "Stop a running extraction for a policy the client uploaded.",
    readOnly: false,
    pages: ["/policies"],
    inputSchema: schema({ policy_id: policyId }, ["policy_id"]),
  }),
  retry_policy_extraction: imperative({
    title: "Retry policy extraction",
    description:
      "Re-extract a policy from its original file, as offered when Spot couldn't finish reading it. Uses AI extraction time.",
    readOnly: false,
    consequential: true,
    pages: ["/policies"],
    inputSchema: schema({ policy_id: policyId }, ["policy_id"]),
  }),

  list_certificates: imperative({
    title: "List certificates",
    description:
      "List certificates of insurance issued for the client, with holder, policy, current version, and PDF links for every version.",
    readOnly: true,
    inputSchema: schema({
      archived: param.boolean("List archived certificates instead of active ones."),
      policy_id: param.string("Optional policy filter."),
    }),
  }),
  list_certificate_review_jobs: imperative({
    title: "List certificate review jobs",
    description:
      "List certificate renewal-reissue and manual-review jobs with status, holder, and policy.",
    readOnly: true,
    inputSchema: schema({
      status: param.enum(
        ["review_required", "blocked_missing_contact", "sending", "sent", "cancelled", "failed"],
        "Optional status filter.",
      ),
    }),
  }),
  generate_certificate: imperative({
    title: "Generate certificate of insurance",
    description:
      "Generate (or reuse) a certificate of insurance PDF for one policy and one holder, covering every available coverage. Returns PDF links. Requests needing endorsements are held for broker review instead.",
    readOnly: false,
    pages: ["/certificates", "/compliance", "/policies"],
    inputSchema: schema(
      {
        policy_id: policyId,
        holder_name: param.string("Certificate holder's legal name."),
        ...holderAddressParams,
      },
      ["policy_id", "holder_name"],
    ),
  }),
  generate_certificates_for_requirements: imperative({
    title: "Generate certificates for requirements",
    description:
      "Generate the certificates needed to satisfy one requirement source (contract, lease) or one requirement. The holder comes from the source. Returns PDFs and any unmet gaps; gaps are never claimed as satisfied.",
    readOnly: false,
    pages: ["/certificates", "/compliance"],
    inputSchema: schema({
      requirement_source_id: param.string("Requirement source ID from list_requirement_sources."),
      requirement_id: param.string("Or one requirement ID from list_compliance_requirements."),
    }),
  }),
  reissue_certificate: imperative({
    title: "Reissue certificate",
    description:
      "Issue a fresh version of an existing certificate with the same holder, using the policy's current data.",
    readOnly: false,
    pages: ["/certificates"],
    inputSchema: schema(
      { certificate_id: param.string("Certificate ID from list_certificates.") },
      ["certificate_id"],
    ),
  }),
  update_certificate_holder: imperative({
    title: "Update certificate holder",
    description:
      "Change an existing certificate's holder name, contact, or address and issue a new version with those details.",
    readOnly: false,
    pages: ["/certificates"],
    inputSchema: schema(
      {
        certificate_id: param.string("Certificate ID from list_certificates."),
        holder_name: param.string("Holder legal name; omit to keep the current name."),
        ...holderAddressParams,
      },
      ["certificate_id"],
    ),
  }),
  archive_certificate: imperative({
    title: "Archive certificate",
    description: "Archive a certificate and cancel its open review jobs. Restore with restore_certificate.",
    readOnly: false,
    pages: ["/certificates"],
    inputSchema: schema(
      { certificate_id: param.string("Certificate ID from list_certificates.") },
      ["certificate_id"],
    ),
  }),
  restore_certificate: imperative({
    title: "Restore certificate",
    description: "Restore an archived certificate.",
    readOnly: false,
    pages: ["/certificates"],
    inputSchema: schema(
      { certificate_id: param.string("Archived certificate ID from list_certificates.") },
      ["certificate_id"],
    ),
  }),

  list_compliance_requirements: imperative({
    title: "List compliance requirements",
    description:
      "List insurance requirements from the client's contracts and leases, for the client itself (own_org) and its vendors, with compliance status (met, not_met, expiring_soon, expired, unverified) and reasons.",
    readOnly: true,
    inputSchema: schema({
      status: param.enum(
        ["met", "not_met", "expiring_soon", "expired", "unverified"],
        "Optional status filter.",
      ),
      scope: param.enum(["own_org", "vendors"], "Optional scope filter."),
    }),
  }),
  list_requirement_sources: imperative({
    title: "List requirement sources",
    description:
      "List the contracts, leases, and vendor packets requirements were imported from, with holder, deal, requirement count, and certificate-readiness per requirement.",
    readOnly: true,
    inputSchema: schema(),
  }),
  list_source_certificates: imperative({
    title: "List certificates for a source",
    description: "List certificates already generated for one requirement source, with PDF links.",
    readOnly: true,
    inputSchema: schema(
      { requirement_source_id: param.string("Requirement source ID.") },
      ["requirement_source_id"],
    ),
  }),
  create_compliance_requirement: imperative({
    title: "Create compliance requirement",
    description: "Add one coverage requirement manually.",
    readOnly: false,
    adminOnly: true,
    pages: ["/compliance"],
    inputSchema: schema(requirementFields, ["scope", "title", "requirement_text", "line_of_business"]),
  }),
  update_compliance_requirement: imperative({
    title: "Update compliance requirement",
    description:
      "Replace an existing requirement's fields. Send the full requirement (read it with list_compliance_requirements first).",
    readOnly: false,
    adminOnly: true,
    pages: ["/compliance"],
    inputSchema: schema(
      { requirement_id: param.string("Requirement ID."), ...requirementFields },
      ["requirement_id", "scope", "title", "requirement_text", "line_of_business"],
    ),
  }),
  archive_compliance_requirement: imperative({
    title: "Archive compliance requirement",
    description: "Archive one requirement so it no longer counts toward compliance.",
    readOnly: false,
    adminOnly: true,
    pages: ["/compliance"],
    inputSchema: schema({ requirement_id: param.string("Requirement ID.") }, ["requirement_id"]),
  }),
  update_requirement_source: imperative({
    title: "Update requirement source",
    description:
      "Edit a requirement source's title, type, holder, deal, or shared notes (Markdown).",
    readOnly: false,
    adminOnly: true,
    pages: ["/compliance"],
    inputSchema: schema(
      {
        requirement_source_id: param.string("Requirement source ID."),
        title: param.string("Optional new title."),
        source_type: param.enum(requirementSourceTypes, "Optional source type."),
        holder: holderObject,
        deal_name: param.string("Optional deal or project name."),
        deal_type: param.string("Optional deal type."),
        notes_markdown: param.string("Optional shared notes, as Markdown."),
      },
      ["requirement_source_id"],
    ),
  }),
  archive_requirement_sources: imperative({
    title: "Archive requirement sources",
    description: "Archive requirement sources and every requirement imported from them.",
    readOnly: false,
    adminOnly: true,
    pages: ["/compliance"],
    inputSchema: schema(
      { requirement_source_ids: param.stringArray("Requirement source IDs.") },
      ["requirement_source_ids"],
    ),
  }),
  import_compliance_requirements: imperative({
    title: "Import compliance requirements",
    description:
      "Extract insurance requirements from a contract, lease, or vendor packet (file or pasted text) and save them with their source. Uses AI extraction time. Own-org imports need a holder.",
    readOnly: false,
    consequential: true,
    adminOnly: true,
    pages: ["/compliance"],
    inputSchema: schema(
      {
        pasted_text: param.string("Requirement text, when not uploading a file."),
        ...fileParams,
        source_type: param.enum(requirementSourceTypes, "Kind of document."),
        source_name: param.string("Optional source title."),
        scope: param.enum(["vendors", "own_org"], "Whose insurance the requirements apply to (default vendors)."),
        holder: holderObject,
        deal_name: param.string("Optional deal or project name."),
        deal_type: param.string("Optional deal type."),
        notes_markdown: param.string("Optional shared notes, as Markdown."),
      },
    ),
  }),
  recheck_compliance_requirement: imperative({
    title: "Recheck compliance requirement",
    description:
      "Run a deeper AI check of one own_org coverage requirement against current policies and return status, matched policies, and notes.",
    readOnly: false,
    consequential: true,
    adminOnly: true,
    pages: ["/compliance"],
    inputSchema: schema({ requirement_id: param.string("Requirement ID.") }, ["requirement_id"]),
  }),

  list_insurance_requests: imperative({
    title: "List insurance requests",
    description:
      "List the client's insurance requests (new coverage, renewals, contract requirements) with status, target effective date, shared details, files, and resulting policy.",
    readOnly: true,
    inputSchema: schema(),
  }),
  get_insurance_request: imperative({
    title: "Get insurance request",
    description: "Check one insurance request's status, shared details, attached files, and resulting policy.",
    readOnly: true,
    inputSchema: schema(
      { request_id: param.string("Request ID from list_insurance_requests or create_insurance_request.") },
      ["request_id"],
    ),
  }),
  create_insurance_request: imperative({
    title: "Create insurance request",
    description:
      "Submit a new insurance request to the Spot team: new coverage, a renewal, a policy change, or coverage for a contract requirement. Describe the need in the narrative.",
    readOnly: false,
    pages: ["/requests"],
    inputSchema: schema(
      {
        title: param.string('Short title, for example "Cyber liability for new SaaS contract".'),
        narrative: param.string(
          "What is needed and why: coverage type, limits, deadlines, contract requirements, and business context.",
        ),
        target_effective_date: param.date("Optional date coverage should start"),
      },
      ["title", "narrative"],
    ),
  }),
  attach_request_document: imperative({
    title: "Attach request document",
    description:
      "Upload a supporting document (contract, prior policy, loss runs, application) to an insurance request.",
    readOnly: false,
    pages: ["/requests"],
    inputSchema: schema(
      { request_id: param.string("Request ID."), ...fileParams },
      ["request_id", "file_name", "content_type", "content_base64"],
    ),
  }),

  list_client_files: imperative({
    title: "List shared files",
    description:
      "List files Spot has shared with the client (policies, certificates, request documents) with download links.",
    readOnly: true,
    inputSchema: schema(),
  }),
};
