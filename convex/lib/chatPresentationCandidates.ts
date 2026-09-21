import {
  parseChatPresentation,
  type PresentationCandidate,
  type PresentationElement,
  type PresentationEvidence,
  type PresentationProps,
  type PresentationReference,
} from "../../lib/chat-presentation";
import {
  isRequirementLimitKind,
  isRequirementProvision,
  REQUIREMENT_LIMIT_KIND_LABELS,
  REQUIREMENT_PROVISION_LABELS,
} from "./complianceTypes";
import { publicResearchUrl } from "./companyResearch";

type Row = Record<string, unknown>;
const REQUEST_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  gathering_information: "Gathering information",
  marketing: "Marketing",
  proposal_review: "Proposal review",
  binding: "Binding",
  information_needed: "Information needed",
  in_progress: "In progress",
  finalizing: "Finalizing",
  completed: "Completed",
  cancelled: "Cancelled",
};
export const CHAT_PRESENTATION_PARTIAL_RESOURCE = "partial_results_notice";
const MAX_CANDIDATES = 18;
const MAX_ROWS = 20;
const MAX_REFERENCES = 80;
const MAX_CANDIDATE_BYTES = 48 * 1024;

function record(value: unknown): Row {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : {};
}
function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.slice(0, MAX_ROWS).map(record) : [];
}
function literal(value: unknown, maximum = 4000): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() && value.length <= maximum
    ? value
    : undefined;
}
function identifier(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(value)
    ? value
    : undefined;
}
function strings(value: unknown, maximum = 20): string[] {
  return Array.isArray(value)
    ? value.slice(0, maximum).flatMap((item) => literal(item, 200) ?? [])
    : [];
}
function outputOf(value: unknown): unknown {
  const wrapper = record(value);
  if (wrapper.error || wrapper.isError === true || wrapper.success === false)
    return null;
  return Object.hasOwn(wrapper, "result") ? wrapper.result : value;
}
function collection(value: unknown, key: string): Row[] {
  return rows(Array.isArray(value) ? value : record(value)[key]);
}
function unknownValue(value: unknown) {
  return literal(value) ?? "Not provided";
}

class Candidates {
  candidates: PresentationCandidate[] = [];
  references: PresentationReference[] = [];
  private bytes = 0;
  partial = false;

  result() {
    if (this.partial && this.candidates.length) {
      if (this.candidates.length === MAX_CANDIDATES) this.candidates.pop();
      this.candidates.push({
        id: "partial_notice",
        resource: CHAT_PRESENTATION_PARTIAL_RESOURCE,
        description: "Required notice that the supplied results are incomplete",
        element: {
          type: "Text",
          props: {
            text: "Partial results shown. Open the full records for a complete review.",
          },
          children: [],
        },
      });
    }
    return { candidates: this.candidates, references: this.references };
  }

  reference(reference: Omit<PresentationReference, "id">): string | undefined {
    const existing = this.references.find(
      (item) =>
        item.kind === reference.kind &&
        item.sourceUrl === reference.sourceUrl &&
        item.recordId === reference.recordId &&
        item.policyId === reference.policyId &&
        item.requestId === reference.requestId &&
        item.page === reference.page &&
        item.label === reference.label &&
        item.href === reference.href &&
        JSON.stringify(item.sourceSpanIds) ===
          JSON.stringify(reference.sourceSpanIds),
    );
    if (existing) return existing.id;
    if (this.references.length >= MAX_REFERENCES) {
      this.partial = true;
      return undefined;
    }
    const id = `ref_${this.references.length}`;
    this.references.push({ id, ...reference });
    return id;
  }

  add(description: string, element: PresentationElement, resource?: string) {
    if (this.candidates.length >= MAX_CANDIDATES) {
      this.partial = true;
      return;
    }
    const id = `candidate_${this.candidates.length}`;
    const parsed = parseChatPresentation({
      version: 1,
      sourceRevision: "candidate",
      createdAt: 0,
      spec: { root: id, elements: { [id]: element } },
      references: this.references,
    });
    if (!parsed) {
      this.partial = true;
      return;
    }
    const candidate = {
      id,
      description,
      element,
      ...(resource ? { resource } : {}),
    };
    const size = new TextEncoder().encode(JSON.stringify(candidate)).length;
    if (this.bytes + size > MAX_CANDIDATE_BYTES) {
      this.partial = true;
      return;
    }
    this.bytes += size;
    this.candidates.push(candidate);
  }
}

type Policy = { row: Row; referenceId: string; label: string; id: string };
function policyRows(name: string, output: unknown): Row[] {
  if (name === "compare_coverages") {
    const pair = record(output);
    return [record(pair.policy1), record(pair.policy2)];
  }
  if (
    name === "lookup_policy" ||
    name === "list_policies" ||
    name === "lookup_vendor_policies"
  ) {
    return collection(output, "policies");
  }
  return [];
}

