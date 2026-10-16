import dayjs from "dayjs";
import type { DecisionQuestion } from "../../contracts/cl-router/policy";
import type { Doc, Id } from "../_generated/dataModel";
import { policyLobCodes } from "./linesOfBusiness";
import {
  isRequirementLimitKind,
  isRequirementProvision,
  normalizeRequirementLineOfBusiness,
  REQUIREMENT_LIMIT_KIND_LABELS,
  REQUIREMENT_LIMIT_KINDS,
  REQUIREMENT_PROVISION_LABELS,
  type ComplianceCheckStatus,
  type RequirementLimitKind,
  type RequirementProvision,
} from "./complianceTypes";

export type ComplianceCheckResult = {
  requirementId: Id<"insuranceRequirements">;
  status: ComplianceCheckStatus;
  reasons: string[];
  matchedPolicyIds: Id<"policies">[];
  matchedPolicy?: {
    _id: Id<"policies">;
    carrier?: string;
    policyNumber?: string;
    insuredName?: string;
    expectedInsuredName?: string;
    expirationDate?: string;
    dataStage: "placeholder" | "preview" | "final";
    provisional: boolean;
    coverageName?: string;
    coverageLimit?: string;
    detectedLimitAmount?: number;
  };
  matchedSummary?: string;
  expiresAt?: string;
  daysUntilExpiration?: number;
  checkedAt: number;
  checkedBy: "system" | "user" | "agent";
  evidence?: {
    note?: string;
    fileId?: Id<"_storage">;
    fileName?: string;
    validUntil?: string;
  };
};

type ManualCheck = Pick<
  Doc<"complianceChecks">,
  | "status"
  | "reasons"
  | "matchedPolicyIds"
  | "matchedSummary"
  | "expiresAt"
  | "evidence"
  | "checkedAt"
  | "checkedBy"
  | "checkedByUserId"
>;

function normalizeText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function legalName(value: string | undefined | null) {
  return normalizeText(value).replace(/(?:\s+(?:inc|incorporated|llc|ltd|limited|corp|corporation|company|co))+$/, "").trim();
}

export function insuredNameMatches(
  actual: string | undefined | null,
  expected: string | undefined | null,
) {
  if (!normalizeText(expected)) return true;
  return !!legalName(actual) && legalName(actual) === legalName(expected);
}

function parseDate(value: string | undefined) {
  if (!value) return Number.NaN;
  const time = dayjs(value).valueOf();
  return Number.isFinite(time) ? time : Number.NaN;
}

function policyDataStage(policy: Doc<"policies">) {
  if (
    policy.extractionDataStage === "placeholder" ||
    policy.extractionDataStage === "preview" ||
    policy.extractionDataStage === "final"
  ) {
    return policy.extractionDataStage;
  }
  return policy.pipelineStatus === "complete" ? "final" : "placeholder";
}

export function policyReadableForCompliance(
  policy: Doc<"policies">,
  includePreviewPolicies: boolean,
) {
  if (policy.deletedAt || policy.dismissed) return false;
  const dataStage = policyDataStage(policy);
  if (policy.pipelineStatus === "complete" && dataStage === "final") {
    return true;
  }
  return (
    includePreviewPolicies &&
    dataStage === "preview" &&
    policy.pipelineStatus !== "complete"
  );
}

function normalizeLimitKind(value: unknown): RequirementLimitKind | undefined {
  if (typeof value !== "string") return undefined;
  const direct = value.trim().toLowerCase();
  if (isRequirementLimitKind(direct)) return direct;
  return undefined;
}

function coverageLobMatches(
  requirement: Doc<"insuranceRequirements">,
  policy: Doc<"policies">,
) {
  const required = requirement.lineOfBusiness;
  if (!required || required === "UN") return true;
  const requiredCode = normalizeRequirementLineOfBusiness(required);
  if (
    requiredCode &&
    (policyLobCodes(policy).some(
      (code) => normalizeRequirementLineOfBusiness(code) === requiredCode,
    ) ||
      (policy.coverages ?? []).some(
        (coverage) =>
          normalizeRequirementLineOfBusiness(coverage.lineOfBusiness) ===
          requiredCode,
      ))
  ) {
    return true;
  }
  return !!bestCoverageForRequirement(policy, requirement);
}

