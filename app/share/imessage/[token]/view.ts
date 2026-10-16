import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { CoverageBreakdown } from "@/convex/lib/coverageBreakdown";
import { lobLabel, policyLobCodes } from "@/convex/lib/linesOfBusiness";
import {
  formatDisplayDate,
  formatDisplayPolicyPeriod,
} from "@/lib/date-format";
import type { CarrierIdentity } from "@/convex/lib/carrierIdentity";

export type Policy = {
  id: string;
  title: string;
  insuredName: string;
  carrier?: string;
  carrierIdentity?: CarrierIdentity | null;
  policyNumber: string;
  linesOfBusiness?: string[];
  effectiveDate: string;
  expirationDate: string;
  policyTermType?: string;
  dataStage?: string;
  coverageBreakdown?: CoverageBreakdown;
  coverages: Array<{
    name: string;
    limit?: string;
    deductible?: string;
    origin?: string;
  }>;
};

export type AppCardView = {
  kind: "policy" | "certificate";
  orgName: string;
  title: string;
  subtitle?: string;
  label?: string;
  policy?: Policy | null;
  certificate?: {
    holderName: string;
    fileName: string;
    fileUrl?: string | null;
    versionNumber?: number;
    createdAt: number;
  };
};

export async function loadAppCardView(token: string): Promise<AppCardView | null> {
  const result = await fetchQuery(api.appCardLinks.getByToken, { token });
  return result as AppCardView | null;
}

export function formatDate(value?: string | number) {
  if (!value) return "Not listed";
  return formatDisplayDate(value, String(value));
}

export function policyPeriod(
  policy: Pick<
    Policy,
    "effectiveDate" | "expirationDate" | "policyTermType"
  >,
) {
  return (
    formatDisplayPolicyPeriod(
      policy.effectiveDate,
      policy.expirationDate,
      policy.policyTermType,
    ) ||
    "Not listed"
  );
}

export function compactList(parts: Array<string | undefined | null>) {
  return parts.filter((part): part is string => Boolean(part?.trim())).join(" | ");
}

export function policyLineBusinessLabels(policy: Pick<Policy, "linesOfBusiness">) {
  return policyLobCodes(policy)
    .filter((code) => code !== "UN")
    .map(lobLabel);
}

export function truncate(value: string | undefined, maxLength: number) {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

export function metadataDescription(view: AppCardView) {
  if (view.policy) {
    return compactList([
      view.policy.carrier,
      policyLineBusinessLabels(view.policy).join(", "),
      policyPeriod(view.policy),
      view.orgName,
    ]) || view.subtitle || view.orgName;
  }
  if (view.certificate) {
    return compactList([
      view.certificate.holderName,
      view.orgName,
    ]);
  }
  return view.subtitle ?? view.orgName;
}
