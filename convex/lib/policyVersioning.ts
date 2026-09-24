const POLICY_VERSION_SNAPSHOT_KEYS = [
  "carrier",
  "security",
  "underwriter",
  "generalAgent",
  "broker",
  "policyNumber",
  "linesOfBusiness",
  "policyTermType",
  "effectiveDate",
  "expirationDate",
  "isRenewal",
  "insuredName",
  "insuredDba",
  "insuredAddress",
  "additionalNamedInsureds",
  "lossPayees",
  "mortgageHolders",
  "limits",
  "deductibles",
  "coverages",
  "declarations",
  "operationalProfile",
  "summary",
  "files",
] as const;

export type PolicyVersionSnapshot = Record<string, unknown>;

export function policyTermTypeFromVersionSnapshot(
  snapshot: unknown,
): string | undefined {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return undefined;
  }
  const value = (snapshot as Record<string, unknown>).policyTermType;
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}

export function buildPolicyVersionSnapshot(policy: Record<string, unknown>): PolicyVersionSnapshot {
  return Object.fromEntries(
    POLICY_VERSION_SNAPSHOT_KEYS.map((key) => [key, policy[key]]),
  );
}

export function buildPolicyVersionFieldDiffs(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
) {
  if (!before) return [];
  return Object.entries(after)
    .filter(([key, value]) => before[key] !== value)
    .map(([fieldPath, afterValue]) => ({
      fieldPath,
      before: before[fieldPath],
      after: afterValue,
    }));
}

export function policyVersionSummary(policy: Record<string, unknown>, fallback: string) {
  const policyNumber = typeof policy.policyNumber === "string" ? policy.policyNumber.trim() : "";
  const carrier = [policy.security, policy.carrier]
    .find((value) => typeof value === "string" && value.trim().length > 0);
  return [fallback, policyNumber, carrier].filter(Boolean).join(" - ");
}
