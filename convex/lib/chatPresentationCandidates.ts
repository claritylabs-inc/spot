import {
  parseChatPresentation,
  type PresentationCandidate,
  type PresentationElement,
  type PresentationEvidence,
  type PresentationProps,
  type PresentationReference,
} from "../../lib/chat-presentation";

type Row = Record<string, unknown>;
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

  reference(reference: Omit<PresentationReference, "id">): string | undefined {
    const existing = this.references.find(
      (item) =>
        item.kind === reference.kind &&
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
    if (this.references.length >= MAX_REFERENCES) return undefined;
    const id = `ref_${this.references.length}`;
    this.references.push({ id, ...reference });
    return id;
  }

  add(description: string, element: PresentationElement, resource?: string) {
    if (this.candidates.length >= MAX_CANDIDATES) return;
    const id = `candidate_${this.candidates.length}`;
    const parsed = parseChatPresentation({
      version: 1,
      sourceRevision: "candidate",
      createdAt: 0,
      spec: { root: id, elements: { [id]: element } },
      references: this.references,
    });
    if (!parsed) return;
    const candidate = {
      id,
      description,
      element,
      ...(resource ? { resource } : {}),
    };
    const size = new TextEncoder().encode(JSON.stringify(candidate)).length;
    if (this.bytes + size > MAX_CANDIDATE_BYTES) return;
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
) {
  if (!policies.length) return;
  const fields = [
    ["Policy number", "number", "policyNumber"],
    ["Carrier", "carrier"],
    ["Named insured", "insured", "insuredName"],
    ["Effective date", "effective", "effectiveDate"],
    ["Expiration date", "expiration", "expirationDate"],
    ["Premium", "premium"],
    ["Data stage", "dataStage", "extractionDataStage"],
    ["Provisional", "provisional"],
  ];
  const values: PresentationProps<"ComparisonTable">["rows"] = fields.map(
    ([label, key, alias]) => ({
      label,
      values: policies.map(({ row }) =>
        key === "provisional"
          ? row.provisional === true
            ? "Yes — enrichment is incomplete"
            : row.provisional === false
              ? "No"
              : "Not provided"
          : unknownValue(row[key] ?? (alias ? row[alias] : undefined)),
      ),
      sourceIds: policies.map((policy) => policy.referenceId),
    }),
  );
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
}

function addPolicySources(
  builder: Candidates,
  output: unknown,
  policyId: string | undefined,
) {
  if (!policyId) return;
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
      return kind && value ? [`${kind}: ${value}`] : [];
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
      ...strings(item.provisions).map((value) => `Provision: ${value}`),
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
  const result = record(output);
  if (result.needsDisambiguation !== true) return;
  const options = rows(result.vendors).flatMap((vendor) => {
    const value = identifier(vendor.vendorOrgId);
    const label = literal(vendor.name, 200);
    return value && label ? [{ value, label }] : [];
  });
  if (options.length)
    builder.add(
      "Choose the vendor explicitly requested by the policy lookup before continuing",
      {
        type: "ChoiceGroup",
        props: { label: "Which vendor?", options, submitLabel: "Continue" },
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
    const facts = [
      ["Request", request.title],
      ["Stage", request.status],
      ["Completion outcome", request.completionOutcome],
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
}

function addProviders(builder: Candidates, name: string, output: unknown) {
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
      const source = literal(fact.sourceRef, 200);
      if (!key || !content || !source || !sourceUrls.includes(source)) continue;
      const sourceId = builder.reference({
        kind: "source",
        recordId: id,
        label: source,
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

/** Consumes successful authorized snapshots; it never authorizes or repeats a business read. */
export function buildPresentationCandidates(evidence: PresentationEvidence): {
  candidates: PresentationCandidate[];
  references: PresentationReference[];
} {
  const builder = new Candidates();
  const tools = evidence.tools.slice(-24);
  const knownPolicies = new Map<string, Policy>();
  for (const tool of tools) {
    if (tool.name === "list_policies" && evidence.audience !== "operator")
      continue;
    const output = outputOf(tool.output);
    const policies: Policy[] = [];
    for (const row of policyRows(tool.name, output).slice(0, 6)) {
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
    addPolicies(builder, policies, `policies_${builder.candidates.length}`);
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
  return { candidates: builder.candidates, references: builder.references };
}