function coveragesFor(row: Row) {
  const breakdown = rows(record(row.coverageBreakdown).all);
  return breakdown.length ? breakdown : rows(row.coverages);
}

function coverageSources(builder: Candidates, policy: Policy, matches: Row[]) {
  const sourceSpanIds = [
    ...new Set(
      matches.flatMap((item) => [
        ...strings(item.sourceSpanIds),
        ...rows(item.limits).flatMap((term) => strings(term.sourceSpanIds)),
      ]),
    ),
  ].slice(0, 20);
  if (!sourceSpanIds.length) return [policy.referenceId];
  const page = matches[0]?.pageNumber ?? matches[0]?.resolvedFromPage;
  const referenceId = builder.reference({
    kind: "source",
    recordId: sourceSpanIds[0],
    policyId: policy.id,
    sourceSpanIds,
    label: policy.label,
    ...(typeof page === "number" && Number.isInteger(page) && page > 0
      ? { page }
      : {}),
  });
  return referenceId ? [policy.referenceId, referenceId] : [policy.referenceId];
}

function addPolicies(
  builder: Candidates,
  policies: Policy[],
  resource: string,
  allowClarification: boolean,
) {
  if (!policies.length) return;
  const fields = [
    ["Policy number", "number", "policyNumber"],
    ["Carrier", "carrier"],
    ["Named insured", "insured", "insuredName"],
    ["Effective date", "effective", "effectiveDate"],
    ["Expiration date", "expiration", "expirationDate"],
    ["Premium", "premium"],
  ];
  const values: PresentationProps<"ComparisonTable">["rows"] = fields.map(
    ([label, key, alias]) => ({
      label,
      values: policies.map(({ row }) =>
        unknownValue(row[key] ?? (alias ? row[alias] : undefined)),
      ),
      sourceIds: policies.map((policy) => policy.referenceId),
    }),
  );
  if (
    policies.some(
      ({ row }) =>
        row.provisional === true ||
        row.dataStage === "preview" ||
        row.extractionDataStage === "preview",
    )
  ) {
    values.push({
      label: "Evidence note",
      values: policies.map(({ row }) =>
        row.provisional === true ||
        row.dataStage === "preview" ||
        row.extractionDataStage === "preview"
          ? "Enrichment is incomplete; terms are provisional."
          : "",
      ),
      sourceIds: policies.map((policy) => policy.referenceId),
    });
  }
  const names = [
    ...new Set(
      policies.flatMap(({ row }) =>
        coveragesFor(row).flatMap(
          (coverage) => literal(coverage.name, 180) ?? [],
        ),
      ),
    ),
  ].slice(0, 12);
  for (const name of names) {
    for (const field of ["limit", "deductible"] as const) {
      values.push({
        label: `${name} — ${field}`,
        values: policies.map(({ row }) => {
          const matches = coveragesFor(row).filter(
            (coverage) => coverage.name === name,
          );
          return matches.length
            ? matches
                .map((item) =>
                  field === "limit" && rows(item.limits).length
                    ? rows(item.limits)
                        .map(
                          (term) =>
                            `${unknownValue(term.label)}: ${unknownValue(term.value)}`,
                        )
                        .join("; ")
                    : unknownValue(item[field]),
                )
                .join("; ")
            : "Not provided";
        }),
        sourceIds: policies.flatMap((policy) =>
          coverageSources(
            builder,
            policy,
            coveragesFor(policy.row).filter((item) => item.name === name),
          ),
        ),
      });
    }
  }
  if (policies.length > 1) {
    builder.add(
      "Compare policy terms and coverage limits; missing values are unknown, not absent coverage",
      {
        type: "ComparisonTable",
        props: {
          columns: policies.map((policy) => ({
            id: policy.referenceId,
            label: policy.label,
          })),
          rows: values,
        },
        children: [],
      },
      resource,
    );
  } else {
    builder.add(
      `Policy facts and coverage: ${policies[0].label}`,
      {
        type: "FactList",
        props: {
          facts: values.map((row) => ({
            label: row.label,
            value: row.values[0],
            sourceIds: row.sourceIds,
          })),
        },
        children: [],
      },
      resource,
    );
  }
  const dates = policies.flatMap((policy) => {
    const value = literal(policy.row.expiration ?? policy.row.expirationDate);
    return value
      ? [
          {
            label: `${policy.label} — expiration`,
            value,
            sourceIds: [policy.referenceId],
          },
        ]
      : [];
  });
  if (dates.length)
    builder.add(
      "Policy expiration dates for renewal planning; these are expiration dates, not promised renewal dates",
      {
        type: "DateList",
        props: { dates },
        children: [],
      },
      resource,
    );
  builder.add(
    "Open the policies resolved by this lookup",
    {
      type: "RecordList",
      props: {
        records: policies.map((policy) => ({
          referenceId: policy.referenceId,
        })),
      },
      children: [],
    },
    resource,
  );
  if (allowClarification && policies.length > 1) {
    const options = policies.map((policy) => ({
      value: policy.referenceId,
      label: policy.label,
    }));
    builder.add(
      "Choose two policies for comparison only when the user has not identified the pair; never replace an already-resolved comparison with a question",
      {
        type: "ClarificationForm",
        props: {
          fields: [
            {
              id: "first_policy",
              label: "First policy",
              type: "record",
              required: true,
              options,
            },
            {
              id: "second_policy",
              label: "Second policy",
              type: "record",
              required: true,
              options,
            },
          ],
          submitLabel: "Compare policies",
        },
        children: [],
      },
      resource,
    );
    builder.add(
      "Choose one policy only when the requested next step needs one record and the user has not identified it",
      {
        type: "RecordSelector",
        props: {
          label: "Which policy?",
          referenceIds: policies.map((policy) => policy.referenceId),
          submitLabel: "Continue",
        },
        children: [],
      },
      resource,
    );
  }
  const actions: PresentationProps<"ActionGroup">["actions"] =
    policies.length === 1
      ? [
          { label: "Open policy", referenceId: policies[0].referenceId },
          {
            label: "Explain coverage terms",
            followUp: `Explain the coverage terms for policy ${policies[0].id}.`,
          },
        ]
      : policies.map((policy) => ({
          label: policy.label,
          referenceId: policy.referenceId,
        }));
  builder.add(
    "Open a resolved policy or explicitly request a coverage explanation when that next step helps the user",
    {
      type: "ActionGroup",
      props: { actions },
      children: [],
    },
    resource,
  );
}

