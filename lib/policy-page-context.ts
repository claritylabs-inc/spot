import { lobLabel, policyLobCodes } from "@/convex/lib/linesOfBusiness";
import { resolvePolicyPartyContext } from "@/convex/lib/policyPartyContext";

/** normalizeOperatorPageContext rejects longer summaries. */
const MAX_SUMMARY_CHARS = 500;

type Part = string | false | null | undefined;

/**
 * Joins the readable parts of a page context summary. The chip shows the
 * start, so lead with the record's name and end with exact IDs.
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

/** Exact IDs named as the read tools take them, e.g. `orgId=… policyId=…`. */
export function contextIds(ids: Record<string, string | null | undefined>) {
  const pairs = Object.entries(ids).filter(([, id]) => id);
  return pairs.length
    ? pairs.map(([name, id]) => `${name}=${id}`).join(" ")
    : undefined;
}

type ContextPolicy = {
  orgId?: string;
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
  const number = known(policy.policyNumber);
  const start = known(policy.effectiveDate);
  const end = known(policy.expirationDate);
  return contextSummary([
    known(parties.insuredName),
    number ? `Policy ${number}` : "Policy",
    lines.slice(0, 4).join(", "),
    known(parties.primaryDisplayName),
    start && end ? `${start} to ${end}` : undefined,
    policy.deletedAt ? "archived" : undefined,
    ...details,
    contextIds({ orgId: policy.orgId }),
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

/**
 * One selected certificate: holder, policy, status and current version. With
 * `ids`, ends with the policy, client and requirement source IDs the operator
 * agent's tools take.
 */
export function certificateContextSummary(
  row: ContextCertificate,
  { ids = false }: { ids?: boolean } = {},
) {
  const version = row.currentVersion;
  const policyLabel = [
    row.policy?.policyNumber,
    row.policy?.carrier ?? row.policy?.security,
  ]
    .filter(Boolean)
    .join(" ");
  return contextSummary([
    `Certificate for ${row.holder?.displayName ?? "unknown holder"}`,
    policyLabel ? `policy ${policyLabel}` : undefined,
    row.status.replaceAll("_", " "),
    version
      ? [`v${version.versionNumber}`, version.formCode?.toUpperCase()]
          .filter(Boolean)
          .join(" ")
      : undefined,
    version?.additionalInsuredName
      ? `additional insured ${version.additionalInsuredName}`
      : version?.requestKind?.replaceAll("_", " "),
    ids
      ? contextIds({
          orgId: row.orgId,
          policyId: row.policyId,
          requirementSourceDocumentId: row.requirementSourceDocumentId,
        })
      : undefined,
  ]);
}