function coverageText(coverage: NonNullable<Doc<"policies">["coverages"]>[number]) {
  return [coverage.name, coverage.originalContent, coverage.resolvedOriginalContent].filter(Boolean).join(" ");
}

function coverageMatchScore(
  coverage: NonNullable<Doc<"policies">["coverages"]>[number],
  requiredCode: string | undefined,
) {
  if (!requiredCode || requiredCode === "UN") return 0;
  return [coverage.lineOfBusiness, coverage.coverageCode].some(
    (code) => normalizeRequirementLineOfBusiness(code) === requiredCode,
  ) ? 100 : 0;
}

export function policyHasRequiredForm(policy: Doc<"policies">, form: string) {
  const normalizeForm = (value: string) => normalizeText(value).replace(/ /g, "");
  const needle = normalizeForm(form);
  return !!needle && [
    ...(policy.formInventory ?? []).map((entry) => entry.formNumber),
    ...(policy.coverages ?? []).map((entry) => entry.formNumber),
  ].some((value) => !!value && normalizeForm(value) === needle);
}

function policyHasProvision(policy: Doc<"policies">, provision: RequirementProvision) {
  const titles = [
    ...(policy.formInventory ?? []).map((form) => form.title),
    ...(policy.coverages ?? []).map((coverage) => coverage.name),
  ].map(normalizeText);
  const phrases: Record<RequirementProvision, string[]> = {
    additional_insured: ["additional insured"],
    waiver_of_subrogation: ["waiver of subrogation", "subrogation waived"],
    primary_non_contributory: ["primary and non contributory", "primary non contributory"],
  };
  return titles.some((title) => phrases[provision].includes(title));
}