function addPolicySources(
  builder: Candidates,
  output: unknown,
  policyId: string | undefined,
) {
  if (!policyId) return;
  builder.partial ||= hasBoundedEvidence(output);
  const findings: PresentationProps<"FindingsList">["findings"] = [];
  for (const item of rows(output)) {
    const sourceSpanIds = strings(item.sourceSpanIds);
    const detail = literal(item.content);
    const label = literal(item.title, 200);
    if (
      !detail ||
      !label ||
      !sourceSpanIds.length ||
      item.originalPdfChecked !== true
    )
      continue;
    const source = rows(item.sourceSpans)[0] ?? rows(item.sourceNodes)[0];
    const page = source?.pageStart;
    const referenceId = builder.reference({
      kind: "source",
      recordId: sourceSpanIds[0],
      label,
      policyId,
      sourceSpanIds,
      ...(typeof page === "number" && Number.isInteger(page) && page > 0
        ? { page }
        : {}),
    });
    if (referenceId)
      findings.push({
        label,
        detail,
        status: item.confidence === "low" ? "uncertain" : "information",
        sourceIds: [referenceId],
      });
  }
  if (findings.length)
    builder.add(
      "Original policy evidence excerpts with source spans; these are excerpts, not a coverage determination",
      { type: "FindingsList", props: { findings }, children: [] },
    );
}

function addCompliance(builder: Candidates, output: unknown) {
  builder.partial ||= hasBoundedEvidence(output);
  for (const vendor of rows(output)) {
    const requirements: PresentationProps<"RequirementMatrix">["requirements"] =
      [];
    for (const check of rows(vendor.checks)) {
      const requirementId = identifier(check.requirementId);
      const title = literal(check.title, 150);
      if (!requirementId || !title) continue;
      const referenceId = builder.reference({
        kind: "requirement",
        recordId: requirementId,
        label: title,
      });
      if (!referenceId) continue;
      const matched = record(check.matchedPolicy);
      const policyId = identifier(matched._id);
      const policyReference = policyId
        ? builder.reference({
            kind: "policy",
            recordId: policyId,
            label: literal(matched.policyNumber, 200) ?? "Matched policy",
          })
        : undefined;
      const status =
        check.status === "met" && matched.provisional !== true
          ? "satisfied"
          : check.status === "not_met" || check.status === "expired"
            ? "missing"
            : "uncertain";
      const details = [
        `Recorded status: ${unknownValue(check.status)}`,
        literal(check.matchedSummary),
        literal(matched.coverageLimit)
          ? `Matched limit: ${literal(matched.coverageLimit)}`
          : undefined,
        literal(check.expiresAt)
          ? `Expires: ${literal(check.expiresAt)}`
          : undefined,
        ...strings(check.reasons).map((reason) => `Reason: ${reason}`),
      ]
        .filter(Boolean)
        .join("\n");
      const vendorName = literal(vendor.name, 45);
      requirements.push({
        label: vendorName ? `${vendorName}: ${title}` : title,
        evidence: details,
        status,
        sourceIds: [referenceId, ...(policyReference ? [policyReference] : [])],
      });
    }
    if (requirements.length)
      builder.add(
        "Recorded vendor compliance checks; expiring, unverified, and provisional evidence remains uncertain",
        {
          type: "RequirementMatrix",
          props: { requirements },
          children: [],
        },
      );
  }
}

