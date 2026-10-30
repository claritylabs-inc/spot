import { useEffect } from "react";
import { lobLabel, policyLobCodes } from "@/convex/lib/linesOfBusiness";
import { resolvePolicyPartyContext } from "@/convex/lib/policyPartyContext";
import { usePageContext, type PageContext } from "@/hooks/use-page-context";

/** normalizeOperatorPageContext rejects longer summaries. */
const MAX_SUMMARY_CHARS = 500;

type Part = string | false | null | undefined;
type Related = NonNullable<PageContext["related"]>[number];

/**
 * Joins the readable parts of a page context summary. The chip shows the
 * start, so lead with the record's name.
 */
export function contextSummary(parts: Part[]) {
  const summary = parts
    .map((part) => (part || "").trim())
    .filter(Boolean)
    .join(" · ");
  return summary.length > MAX_SUMMARY_CHARS
    ? `${summary.slice(0, MAX_SUMMARY_CHARS - 1)}…`
    : summary;
}

/** Related records with an ID, in order; undefined when there are none. */
export function relatedRecords(
  entries: Array<Partial<Related> & { kind: string }>,
): Related[] | undefined {
  const related = entries.flatMap(({ kind, id, label }) =>
    id ? [{ kind, id, ...(label ? { label } : {}) }] : [],
  );
  return related.length ? related : undefined;
}

// Contexts compare by value: summaries and related lists are rebuilt each render.
function useContextKey(context: PageContext | null) {
  return context ? JSON.stringify(context) : null;
}

/** Registers the page's own context while mounted. */
export function usePageContextBase(context: PageContext | null) {
  const { setPageContext } = usePageContext();
  const key = useContextKey(context);
  useEffect(() => {
    if (!key) return;
    setPageContext(JSON.parse(key) as PageContext);
    return () => setPageContext(null);
  }, [key, setPageContext]);
}

/** Layers an open panel's record over the page's context while it is shown. */
export function usePageContextLayer(context: PageContext | null) {
  const { pushPageContext } = usePageContext();
  const key = useContextKey(context);
  useEffect(
    () => (key ? pushPageContext(JSON.parse(key) as PageContext) : undefined),
    [key, pushPageContext],
  );
}

type ContextPolicy = {
  policyNumber?: string;
  effectiveDate?: string;
  expirationDate?: string;
  linesOfBusiness?: readonly string[];
  deletedAt?: number;
};

function known(value: string | undefined) {
  const text = value?.trim();
  return !text || /^(unknown|extracting\.{0,3}|not applicable|n\/a)$/i.test(text)
    ? undefined
    : text;
}

/** `Policy GL-123`, or `Policy` while the number is unknown. */
export function policyLabel(policy: { policyNumber?: string }) {
  const number = known(policy.policyNumber);
  return number ? `Policy ${number}` : "Policy";
}

/**
 * The operator's view of one policy: insured, number, lines, carrier, term,
 * then whatever the page adds (tab, open panel, extraction state).
 */
export function policyContextSummary(
  policy: ContextPolicy,
  details: Part[] = [],
) {
  const parties = resolvePolicyPartyContext(policy);
  const lines = policyLobCodes(policy)
    .filter((code) => code !== "UN" && code !== "BLANK")
    .map(lobLabel);
  const start = known(policy.effectiveDate);
  const end = known(policy.expirationDate);
  return contextSummary([
    known(parties.insuredName),
    policyLabel(policy),
    lines.slice(0, 4).join(", "),
    known(parties.primaryDisplayName),
    start && end ? `${start} to ${end}` : undefined,
    policy.deletedAt ? "archived" : undefined,
    ...details,
  ]);
}

type ContextCertificate = {
  _id: string;
  orgId?: string;
  policyId: string;
  requirementSourceDocumentId?: string;
  status: string;
  holder?: { displayName: string } | null;
  policy?: {
    policyNumber?: string;
    carrier?: string;
    security?: string;
  } | null;
  currentVersion?: {
    versionNumber: number;
    formCode?: string;
    requestKind?: string;
    additionalInsuredName?: string;
  } | null;
};

/** One selected certificate: holder, policy, status and current version. */
export function certificateContextSummary(row: ContextCertificate) {
  const version = row.currentVersion;
  const policy = [
    row.policy?.policyNumber,
    row.policy?.carrier ?? row.policy?.security,
  ]
    .filter(Boolean)
    .join(" ");
  return contextSummary([
    `Certificate for ${row.holder?.displayName ?? "unknown holder"}`,
    policy ? `policy ${policy}` : undefined,
    row.status.replaceAll("_", " "),
    version
      ? [`v${version.versionNumber}`, version.formCode?.toUpperCase()]
          .filter(Boolean)
          .join(" ")
      : undefined,
    version?.additionalInsuredName
      ? `additional insured ${version.additionalInsuredName}`
      : version?.requestKind?.replaceAll("_", " "),
  ]);
}

/** The client, policy and requirement source a certificate belongs to. */
export function certificateContextRelated(row: ContextCertificate) {
  return relatedRecords([
    { kind: "organization", id: row.orgId },
    {
      kind: "policy",
      id: row.policyId,
      label: row.policy ? policyLabel(row.policy) : undefined,
    },
    { kind: "requirement_source", id: row.requirementSourceDocumentId },
  ]);
}