export function complianceJudgmentPlan(
  requirement: Doc<"insuranceRequirements">,
  policy: Doc<"policies">,
  expectedNames: string[],
) {
  const state = {
    requirement: {
      party: expectedNames,
      lineOfBusiness: requirement.lineOfBusiness ?? requirement.title,
      provisions: requirement.provisions ?? [],
      requiredForms: requirement.requiredForms ?? [],
    },
    policy: {
      insuredName: policy.insuredName ?? null,
      formInventory: (policy.formInventory ?? []).map((form) => ({ formNumber: form.formNumber ?? null, title: form.title ?? null })),
      coverages: (policy.coverages ?? []).map((coverage) => ({
        name: coverage.name,
        lineOfBusiness: coverage.lineOfBusiness ?? null,
        coverageCode: coverage.coverageCode ?? null,
        text: coverageText(coverage),
        limitType: coverage.limitType ?? coverage.limit ?? null,
        limits: (coverage.limits ?? []).map((limit) => limit.kind ?? limit.label ?? limit.appliesTo ?? null),
      })),
    },
  };
  const questions: Record<string, DecisionQuestion> = {};
  if (expectedNames.length && !expectedNames.some((name) => insuredNameMatches(policy.insuredName, name))) {
    questions.insured = { type: "noul", instructions: "Is `policy.insuredName` the same legal entity as any party in `requirement.party` (including a DBA or trading name)? Similar words alone do not establish identity." };
  }
  if (state.policy.coverages.length > 0 && state.policy.coverages.length < 128 &&
    !(policy.coverages ?? []).some((coverage) => coverageMatchScore(coverage, normalizeRequirementLineOfBusiness(requirement.lineOfBusiness)))) {
    questions.coverage = {
      type: "choice",
      instructions: "Which row in `policy.coverages` provides the insurance line in `requirement.lineOfBusiness`? Select none when no row provides that line.",
      criteria: Object.fromEntries([
        ...state.policy.coverages.map((_, index) => [`c${index}`, { what: `The coverage row at \`policy.coverages[${index}]\` provides the requested line.`, not_for: "A row describing another insurance line or merely mentioning the requested line in an exclusion." }]),
        ["none", "No coverage row provides the requested insurance line."],
      ]),
    };
  }
  for (const [index, provision] of (requirement.provisions ?? []).entries()) {
    if (isRequirementProvision(provision) && policyHasProvision(policy, provision)) continue;
    questions[`provision_${index}`] = { type: "noul", instructions: `Do the endorsement/form titles in \`policy.formInventory\` and coverage text in \`policy.coverages\` establish the provision at \`requirement.provisions[${index}]\`? An exclusion, unrelated words, or a request to add it does not establish the provision.` };
  }
  for (const [index, form] of (requirement.requiredForms ?? []).entries()) {
    if (policyHasRequiredForm(policy, form)) continue;
    // Printed form identifiers are deterministic; only descriptive form titles need semantics.
    if (/\d/.test(form)) continue;
    questions[`form_${index}`] = { type: "noul", instructions: `Does \`policy.formInventory\` establish the descriptive form required at \`requirement.requiredForms[${index}]\`?` };
  }
  for (const [index, coverage] of state.policy.coverages.entries()) {
    for (const [limitIndex, label] of [coverage.limitType, ...coverage.limits].entries()) {
      if (!label || normalizeLimitKind(label)) continue;
      questions[`limit_${index}_${limitIndex}`] = {
        type: "choice",
        instructions: `Which typed limit kind describes ${limitIndex === 0 ? `\`policy.coverages[${index}].limitType\`` : `\`policy.coverages[${index}].limits[${limitIndex - 1}]\``}? Classify the limit's scope, not the policy's occurrence/claims-made trigger.`,
        criteria: Object.fromEntries([
          ...REQUIREMENT_LIMIT_KINDS.map((kind) => [kind, {
            what: REQUIREMENT_LIMIT_KIND_LABELS[kind],
            not_for: kind.startsWith("el_") ? "Non-employers-liability limits; a generic policy limit is insufficient." : kind === "per_claim" ? "Aggregate limits, including claims-made aggregates." : kind === "aggregate" ? "Per-claim or specifically general/products-completed-operations aggregates." : "Limits with a different scope; prefer the explicitly named scope.",
          }]),
          ["none", "The label does not identify a limit scope."],
        ]),
      };
    }
  }
  return { state, questions, inputKey: JSON.stringify({ version: 1, state, requirementUpdatedAt: requirement.updatedAt }) };
}

function storedJudgments(requirement: Doc<"insuranceRequirements">, policy: Doc<"policies">, expectedNames: string[]) {
  const plan = complianceJudgmentPlan(requirement, policy, expectedNames);
  return requirement.semanticJudgments?.find((entry) => entry.policyId === policy._id && entry.inputKey === plan.inputKey)?.answers ?? {};
}

function semanticLimitKind(value: string | boolean | undefined) {
  return isRequirementLimitKind(value) ? value : undefined;
}

function coverageAmountForKind(
  coverage: NonNullable<Doc<"policies">["coverages"]>[number],
  requiredKind: RequirementLimitKind,
  judgments: Record<string, string | boolean>,
  coverageIndex: number,
) {
  const candidates: Array<{
    kind?: RequirementLimitKind;
    amount?: number;
    label?: string;
  }> = [];
  if (coverage.limitAmount !== undefined) {
    candidates.push({
      kind: normalizeLimitKind(coverage.limitType ?? coverage.limit) ?? semanticLimitKind(judgments[`limit_${coverageIndex}_0`]),
      amount: coverage.limitAmount,
      label: coverage.limit,
    });
  }
  for (const [index, limit] of (coverage.limits ?? []).entries()) {
    candidates.push({
      kind: normalizeLimitKind(limit.kind ?? limit.label ?? limit.appliesTo) ?? semanticLimitKind(judgments[`limit_${coverageIndex}_${index + 1}`]),
      amount: limit.amount,
      label: [limit.label, limit.value].filter(Boolean).join(": "),
    });
  }

  const exact = candidates.find(
    (candidate) =>
      candidate.kind === requiredKind && typeof candidate.amount === "number",
  );
  if (exact) return exact;
  return undefined;
}

function bestCoverageForRequirement(
  policy: Doc<"policies">,
  requirement: Doc<"insuranceRequirements">,
  judgments: Record<string, string | boolean> = {},
) {
  const selected = judgments.coverage;
  if (typeof selected === "string" && /^c\d+$/.test(selected)) return policy.coverages?.[Number(selected.slice(1))];
  const required = requirement.lineOfBusiness;
  const requiredCode = normalizeRequirementLineOfBusiness(required);
  let best:
    | NonNullable<Doc<"policies">["coverages"]>[number]
    | undefined;
  let bestScore = 0;
  for (const coverage of policy.coverages ?? []) {
    const score = coverageMatchScore(coverage, requiredCode);
    if (score === 0) continue;
    if (!best || score > bestScore) {
      best = coverage;
      bestScore = score;
      continue;
    }
    if (score < bestScore) continue;
    const bestAmount = best.limitAmount ?? 0;
    const amount = coverage.limitAmount ?? 0;
    if (amount > bestAmount) best = coverage;
  }
  return best;
}

function matchedPolicySummary(args: {
  policy: Doc<"policies">;
  coverage?: NonNullable<Doc<"policies">["coverages"]>[number];
  amount?: number;
  expectedInsuredName?: string;
}) {
  const dataStage = policyDataStage(args.policy);
  return {
    _id: args.policy._id,
    carrier: args.policy.carrier || args.policy.security,
    policyNumber: args.policy.policyNumber,
    insuredName: args.policy.insuredName,
    expectedInsuredName: args.expectedInsuredName,
    expirationDate: args.policy.expirationDate,
    dataStage,
    provisional: dataStage === "preview",
    coverageName: args.coverage?.name,
    coverageLimit: args.coverage?.limit,
    detectedLimitAmount: args.amount ?? args.coverage?.limitAmount,
  };
}

function sentenceForReason(reason: string) {
  if (reason === "no_matching_policy") return "No matching policy found.";
  if (reason === "insured_name_mismatch") return "Named insured does not match.";
  if (reason === "deductible_above_required") {
    return "Deductible is above the required maximum.";
  }
  if (reason === "deductible_unverifiable") {
    return "Deductible is not structured on the matched coverage.";
  }
  if (reason === "coverage_form_unverifiable") {
    return "Occurrence or claims-made form is not structured on the matched policy.";
  }
  if (reason === "coverage_form_mismatch") {
    return "Policy coverage form does not match the requirement.";
  }
  if (reason === "retroactive_date_unverifiable") {
    return "Retroactive date is not structured on the matched coverage.";
  }
  if (reason === "retroactive_date_after_required") {
    return "Policy retroactive date is later than the permitted date.";
  }
  if (reason === "limit_unverifiable") {
    return "Structured limits do not show the required amount.";
  }
  if (reason.startsWith("limit_unverifiable:")) {
    const kind = reason.split(":")[1] as RequirementLimitKind;
    return `${REQUIREMENT_LIMIT_KIND_LABELS[kind] ?? kind} limit is not structured on the matched policy.`;
  }
  if (reason.startsWith("limit_below_required:")) {
    const kind = reason.split(":")[1] as RequirementLimitKind;
    return `${REQUIREMENT_LIMIT_KIND_LABELS[kind] ?? kind} limit is below the requirement.`;
  }
  if (reason.startsWith("provision_missing:")) {
    const provision = reason.split(":")[1] as RequirementProvision;
    return `${REQUIREMENT_PROVISION_LABELS[provision] ?? provision} not confirmed.`;
  }
  if (reason.startsWith("required_form_missing:")) {
    return `Required form ${reason.split(":").slice(1).join(":")} not confirmed.`;
  }
  return reason.replace(/_/g, " ");
}

export function formatComplianceReasons(reasons: readonly string[]) {
  return reasons.map(sentenceForReason).join(" ");
}

function savedReviewIsCurrent(
  requirement: Doc<"insuranceRequirements">,
  check: ManualCheck | undefined,
  now: number,
  policies: Doc<"policies">[],
) {
  if (!check || (check.checkedBy !== "user" && check.checkedBy !== "agent")) {
    return false;
  }
  if (check.checkedAt < requirement.updatedAt) return false;
  const matchedPolicyIds = new Set(check.matchedPolicyIds.map(String));
  const relevantPolicies = matchedPolicyIds.size
    ? policies.filter((policy) => matchedPolicyIds.has(String(policy._id)))
    : policies;
  if (
    relevantPolicies.some(
      (policy) =>
        Math.max(
          policy.extractionDataStageUpdatedAt ?? 0,
          policy.policyDetailOverridesUpdatedAt ?? 0,
        ) > check.checkedAt,
    )
  ) {
    return false;
  }
  const validUntil = check.evidence?.validUntil;
  if (!validUntil) return true;
  const expires = parseDate(validUntil);
  return Number.isFinite(expires) ? expires >= now : true;
}

export function latestSavedReview(
  requirement: Doc<"insuranceRequirements">,
  checks: ManualCheck[],
  policies: Doc<"policies">[],
  now = dayjs().valueOf(),
) {
  return checks
    .filter((check) => savedReviewIsCurrent(requirement, check, now, policies))
    .sort((a, b) => b.checkedAt - a.checkedAt)[0];
}

export function assessRequirementCompliance(
  requirement: Doc<"insuranceRequirements">,
  policies: Doc<"policies">[],
  options?: {
    now?: number;
    expectedInsuredName?: string;
    expectedInsuredNames?: string[];
    includePreviewPolicies?: boolean;
    existingChecks?: ManualCheck[];
  },
): ComplianceCheckResult {
  const now = options?.now ?? dayjs().valueOf();
  const savedReview = latestSavedReview(
    requirement,
    options?.existingChecks ?? [],
    policies,
    now,
  );
  if (savedReview) {
    return {
      requirementId: requirement._id,
      status: savedReview.status,
      reasons: savedReview.reasons ?? [],
      matchedPolicyIds: savedReview.matchedPolicyIds,
      matchedSummary: savedReview.matchedSummary,
      expiresAt: savedReview.expiresAt,
      checkedAt: savedReview.checkedAt,
      checkedBy: savedReview.checkedBy,
      evidence: savedReview.evidence,
    };
  }

  if (requirement.kind !== "coverage") {
    return {
      requirementId: requirement._id,
      status: "unverified",
      reasons: ["manual_verification_required"],
      matchedPolicyIds: [],
      matchedSummary: "Manual verification required.",
      checkedAt: now,
      checkedBy: "system",
    };
  }

  const includePreviewPolicies = options?.includePreviewPolicies !== false;
  const insuredNames = options?.expectedInsuredNames?.length
    ? options.expectedInsuredNames
    : options?.expectedInsuredName
      ? [options.expectedInsuredName]
      : [];
  const candidates = policies
    .filter((policy) => policyReadableForCompliance(policy, includePreviewPolicies))
    .filter((policy) => coverageLobMatches(requirement, policy) || !!bestCoverageForRequirement(policy, requirement, storedJudgments(requirement, policy, insuredNames)))
    .map((policy) => ({
      policy,
      coverage: bestCoverageForRequirement(policy, requirement, storedJudgments(requirement, policy, insuredNames)),
      expiration: parseDate(policy.expirationDate),
    }))
    .sort(
      (a, b) =>
        (Number.isFinite(b.expiration) ? b.expiration : 0) -
        (Number.isFinite(a.expiration) ? a.expiration : 0),
    );

  if (candidates.length === 0) {
    return {
      requirementId: requirement._id,
      status: "unverified",
      reasons: ["no_matching_policy"],
      matchedPolicyIds: [],
      matchedSummary: "No active policy appears to match this coverage requirement.",
      checkedAt: now,
      checkedBy: "system",
    };
  }

  const active =
    candidates.find(
      ({ expiration }) => Number.isFinite(expiration) && expiration >= now,
    ) ?? candidates[0]!;
  const reasons: string[] = [];
  const judgments = storedJudgments(requirement, active.policy, insuredNames);
  if (!active.coverage) reasons.push("coverage_unverifiable");
  let bestDetectedAmount: number | undefined;
  for (const required of requirement.limits ?? []) {
    const requiredKind = isRequirementLimitKind(required.kind)
      ? required.kind
      : "other";
    const matched = active.coverage
      ? coverageAmountForKind(active.coverage, requiredKind, judgments, active.policy.coverages?.indexOf(active.coverage) ?? -1)
      : undefined;
    if (!matched || matched.amount === undefined) {
      reasons.push(`limit_unverifiable:${requiredKind}`);
      continue;
    }
    bestDetectedAmount =
      bestDetectedAmount === undefined
        ? matched.amount
        : Math.max(bestDetectedAmount, matched.amount);
    if (matched.amount < required.amount) {
      reasons.push(`limit_below_required:${requiredKind}`);
    }
  }
  if (
    requirement.maxDeductible?.amount !== undefined &&
    active.coverage?.deductibleAmount === undefined
  ) {
    reasons.push("deductible_unverifiable");
  } else if (
    requirement.maxDeductible?.amount !== undefined &&
    active.coverage?.deductibleAmount !== undefined &&
    active.coverage.deductibleAmount > requirement.maxDeductible.amount
  ) {
    reasons.push("deductible_above_required");
  }
  if (requirement.coverageForm) {
    const actualForm = normalizeText(active.policy.coverageForm);
    if (!actualForm) {
      reasons.push("coverage_form_unverifiable");
    } else if (actualForm !== normalizeText(requirement.coverageForm)) {
      reasons.push("coverage_form_mismatch");
    }
  }
  if (requirement.retroactiveDateOnOrBefore) {
    const actualRetroactiveDate = parseDate(active.coverage?.retroactiveDate);
    const requiredRetroactiveDate = parseDate(
      requirement.retroactiveDateOnOrBefore,
    );
    if (!Number.isFinite(actualRetroactiveDate)) {
      reasons.push("retroactive_date_unverifiable");
    } else if (
      Number.isFinite(requiredRetroactiveDate) &&
      actualRetroactiveDate > requiredRetroactiveDate
    ) {
      reasons.push("retroactive_date_after_required");
    }
  }
  for (const [index, rawProvision] of (requirement.provisions ?? []).entries()) {
    if (!(isRequirementProvision(rawProvision) && policyHasProvision(active.policy, rawProvision)) && judgments[`provision_${index}`] !== true) {
      reasons.push(`provision_${judgments[`provision_${index}`] === false ? "missing" : "unverifiable"}:${rawProvision}`);
    }
  }
  for (const [index, form] of (requirement.requiredForms ?? []).entries()) {
    if (!policyHasRequiredForm(active.policy, form) && judgments[`form_${index}`] !== true) {
      reasons.push(`required_form_unverifiable:${form}`);
    }
  }
  if (
    active.expiration >= now &&
    insuredNames.length > 0 &&
    !insuredNames.some((name) => insuredNameMatches(active.policy.insuredName, name)) &&
    judgments.insured !== true
  ) {
    reasons.push(judgments.insured === false ? "insured_name_mismatch" : "insured_name_unverifiable");
  }

  if (!Number.isFinite(active.expiration)) reasons.push("expiration_unverifiable");
  const effective = parseDate(active.policy.effectiveDate);
  if (!Number.isFinite(effective)) reasons.push("effective_date_unverifiable");
  else if (effective > now) reasons.push("policy_not_yet_effective");
  const daysUntilExpiration = Number.isFinite(active.expiration)
    ? Math.ceil((active.expiration - now) / (24 * 60 * 60 * 1000))
    : undefined;
  const onlyUnverifiableReasons =
    reasons.length > 0 &&
    reasons.every(
      (reason) =>
        reason.includes("unverifiable") || reason === "manual_verification_required",
    );
  const status: ComplianceCheckStatus =
    active.expiration < now
      ? "expired"
      : reasons.length > 0
        ? onlyUnverifiableReasons
          ? "unverified"
          : "not_met"
        : daysUntilExpiration !== undefined && daysUntilExpiration <= 30
          ? "expiring_soon"
          : "met";
  const matchedPolicy = matchedPolicySummary({
    policy: active.policy,
    coverage: active.coverage,
    amount: bestDetectedAmount,
    expectedInsuredName: insuredNames[0],
  });
  const matchedSummary =
    status === "met"
      ? `Matched ${matchedPolicy.carrier ?? "policy"} ${matchedPolicy.policyNumber ?? ""}`.trim()
      : formatComplianceReasons(reasons.length > 0 ? reasons : ["policy_expired"]);

  return {
    requirementId: requirement._id,
    status,
    reasons: status === "expired" && reasons.length === 0 ? ["policy_expired"] : reasons,
    matchedPolicyIds: [active.policy._id],
    matchedPolicy,
    matchedSummary,
    expiresAt: Number.isFinite(active.expiration)
      ? active.policy.expirationDate
      : undefined,
    daysUntilExpiration,
    checkedAt: now,
    checkedBy: "system",
  };
}