function addRequirements(
  builder: Candidates,
  output: unknown,
  audience: PresentationEvidence["audience"],
) {
  builder.partial ||= hasBoundedEvidence(output);
  const requirements: PresentationProps<"RequirementMatrix">["requirements"] =
    [];
  for (const item of rows(record(output).requirements)) {
    const id = identifier(item.requirementId);
    const label = literal(item.title, 200);
    if (!id || !label) continue;
    const orgId = identifier(item.orgId);
    const href =
      audience === "client"
        ? "/compliance"
        : orgId
          ? `/operator/clients/${orgId}/compliance`
          : undefined;
    const referenceId = builder.reference({
      kind: "requirement",
      recordId: id,
      label,
      ...(href ? { href } : {}),
    });
    if (!referenceId) continue;
    const limits = rows(item.limits).flatMap((limit) => {
      const kind = literal(limit.kind, 200);
      const value = literal(limit.label ?? limit.amount);
      return kind && value
        ? [
            `${isRequirementLimitKind(kind) ? REQUIREMENT_LIMIT_KIND_LABELS[kind] : kind}: ${value}`,
          ]
        : [];
    });
    const deductible = record(item.maxDeductible);
    const details = [
      literal(item.requirementText),
      literal(item.scope) ? `Scope: ${item.scope}` : undefined,
      literal(item.lineOfBusiness) ? `Line: ${item.lineOfBusiness}` : undefined,
      ...limits,
      literal(deductible.label ?? deductible.amount)
        ? `Maximum deductible: ${literal(deductible.label ?? deductible.amount)}`
        : undefined,
      literal(item.coverageForm)
        ? `Coverage form: ${item.coverageForm}`
        : undefined,
      literal(item.retroactiveDateOnOrBefore)
        ? `Retroactive date on or before: ${item.retroactiveDateOnOrBefore}`
        : undefined,
      ...strings(item.provisions).map(
        (value) =>
          `Provision: ${isRequirementProvision(value) ? REQUIREMENT_PROVISION_LABELS[value] : value}`,
      ),
      ...strings(item.requiredForms).map((value) => `Required form: ${value}`),
      `Recorded status: ${unknownValue(item.currentComplianceStatus)}`,
      ...strings(item.currentComplianceReasons).map(
        (value) => `Reason: ${value}`,
      ),
      literal(item.matchedSummary),
      literal(item.sourceDocumentName)
        ? `Source: ${item.sourceDocumentName}`
        : undefined,
      literal(item.sourceExcerpt)
        ? `Source excerpt: ${item.sourceExcerpt}`
        : undefined,
    ]
      .filter(Boolean)
      .join("\n");
    const sourceIds = [referenceId];
    const sourceDocumentId = identifier(item.requirementSourceDocumentId);
    const sourcePage = item.sourcePageStart;
    if (sourceDocumentId) {
      const source = builder.reference({
        kind: "source",
        recordId: sourceDocumentId,
        label: literal(item.sourceDocumentName, 200) ?? "Requirement source",
        ...(typeof sourcePage === "number" &&
        Number.isInteger(sourcePage) &&
        sourcePage > 0
          ? { page: sourcePage }
          : {}),
      });
      if (source) sourceIds.push(source);
    }
    for (const policyId of strings(item.matchedPolicyIds, 10)) {
      if (!identifier(policyId)) continue;
      const reference = builder.reference({
        kind: "policy",
        recordId: policyId,
        label: "Matched policy",
      });
      if (reference) sourceIds.push(reference);
    }
    requirements.push({
      label,
      evidence: details,
      status:
        item.currentComplianceStatus === "met"
          ? "satisfied"
          : item.currentComplianceStatus === "not_met" ||
              item.currentComplianceStatus === "expired"
            ? "missing"
            : "uncertain",
      sourceIds,
    });
  }
  if (requirements.length)
    builder.add(
      "Saved insurance requirements and recorded compliance evidence; unknown or unchecked requirements remain uncertain",
      {
        type: "RequirementMatrix",
        props: { requirements },
        children: [],
      },
    );
}

