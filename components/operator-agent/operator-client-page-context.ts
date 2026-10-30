/**
 * Summary text for the client pages' agent page context. The model reads the
 * summary next to pageType and entityId, so it names what the operator sees
 * (tab, filters, open record) and carries the IDs it would otherwise look up.
 */

/** Matches `normalizeOperatorPageContext`'s summary bound. */
const MAX_SUMMARY_LENGTH = 500;

export function pageContextSummary(
  parts: Array<string | false | null | undefined>,
) {
  const text = parts.filter(Boolean).join("; ");
  return text.length > MAX_SUMMARY_LENGTH
    ? `${text.slice(0, MAX_SUMMARY_LENGTH - 1)}…`
    : text;
}

/** "A, B, C +2" */
export function namedList(names: string[], max = 3) {
  const shown = names.slice(0, max);
  const hidden = names.length - shown.length;
  return shown.join(", ") + (hidden > 0 ? ` +${hidden}` : "");
}

/** The operating name, with the legal name when a DBA differs from it. */
export function clientContextName(client: { name: string; dba?: string | null }) {
  const dba = client.dba?.trim();
  return dba && dba !== client.name ? `${dba} (legal name ${client.name})` : client.name;
}

export function policyContextLabel(policy: {
  carrier?: string | null;
  policyNumber?: string | null;
  fileName?: string | null;
  effectiveDate?: string | null;
  expirationDate?: string | null;
}) {
  const name =
    [policy.carrier, policy.policyNumber && `#${policy.policyNumber}`]
      .map((value) => value?.trim())
      .filter((value) => value && value !== "Extracting...")
      .join(" ") ||
    policy.fileName?.trim() ||
    "Untitled policy";
  const term =
    policy.effectiveDate || policy.expirationDate
      ? ` (${policy.effectiveDate ?? "?"} to ${policy.expirationDate ?? "?"})`
      : "";
  return `${name}${term}`;
}
