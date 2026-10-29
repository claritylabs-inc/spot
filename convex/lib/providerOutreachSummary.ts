import type { IntakeApplication } from "../../lib/intake-application";
import {
  coverageRequestLabel,
  coverageOption,
  UNKNOWN_ANSWER,
} from "../../lib/insurance-intake-details";
import { followupQuestionVisible } from "../../lib/intake-followups";
import { formatIntakeMoney, intakeCurrency } from "../../lib/intake-money";

export type OutreachSummaryItem = { label: string; value: string };

/** Published business facts only. Personal contact details stay in the authorized packet. */
export function providerOutreachSummary(
  application: IntakeApplication | null,
): {
  applicantName: string | null;
  summaryItems: OutreachSummaryItem[];
  coverageLabels: string[];
  coverageRequest: string | null;
} {
  if (!application)
    return { applicantName: null, summaryItems: [], coverageLabels: [], coverageRequest: null };
  const { answers, details } = application;
  const summaryItems: OutreachSummaryItem[] = [];
  const add = (label: string, value?: string) => {
    if (value?.trim()) summaryItems.push({ label, value: value.trim() });
  };
  const currency = intakeCurrency(details.registrationCountry);
  add("Business", answers.description);
  // Summarize the business location without publishing its street address.
  const address = details.registrationAddress;
  add(
    "Location",
    [
      address?.city,
      address?.state ?? details.registrationState,
      address?.country ?? details.registrationCountry,
    ]
      .filter(Boolean)
      .join(", "),
  );
  add("Established", answers.yearStarted);
  const revenue = details.revenue;
  add(
    "Annual revenue",
    revenue?.annualAmount?.trim()
      ? `${formatIntakeMoney(revenue.annualAmount, currency)}${revenue.annualPeriod?.trim() ? ` reported for ${revenue.annualPeriod.toLowerCase()}` : " (reporting period not provided)"}`
      : answers.trailingRevenue,
  );
  const coverages = details.coverages.map((line) => {
    const label = coverageRequestLabel(line);
    const limits = coverageOption(line.coverage).limits.flatMap((limit) => {
      const value = line.limits[limit.key]?.trim();
      if (limit.key === "coverage_description" || !value || value === UNKNOWN_ANSWER) return [];
      return [`${limit.label}: ${limit.key === "statutory" ? value : formatIntakeMoney(value, currency)}`];
    });
    const amount = limits.length ? ` (${limits.join(", ")})` : "";
    const scope = line.scopeDescription?.trim();
    return `${label}${amount}${scope ? ` — ${scope}` : ""}`;
  });
  add("Coverage requested", coverages.join("; ") || answers.coverage);
  add(
    "Current insurance",
    [
      answers.currentInsurance,
      answers.trigger === "Shopping for renewal" ? "shopping for renewal" : "",
    ]
      .filter(Boolean)
      .join("; "),
  );
  if (
    answers.claims?.trim().toLowerCase() === "no" &&
    answers.cancellations?.trim().toLowerCase() === "no"
  ) {
    add("Claims or cancellations/declines", "None reported");
  } else {
    add("Claims history (applicant reported)", answers.claims);
    add(
      "Cancellations, nonrenewals, declines or uninsured periods (applicant reported)",
      answers.cancellations,
    );
  }
  const followups = (details.followups ?? []).filter(
    (row) =>
      !row.skipped &&
      row.answer.trim() &&
      followupQuestionVisible(row, details.followups),
  );
  const excavation = followups.find(
    (row) =>
      row.source?.endsWith(" · supplement.contractor.excavation") ||
      /^(?:For your general liability insurance, )?does (?:your|the) business excavate or perform below-ground work\?$/i.test(
        row.label.trim(),
      ),
  );
  if (excavation) {
    const depth = followups.find((row) =>
      row.source?.endsWith(" · supplement.contractor.excavation_depth"),
    );
    add(
      "Below-ground work",
      excavation.answer.trim().toLowerCase() === "yes"
        ? `Yes; ${depth ? `maximum excavation depth: ${depth.answer}` : "scope to be clarified"}`
        : excavation.answer,
    );
  }
  const vehicles = details.coverages
    .filter((line) => line.coverage === "commercial_auto")
    .flatMap((line) => line.vehicles ?? [])
    .slice(0, 3)
    .map((vehicle) =>
      [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" "),
    )
    .filter(Boolean);
  if (vehicles.length)
    add("Vehicles (applicant reported)", vehicles.join("; "));
  return {
    applicantName: answers.name?.trim() || null,
    summaryItems,
    coverageLabels: details.coverages.map(coverageRequestLabel),
    coverageRequest: coverages.join("; ") || answers.coverage || null,
  };
}