function addVendorClarification(builder: Candidates, output: unknown) {
  builder.partial ||= hasBoundedEvidence(output);
  const result = record(output);
  if (result.needsDisambiguation !== true) return;
  const referenceIds = rows(result.vendors).flatMap((vendor) => {
    const recordId = identifier(vendor.vendorOrgId);
    const label = literal(vendor.name, 200);
    if (!recordId || !label) return [];
    return (
      builder.reference({
        kind: "vendor",
        recordId,
        label,
        href: `/connect/vendors/${recordId}/policies`,
      }) ?? []
    );
  });
  if (referenceIds.length)
    builder.add(
      "Choose the vendor explicitly requested by the policy lookup before continuing",
      {
        type: "RecordSelector",
        props: {
          label: "Which vendor?",
          referenceIds,
          submitLabel: "Continue",
        },
        children: [],
      },
    );
}

function requestHref(request: Row) {
  const id = identifier(request._id ?? request.requestId);
  const orgId = identifier(request.clientOrgId);
  return id && orgId
    ? `/operator/clients/${orgId}/procurement/${id}`
    : undefined;
}
function addRequests(builder: Candidates, name: string, output: unknown) {
  builder.partial ||= hasBoundedEvidence(output);
  const clientDto = name === "lookup_client_requests";
  const result = record(output);
  const requests =
    name === "list_procurement_requests" || clientDto
      ? rows(result.requests)
      : [record(result.request)];
  for (const request of requests) {
    const id = identifier(request._id ?? request.requestId);
    const label = literal(request.title, 200);
    if (!id || !label) continue;
    const href = clientDto ? `/requests/${id}` : requestHref(request);
    const referenceId = builder.reference({
      kind: "request",
      recordId: id,
      label,
      ...(href ? { href } : {}),
    });
    if (!referenceId) continue;
    const outcome = record(request.completionOutcome);
    const facts = [
      ["Request", request.title],
      [
        "Stage",
        typeof request.status === "string"
          ? REQUEST_STATUS_LABELS[request.status]
          : undefined,
      ],
      [
        "Completion outcome",
        outcome.kind === "placed_elsewhere" ? "Placed elsewhere" : undefined,
      ],
      ["Purchased from", outcome.provider],
      ["Purchase date", outcome.purchaseDate],
      ["Target effective date", request.targetEffectiveDate],
    ].flatMap(([label, value]) => {
      const text = literal(value);
      return typeof label === "string" && text
        ? [{ label, value: text, sourceIds: [referenceId] }]
        : [];
    });
    builder.add(`Procurement request facts: ${label}`, {
      type: "FactList",
      props: { facts },
      children: [],
    });
    if (clientDto) addRequestFiles(builder, request.files, id, true);
  }
  if (!clientDto) {
    const request = record(result.request);
    addRequestFiles(
      builder,
      result.files,
      identifier(request._id ?? request.requestId),
      false,
    );
  }
}

function addRequestFiles(
  builder: Candidates,
  files: unknown,
  requestId: string | undefined,
  clientDto: boolean,
) {
  if (!requestId) return;
  for (const item of rows(files)) {
    const file = record(item.clientFile);
    const released =
      item.brokerRelease === "listed" ||
      item.brokerRelease === "attached" ||
      item.release === "listed" ||
      item.release === "attached";
    if (!clientDto && !released && item.clientVisible !== true) continue;
    if (Object.hasOwn(item, "clientFile") && !file._id) continue;
    const recordId = identifier(item.clientFileId);
    const label = literal(item.label ?? item.name ?? file.name, 200);
    if (!recordId || !label) continue;
    const referenceId = builder.reference({
      kind: "file",
      recordId,
      requestId,
      label,
    });
    if (referenceId)
      builder.add(`Shared request file: ${label}`, {
        type: "FileReference",
        props: { referenceId },
        children: [],
      });
  }
}

function addProposals(builder: Candidates, name: string, output: unknown) {
  builder.partial ||= hasBoundedEvidence(output);
  const proposals = (
    name === "list_procurement_proposals"
      ? collection(output, "proposals")
      : [record(output)]
  ).slice(0, 6);
  const resolved = proposals.flatMap((proposal) => {
    const id = identifier(proposal._id);
    const label = literal(proposal.brokerName, 200) ?? "Proposal";
    if (!id) return [];
    const referenceId = builder.reference({
      kind: "proposal",
      recordId: id,
      label,
    });
    return referenceId
      ? [
          {
            proposal,
            offer: record(proposal.extractedOffer),
            referenceId,
            label,
          },
        ]
      : [];
  });
  if (!resolved.length) return;
  const fields = [
    ["Carrier", "carrier"],
    ["Quote number", "quoteNumber"],
    ["Named insured", "insuredName"],
    ["Total premium", "premium"],
    ["Proposed effective date", "proposedEffectiveDate"],
    ["Proposed expiration date", "proposedExpirationDate"],
    ["Quote expiration date", "quoteExpirationDate"],
  ];
  const comparisonRows: PresentationProps<"ComparisonTable">["rows"] =
    fields.map(([label, key]) => ({
      label,
      values: resolved.map(({ offer }) => unknownValue(offer[key])),
      sourceIds: resolved.map((item) => item.referenceId),
    }));
  comparisonRows.unshift({
    label: "Status",
    values: resolved.map(({ proposal }) => unknownValue(proposal.status)),
    sourceIds: resolved.map((item) => item.referenceId),
  });
  const coverageNames = [
    ...new Set(
      resolved.flatMap(({ offer }) =>
        rows(offer.coverages).flatMap((item) => literal(item.name, 180) ?? []),
      ),
    ),
  ].slice(0, 12);
  for (const name of coverageNames) {
    comparisonRows.push({
      label: name,
      values: resolved.map(({ offer }) => {
        const matches = rows(offer.coverages).filter(
          (item) => item.name === name,
        );
        return matches.length
          ? matches
              .map(
                (item) =>
                  `Limit: ${unknownValue(item.limit)}; deductible: ${unknownValue(item.deductible)}`,
              )
              .join("\n")
          : "Not provided";
      }),
      sourceIds: resolved.map((item) => item.referenceId),
    });
  }
  builder.add(
    "Operator-private proposal comparison from extracted offers; unknown terms remain unknown",
    {
      type: "ComparisonTable",
      props: {
        columns: resolved.map((item) => ({
          id: item.referenceId,
          label: item.label,
        })),
        rows: comparisonRows,
      },
      children: [],
    },
  );
  for (const item of resolved)
    addProposalFindings(builder, item.proposal, item.referenceId);
}

function addProposalFindings(
  builder: Candidates,
  proposal: Row,
  referenceId: string,
) {
  const offer = record(proposal.extractedOffer);
  const findings: PresentationProps<"FindingsList">["findings"] = [];
  for (const [key, category] of [
    ["conditions", "Condition"],
    ["exclusions", "Exclusion"],
    ["subjectivities", "Subjectivity"],
  ]) {
    for (const item of rows(offer[key])) {
      const label = literal(item.name ?? item.category, 160) ?? category;
      const detail = literal(item.content ?? item.description);
      if (!detail) continue;
      findings.push({
        label: `${category}: ${label}`,
        detail,
        status: key === "subjectivities" ? "uncertain" : "information",
        sourceIds: proposalSources(
          builder,
          proposal,
          item.evidence,
          referenceId,
        ),
      });
    }
  }
  if (findings.length)
    builder.add(
      "Extracted proposal conditions, exclusions and unresolved subjectivities; no finding implies coverage or completion",
      {
        type: "FindingsList",
        props: { findings: findings.slice(0, MAX_ROWS) },
        children: [],
      },
    );
  if (findings.length > MAX_ROWS) builder.partial = true;

  const review = rows(proposal.reviews)[0];
  if (!review) return;
  const current =
    review.stale === false &&
    typeof review.confirmedAt === "number" &&
    Number.isFinite(review.confirmedAt) &&
    Boolean(identifier(review.confirmedByUserId)) &&
    ["meets_requirements", "has_gaps", "insufficient_evidence"].includes(
      String(review.staffConclusion),
    ) &&
    typeof proposal.extractionFingerprint === "string" &&
    review.extractionFingerprint === proposal.extractionFingerprint;
  const reviewFindings: PresentationProps<"FindingsList">["findings"] = rows(
    review.findings,
  ).flatMap((finding) => {
    const detail = literal(finding.summary, 3500);
    if (!detail) return [];
    const heading = record(proposal.sectionHeadings)[
      String(finding.sectionKey)
    ];
    const label =
      literal(heading, 200) ??
      literal(finding.sectionKey, 200) ??
      "Review finding";
    const evidence = rows(finding.evidence);
    const grounded =
      evidence.length > 0 &&
      evidence.every((item) =>
        rows(proposal.documents).some(
          (document) => document._id === item.proposalDocumentId,
        ),
      );
    const status: PresentationProps<"FindingsList">["findings"][number]["status"] =
      current &&
      grounded &&
      review.staffConclusion === "meets_requirements" &&
      finding.conclusion === "meets"
        ? "satisfied"
        : current &&
            grounded &&
            review.staffConclusion === "has_gaps" &&
            finding.conclusion === "has_gap"
          ? "missing"
          : "uncertain";
    const qualification = !current
      ? "Review is stale or awaiting confirmation."
      : !grounded
        ? "Supporting document evidence is unavailable."
        : undefined;
    return [
      {
        label,
        detail: qualification ? `${qualification}\n${detail}` : detail,
        status,
        sourceIds: proposalSources(
          builder,
          proposal,
          finding.evidence,
          referenceId,
        ),
      },
    ];
  });
  if (reviewFindings.length)
    builder.add(
      "Latest proposal requirement-review findings; stale, unconfirmed or unsupported findings remain uncertain",
      {
        type: "FindingsList",
        props: { findings: reviewFindings },
        children: [],
      },
    );
}

function proposalSources(
  builder: Candidates,
  proposal: Row,
  evidence: unknown,
  referenceId: string,
) {
  const sourceIds = [referenceId];
  for (const item of rows(evidence).slice(0, 10)) {
    const document = rows(proposal.documents).find(
      (document) => document._id === item.proposalDocumentId,
    );
    const clientFileId = identifier(document?.clientFileId);
    if (!document || !clientFileId) continue;
    const page = item.pageStart;
    const sourceId = builder.reference({
      kind: "file",
      recordId: clientFileId,
      label: literal(document.fileName, 200) ?? "Proposal document",
      sourceSpanIds: strings(item.sourceSpanIds),
      ...(typeof page === "number" && Number.isInteger(page) && page > 0
        ? { page }
        : {}),
    });
    if (sourceId && !sourceIds.includes(sourceId)) sourceIds.push(sourceId);
  }
  return sourceIds;
}

function addProviders(builder: Candidates, name: string, output: unknown) {
  builder.partial ||= hasBoundedEvidence(output);
  const result = record(output);
  const providers =
    name === "list_broker_network_profiles" ? rows(result.profiles) : [result];
  for (const provider of providers) {
    const broker =
      name === "get_organization" ? provider : record(provider.broker);
    if (name === "get_organization" && broker.type !== "broker") continue;
    const id = identifier(broker._id ?? broker.orgId);
    const label = literal(broker.name, 200);
    if (!id || !label) continue;
    const referenceId = builder.reference({
      kind: "provider",
      recordId: id,
      label,
    });
    if (!referenceId) continue;
    const profile = record(provider.profile);
    const research = record(broker.companyResearch);
    const facts = [
      { label: "Insurance provider", value: label, sourceIds: [referenceId] },
      {
        label: "Research status",
        value: unknownValue(research.status),
        sourceIds: [referenceId],
      },
      {
        label: "States serviced",
        value: strings(profile.writingStates, 60).join(", ") || "Not provided",
        sourceIds: [referenceId],
      },
      {
        label: "ACORD lines",
        value:
          strings(profile.lineOfBusinessCodes, 60).join(", ") || "Not provided",
        sourceIds: [referenceId],
      },
    ];
    // Research-owned prose is accepted only with its persisted source-set membership.
    const sourceUrls = Array.isArray(research.sourceUrls)
      ? research.sourceUrls
      : [];
    for (const fact of rows(research.facts)) {
      const content = literal(fact.content);
      const key = literal(fact.key, 200);
      const source = literal(fact.sourceRef, 2000);
      if (!key || !content || !source || !sourceUrls.includes(source)) continue;
      const sourceUrl = publicResearchUrl(source);
      if (!sourceUrl) continue;
      const sourceId = builder.reference({
        kind: "source",
        recordId: id,
        sourceUrl: source,
        label: new URL(sourceUrl).hostname.slice(0, 200),
      });
      if (sourceId)
        facts.push({ label: key, value: content, sourceIds: [sourceId] });
    }
    builder.add(
      `Insurance provider profile and persisted research: ${label}; partial research is not complete`,
      { type: "FactList", props: { facts }, children: [] },
    );
  }
}

const BOUNDED_COLLECTIONS: Record<string, number> = {
  policies: 6,
  proposals: 6,
  requests: MAX_ROWS,
  profiles: MAX_ROWS,
  results: MAX_ROWS,
  files: MAX_ROWS,
  documents: MAX_ROWS,
  checks: MAX_ROWS,
  requirements: MAX_ROWS,
  vendors: MAX_ROWS,
  coverages: 12,
  all: 12,
  limits: MAX_ROWS,
  facts: MAX_ROWS,
  conditions: MAX_ROWS,
  exclusions: MAX_ROWS,
  subjectivities: MAX_ROWS,
  findings: MAX_ROWS,
};
function hasBoundedEvidence(
  value: unknown,
  limit = MAX_ROWS,
  depth = 0,
): boolean {
  if (depth > 6 || value === null || typeof value !== "object") return false;
  if (Array.isArray(value))
    return (
      value.length > limit ||
      value
        .slice(0, limit)
        .some((item) => hasBoundedEvidence(item, MAX_ROWS, depth + 1))
    );
  const item = record(value);
  if (
    [
      "content",
      "description",
      "summary",
      "requirementText",
      "sourceExcerpt",
    ].some((key) => typeof item[key] === "string" && item[key].length > 4000)
  )
    return true;
  if (item.bounded === true) return true;
  for (const [key, maximum] of Object.entries(BOUNDED_COLLECTIONS)) {
    if (hasBoundedEvidence(item[key], maximum, depth + 1)) return true;
  }
  for (const key of [
    "result",
    "request",
    "policy1",
    "policy2",
    "coverageBreakdown",
    "extractedOffer",
    "broker",
    "companyResearch",
  ]) {
    if (item[key] && hasBoundedEvidence(item[key], MAX_ROWS, depth + 1))
      return true;
  }
  const latestReview = Array.isArray(item.reviews)
    ? item.reviews[0]
    : undefined;
  return Boolean(
    latestReview && hasBoundedEvidence(latestReview, MAX_ROWS, depth + 1),
  );
}

/** Consumes successful authorized snapshots; it never authorizes or repeats a business read. */
export function buildPresentationCandidates(evidence: PresentationEvidence): {
  candidates: PresentationCandidate[];
  references: PresentationReference[];
} {
  const builder = new Candidates();
  const tools = evidence.tools.slice(-24);
  builder.partial = evidence.tools.length > tools.length;
  const knownPolicies = new Map<string, Policy>();
  for (const tool of tools) {
    if (tool.name === "list_policies" && evidence.audience !== "operator")
      continue;
    const output = outputOf(tool.output);
    const policyResults = policyRows(tool.name, output);
    if (
      policyResults.length > 6 ||
      (policyResults.length > 0 && hasBoundedEvidence(output))
    )
      builder.partial = true;
    const policies: Policy[] = [];
    for (const row of policyResults.slice(0, 6)) {
      const id = identifier(row.id ?? row.policyId);
      if (
        !id ||
        row.dataStage === "placeholder" ||
        row.extractionDataStage === "placeholder"
      )
        continue;
      const label =
        literal(row.number ?? row.policyNumber, 200) ??
        literal(row.carrier, 200) ??
        "Policy";
      const orgId = identifier(row.orgId ?? record(tool.input).orgId);
      const href =
        evidence.audience === "operator"
          ? orgId
            ? `/operator/clients/${orgId}/policies/${id}`
            : undefined
          : tool.name === "lookup_vendor_policies"
            ? identifier(record(output).vendorOrgId)
              ? `/connect/vendors/${record(output).vendorOrgId}/policies/${id}`
              : undefined
            : `/policies/${id}`;
      const referenceId = builder.reference({
        kind: "policy",
        recordId: id,
        label,
        ...(href ? { href } : {}),
      });
      if (!referenceId) continue;
      const policy = { row, referenceId, label, id };
      policies.push(policy);
      knownPolicies.set(id, policy);
    }
    const selectedIds = record(tool.input).policyIds;
    addPolicies(
      builder,
      policies,
      `policies_${builder.candidates.length}`,
      tool.name !== "compare_coverages" &&
        !(Array.isArray(selectedIds) && selectedIds.length === 2),
    );
  }
  for (const tool of tools) {
    const output = outputOf(tool.output);
    if (!output) continue;
    if (tool.name === "lookup_policy_section")
      addPolicySources(
        builder,
        record(output).results ?? output,
        identifier(record(output).policyId) ??
          knownPolicies.get(String(record(tool.input).policyId))?.id,
      );
    if (tool.name === "lookup_vendor_compliance")
      addCompliance(builder, output);
    if (tool.name === "lookup_compliance_requirements")
      addRequirements(builder, output, evidence.audience);
    if (tool.name === "lookup_vendor_policies")
      addVendorClarification(builder, output);
    if (tool.name === "lookup_client_requests")
      addRequests(builder, tool.name, output);
    if (evidence.audience !== "operator") continue;
    if (
      [
        "list_procurement_requests",
        "get_procurement_request",
        "preview_broker_packet",
      ].includes(tool.name)
    )
      addRequests(builder, tool.name, output);
    if (
      ["list_procurement_proposals", "get_procurement_proposal"].includes(
        tool.name,
      )
    )
      addProposals(builder, tool.name, output);
    if (
      [
        "get_broker_network_profile",
        "list_broker_network_profiles",
        "get_organization",
      ].includes(tool.name)
    )
      addProviders(builder, tool.name, output);
  }
  return builder.result();
}
