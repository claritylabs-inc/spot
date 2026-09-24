import { syncPolicyUploadFingerprints } from "./lib/policyImportDedup";
import { v } from "convex/values";
import {
  mutation,
  query,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  getCurrentOrgAccess,
  getPolicyAccessForQuery,
  assertCanEditPolicyExtractedFields,
  assertCanUploadPolicy,
  assertCanManageUploadedPolicy,
  assertCanReviewPolicyExtraction,
  assertCanReadPolicies,
  getOrgAccess,
  type OrgAccess,
} from "./lib/access";
import {
  assertImpersonatedSetupWrite,
  getActiveOperatorImpersonation,
  requireOperator,
  requireOperatorForUser,
  writeOperatorAudit,
} from "./lib/operatorIdentity";
import type { Id as DataModelId } from "./_generated/dataModel";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import {
  normalizeExtractedDate,
  normalizeExtractedDateFields,
  normalizeMoneyField,
  normalizeMoneyString,
  parseExtractedNumber,
} from "./lib/valueNormalization";
import { toLobCodes } from "./lib/linesOfBusiness";
import {
  readCarrierIdentity,
  type CarrierIdentity,
} from "./lib/carrierIdentity";
import { resolveCarrierIdentity } from "./lib/carrierIdentityProjection";
import { policyProductIdentityValidator } from "./lib/policyProductIdentity";
import { assertNoOperatorImpersonation } from "./lib/clientFiles";
import {
  extractionContractHash,
  evaluateExtractionPromotion,
  sectionResultArtifactReasons,
  type ExtractionCompletionManifest,
  type PromotionEvidenceLedger,
} from "./lib/extractionPromotion";

dayjs.extend(customParseFormat);

type PolicyPipelineStatus =
  | "idle"
  | "running"
  | "paused"
  | "complete"
  | "error";
type PolicyExtractionDataStage = "placeholder" | "preview" | "final";
type PolicyExtractionArtifactKind =
  | "cl_sdk_checkpoint"
  | "embedding_payload"
  | "external_completion_payload"
  | "source_bundle"
  | "section_result"
  | "parsed_source"
  | "section_plan";
type PolicyPipelineLogEntry = {
  timestamp: number;
  message: string;
  phase?: string;
  level?: string;
};

async function deactivatePolicyDeclarationFacts(
  ctx: MutationCtx,
  policyId: DataModelId<"policies">,
) {
  const facts = await ctx.db
    .query("policyDeclarationFacts")
    .withIndex("policy_active", (q) =>
      q.eq("policyId", policyId).eq("active", true),
    )
    .collect();
  for (const fact of facts) {
    await ctx.db.patch(fact._id, { active: false });
  }
}

async function reactivatePolicyDeclarationFacts(
  ctx: MutationCtx,
  policyId: DataModelId<"policies">,
) {
  const facts = await ctx.db
    .query("policyDeclarationFacts")
    .withIndex("policy_active", (q) =>
      q.eq("policyId", policyId).eq("active", false),
    )
    .collect();
  const latestObservedAt = facts.reduce(
    (latest, fact) => Math.max(latest, fact.observedAt),
    Number.NEGATIVE_INFINITY,
  );
  for (const fact of facts.filter(
    (candidate) => candidate.observedAt === latestObservedAt,
  )) {
    await ctx.db.patch(fact._id, { active: true });
  }
}

const PIPELINE_LOG_LIMIT = 500;
const PIPELINE_LOG_MIN_INTERVAL_MS = 10_000;
const PIPELINE_STALE_REQUEUE_MS = 5 * 60 * 1000;
const PIPELINE_STALE_REQUEUE_BATCH_LIMIT = 25;
const INTAKE_CANDIDATE_SCAN_LIMIT = 40;

function isImportantPipelineLog(entry: PolicyPipelineLogEntry) {
  if (entry.level === "warn" || entry.level === "error") return true;
  return /\b(complete|completed|cancelled|canceled|failed|error|finished)\b/i.test(
    entry.message,
  );
}

function nowMs(): number {
  return dayjs().valueOf();
}

function normalizeFileSha256(value?: string): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[a-f0-9]{64}$/.test(normalized)
    ? normalized
    : undefined;
}

function normalizeFileSha256s(values?: string[]): string[] | undefined {
  if (!values) return undefined;
  const hashes = Array.from(
    new Set(
      values
        .map((value) => normalizeFileSha256(value))
        .filter((value): value is string => Boolean(value)),
    ),
  );
  return hashes.length > 0 ? hashes : undefined;
}

async function writePolicyOperatorAudit(
  ctx: MutationCtx,
  access: OrgAccess,
  policyId: DataModelId<"policies">,
  orgId: DataModelId<"organizations">,
  summary: string,
  metadata?: Record<string, unknown>,
) {
  if (access.accessType !== "operator") return;
  await writeOperatorAudit(ctx, {
    operatorUserId: access.userId,
    type: "setup_write",
    targetOrgId: orgId,
    summary,
    metadata: {
      domain: "policies",
      policyId,
      ...metadata,
    },
  });
}

function effectiveExtractionDataStage(policy: {
  extractionDataStage?: string;
}): PolicyExtractionDataStage {
  if (
    policy.extractionDataStage === "placeholder" ||
    policy.extractionDataStage === "preview" ||
    policy.extractionDataStage === "final"
  ) {
    return policy.extractionDataStage;
  }
  return "placeholder";
}

function isFinalExtractedPolicy(policy: {
  extractionDataStage?: string;
  pipelineStatus?: string;
  deletedAt?: number;
}) {
  return (
    !policy.deletedAt &&
    policy.pipelineStatus === "complete" &&
    effectiveExtractionDataStage(policy) === "final"
  );
}

function isPreviewReadablePolicy(policy: {
  extractionDataStage?: string;
  pipelineStatus?: string;
  deletedAt?: number;
}) {
  if (isFinalExtractedPolicy(policy)) return true;
  return (
    !policy.deletedAt &&
    policy.extractionDataStage === "preview" &&
    policy.pipelineStatus !== "complete"
  );
}

function isVisiblePolicyListRow(policy: {
  extractionDataStage?: string;
  pipelineStatus?: string;
  deletedAt?: number;
}) {
  if (policy.deletedAt) return false;
  if (policy.extractionDataStage === "placeholder") return true;
  if (isPreviewReadablePolicy(policy)) return true;
  if (policy.pipelineStatus === "error") return true;
  return false;
}

const FINAL_EXTRACTION_IDENTITY_FIELDS = [
  "policyNumber",
  "insuredName",
  "broker",
  "effectiveDate",
  "expirationDate",
  "premium",
] as const;

function knownPolicyText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^(unknown|extracting(?:\.\.\.)?|not applicable|n\/a)$/i.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function preserveKnownFinalExtractionIdentityFields(
  fields: Record<string, unknown>,
  existing: Record<string, unknown> | null,
) {
  if (!existing) return;

  for (const key of FINAL_EXTRACTION_IDENTITY_FIELDS) {
    if (knownPolicyText(fields[key]) || !knownPolicyText(existing[key]))
      continue;
    fields[key] = existing[key];
  }

  const existingCarrier =
    knownPolicyText(existing.carrier) ?? knownPolicyText(existing.security);
  const existingSecurity =
    knownPolicyText(existing.security) ?? existingCarrier;
  if (!knownPolicyText(fields.carrier) && existingCarrier) {
    fields.carrier = existingCarrier;
  }
  if (!knownPolicyText(fields.security) && existingSecurity) {
    fields.security = existingSecurity;
  }
  if (
    (!Array.isArray(fields.coverages) || fields.coverages.length === 0) &&
    Array.isArray(existing.coverages) &&
    existing.coverages.length > 0
  ) {
    fields.coverages = existing.coverages;
  }
  if (
    (!knownPolicyText(fields.fileName) || fields.fileName === "Unknown.pdf") &&
    knownPolicyText(existing.fileName)
  ) {
    fields.fileName = existing.fileName;
  }
}

function policyYearFromInput(value: string | undefined): number | undefined {
  const normalized = normalizeExtractedDate(value);
  if (!normalized) return undefined;
  const parsed = dayjs(
    normalized,
    ["MM/DD/YYYY", "M/D/YYYY", "YYYY-MM-DD", "YYYY/M/D"],
    true,
  );
  return parsed.isValid() ? parsed.year() : undefined;
}

export function normalizeEditableFields(
  fields: Record<string, unknown>,
  options: {
    deriveNumericAmounts?: boolean;
    normalizeMoneyText?: boolean;
  } = {},
): Record<string, unknown> {
  const deriveNumericAmounts = options.deriveNumericAmounts ?? true;
  const normalizeMoneyText = options.normalizeMoneyText ?? true;
  const next = normalizeExtractedDateFields(fields) as Record<string, unknown>;
  if (next.documentType && next.documentType !== "policy") {
    next.documentType = "policy";
  }
  for (const key of [
    "quoteNumber",
    "quoteYear",
    "proposedEffectiveDate",
    "proposedExpirationDate",
    "quoteExpirationDate",
    "subjectivities",
    "underwritingConditions",
    "enrichedSubjectivities",
    "enrichedUnderwritingConditions",
    "warrantyRequirements",
  ]) {
    delete next[key];
  }
  if (Array.isArray(next.linesOfBusiness)) {
    next.linesOfBusiness = toLobCodes(
      next.linesOfBusiness.filter(
        (value): value is string => typeof value === "string",
      ),
    );
  }
  delete next.policyTypes;

  for (const [textKey, amountKey] of [
    ["premium", "premiumAmount"],
    ["totalCost", "totalCostAmount"],
    ["minPremium", "minPremiumAmount"],
    ["depositPremium", "depositPremiumAmount"],
  ] as const) {
    if (next[textKey] !== undefined) {
      if (!normalizeMoneyText && !deriveNumericAmounts) continue;
      const money = normalizeMoneyField(next[textKey]);
      if (normalizeMoneyText && money.text !== undefined)
        next[textKey] = money.text;
      if (deriveNumericAmounts && money.amount !== undefined)
        next[amountKey] = money.amount;
    }
  }

  if (Array.isArray(next.coverages)) {
    next.coverages = next.coverages.map((coverage) => {
      const row = { ...(coverage as Record<string, unknown>) };
      const limitAmount =
        typeof row.limitAmount === "number"
          ? row.limitAmount
          : deriveNumericAmounts
            ? (parseExtractedNumber(row.limit) ??
              parseExtractedNumber(row.originalContent))
            : undefined;
      const deductibleAmount =
        typeof row.deductibleAmount === "number"
          ? row.deductibleAmount
          : deriveNumericAmounts
            ? parseExtractedNumber(row.deductible)
            : undefined;
      if (normalizeMoneyText && row.limit !== undefined) {
        row.limit = normalizeMoneyString(row.limit) ?? row.limit;
      }
      if (normalizeMoneyText && row.deductible !== undefined) {
        row.deductible = normalizeMoneyString(row.deductible) ?? row.deductible;
      }
      if (limitAmount !== undefined) row.limitAmount = limitAmount;
      if (deductibleAmount !== undefined)
        row.deductibleAmount = deductibleAmount;
      return row;
    });
  }

  for (const key of ["taxesAndFees", "premiumBreakdown"]) {
    if (!Array.isArray(next[key])) continue;
    next[key] = (next[key] as Array<Record<string, unknown>>).map((row) => {
      if (!normalizeMoneyText && !deriveNumericAmounts) return row;
      const money = normalizeMoneyField(row.amount);
      return {
        ...row,
        ...(normalizeMoneyText && money.text !== undefined
          ? { amount: money.text }
          : {}),
        ...(deriveNumericAmounts && money.amount !== undefined
          ? { amountValue: money.amount }
          : {}),
      };
    });
  }

  return next;
}

async function getPolicyExtractionRun(
  ctx: QueryCtx | MutationCtx,
  policyId: DataModelId<"policies">,
) {
  return await ctx.db
    .query("policyExtractionRuns")
    .withIndex("policy", (q) => q.eq("policyId", policyId))
    .first();
}

export async function readPolicyPipelineState(
  ctx: QueryCtx | MutationCtx,
  policyId: DataModelId<"policies">,
) {
  const run = await getPolicyExtractionRun(ctx, policyId);
  if (run) {
    return {
      pipelineStatus: run.pipelineStatus as PolicyPipelineStatus,
      pipelineError: run.pipelineError,
      pipelineCheckpoint: run.pipelineCheckpoint,
      pipelineLog: run.pipelineLog,
    };
  }

  const policy = await ctx.db.get(policyId);
  if (!policy) return null;
  return {
    pipelineStatus: (policy.pipelineStatus ?? "idle") as PolicyPipelineStatus,
    pipelineError: policy.pipelineError,
    pipelineCheckpoint: policy.pipelineCheckpoint,
    pipelineLog: policy.pipelineLog,
  };
}

async function mergePolicyPipelineState<
  T extends { _id: DataModelId<"policies"> },
>(ctx: QueryCtx, policy: T): Promise<T> {
  const state = await readPolicyPipelineState(ctx, policy._id);
  if (!state) return policy;
  return {
    ...policy,
    pipelineStatus: state.pipelineStatus,
    pipelineError: state.pipelineError,
    pipelineCheckpoint: state.pipelineCheckpoint,
    pipelineLog: state.pipelineLog,
  };
}

async function attachResolvedCarrierIdentity<
  T extends { carrierIdentity?: unknown },
>(
  ctx: QueryCtx,
  policy: T,
): Promise<
  Omit<T, "carrierIdentity"> & {
    carrierIdentity?: CarrierIdentity;
  }
> {
  const carrierIdentity = await resolveCarrierIdentity(
    ctx,
    policy.carrierIdentity,
  );
  return {
    ...policy,
    ...(carrierIdentity ? { carrierIdentity } : {}),
  };
}

async function ensurePolicyExtractionRun(
  ctx: any,
  policyId: DataModelId<"policies">,
) {
  const policy = await ctx.db.get(policyId);
  if (policy?.orgId) {
    const org = await ctx.db.get(policy.orgId);
    if (org?.deletedAt !== undefined) throw new Error("Organization deleted");
  }
  const existing = await getPolicyExtractionRun(ctx, policyId);
  if (existing) return existing;
  const now = nowMs();
  const fields: Record<string, unknown> = {
    policyId,
    pipelineStatus: (policy?.pipelineStatus ?? "idle") as PolicyPipelineStatus,
    createdAt: now,
    updatedAt: now,
  };
  if (policy?.pipelineError) fields.pipelineError = policy.pipelineError;
  if (policy?.pipelineCheckpoint)
    fields.pipelineCheckpoint = policy.pipelineCheckpoint;
  if (Array.isArray(policy?.pipelineLog))
    fields.pipelineLog = policy.pipelineLog;

  const runId = await ctx.db.insert("policyExtractionRuns", fields as any);
  if (policy?.pipelineCheckpoint || policy?.pipelineLog) {
    await ctx.db.patch(policyId, {
      pipelineCheckpoint: undefined,
      pipelineLog: undefined,
    });
  }
  return await ctx.db.get(runId);
}

async function patchPolicyExtractionRun(
  ctx: any,
  policyId: DataModelId<"policies">,
  patch: Record<string, unknown>,
) {
  const run = await ensurePolicyExtractionRun(ctx, policyId);
  if (!run) return null;
  await ctx.db.patch(run._id, { ...patch, updatedAt: nowMs() });
  return await ctx.db.get(run._id);
}

async function clearPolicyExtractionArtifacts(
  ctx: any,
  policyId: DataModelId<"policies">,
  kind?: PolicyExtractionArtifactKind,
) {
  const query = kind
    ? ctx.db
        .query("policyExtractionArtifacts")
        .withIndex("policy_kind", (q: any) =>
          q.eq("policyId", policyId).eq("kind", kind),
        )
    : ctx.db
        .query("policyExtractionArtifacts")
        .withIndex("policy", (q: any) => q.eq("policyId", policyId));
  const artifacts = await query.collect();
  for (const artifact of artifacts) {
    await ctx.storage.delete(artifact.storageId).catch(() => {});
    await ctx.db.delete(artifact._id);
  }
}

async function clearTransientPolicyExtractionArtifacts(
  ctx: any,
  policyId: DataModelId<"policies">,
) {
  for (const kind of [
    "cl_sdk_checkpoint",
    "embedding_payload",
    "parsed_source",
    "section_plan",
  ] as const) {
    await clearPolicyExtractionArtifacts(ctx, policyId, kind);
  }
}

// Phases that run before replacement fields are promoted. "extract" is the
// removed monolithic phase; its checkpoints restart from load_pdf.
const PRE_PROMOTION_PHASES = new Set([
  "load_pdf",
  "parse",
  "plan_sections",
  "extract_sections",
  "merge",
  "extract",
]);

type PolicyPipelineCheckpoint = {
  nextPhase?: string;
  state?: {
    policyVersionKind?: string;
    replacementPromotionStarted?: boolean;
  };
};

function policyPipelineCheckpoint(checkpoint: unknown) {
  return checkpoint && typeof checkpoint === "object"
    ? (checkpoint as PolicyPipelineCheckpoint)
    : undefined;
}

function isRetryablePrePromotionReplacement(
  policy: { extractionDataStage?: string } | null,
  checkpoint: unknown,
) {
  const typedCheckpoint = policyPipelineCheckpoint(checkpoint);
  const state = typedCheckpoint?.state;
  const replacementRun =
    state?.policyVersionKind === "re_extraction" ||
    state?.policyVersionKind === "renewal";
  return (
    policy?.extractionDataStage === "final" &&
    replacementRun &&
    state.replacementPromotionStarted === false &&
    PRE_PROMOTION_PHASES.has(typedCheckpoint?.nextPhase ?? "")
  );
}

function preservesBoundPolicyOnExtractionError(
  policy: {
    extractionDataStage?: string;
    pipelineStatus?: string;
  } | null,
  checkpoint: unknown,
  status: PolicyPipelineStatus,
) {
  const policyVersionKind =
    policyPipelineCheckpoint(checkpoint)?.state?.policyVersionKind;
  const replacementRun =
    policyVersionKind === "re_extraction" || policyVersionKind === "renewal";
  return (
    status === "error" &&
    policy?.extractionDataStage === "final" &&
    (replacementRun
      ? isRetryablePrePromotionReplacement(policy, checkpoint)
      : policy.pipelineStatus === "complete")
  );
}

function canonicalPipelineStatusPatch(
  policy: {
    extractionDataStage?: string;
    pipelineStatus?: string;
  } | null,
  checkpoint: unknown,
  status: PolicyPipelineStatus,
  error: string | null | undefined,
) {
  const preservesBoundPolicy = preservesBoundPolicyOnExtractionError(
    policy,
    checkpoint,
    status,
  );
  return {
    pipelineStatus: preservesBoundPolicy ? "complete" : status,
    pipelineError: preservesBoundPolicy ? undefined : (error ?? undefined),
  };
}

function policyPipelineStatusPatch(
  policy: {
    extractionDataStage?: string;
    pipelineStatus?: string;
  } | null,
  checkpoint: unknown,
  status: PolicyPipelineStatus,
  error: string | null | undefined,
) {
  return {
    ...canonicalPipelineStatusPatch(policy, checkpoint, status, error),
    pipelineCheckpoint: undefined,
    pipelineLog: undefined,
  };
}

async function setPolicyPipelineStatus(
  ctx: any,
  policyId: DataModelId<"policies">,
  status: PolicyPipelineStatus,
  error: string | null,
) {
  const [run, policy] = await Promise.all([
    getPolicyExtractionRun(ctx, policyId),
    ctx.db.get(policyId),
  ]);
  const canonicalStatus = canonicalPipelineStatusPatch(
    policy,
    run?.pipelineCheckpoint,
    status,
    error,
  );
  await patchPolicyExtractionRun(ctx, policyId, {
    ...canonicalStatus,
  });
  await ctx.db.patch(
    policyId,
    policyPipelineStatusPatch(policy, run?.pipelineCheckpoint, status, error),
  );
}

async function appendPolicyPipelineLog(
  ctx: any,
  policyId: DataModelId<"policies">,
  entry: PolicyPipelineLogEntry,
) {
  const run = await ensurePolicyExtractionRun(ctx, policyId);
  if (!run) return;
  const existing = Array.isArray(run.pipelineLog) ? run.pipelineLog : [];
  const previous = existing.at(-1);
  const important = isImportantPipelineLog(entry);
  const phaseChanged = previous?.phase !== entry.phase;
  const enoughTimeElapsed =
    previous?.timestamp === undefined ||
    entry.timestamp - previous.timestamp >= PIPELINE_LOG_MIN_INTERVAL_MS;
  if (!important && !phaseChanged && !enoughTimeElapsed) return;
  const next = [...existing, entry].slice(-PIPELINE_LOG_LIMIT);
  await ctx.db.patch(run._id, {
    pipelineLog: next,
    updatedAt: nowMs(),
  });
}

async function insertPipelineTraceLog(
  ctx: any,
  policyId: DataModelId<"policies">,
  entry: PolicyPipelineLogEntry,
) {
  const run = await getPolicyExtractionRun(ctx, policyId);
  const checkpoint = run?.pipelineCheckpoint as
    | { state?: { traceId?: string } }
    | undefined;
  const traceId = checkpoint?.state?.traceId;
  if (!traceId) return;
  const session = await ctx.db
    .query("policyExtractionTraceSessions")
    .withIndex("trace", (q: any) => q.eq("traceId", traceId))
    .first();
  if (!session) return;
  await ctx.db.insert("policyExtractionTraceEvents", {
    traceId,
    policyId,
    orgId: session.orgId,
    kind: "log",
    timestamp: entry.timestamp,
    message: entry.message,
    phase: entry.phase,
    level: entry.level,
    expiresAt: session.expiresAt,
  });
}

export const get = query({
  args: { id: v.id("policies") },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.id);
    if (!policy || !policy.orgId) return null;
    try {
      const access = await getOrgAccess(ctx, policy.orgId, {
        allowOperator: true,
      });
      assertCanReadPolicies(access);
    } catch {
      return null;
    }
    return await attachResolvedCarrierIdentity(
      ctx,
      await mergePolicyPipelineState(ctx, policy),
    );
  },
});

export const getSummary = query({
  args: { id: v.id("policies") },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.id);
    if (!policy || !policy.orgId) return null;
    try {
      const access = await getOrgAccess(ctx, policy.orgId, {
        allowOperator: true,
      });
      assertCanReadPolicies(access);
    } catch {
      return null;
    }

    const enrichedPolicy = await attachResolvedCarrierIdentity(
      ctx,
      await mergePolicyPipelineState(ctx, policy),
    );

    return {
      _id: enrichedPolicy._id,
      _creationTime: enrichedPolicy._creationTime,
      orgId: enrichedPolicy.orgId,
      fileId: enrichedPolicy.fileId,
      fileName: enrichedPolicy.fileName,
      documentType: enrichedPolicy.documentType,
      policyNumber: enrichedPolicy.policyNumber,
      linesOfBusiness: enrichedPolicy.linesOfBusiness,
      policyTermType: enrichedPolicy.policyTermType,
      carrier: enrichedPolicy.carrier,
      carrierIdentity: enrichedPolicy.carrierIdentity,
      carrierLegalName: enrichedPolicy.carrierLegalName,
      carrierNaicNumber: enrichedPolicy.carrierNaicNumber,
      security: enrichedPolicy.security,
      generalAgent: enrichedPolicy.generalAgent,
      broker: enrichedPolicy.broker,
      brokerAgency: enrichedPolicy.brokerAgency,
      brokerContactName: enrichedPolicy.brokerContactName,
      brokerLicenseNumber: enrichedPolicy.brokerLicenseNumber,
      producer: enrichedPolicy.producer,
      insurer: enrichedPolicy.insurer,
      policyDetailOverrides: enrichedPolicy.policyDetailOverrides,
      policyDetailOverridesUpdatedAt:
        enrichedPolicy.policyDetailOverridesUpdatedAt,
      insuredName: enrichedPolicy.insuredName,
      effectiveDate: enrichedPolicy.effectiveDate,
      expirationDate: enrichedPolicy.expirationDate,
      premium: enrichedPolicy.premium,
      limits: enrichedPolicy.limits,
      deductibles: enrichedPolicy.deductibles,
      coverages: enrichedPolicy.coverages,
      operationalProfile: enrichedPolicy.operationalProfile,
      summary: enrichedPolicy.summary,
      isRenewal: enrichedPolicy.isRenewal,
      isDemo: enrichedPolicy.isDemo,
      deletedAt: enrichedPolicy.deletedAt,
      dismissed: enrichedPolicy.dismissed,
      pipelineStatus: enrichedPolicy.pipelineStatus,
      pipelineError: enrichedPolicy.pipelineError,
      uploadedBySide: enrichedPolicy.uploadedBySide,
      pipelineLog: enrichedPolicy.pipelineLog,
      extractionDataStage: effectiveExtractionDataStage(enrichedPolicy),
      extractionDataStageUpdatedAt: enrichedPolicy.extractionDataStageUpdatedAt,
      extractionPreviewVersion: enrichedPolicy.extractionPreviewVersion,
      extractionPreviewModel: enrichedPolicy.extractionPreviewModel,
      extractionPreviewError: enrichedPolicy.extractionPreviewError,
      extractionReview: enrichedPolicy.extractionReview,
    };
  },
});

export const getPolicyFileUrl = query({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const policyAccess = await getPolicyAccessForQuery(ctx, args.policyId);
    if (!policyAccess?.policy.fileId) return null;
    return await ctx.storage.getUrl(policyAccess.policy.fileId);
  },
});

// All complete, non-deleted policies for an org (used by agent action)
export const listAllInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("policies")
      .withIndex("organization", (idx) => idx.eq("orgId", args.orgId))
      .collect();
    return all.filter(isFinalExtractedPolicy);
  },
});

// Most recent final policies in an org, offered to the intake classifier as
// advisory relationship candidates. Bounded because policy rows are large.
export const listIntakeCandidatesInternal = internalQuery({
  args: {
    orgId: v.id("organizations"),
    excludePolicyId: v.id("policies"),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const recent = await ctx.db
      .query("policies")
      .withIndex("organization", (idx) => idx.eq("orgId", args.orgId))
      .order("desc")
      .take(INTAKE_CANDIDATE_SCAN_LIMIT);
    return recent
      .filter(
        (policy) =>
          policy._id !== args.excludePolicyId && isFinalExtractedPolicy(policy),
      )
      .slice(0, args.limit)
      .map((policy) => ({
        policyId: String(policy._id),
        policyNumber: policy.policyNumber,
        carrier: policy.carrier,
        namedInsured: policy.insuredName,
        effectiveDate: policy.effectiveDate,
        expirationDate: policy.expirationDate,
      }));
  },
});

// Final policies plus provisional first-read policies for low-risk read surfaces
// such as agents, MCP summaries, and live compliance previews.
export const listAllPreviewReadableInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("policies")
      .withIndex("organization", (idx) => idx.eq("orgId", args.orgId))
      .collect();
    return all.filter(isPreviewReadablePolicy).map((policy) => ({
      ...policy,
      extractionDataStage: effectiveExtractionDataStage(policy),
    }));
  },
});

// Shared validators for coverages and document structure
const coverageValidator = v.object({
  name: v.string(),
  lineOfBusiness: v.optional(v.string()),
  endorsementNumber: v.optional(v.string()),
  coverageCode: v.optional(v.string()),
  formEditionDate: v.optional(v.string()),
  limit: v.optional(v.string()),
  limitAmount: v.optional(v.number()),
  limitType: v.optional(v.string()),
  limitValueType: v.optional(v.string()),
  limits: v.optional(
    v.array(
      v.object({
        label: v.string(),
        value: v.string(),
        amount: v.optional(v.number()),
        appliesTo: v.optional(v.string()),
        kind: v.optional(v.string()),
        sourceNodeIds: v.optional(v.array(v.string())),
        sourceSpanIds: v.optional(v.array(v.string())),
      }),
    ),
  ),
  deductible: v.optional(v.string()),
  deductibleAmount: v.optional(v.number()),
  deductibleType: v.optional(v.string()),
  deductibleValueType: v.optional(v.string()),
  formNumber: v.optional(v.string()),
  sir: v.optional(v.string()),
  sublimit: v.optional(v.string()),
  coinsurance: v.optional(v.string()),
  valuation: v.optional(v.string()),
  territory: v.optional(v.string()),
  trigger: v.optional(v.string()),
  retroactiveDate: v.optional(v.string()),
  included: v.optional(v.boolean()),
  coveragePremium: v.optional(v.string()),
  premium: v.optional(v.string()),
  pageNumber: v.optional(v.number()),
  resolvedFromPage: v.optional(v.number()),
  sectionRef: v.optional(v.string()),
  originalContent: v.optional(v.string()),
  resolvedOriginalContent: v.optional(v.string()),
  recordId: v.optional(v.string()),
  documentNodeId: v.optional(v.string()),
  sourceSpanIds: v.optional(v.array(v.string())),
  sourceTextHash: v.optional(v.string()),
  extractionReviewStatus: v.optional(v.string()),
  extractionReviewReason: v.optional(v.string()),
  reviewSourceSpanIds: v.optional(v.array(v.string())),
});

const premiumLineValidator = v.object({
  line: v.string(),
  amount: v.string(),
  amountValue: v.optional(v.number()),
  documentNodeId: v.optional(v.string()),
  sourceSpanIds: v.optional(v.array(v.string())),
  sourceTextHash: v.optional(v.string()),
  pageStart: v.optional(v.number()),
  pageEnd: v.optional(v.number()),
});

const addressValidator = v.object({
  street1: v.string(),
  street2: v.optional(v.string()),
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  zip: v.optional(v.string()),
  country: v.optional(v.string()),
  formatted: v.optional(v.string()),
  documentNodeId: v.optional(v.string()),
  sourceSpanIds: v.optional(v.array(v.string())),
  sourceTextHash: v.optional(v.string()),
});

const operationalAddressValidator = v.object({
  street1: v.optional(v.string()),
  street2: v.optional(v.string()),
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  zip: v.optional(v.string()),
  country: v.optional(v.string()),
  formatted: v.optional(v.string()),
  documentNodeId: v.optional(v.string()),
  sourceSpanIds: v.optional(v.array(v.string())),
  sourceTextHash: v.optional(v.string()),
});

const carrierIdentityValidator = v.object({
  displayName: v.string(),
  sourceName: v.optional(v.string()),
  operatingName: v.optional(v.string()),
  publicNameRelationship: v.optional(
    v.union(
      v.literal("same_legal_entity"),
      v.literal("trading_name"),
      v.literal("parent_brand"),
      v.literal("group_brand"),
    ),
  ),
  legalEntities: v.array(
    v.object({
      name: v.string(),
      sourceNodeIds: v.array(v.string()),
      sourceSpanIds: v.array(v.string()),
    }),
  ),
  legalEntityRelationship: v.union(
    v.literal("single"),
    v.literal("and"),
    v.literal("or"),
    v.literal("and_or"),
    v.literal("unspecified"),
  ),
  sourceNodeIds: v.array(v.string()),
  sourceSpanIds: v.array(v.string()),
  branding: v.optional(
    v.object({
      website: v.string(),
      websiteTitle: v.optional(v.string()),
      iconStorageId: v.optional(v.id("_storage")),
      accentColor: v.optional(v.string()),
      accentColorSource: v.optional(
        v.union(
          v.literal("favicon"),
          v.literal("theme_meta"),
          v.literal("stylesheet"),
          v.literal("html"),
        ),
      ),
      confidence: v.union(
        v.literal("high"),
        v.literal("medium"),
        v.literal("low"),
      ),
      sourceUrls: v.array(v.string()),
      enrichmentVersion: v.number(),
      updatedAt: v.number(),
    }),
  ),
});

const policyDetailAddressValidator = v.object({
  street1: v.optional(v.string()),
  street2: v.optional(v.string()),
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  zip: v.optional(v.string()),
  country: v.optional(v.string()),
  formatted: v.optional(v.string()),
});

const policyDetailUpdateValidator = v.union(
  v.object({
    section: v.literal("overview"),
    policyNumber: v.string(),
    effectiveDate: v.string(),
    expirationDate: v.string(),
    premium: v.string(),
    operationsDescription: v.string(),
  }),
  v.object({
    section: v.literal("insured"),
    name: v.string(),
    address: policyDetailAddressValidator,
    additionalNamedInsureds: v.array(v.string()),
  }),
  v.object({
    section: v.literal("producer"),
    name: v.string(),
    address: policyDetailAddressValidator,
    contactName: v.string(),
    licenseNumber: v.string(),
    phone: v.string(),
    email: v.string(),
  }),
  v.object({
    section: v.literal("insurer"),
    name: v.string(),
    address: policyDetailAddressValidator,
    naicNumber: v.string(),
  }),
  v.object({
    section: v.literal("generalAgent"),
    name: v.string(),
    address: policyDetailAddressValidator,
    licenseNumber: v.string(),
  }),
);

const limitsValidator = v.object({
  perOccurrence: v.optional(v.string()),
  generalAggregate: v.optional(v.string()),
  productsCompletedOpsAggregate: v.optional(v.string()),
  personalAdvertisingInjury: v.optional(v.string()),
  eachEmployee: v.optional(v.string()),
  fireDamage: v.optional(v.string()),
  medicalExpense: v.optional(v.string()),
  combinedSingleLimit: v.optional(v.string()),
  bodilyInjuryPerPerson: v.optional(v.string()),
  bodilyInjuryPerAccident: v.optional(v.string()),
  propertyDamage: v.optional(v.string()),
  eachOccurrenceUmbrella: v.optional(v.string()),
  umbrellaAggregate: v.optional(v.string()),
  umbrellaRetention: v.optional(v.string()),
  statutory: v.optional(v.boolean()),
  employersLiability: v.optional(
    v.object({
      eachAccident: v.string(),
      diseasePolicyLimit: v.string(),
      diseaseEachEmployee: v.string(),
    }),
  ),
  sublimits: v.optional(
    v.array(
      v.object({
        name: v.string(),
        limit: v.string(),
        appliesTo: v.optional(v.string()),
        deductible: v.optional(v.string()),
      }),
    ),
  ),
  sharedLimits: v.optional(
    v.array(
      v.object({
        description: v.string(),
        limit: v.string(),
        coverageParts: v.array(v.string()),
      }),
    ),
  ),
  defenseCostTreatment: v.optional(v.string()),
});

const deductiblesValidator = v.object({
  perClaim: v.optional(v.string()),
  perOccurrence: v.optional(v.string()),
  aggregateDeductible: v.optional(v.string()),
  selfInsuredRetention: v.optional(v.string()),
  corridorDeductible: v.optional(v.string()),
  waitingPeriod: v.optional(v.string()),
  appliesTo: v.optional(v.string()),
});

const locationValidator = v.object({
  number: v.number(),
  address: addressValidator,
  description: v.optional(v.string()),
  buildingValue: v.optional(v.string()),
  contentsValue: v.optional(v.string()),
  businessIncomeValue: v.optional(v.string()),
  constructionType: v.optional(v.string()),
  yearBuilt: v.optional(v.number()),
  squareFootage: v.optional(v.number()),
  protectionClass: v.optional(v.string()),
  sprinklered: v.optional(v.boolean()),
  alarmType: v.optional(v.string()),
  occupancy: v.optional(v.string()),
});

const vehicleValidator = v.object({
  number: v.number(),
  year: v.number(),
  make: v.string(),
  model: v.string(),
  vin: v.string(),
  costNew: v.optional(v.string()),
  statedValue: v.optional(v.string()),
  garageLocation: v.optional(v.number()),
  coverages: v.optional(
    v.array(
      v.object({
        type: v.string(),
        limit: v.optional(v.string()),
        deductible: v.optional(v.string()),
        included: v.boolean(),
      }),
    ),
  ),
  radius: v.optional(v.string()),
  vehicleType: v.optional(v.string()),
});

const classificationValidator = v.object({
  code: v.string(),
  description: v.string(),
  premiumBasis: v.string(),
  basisAmount: v.optional(v.string()),
  rate: v.optional(v.string()),
  premium: v.optional(v.string()),
  locationNumber: v.optional(v.number()),
});

const formReferenceValidator = v.object({
  formNumber: v.string(),
  editionDate: v.optional(v.string()),
  title: v.optional(v.string()),
  formType: v.string(),
  pageStart: v.optional(v.number()),
  pageEnd: v.optional(v.number()),
  documentNodeId: v.optional(v.string()),
  sourceSpanIds: v.optional(v.array(v.string())),
  sourceTextHash: v.optional(v.string()),
});

const taxFeeValidator = v.object({
  name: v.string(),
  amount: v.string(),
  amountValue: v.optional(v.number()),
  type: v.optional(v.string()),
  description: v.optional(v.string()),
  documentNodeId: v.optional(v.string()),
  sourceSpanIds: v.optional(v.array(v.string())),
  sourceTextHash: v.optional(v.string()),
});

// Document structure from cl-sdk — uses v.any() because the schema evolves with cl-sdk versions.
// Contains sections, endorsements, conditions, exclusions, regulatory context, claims contact, etc.
const documentValidator = v.any();

const metadataSourceValidator = v.object({
  carrierPage: v.optional(v.number()),
  policyNumberPage: v.optional(v.number()),
  premiumPage: v.optional(v.number()),
  effectiveDatePage: v.optional(v.number()),
});

export const insert = mutation({
  args: {
    userId: v.optional(v.id("users")),
    orgId: v.optional(v.id("organizations")),
    fileId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    fileSha256: v.optional(v.string()),
    uploadFileSha256s: v.optional(v.array(v.string())),
    carrier: v.string(),
    security: v.optional(v.string()),
    underwriter: v.optional(v.string()),
    broker: v.optional(v.string()),
    policyNumber: v.string(),
    linesOfBusiness: v.optional(v.array(v.string())),
    documentType: v.literal("policy"),
    policyYear: v.number(),
    effectiveDate: v.string(),
    expirationDate: v.string(),
    isRenewal: v.boolean(),
    coverages: v.array(coverageValidator),
    premium: v.optional(v.string()),
    insuredName: v.string(),
    summary: v.optional(v.string()),
    metadataSource: v.optional(metadataSourceValidator),
    documentMetadata: v.optional(v.any()),
    documentOutline: v.optional(v.any()),
    document: v.optional(documentValidator),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    if (!args.orgId) throw new Error("Client organization is required");
    const client = await ctx.db.get(args.orgId);
    if (!client || client.type !== "client")
      throw new Error("Client not found");
    await assertImpersonatedSetupWrite(ctx, args.orgId);
    const now = nowMs();
    const fileSha256 = normalizeFileSha256(args.fileSha256);
    const uploadFileSha256s = normalizeFileSha256s(
      args.uploadFileSha256s ?? (fileSha256 ? [fileSha256] : undefined),
    );
    const {
      fileSha256: _fileSha256,
      uploadFileSha256s: _uploadFileSha256s,
      ...rawFields
    } = args;
    const fields = {
      ...rawFields,
      userId: operator.userId,
      orgId: args.orgId,
      uploadedBySide: "operator" as const,
      uploadedByUserId: operator.userId,
      linesOfBusiness: toLobCodes(rawFields.linesOfBusiness),
    };
    const policyId = await ctx.db.insert("policies", {
      ...fields,
      uploadFileSha256s,
      extractionDataStage: "placeholder",
      extractionDataStageUpdatedAt: now,
    });
    await syncPolicyUploadFingerprints(ctx, policyId);
    return policyId;
  },
});

export const insertAutomationUploadInternal = internalMutation({
  args: {
    userId: v.id("users"),
    orgId: v.id("organizations"),
    fileId: v.id("_storage"),
    fileName: v.string(),
    uploadFileSha256s: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const uploadFileSha256s = normalizeFileSha256s(args.uploadFileSha256s);
    if (!uploadFileSha256s?.length) {
      throw new Error("Automation policy uploads require a SHA-256 hash");
    }

    const existing = await ctx.db
      .query("policies")
      .withIndex("organization", (query) => query.eq("orgId", args.orgId))
      .collect();
    const duplicate = existing.find(
      (policy) =>
        !policy.deletedAt &&
        uploadFileSha256s.every((hash) =>
          policy.uploadFileSha256s?.includes(hash),
        ),
    );
    if (duplicate) {
      return { created: false as const, policyId: duplicate._id };
    }

    const now = nowMs();
    const policyId = await ctx.db.insert("policies", {
      userId: args.userId,
      orgId: args.orgId,
      fileId: args.fileId,
      fileName: args.fileName,
      uploadFileSha256s,
      carrier: "Extracting...",
      policyNumber: "Extracting...",
      linesOfBusiness: ["UN"],
      documentType: "policy",
      policyYear: dayjs().year(),
      effectiveDate: "Extracting...",
      expirationDate: "Extracting...",
      isRenewal: false,
      coverages: [],
      insuredName: "Extracting...",
      extractionDataStage: "placeholder",
      extractionDataStageUpdatedAt: now,
    });
    await syncPolicyUploadFingerprints(ctx, policyId);
    return { created: true as const, policyId };
  },
});

export const updateExtraction = mutation({
  args: {
    id: v.id("policies"),
    carrier: v.optional(v.string()),
    security: v.optional(v.string()),
    underwriter: v.optional(v.string()),
    broker: v.optional(v.string()),
    // Enriched entity fields (cl-sdk 1.2+)
    carrierIdentity: v.optional(carrierIdentityValidator),
    carrierLegalName: v.optional(v.string()),
    carrierNaicNumber: v.optional(v.string()),
    carrierAmBestRating: v.optional(v.string()),
    carrierAdmittedStatus: v.optional(v.string()),
    brokerAgency: v.optional(v.string()),
    brokerContactName: v.optional(v.string()),
    brokerLicenseNumber: v.optional(v.string()),
    // Structured entity objects (cl-sdk 0.11+)
    insurer: v.optional(
      v.object({
        legalName: v.string(),
        naicNumber: v.optional(v.string()),
        amBestRating: v.optional(v.string()),
        amBestNumber: v.optional(v.string()),
        admittedStatus: v.optional(v.string()),
        stateOfDomicile: v.optional(v.string()),
        address: v.optional(operationalAddressValidator),
        documentNodeId: v.optional(v.string()),
        sourceSpanIds: v.optional(v.array(v.string())),
        sourceTextHash: v.optional(v.string()),
        pageStart: v.optional(v.number()),
        pageEnd: v.optional(v.number()),
      }),
    ),
    producer: v.optional(
      v.object({
        agencyName: v.string(),
        contactName: v.optional(v.string()),
        licenseNumber: v.optional(v.string()),
        phone: v.optional(v.string()),
        email: v.optional(v.string()),
        documentNodeId: v.optional(v.string()),
        sourceSpanIds: v.optional(v.array(v.string())),
        sourceTextHash: v.optional(v.string()),
        pageStart: v.optional(v.number()),
        pageEnd: v.optional(v.number()),
        address: v.optional(addressValidator),
      }),
    ),
    generalAgent: v.optional(
      v.object({
        agencyName: v.string(),
        licenseNumber: v.optional(v.string()),
        documentNodeId: v.optional(v.string()),
        sourceSpanIds: v.optional(v.array(v.string())),
        sourceTextHash: v.optional(v.string()),
        pageStart: v.optional(v.number()),
        pageEnd: v.optional(v.number()),
        address: v.optional(addressValidator),
      }),
    ),
    lossPayees: v.optional(
      v.array(
        v.object({
          name: v.string(),
          role: v.string(),
          address: v.optional(addressValidator),
          relationship: v.optional(v.string()),
          scope: v.optional(v.string()),
          documentNodeId: v.optional(v.string()),
          sourceSpanIds: v.optional(v.array(v.string())),
          sourceTextHash: v.optional(v.string()),
          pageStart: v.optional(v.number()),
          pageEnd: v.optional(v.number()),
        }),
      ),
    ),
    mortgageHolders: v.optional(
      v.array(
        v.object({
          name: v.string(),
          role: v.string(),
          address: v.optional(addressValidator),
          relationship: v.optional(v.string()),
          scope: v.optional(v.string()),
          documentNodeId: v.optional(v.string()),
          sourceSpanIds: v.optional(v.array(v.string())),
          sourceTextHash: v.optional(v.string()),
          pageStart: v.optional(v.number()),
          pageEnd: v.optional(v.number()),
        }),
      ),
    ),
    priorPolicyNumber: v.optional(v.string()),
    programName: v.optional(v.string()),
    productIdentity: v.optional(policyProductIdentityValidator),
    isPackage: v.optional(v.boolean()),
    // Insured details
    insuredDba: v.optional(v.string()),
    insuredAddress: v.optional(addressValidator),
    insuredEntityType: v.optional(v.string()),
    insuredFein: v.optional(v.string()),
    additionalNamedInsureds: v.optional(
      v.array(
        v.object({
          name: v.string(),
          relationship: v.optional(v.string()),
          address: v.optional(addressValidator),
          documentNodeId: v.optional(v.string()),
          sourceSpanIds: v.optional(v.array(v.string())),
          sourceTextHash: v.optional(v.string()),
          pageStart: v.optional(v.number()),
          pageEnd: v.optional(v.number()),
        }),
      ),
    ),
    // Coverage structure
    coverageForm: v.optional(v.string()),
    retroactiveDate: v.optional(v.string()),
    effectiveTime: v.optional(v.string()),
    limits: v.optional(limitsValidator),
    deductibles: v.optional(deductiblesValidator),
    // Locations, vehicles, classifications
    locations: v.optional(v.array(locationValidator)),
    vehicles: v.optional(v.array(vehicleValidator)),
    classifications: v.optional(v.array(classificationValidator)),
    formInventory: v.optional(v.array(formReferenceValidator)),
    taxesAndFees: v.optional(v.array(taxFeeValidator)),
    premiumBreakdown: v.optional(v.array(premiumLineValidator)),
    // Standard fields
    policyNumber: v.optional(v.string()),
    linesOfBusiness: v.optional(v.array(v.string())),
    documentType: v.optional(v.literal("policy")),
    policyYear: v.optional(v.number()),
    effectiveDate: v.optional(v.string()),
    expirationDate: v.optional(v.string()),
    isRenewal: v.optional(v.boolean()),
    coverages: v.optional(v.array(coverageValidator)),
    premium: v.optional(v.string()),
    premiumAmount: v.optional(v.number()),
    totalCost: v.optional(v.string()),
    totalCostAmount: v.optional(v.number()),
    insuredName: v.optional(v.string()),
    summary: v.optional(v.string()),
    metadataSource: v.optional(metadataSourceValidator),
    documentMetadata: v.optional(v.any()),
    documentOutline: v.optional(v.any()),
    document: v.optional(documentValidator),
    fileId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    // Typed declarations (cl-sdk 1.4+)
    declarations: v.optional(v.any()),
    extractionReview: v.optional(v.any()),
    // cl-sdk 3.0+ fields
    policyTermType: v.optional(v.string()),
    nextReviewDate: v.optional(v.string()),
    minPremium: v.optional(v.string()),
    minPremiumAmount: v.optional(v.number()),
    depositPremium: v.optional(v.string()),
    depositPremiumAmount: v.optional(v.number()),
    auditProvision: v.optional(v.boolean()),
    cancellationProvisions: v.optional(v.string()),
    nonRenewalProvisions: v.optional(v.string()),
    assignmentClause: v.optional(v.string()),
    subrogationClause: v.optional(v.string()),
    otherInsuranceClause: v.optional(v.string()),
    // Supplementary extraction (cl-sdk 0.13+)
    supplementaryFacts: v.optional(
      v.array(
        v.object({
          key: v.string(),
          value: v.string(),
          subject: v.optional(v.string()),
          context: v.optional(v.string()),
          documentNodeId: v.optional(v.string()),
          sourceSpanIds: v.optional(v.array(v.string())),
          sourceTextHash: v.optional(v.string()),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    await ctx.db.patch(id, normalizeEditableFields(fields));
  },
});

export const updateExtractedFields = mutation({
  args: {
    id: v.id("policies"),
    fields: v.object({
      carrier: v.optional(v.string()),
      security: v.optional(v.string()),
      generalAgentName: v.optional(v.string()),
      broker: v.optional(v.string()),
      policyNumber: v.optional(v.string()),
      linesOfBusiness: v.optional(v.array(v.string())),
      policyYear: v.optional(v.number()),
      effectiveDate: v.optional(v.string()),
      expirationDate: v.optional(v.string()),
      insuredName: v.optional(v.string()),
      premium: v.optional(v.string()),
      premiumAmount: v.optional(v.number()),
      totalCost: v.optional(v.string()),
      totalCostAmount: v.optional(v.number()),
      minPremium: v.optional(v.string()),
      minPremiumAmount: v.optional(v.number()),
      depositPremium: v.optional(v.string()),
      depositPremiumAmount: v.optional(v.number()),
      summary: v.optional(v.string()),
      coverages: v.optional(v.array(coverageValidator)),
      extractionReview: v.optional(v.any()),
      taxesAndFees: v.optional(v.array(taxFeeValidator)),
      premiumBreakdown: v.optional(v.array(premiumLineValidator)),
      limits: v.optional(v.any()),
      deductibles: v.optional(v.any()),
    }),
  },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.id);
    if (!policy?.orgId) throw new Error("Not found");
    const access = await getOrgAccess(ctx, policy.orgId, {
      allowOperator: true,
    });
    assertCanEditPolicyExtractedFields(access);
    await assertImpersonatedSetupWrite(ctx, policy.orgId);

    const patch: Record<string, unknown> = {};
    const normalizedFields = normalizeEditableFields(args.fields);
    for (const [key, value] of Object.entries(normalizedFields)) {
      if (value !== undefined) patch[key] = value;
    }

    const derivedYear =
      args.fields.policyYear ??
      policyYearFromInput(patch.effectiveDate as string | undefined);
    if (derivedYear !== undefined) patch.policyYear = derivedYear;

    if (Object.keys(patch).length === 0) return;
    await ctx.db.patch(args.id, patch);
    await ctx.db.insert("policyAuditLog", {
      policyId: args.id,
      userId: access.userId,
      orgId: policy.orgId,
      action: "manual_policy_update",
      detail: `Updated ${Object.keys(patch).join(", ")}`,
      metadata: { fields: Object.keys(patch) },
    });
    await writePolicyOperatorAudit(
      ctx,
      access,
      args.id,
      policy.orgId,
      `Updated extracted fields on policy ${policy.policyNumber ?? args.id}`,
      { fields: Object.keys(patch) },
    );
  },
});

type PolicyDetailAddress = {
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  formatted?: string;
};

function cleanPolicyDetailAddress(address: PolicyDetailAddress) {
  const cleaned: PolicyDetailAddress = {};
  for (const key of [
    "street1",
    "street2",
    "city",
    "state",
    "zip",
    "country",
    "formatted",
  ] as const) {
    const value = address[key]?.trim();
    if (value) cleaned[key] = value;
  }
  return cleaned;
}

export const updatePolicyDetails = mutation({
  args: {
    id: v.id("policies"),
    update: policyDetailUpdateValidator,
  },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.id);
    if (!policy?.orgId) throw new Error("Not found");
    const access = await getOrgAccess(ctx, policy.orgId, {
      allowOperator: true,
    });
    assertCanEditPolicyExtractedFields(access);
    await assertImpersonatedSetupWrite(ctx, policy.orgId);

    const existingOverrides = policy.policyDetailOverrides ?? {};
    const patch: Record<string, unknown> = {
      policyDetailOverridesUpdatedAt: dayjs().valueOf(),
      policyDetailOverridesUpdatedByUserId: access.userId,
    };
    let updatedFields: string[];

    switch (args.update.section) {
      case "overview": {
        const normalized = normalizeEditableFields({
          policyNumber: args.update.policyNumber.trim(),
          effectiveDate: args.update.effectiveDate.trim(),
          expirationDate: args.update.expirationDate.trim(),
          premium: args.update.premium.trim(),
        });
        if (!args.update.premium.trim()) normalized.premiumAmount = undefined;
        Object.assign(patch, normalized, {
          policyDetailOverrides: {
            ...existingOverrides,
            operationsDescription: args.update.operationsDescription.trim(),
          },
        });
        const derivedYear = policyYearFromInput(
          normalized.effectiveDate as string | undefined,
        );
        if (derivedYear !== undefined) patch.policyYear = derivedYear;
        updatedFields = [
          "policyNumber",
          "effectiveDate",
          "expirationDate",
          "premium",
          "operationsDescription",
        ];
        break;
      }
      case "insured":
        patch.policyDetailOverrides = {
          ...existingOverrides,
          insured: {
            name: args.update.name.trim(),
            address: cleanPolicyDetailAddress(args.update.address),
            additionalNamedInsureds: args.update.additionalNamedInsureds
              .map((name) => name.trim())
              .filter(Boolean)
              .slice(0, 100),
          },
        };
        updatedFields = [
          "insuredName",
          "insuredAddress",
          "additionalNamedInsureds",
        ];
        break;
      case "producer":
        patch.policyDetailOverrides = {
          ...existingOverrides,
          producer: {
            name: args.update.name.trim(),
            address: cleanPolicyDetailAddress(args.update.address),
            contactName: args.update.contactName.trim(),
            licenseNumber: args.update.licenseNumber.trim(),
            phone: args.update.phone.trim(),
            email: args.update.email.trim(),
          },
        };
        updatedFields = [
          "producerName",
          "producerAddress",
          "producerContactName",
          "producerLicenseNumber",
          "producerPhone",
          "producerEmail",
        ];
        break;
      case "insurer":
        patch.policyDetailOverrides = {
          ...existingOverrides,
          insurer: {
            name: args.update.name.trim(),
            address: cleanPolicyDetailAddress(args.update.address),
            naicNumber: args.update.naicNumber.trim(),
          },
        };
        updatedFields = ["insurerName", "insurerAddress", "insurerNaicNumber"];
        break;
      case "generalAgent":
        patch.policyDetailOverrides = {
          ...existingOverrides,
          generalAgent: {
            name: args.update.name.trim(),
            address: cleanPolicyDetailAddress(args.update.address),
            licenseNumber: args.update.licenseNumber.trim(),
          },
        };
        updatedFields = [
          "generalAgentName",
          "generalAgentAddress",
          "generalAgentLicenseNumber",
        ];
        break;
    }

    await ctx.db.patch(args.id, patch);
    await ctx.db.insert("policyAuditLog", {
      policyId: args.id,
      userId: access.userId,
      orgId: policy.orgId,
      action: "manual_policy_update",
      detail: `Updated ${args.update.section} policy details`,
      metadata: {
        section: args.update.section,
        fields: updatedFields,
      },
    });
    await writePolicyOperatorAudit(
      ctx,
      access,
      args.id,
      policy.orgId,
      `Updated ${args.update.section} details on policy ${policy.policyNumber ?? args.id}`,
      { section: args.update.section, fields: updatedFields },
    );
    return { section: args.update.section, fields: updatedFields };
  },
});

function normalizeReviewText(value: unknown): string {
  return typeof value === "string"
    ? value
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .replace(/\s+/g, " ")
    : "";
}

function normalizeReviewCoverageName(value: unknown): string {
  return normalizeReviewText(value)
    .replace(
      /\b(each|per|policy|general|annual|aggregate|occurrence|claim|claims|limit|limits|deductible|retention|coverage)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function reviewLimitType(coverage: Record<string, unknown>): string {
  const raw = normalizeReviewText(coverage.limitType);
  if (raw.includes("aggregate")) return "aggregate";
  if (raw.includes("occurrence")) return "per_occurrence";
  if (raw.includes("claim")) return "per_claim";
  if (raw.includes("person")) return "per_person";
  if (raw.includes("accident")) return "per_accident";
  if (raw) return raw;
  const text = normalizeReviewText(
    [coverage.name, coverage.originalContent, coverage.sectionRef]
      .filter(Boolean)
      .join(" "),
  );
  if (text.includes("aggregate")) return "aggregate";
  if (text.includes("occurrence")) return "per_occurrence";
  if (text.includes("claim")) return "per_claim";
  if (text.includes("person")) return "per_person";
  if (text.includes("accident")) return "per_accident";
  return "limit";
}

export const answerCoverageReviewQuestion = mutation({
  args: {
    id: v.id("policies"),
    questionId: v.string(),
    selectedValue: v.string(),
    selectedOptionId: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.id);
    if (!policy?.orgId) throw new Error("Not found");
    const access = await getOrgAccess(ctx, policy.orgId, {
      allowOperator: true,
    });
    assertCanReviewPolicyExtraction(access);
    await assertImpersonatedSetupWrite(ctx, policy.orgId);

    const review = policy.extractionReview as
      | { questions?: Array<Record<string, unknown>> }
      | undefined;
    const questions = Array.isArray(review?.questions) ? review.questions : [];
    const questionIndex = questions.findIndex(
      (question) => question.id === args.questionId,
    );
    if (questionIndex < 0) throw new Error("Question not found");
    const question = questions[questionIndex];
    const options = Array.isArray(question.options)
      ? (question.options as Array<Record<string, unknown>>)
      : [];
    const option = args.selectedOptionId
      ? options.find((item) => item.id === args.selectedOptionId)
      : options.find((item) => item.value === args.selectedValue);
    if (!option) throw new Error("Selected option not found");
    const optionCoverage = option.coverage as
      | Record<string, unknown>
      | undefined;
    if (!optionCoverage)
      throw new Error("Selected option is missing coverage data");

    const targetName = normalizeReviewCoverageName(question.coverageName);
    const targetLimitType =
      typeof question.limitType === "string" ? question.limitType : undefined;
    const currentCoverages = Array.isArray(policy.coverages)
      ? (policy.coverages as Array<Record<string, unknown>>)
      : [];
    let replaced = false;
    const nextCoverages = currentCoverages.map((coverage) => {
      const nameMatches =
        normalizeReviewCoverageName(coverage.name) === targetName;
      const typeMatches =
        !targetLimitType || reviewLimitType(coverage) === targetLimitType;
      if (!replaced && nameMatches && typeMatches) {
        replaced = true;
        return {
          ...coverage,
          ...optionCoverage,
          extractionReviewStatus: "confirmed",
          extractionReviewReason:
            args.note?.trim() ||
            `Confirmed from extraction review: ${args.selectedValue}`,
        };
      }
      return coverage;
    });
    if (!replaced) {
      nextCoverages.push({
        ...optionCoverage,
        extractionReviewStatus: "confirmed",
        extractionReviewReason:
          args.note?.trim() ||
          `Confirmed from extraction review: ${args.selectedValue}`,
      });
    }

    const now = nowMs();
    const nextQuestions = [...questions];
    nextQuestions[questionIndex] = {
      ...question,
      status: "confirmed",
      answer: args.selectedValue,
      note: args.note?.trim() || undefined,
      answeredAt: now,
      answeredByUserId: access.userId,
    };

    await ctx.db.patch(
      args.id,
      normalizeEditableFields({
        coverages: nextCoverages as any,
        extractionReview: {
          ...(review ?? {}),
          questions: nextQuestions,
        },
      }),
    );
    await ctx.db.insert("policyAuditLog", {
      policyId: args.id,
      userId: access.userId,
      orgId: policy.orgId,
      action: "answered_extraction_review_question",
      detail: `${String(question.question ?? "Coverage review question")} ${args.selectedValue}`,
      metadata: {
        questionId: args.questionId,
        selectedValue: args.selectedValue,
        coverageName: question.coverageName,
      },
    });
    await writePolicyOperatorAudit(
      ctx,
      access,
      args.id,
      policy.orgId,
      `Answered an extraction review question on policy ${policy.policyNumber ?? args.id}`,
      { questionId: args.questionId, selectedValue: args.selectedValue },
    );
  },
});

export const confirmPolicyFactFromSource = internalMutation({
  args: {
    id: v.id("policies"),
    orgId: v.id("organizations"),
    userId: v.id("users"),
    fact: v.string(),
    sourceSpanIds: v.array(v.string()),
    source: v.optional(
      v.union(
        v.literal("chat"),
        v.literal("email"),
        v.literal("imessage"),
        v.literal("slack"),
      ),
    ),
    fieldUpdates: v.optional(
      v.object({
        carrier: v.optional(v.string()),
        security: v.optional(v.string()),
        generalAgentName: v.optional(v.string()),
        broker: v.optional(v.string()),
        policyNumber: v.optional(v.string()),
        effectiveDate: v.optional(v.string()),
        expirationDate: v.optional(v.string()),
        insuredName: v.optional(v.string()),
        premium: v.optional(v.string()),
        totalCost: v.optional(v.string()),
        minPremium: v.optional(v.string()),
        depositPremium: v.optional(v.string()),
        summary: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.id);
    if (!policy || policy.orgId !== args.orgId)
      throw new Error("Policy not found");
    if (!isFinalExtractedPolicy(policy)) {
      throw new Error(
        "Policy facts can be confirmed after full source-backed extraction finishes.",
      );
    }
    if (args.sourceSpanIds.length === 0)
      throw new Error("Source evidence is required");

    const policySpans = await ctx.db
      .query("sourceSpans")
      .withIndex("policy", (q) => q.eq("policyId", args.id))
      .collect();
    const validSpanIds = new Set(policySpans.map((span) => span.spanId));
    const invalidSpanIds = args.sourceSpanIds.filter(
      (id) => !validSpanIds.has(id),
    );
    if (invalidSpanIds.length > 0) {
      throw new Error("Source evidence was not found on this policy");
    }

    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args.fieldUpdates ?? {})) {
      if (value === undefined || key === "generalAgentName") continue;
      patch[key] = value;
    }
    if (args.fieldUpdates?.generalAgentName !== undefined) {
      patch.generalAgent = {
        ...(policy.generalAgent ?? {}),
        agencyName: args.fieldUpdates.generalAgentName,
        sourceSpanIds: args.sourceSpanIds,
      };
    }
    const derivedYear = policyYearFromInput(args.fieldUpdates?.effectiveDate);
    if (derivedYear !== undefined) patch.policyYear = derivedYear;

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.id, patch);
    }

    await ctx.db.insert("policyAuditLog", {
      policyId: args.id,
      userId: args.userId,
      orgId: args.orgId,
      action: "agent_confirmed_policy_fact",
      detail: args.fact,
      metadata: {
        sourceSpanIds: args.sourceSpanIds,
        fields: Object.keys(patch),
      },
    });

    return {
      updatedFields: Object.keys(patch),
      sourceSpanIds: args.sourceSpanIds,
    };
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const generateUploadUrlForOrg = mutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.orgId, {
      allowOperator: true,
    });
    assertCanUploadPolicy(access);
    await assertImpersonatedSetupWrite(ctx, args.orgId);
    return await ctx.storage.generateUploadUrl();
  },
});

export const checkDuplicateUploadByHash = mutation({
  args: {
    orgId: v.id("organizations"),
    fileSha256: v.string(),
  },
  handler: async (ctx, args) => {
    const fileSha256 = normalizeFileSha256(args.fileSha256);
    if (!fileSha256) return null;

    const access = await getOrgAccess(ctx, args.orgId, {
      allowOperator: true,
    });
    assertCanUploadPolicy(access);

    const policies = await ctx.db
      .query("policies")
      .withIndex("organization", (idx) => idx.eq("orgId", args.orgId))
      .collect();

    const duplicate = policies.find((policy) => {
      if (policy.deletedAt) return false;
      return policy.uploadFileSha256s?.includes(fileSha256) ?? false;
    });

    if (!duplicate) return null;
    return {
      policyId: duplicate._id,
      fileName: duplicate.fileName ?? null,
      policyNumber: duplicate.policyNumber ?? null,
      carrier: duplicate.carrier ?? null,
      uploadedAt: duplicate._creationTime,
    };
  },
});

export const hasPendingExtractionInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const policies = await ctx.db
      .query("policies")
      .withIndex("organization", (query) => query.eq("orgId", args.orgId))
      .collect();
    const nonFinalPolicies = policies.filter(
      (policy) =>
        !policy.deletedAt && effectiveExtractionDataStage(policy) !== "final",
    );
    const pending = await Promise.all(
      nonFinalPolicies.map(async (policy) => {
        const run = await getPolicyExtractionRun(ctx, policy._id);
        const status = run?.pipelineStatus ?? policy.pipelineStatus ?? "idle";
        return status === "idle" || status === "running" || status === "paused";
      }),
    );
    return pending.some(Boolean);
  },
});

// Operators use an explicit client target instead of impersonating a client or
// pretending to be its broker. The resulting policy keeps operator provenance
// and records the support write in the operator audit trail.
export const createOperatorUpload = mutation({
  args: {
    clientOrgId: v.id("organizations"),
    fileId: v.id("_storage"),
    fileName: v.optional(v.string()),
    fileSha256: v.optional(v.string()),
    uploadFileSha256s: v.optional(v.array(v.string())),
    documentType: v.literal("policy"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await assertImpersonatedSetupWrite(ctx, args.clientOrgId);
    return createOperatorUploadByUser(ctx, operator.userId, args);
  },
});

/** Registers the placeholder policy row that extractFromUpload fills in. */
async function insertUploadPlaceholder(
  ctx: MutationCtx,
  args: {
    orgId: DataModelId<"organizations">;
    fileId: DataModelId<"_storage">;
    fileName?: string;
    uploadFileSha256s?: string[];
    uploadedBySide: "operator" | "client";
    uploadedByUserId: DataModelId<"users">;
  },
): Promise<DataModelId<"policies">> {
  const policyId = await ctx.db.insert("policies", {
    orgId: args.orgId,
    fileId: args.fileId,
    fileName: args.fileName,
    uploadFileSha256s: normalizeFileSha256s(args.uploadFileSha256s),
    documentType: "policy",
    carrier: "Extracting...",
    policyNumber: "Extracting...",
    linesOfBusiness: ["UN"],
    policyYear: dayjs().year(),
    effectiveDate: "Extracting...",
    expirationDate: "Extracting...",
    isRenewal: false,
    coverages: [],
    insuredName: "Extracting...",
    extractionDataStage: "placeholder",
    extractionDataStageUpdatedAt: nowMs(),
    uploadedBySide: args.uploadedBySide,
    uploadedByUserId: args.uploadedByUserId,
  });
  await syncPolicyUploadFingerprints(ctx, policyId);
  return policyId;
}

// Client members upload into their own organization. The row keeps client
// provenance so they can later archive or cancel it; extraction starts with
// extractFromUpload.
export const createClientUpload = mutation({
  args: {
    orgId: v.id("organizations"),
    fileId: v.id("_storage"),
    fileName: v.optional(v.string()),
    fileSha256: v.optional(v.string()),
    uploadFileSha256s: v.optional(v.array(v.string())),
    documentType: v.literal("policy"),
  },
  handler: async (ctx, args) => {
    if (await getActiveOperatorImpersonation(ctx)) {
      throw new Error("Stop impersonating before managing policies");
    }
    const access = await getOrgAccess(ctx, args.orgId);
    assertCanUploadPolicy(access);
    const fileSha256 = normalizeFileSha256(args.fileSha256);
    return await insertUploadPlaceholder(ctx, {
      orgId: args.orgId,
      fileId: args.fileId,
      fileName: args.fileName,
      uploadFileSha256s: args.uploadFileSha256s ?? (fileSha256 ? [fileSha256] : undefined),
      uploadedBySide: "client",
      uploadedByUserId: access.userId,
    });
  },
});

/**
 * Authorizes extractFromUpload. Operators may extract any registered upload;
 * client members only their own untouched client upload for that file.
 */
export const getUploadExtractionContext = query({
  args: { policyId: v.id("policies"), fileId: v.id("_storage") },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.policyId);
    if (!policy?.orgId) return { error: "Policy not found" };
    if (await getActiveOperatorImpersonation(ctx)) {
      return { error: "Stop impersonating before managing policies" };
    }
    const access = await getOrgAccess(ctx, policy.orgId, {
      allowOperator: true,
    });
    assertCanUploadPolicy(access);
    if (access.accessType !== "operator") {
      const untouchedOwnUpload =
        policy.uploadedBySide === "client" &&
        policy.uploadedByUserId === access.userId &&
        policy.fileId === args.fileId &&
        effectiveExtractionDataStage(policy) === "placeholder" &&
        !(await getPolicyExtractionRun(ctx, policy._id));
      if (!untouchedOwnUpload) {
        return {
          error:
            "Extraction can only start for your new upload. Use retry for existing policies.",
        };
      }
    }
    return { orgId: policy.orgId, userId: access.userId };
  },
});

export async function createOperatorUploadByUser(
  ctx: MutationCtx,
  operatorUserId: DataModelId<"users">,
  args: {
    clientOrgId: DataModelId<"organizations">;
    fileId: DataModelId<"_storage">;
    fileName?: string;
    fileSha256?: string;
    uploadFileSha256s?: string[];
    documentType: "policy";
  },
): Promise<DataModelId<"policies">> {
  const operator = await requireOperatorForUser(ctx, operatorUserId);
  await assertNoOperatorImpersonation(ctx, operatorUserId);
  const client = await ctx.db.get(args.clientOrgId);
  if (!client || client.type !== "client") throw new Error("Client not found");
  const fileSha256 = normalizeFileSha256(args.fileSha256);

  const policyId = await insertUploadPlaceholder(ctx, {
    orgId: args.clientOrgId,
    fileId: args.fileId,
    fileName: args.fileName,
    uploadFileSha256s: args.uploadFileSha256s ?? (fileSha256 ? [fileSha256] : undefined),
    uploadedBySide: "operator",
    uploadedByUserId: operator.userId,
  });

  await writeOperatorAudit(ctx, {
    operatorUserId: operator.userId,
    type: "setup_write",
    targetOrgId: args.clientOrgId,
    summary: `Uploaded a policy for ${client.name}`,
    metadata: {
      domain: "policies",
      policyId,
      documentType: args.documentType,
      fileName: args.fileName,
    },
  });

  return policyId;
}

// Operators query policies for an explicit client organization. Tenant clients
// use listForClient and receive read-only policy access.
export const listForOperator = query({
  args: {
    clientOrgId: v.id("organizations"),
    documentType: v.optional(v.literal("policy")),
    archived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const all = await ctx.db
      .query("policies")
      .withIndex("organization", (idx) => idx.eq("orgId", args.clientOrgId))
      .collect();
    const filtered = all.filter((p) => {
      const matchesArchive = args.archived
        ? Boolean(p.deletedAt)
        : isVisiblePolicyListRow(p);
      return (
        matchesArchive &&
        (!args.documentType || p.documentType === args.documentType)
      );
    });
    return await Promise.all(
      filtered.map((policy) => attachResolvedCarrierIdentity(ctx, policy)),
    );
  },
});

// Client queries their own policies (explicit about side).
export const listForClient = query({
  args: {
    documentType: v.optional(v.literal("policy")),
    archived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const access = await getCurrentOrgAccess(ctx);
    if (!access) return [];
    assertCanReadPolicies(access);
    const { orgId } = access;
    const all = await ctx.db
      .query("policies")
      .withIndex("organization", (idx) => idx.eq("orgId", orgId))
      .collect();
    const filtered = all.filter((p) => {
      const matchesArchive = args.archived
        ? Boolean(p.deletedAt)
        : isVisiblePolicyListRow(p);
      return (
        !p.dismissed &&
        matchesArchive &&
        (!args.documentType || p.documentType === args.documentType)
      );
    });
    return await Promise.all(
      filtered.map(async (policy) =>
        attachResolvedCarrierIdentity(
          ctx,
          await mergePolicyPipelineState(ctx, policy),
        ),
      ),
    );
  },
});

export const cancelExtraction = mutation({
  args: { id: v.id("policies") },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.id);
    if (!policy?.orgId) throw new Error("Not found");
    const access = await getOrgAccess(ctx, policy.orgId, {
      allowOperator: true,
    });
    assertCanManageUploadedPolicy(access, policy);
    await assertImpersonatedSetupWrite(ctx, policy.orgId);
    const { userId } = access;
    const orgId = policy.orgId;
    const state = await readPolicyPipelineState(ctx, args.id);
    const cancelable = ["idle", "running", "paused", "error"];
    if (state?.pipelineStatus && !cancelable.includes(state.pipelineStatus)) {
      throw new Error("Cannot cancel a completed extraction");
    }
    await patchPolicyExtractionRun(ctx, args.id, {
      pipelineStatus: "error",
      pipelineError: "Cancelled by user",
      pipelineCheckpoint: undefined,
    });
    await clearPolicyExtractionArtifacts(ctx, args.id);
    await appendPolicyPipelineLog(ctx, args.id, {
      timestamp: nowMs(),
      message: "Extraction cancelled by user",
      phase: "cancel",
      level: "warn",
    });
    await ctx.db.patch(args.id, {
      pipelineStatus: "error",
      pipelineError: "Cancelled by user",
      pipelineCheckpoint: undefined,
      pipelineLog: undefined,
    });
    await ctx.db.insert("policyAuditLog", {
      policyId: args.id,
      userId,
      orgId,
      action: "cancelled",
    });
    await writePolicyOperatorAudit(
      ctx,
      access,
      args.id,
      orgId,
      `Cancelled extraction for policy ${policy.policyNumber ?? args.id}`,
    );
  },
});

export const archive = mutation({
  args: { id: v.id("policies") },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.id);
    if (!policy?.orgId) throw new Error("Not found");
    const access = await getOrgAccess(ctx, policy.orgId, {
      allowOperator: true,
    });
    assertCanManageUploadedPolicy(access, policy);
    await assertImpersonatedSetupWrite(ctx, policy.orgId);
    if (policy.deletedAt) return;
    await ctx.db.patch(args.id, { deletedAt: dayjs().valueOf() });
    await deactivatePolicyDeclarationFacts(ctx, args.id);
    await ctx.db.insert("policyAuditLog", {
      policyId: args.id,
      userId: access.userId,
      orgId: policy.orgId,
      action: "archived",
    });
    await writePolicyOperatorAudit(
      ctx,
      access,
      args.id,
      policy.orgId,
      `Archived policy ${policy.policyNumber ?? args.id}`,
    );
  },
});

export const appendExtractionLog = internalMutation({
  args: {
    id: v.id("policies"),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.id);
    if (!policy) return;
    await appendPolicyPipelineLog(ctx, args.id, {
      timestamp: nowMs(),
      message: args.message,
    });
  },
});

export const getInternal = internalQuery({
  args: { id: v.id("policies") },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.id);
    if (!policy) return null;
    return await mergePolicyPipelineState(ctx, policy);
  },
});

function hasPersistablePolicyAddress(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const street1 = (value as Record<string, unknown>).street1;
  return typeof street1 === "string" && street1.trim().length > 0;
}

function dropUnpersistableNestedAddress(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (!("address" in record) || record.address === undefined) return value;
  if (hasPersistablePolicyAddress(record.address)) return value;
  const next = { ...record };
  delete next.address;
  return next;
}

function dropUnpersistableExtractedAddresses(
  fields: Record<string, unknown>,
): void {
  if (
    fields.insuredAddress !== undefined &&
    !hasPersistablePolicyAddress(fields.insuredAddress)
  ) {
    delete fields.insuredAddress;
  }

  for (const key of ["insurer", "producer", "generalAgent"] as const) {
    if (fields[key] !== undefined) {
      fields[key] = dropUnpersistableNestedAddress(fields[key]);
    }
  }

  for (const key of [
    "additionalNamedInsureds",
    "lossPayees",
    "mortgageHolders",
  ] as const) {
    if (Array.isArray(fields[key])) {
      fields[key] = fields[key].map(dropUnpersistableNestedAddress);
    }
  }
}

function prepareExtractionMutationFields(input: Record<string, unknown>) {
  const fields = normalizeEditableFields(input, {
    deriveNumericAmounts: false,
    normalizeMoneyText: false,
  });
  const sourceTreeFieldClears = Array.isArray(fields.sourceTreeFieldClears)
    ? fields.sourceTreeFieldClears
    : [];
  delete fields.sourceTreeFieldClears;
  for (const field of sourceTreeFieldClears) {
    if (field === "productIdentity" || field === "programName") {
      fields[field] = undefined;
    }
  }
  dropUnpersistableExtractedAddresses(fields);
  const operationalProfile = fields.operationalProfile;
  if (
    operationalProfile &&
    typeof operationalProfile === "object" &&
    !Array.isArray(operationalProfile) &&
    !(operationalProfile as Record<string, unknown>).premium
  ) {
    fields.premium = undefined;
    fields.premiumAmount = undefined;
  }
  return fields;
}

function hashWithoutKey(value: Record<string, unknown>, key: string) {
  const withoutKey = { ...value };
  delete withoutKey[key];
  return extractionContractHash(withoutKey);
}

function hasSourceBackedCarrierIdentity(value: unknown) {
  const identity = readCarrierIdentity(value);
  if (!identity) return false;
  return (
    identity.sourceNodeIds.length > 0 ||
    identity.sourceSpanIds.length > 0 ||
    identity.legalEntities.some(
      (entity) =>
        entity.sourceNodeIds.length > 0 || entity.sourceSpanIds.length > 0,
    )
  );
}

// All policy rows for an org (used by DocumentStore)
export const listByOrgInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const policies = await ctx.db
      .query("policies")
      .withIndex("organization", (idx) => idx.eq("orgId", args.orgId))
      .collect();
    return policies;
  },
});

// Internal update extraction (no auth check — used by DocumentStore.save and extraction pipeline)
export const updateExtractionInternal = internalMutation({
  args: {
    id: v.id("policies"),
    fields: v.any(), // Accept any policy fields from insuranceDocToPolicy
  },
  handler: async (ctx, args) => {
    if (
      args.fields &&
      typeof args.fields === "object" &&
      !Array.isArray(args.fields) &&
      (args.fields as Record<string, unknown>).extractionDataStage === "final"
    ) {
      throw new Error(
        "updateExtractionInternal cannot promote a policy to final; use promoteCompletedExtractionInternal",
      );
    }
    const existingPolicy = await ctx.db.get(args.id);
    if (!existingPolicy) throw new Error("Policy not found");
    const fields = prepareExtractionMutationFields(
      args.fields as Record<string, unknown>,
    );
    await ctx.db.patch(args.id, fields);
  },
});

/**
 * The only mutation allowed to move extractionDataStage to final. It verifies
 * that a current leased run persisted the exact source bundle used to compute
 * the completion manifest, then records the immutable run decision atomically
 * with the policy projection.
 */
export const promoteCompletedExtractionInternal = internalMutation({
  args: {
    id: v.id("policies"),
    runId: v.id("policyExtractionRuns"),
    leaseId: v.string(),
    sourceBundleArtifactId: v.id("policyExtractionArtifacts"),
    fields: v.any(),
    evidenceLedger: v.any(),
    completionManifest: v.any(),
  },
  handler: async (ctx, args) => {
    if (
      !args.fields ||
      typeof args.fields !== "object" ||
      Array.isArray(args.fields)
    ) {
      throw new Error("Promotion fields must be an object");
    }
    if ("extractionDataStage" in (args.fields as Record<string, unknown>)) {
      throw new Error("The promotion mutation owns extractionDataStage");
    }

    const [policy, run, artifact] = await Promise.all([
      ctx.db.get(args.id),
      ctx.db.get(args.runId),
      ctx.db.get(args.sourceBundleArtifactId),
    ]);
    if (!policy) throw new Error("Policy not found");
    if (!run || run.policyId !== args.id || run.pipelineStatus !== "running") {
      throw new Error("Extraction promotion requires the current running run");
    }
    const currentRun = await getPolicyExtractionRun(ctx, args.id);
    if (!currentRun || currentRun._id !== args.runId) {
      throw new Error("Extraction promotion run is stale");
    }
    const checkpoint = run.pipelineCheckpoint as
      | { lease?: { id?: string } }
      | undefined;
    if (checkpoint?.lease?.id !== args.leaseId) {
      throw new Error("Extraction promotion lease is stale");
    }
    if (
      !artifact ||
      artifact.policyId !== args.id ||
      artifact.runId !== args.runId ||
      artifact.kind !== "source_bundle"
    ) {
      throw new Error(
        "Extraction promotion requires its persisted source bundle",
      );
    }
    if (run.promotedAt) {
      throw new Error("This extraction run has already been promoted");
    }

    const ledger = args.evidenceLedger as PromotionEvidenceLedger;
    const manifest = args.completionManifest as ExtractionCompletionManifest;
    if (
      !ledger ||
      ledger.version !== "evidence-ledger-v1" ||
      ledger.ledgerHash !==
        hashWithoutKey(
          ledger as unknown as Record<string, unknown>,
          "ledgerHash",
        )
    ) {
      throw new Error("Evidence ledger hash is invalid");
    }
    if (
      !manifest ||
      manifest.version !== "extraction-completion-manifest-v1" ||
      manifest.manifestHash !==
        hashWithoutKey(
          manifest as unknown as Record<string, unknown>,
          "manifestHash",
        )
    ) {
      throw new Error("Extraction completion manifest hash is invalid");
    }
    if (
      artifact.sourceFingerprint !== ledger.sourceFingerprint ||
      artifact.sourceFingerprint !== manifest.sourceFingerprint ||
      artifact.extractorVersion !== manifest.extractorVersion ||
      artifact.metadata?.evidenceLedgerHash !== ledger.ledgerHash ||
      artifact.metadata?.manifestHash !== manifest.manifestHash
    ) {
      throw new Error(
        "Persisted source bundle metadata does not match the promotion evidence",
      );
    }
    if (manifest.protocolVersion !== "convex-sections-v1") {
      throw new Error("Extraction promotion requires a convex-sections-v1 manifest");
    }
    const sectionArtifacts = await ctx.db
      .query("policyExtractionArtifacts")
      .withIndex("policy_kind", (q) =>
        q.eq("policyId", args.id).eq("kind", "section_result"),
      )
      .collect();
    const missingSections = sectionResultArtifactReasons({
      manifest,
      runId: args.runId,
      artifacts: sectionArtifacts,
    });
    if (missingSections.length > 0) {
      throw new Error(
        `Extraction promotion requires persisted section results: ${missingSections.join("; ")}`,
      );
    }

    const inputFields = args.fields as Record<string, unknown>;
    const decision = evaluateExtractionPromotion({
      manifest,
      ledger,
      operationalProfile: inputFields.operationalProfile,
      hasValidCarrierIdentity: hasSourceBackedCarrierIdentity(
        inputFields.carrierIdentity,
      ),
    });
    const mode =
      process.env.EXTRACTION_PROMOTION_GATE_MODE === "enforce"
        ? "enforce"
        : "shadow";
    const decidedAt = nowMs();
    const recordedDecision = {
      ...decision,
      mode,
      runId: args.runId,
      sourceBundleArtifactId: args.sourceBundleArtifactId,
      sourceFingerprint: ledger.sourceFingerprint,
      evidenceLedgerHash: ledger.ledgerHash,
      manifestHash: manifest.manifestHash,
      decidedAt,
    };
    if (mode === "enforce" && !decision.allowed) {
      await ctx.db.patch(args.runId, {
        sourceFingerprint: ledger.sourceFingerprint,
        extractorVersion: manifest.extractorVersion,
        evidenceLedgerHash: ledger.ledgerHash,
        completionManifest: manifest,
        promotionGateDecision: recordedDecision,
        updatedAt: decidedAt,
      });
      return { promoted: false as const, decision: recordedDecision };
    }

    const fields = prepareExtractionMutationFields(inputFields);
    fields.extractionDataStage = "final";
    fields.extractionPreviewError = undefined;
    preserveKnownFinalExtractionIdentityFields(fields, policy);
    fields.extractionDataStageUpdatedAt = decidedAt;
    fields.extractionPromotion = recordedDecision;
    await ctx.db.patch(args.id, fields);
    await ctx.db.patch(args.runId, {
      sourceFingerprint: ledger.sourceFingerprint,
      extractorVersion: manifest.extractorVersion,
      evidenceLedgerHash: ledger.ledgerHash,
      completionManifest: manifest,
      promotionGateDecision: recordedDecision,
      promotedAt: decidedAt,
      updatedAt: decidedAt,
    });
    return { promoted: true as const, decision: recordedDecision };
  },
});

const PREVIEW_EXTRACTION_FIELD_ALLOWLIST = new Set([
  "carrier",
  "security",
  "underwriter",
  "generalAgent",
  "broker",
  "policyNumber",
  "programName",
  "linesOfBusiness",
  "documentType",
  "policyYear",
  "effectiveDate",
  "expirationDate",
  "isRenewal",
  "coverages",
  "premium",
  "premiumAmount",
  "totalCost",
  "totalCostAmount",
  "limits",
  "deductibles",
  "insuredName",
  "summary",
]);

/**
 * Writes provisional first-read fields while the current leased extraction run
 * is still working. Final policies are never overwritten.
 */
export const updatePreviewExtractionInternal = internalMutation({
  args: {
    id: v.id("policies"),
    runId: v.id("policyExtractionRuns"),
    leaseId: v.string(),
    fields: v.any(),
    previewVersion: v.string(),
    previewModel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const [policy, currentRun] = await Promise.all([
      ctx.db.get(args.id),
      getPolicyExtractionRun(ctx, args.id),
    ]);
    if (!policy) return { updated: false, reason: "not_found" };
    const checkpoint = currentRun?.pipelineCheckpoint as
      | { lease?: { id?: string } }
      | undefined;
    if (
      currentRun?._id !== args.runId ||
      currentRun.pipelineStatus !== "running" ||
      checkpoint?.lease?.id !== args.leaseId
    ) {
      return { updated: false, reason: "stale_run" };
    }
    if (isFinalExtractedPolicy(policy)) {
      return { updated: false, reason: "already_final" };
    }

    const normalized = normalizeEditableFields(args.fields);
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(normalized)) {
      if (value === undefined || !PREVIEW_EXTRACTION_FIELD_ALLOWLIST.has(key)) {
        continue;
      }
      patch[key] = value;
    }
    const derivedYear =
      typeof patch.policyYear === "number"
        ? patch.policyYear
        : policyYearFromInput(patch.effectiveDate as string | undefined);
    if (derivedYear !== undefined) patch.policyYear = derivedYear;

    if (Object.keys(patch).length === 0) {
      return { updated: false, reason: "empty_preview" };
    }

    const now = nowMs();
    await ctx.db.patch(args.id, {
      ...patch,
      extractionDataStage: "preview",
      extractionDataStageUpdatedAt: now,
      extractionPreviewVersion: args.previewVersion,
      extractionPreviewModel: args.previewModel,
      extractionPreviewError: undefined,
    });
    return { updated: true };
  },
});

// Internal soft delete (no auth check — used by DocumentStore.delete)
export const softDeleteInternal = internalMutation({
  args: { id: v.id("policies") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { deletedAt: dayjs().valueOf() });
    await deactivatePolicyDeclarationFacts(ctx, args.id);
  },
});

// Update the lightweight file projection and primary source file.
export const updateFiles = internalMutation({
  args: {
    id: v.id("policies"),
    files: v.optional(
      v.array(
        v.object({
          fileId: v.id("_storage"),
          fileName: v.string(),
          fileType: v.string(),
          status: v.string(),
        }),
      ),
    ),
    primaryFileId: v.optional(v.id("_storage")),
    primaryFileName: v.optional(v.string()),
    uploadFileSha256s: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    const patch: Record<string, any> = {};
    if (fields.files !== undefined) patch.files = fields.files;
    if (fields.primaryFileId !== undefined) patch.fileId = fields.primaryFileId;
    if (fields.primaryFileName !== undefined)
      patch.fileName = fields.primaryFileName;
    const uploadFileSha256s = normalizeFileSha256s(fields.uploadFileSha256s);
    if (uploadFileSha256s !== undefined)
      patch.uploadFileSha256s = uploadFileSha256s;
    await ctx.db.patch(id, patch);
    if (uploadFileSha256s !== undefined) await syncPolicyUploadFingerprints(ctx, id);
  },
});

export const restore = mutation({
  args: { id: v.id("policies") },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.id);
    if (!policy?.orgId) throw new Error("Not found");
    const access = await getOrgAccess(ctx, policy.orgId, {
      allowOperator: true,
    });
    assertCanManageUploadedPolicy(access, policy);
    await assertImpersonatedSetupWrite(ctx, policy.orgId);
    if (!policy.deletedAt) return;
    await ctx.db.patch(args.id, { deletedAt: undefined });
    await reactivatePolicyDeclarationFacts(ctx, args.id);
    await ctx.db.insert("policyAuditLog", {
      policyId: args.id,
      userId: access.userId,
      orgId: policy.orgId,
      action: "restored",
    });
    await writePolicyOperatorAudit(
      ctx,
      access,
      args.id,
      policy.orgId,
      `Restored policy ${policy.policyNumber ?? args.id}`,
    );
  },
});

export const listForOrg = query({
  args: {
    orgId: v.id("organizations"),
    documentType: v.optional(v.literal("policy")),
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.orgId, {
      allowOperator: true,
    });
    assertCanReadPolicies(access);
    const all = await ctx.db
      .query("policies")
      .withIndex("organization", (idx) => idx.eq("orgId", args.orgId))
      .collect();
    const filtered = all.filter(
      (policy) =>
        !policy.deletedAt &&
        !policy.dismissed &&
        (!args.documentType || policy.documentType === args.documentType),
    );
    return await Promise.all(
      filtered.map(async (policy) =>
        attachResolvedCarrierIdentity(
          ctx,
          await mergePolicyPipelineState(ctx, policy),
        ),
      ),
    );
  },
});

const pipelineArtifactKindValidator = v.union(
  v.literal("cl_sdk_checkpoint"),
  v.literal("embedding_payload"),
  v.literal("source_bundle"),
  v.literal("section_result"),
  v.literal("parsed_source"),
  v.literal("section_plan"),
);

export const pipelineSaveArtifact = internalMutation({
  args: {
    jobId: v.string(),
    kind: v.union(
      pipelineArtifactKindValidator,
      // P5: remove with extraction-worker (convex/externalExtractionPayload.ts).
      v.literal("external_completion_payload"),
    ),
    storageId: v.id("_storage"),
    sourceFingerprint: v.optional(v.string()),
    extractorVersion: v.optional(v.string()),
    sectionId: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (
    ctx,
    {
      jobId,
      kind,
      storageId,
      sourceFingerprint,
      extractorVersion,
      sectionId,
      metadata,
    },
  ) => {
    const policyId = jobId as DataModelId<"policies">;
    const run = await ensurePolicyExtractionRun(ctx, policyId);
    if (
      (kind === "source_bundle" || kind === "section_result") &&
      (!sourceFingerprint || !extractorVersion)
    ) {
      throw new Error(
        `${kind} artifacts require a source fingerprint and extractor version`,
      );
    }
    if (kind === "section_result" && !sectionId) {
      throw new Error("section_result artifacts require sectionId");
    }
    if (kind === "section_result") {
      const existingSections = await ctx.db
        .query("policyExtractionArtifacts")
        .withIndex("policy_kind", (q) =>
          q.eq("policyId", policyId).eq("kind", kind),
        )
        .collect();
      for (const artifact of existingSections) {
        if (
          artifact.runId !== run?._id ||
          artifact.sectionId !== sectionId ||
          artifact.sourceFingerprint !== sourceFingerprint ||
          artifact.extractorVersion !== extractorVersion
        ) {
          continue;
        }
        await ctx.storage.delete(artifact.storageId).catch(() => {});
        await ctx.db.delete(artifact._id);
      }
    } else if (kind === "source_bundle") {
      const role =
        metadata && typeof metadata === "object" && !Array.isArray(metadata)
          ? (metadata as Record<string, unknown>).artifactRole
          : undefined;
      const existingBundles = await ctx.db
        .query("policyExtractionArtifacts")
        .withIndex("policy_kind", (q) =>
          q.eq("policyId", policyId).eq("kind", kind),
        )
        .collect();
      for (const artifact of existingBundles) {
        const existingRole =
          artifact.metadata &&
          typeof artifact.metadata === "object" &&
          !Array.isArray(artifact.metadata)
            ? (artifact.metadata as Record<string, unknown>).artifactRole
            : undefined;
        if (
          artifact.runId !== run?._id ||
          artifact.sourceFingerprint !== sourceFingerprint ||
          artifact.extractorVersion !== extractorVersion ||
          existingRole !== role
        ) {
          continue;
        }
        await ctx.storage.delete(artifact.storageId).catch(() => {});
        await ctx.db.delete(artifact._id);
      }
    } else {
      await clearPolicyExtractionArtifacts(ctx, policyId, kind);
    }
    const now = nowMs();
    return await ctx.db.insert("policyExtractionArtifacts", {
      policyId,
      kind,
      storageId,
      runId: run?._id,
      sourceFingerprint,
      extractorVersion,
      sectionId,
      metadata,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const pipelineGetPromotionContext = internalQuery({
  args: { jobId: v.string() },
  handler: async (ctx, { jobId }) => {
    const policyId = jobId as DataModelId<"policies">;
    const run = await getPolicyExtractionRun(ctx, policyId);
    const checkpoint = run?.pipelineCheckpoint as
      | { lease?: { id?: string } }
      | undefined;
    if (!run || run.pipelineStatus !== "running" || !checkpoint?.lease?.id) {
      return null;
    }
    return {
      runId: run._id,
      leaseId: checkpoint.lease.id,
      promotionGateDecision: run.promotionGateDecision,
      promotedAt: run.promotedAt,
    };
  },
});

export const pipelineListSectionResults = internalQuery({
  args: { jobId: v.string() },
  handler: async (ctx, { jobId }) => {
    const policyId = jobId as DataModelId<"policies">;
    const run = await getPolicyExtractionRun(ctx, policyId);
    if (!run) return [];
    const artifacts = await ctx.db
      .query("policyExtractionArtifacts")
      .withIndex("policy_kind", (q) =>
        q.eq("policyId", policyId).eq("kind", "section_result"),
      )
      .collect();
    return artifacts
      .filter((artifact) => artifact.runId === run._id)
      .map((artifact) => ({
        sectionId: artifact.sectionId,
        storageId: artifact.storageId,
        metadata: artifact.metadata,
      }));
  },
});

export const pipelineGetArtifact = internalQuery({
  args: {
    jobId: v.string(),
    kind: pipelineArtifactKindValidator,
  },
  handler: async (ctx, { jobId, kind }) => {
    return await ctx.db
      .query("policyExtractionArtifacts")
      .withIndex("policy_kind", (q) =>
        q.eq("policyId", jobId as DataModelId<"policies">).eq("kind", kind),
      )
      .order("desc")
      .first();
  },
});

export const pipelineClearArtifacts = internalMutation({
  args: {
    jobId: v.string(),
    kind: v.optional(pipelineArtifactKindValidator),
  },
  handler: async (ctx, { jobId, kind }) => {
    const policyId = jobId as DataModelId<"policies">;
    await clearPolicyExtractionArtifacts(ctx, policyId, kind);
    if (kind === undefined) {
      await patchPolicyExtractionRun(ctx, policyId, {
        sourceFingerprint: undefined,
        extractorVersion: undefined,
        evidenceLedgerHash: undefined,
        completionManifest: undefined,
        promotionGateDecision: undefined,
        promotedAt: undefined,
      });
    }
  },
});

// ── cl-pipelines contract mutations for policies ───────────────────────────────
const PIPELINE_LEGACY_LEASE_STALE_MS = 5 * 60 * 1000;

export const pipelineGetJob = internalQuery({
  args: { jobId: v.string() },
  handler: async (ctx, { jobId }) => {
    const state = await readPolicyPipelineState(
      ctx,
      jobId as DataModelId<"policies">,
    );
    if (!state) return null;
    return {
      status: state.pipelineStatus,
      checkpoint: state.pipelineCheckpoint ?? null,
      error: state.pipelineError,
    };
  },
});

export const pipelineSetStatus = internalMutation({
  args: {
    jobId: v.string(),
    status: v.union(
      v.literal("idle"),
      v.literal("running"),
      v.literal("paused"),
      v.literal("complete"),
      v.literal("error"),
    ),
    error: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { jobId, status, error }) => {
    const policyId = jobId as DataModelId<"policies">;
    if (status === "complete" || status === "error") {
      const [run, policy] = await Promise.all([
        getPolicyExtractionRun(ctx, policyId),
        ctx.db.get(policyId),
      ]);
      const canonicalStatus = canonicalPipelineStatusPatch(
        policy,
        run?.pipelineCheckpoint,
        status,
        error,
      );
      await patchPolicyExtractionRun(ctx, policyId, {
        ...canonicalStatus,
        ...(status === "complete" || error === "Cancelled by user"
          ? { pipelineCheckpoint: undefined }
          : {}),
      });
      await ctx.db.patch(policyId, {
        ...policyPipelineStatusPatch(
          policy,
          run?.pipelineCheckpoint,
          status,
          error,
        ),
        ...(status === "complete" ? { extractionPreviewError: undefined } : {}),
      });
      return;
    }
    await setPolicyPipelineStatus(ctx, policyId, status, error);
  },
});

export const pipelineSetCheckpoint = internalMutation({
  args: { jobId: v.string(), checkpoint: v.optional(v.any()) },
  handler: async (ctx, { jobId, checkpoint }) => {
    await patchPolicyExtractionRun(ctx, jobId as DataModelId<"policies">, {
      pipelineCheckpoint: checkpoint ?? undefined,
    });
    await ctx.db.patch(jobId as DataModelId<"policies">, {
      pipelineCheckpoint: undefined,
      pipelineLog: undefined,
    });
  },
});

export const pipelineAppendLog = internalMutation({
  args: {
    jobId: v.string(),
    timestamp: v.number(),
    message: v.string(),
    phase: v.optional(v.string()),
    level: v.optional(v.string()),
  },
  handler: async (ctx, { jobId, timestamp, message, phase, level }) => {
    const entry: PolicyPipelineLogEntry = {
      timestamp,
      message,
    };
    if (phase !== undefined) entry.phase = phase;
    if (level !== undefined) entry.level = level;
    const policyId = jobId as DataModelId<"policies">;
    await appendPolicyPipelineLog(ctx, policyId, entry);
    await insertPipelineTraceLog(ctx, policyId, entry);
  },
});

export const pipelineClearLog = internalMutation({
  args: { jobId: v.string() },
  handler: async (ctx, { jobId }) => {
    await patchPolicyExtractionRun(ctx, jobId as DataModelId<"policies">, {
      pipelineLog: [],
    });
    await ctx.db.patch(jobId as DataModelId<"policies">, {
      pipelineLog: undefined,
    });
  },
});

// Auto-archives a policy row whose document was rejected by the intake gate so
// it lands in the archived list instead of lingering as a failed policy row.
async function archiveRejectedPolicyDocument(
  ctx: any,
  policyId: DataModelId<"policies">,
  userId?: string,
) {
  const policy = await ctx.db.get(policyId);
  if (!policy || policy.deletedAt) return;
  await ctx.db.patch(policyId, { deletedAt: nowMs() });
  if (policy.orgId) {
    await deactivatePolicyDeclarationFacts(ctx, policyId);
  }
  const auditUserId =
    userId ?? String(policy.userId ?? policy.uploadedByUserId ?? "");
  if (auditUserId) {
    await ctx.db.insert("policyAuditLog", {
      policyId,
      userId: auditUserId as DataModelId<"users">,
      orgId: policy.orgId,
      action: "archived",
      detail: "Auto-archived: rejected by the document intake gate",
    });
  }
}

// The parse phase rejects documents that fail the intake gate.
export const archiveRejectedDocumentInternal = internalMutation({
  args: {
    id: v.id("policies"),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await archiveRejectedPolicyDocument(ctx, args.id, args.userId);
  },
});

export const pipelineRequeueStale = internalMutation({
  args: {
    olderThanMs: v.optional(v.number()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = nowMs();
    const olderThanMs = Math.max(
      PIPELINE_STALE_REQUEUE_MS,
      Math.floor(args.olderThanMs ?? PIPELINE_STALE_REQUEUE_MS),
    );
    const batchSize = Math.max(
      1,
      Math.min(
        PIPELINE_STALE_REQUEUE_BATCH_LIMIT,
        Math.floor(args.batchSize ?? PIPELINE_STALE_REQUEUE_BATCH_LIMIT),
      ),
    );
    const cutoff = now - olderThanMs;
    const runs = await ctx.db
      .query("policyExtractionRuns")
      .withIndex("status_updated", (q) =>
        q.eq("pipelineStatus", "running").lt("updatedAt", cutoff),
      )
      .order("asc")
      .take(batchSize);

    const requeued: string[] = [];
    const markedError: string[] = [];
    const skipped: string[] = [];

    for (const run of runs) {
      const checkpoint = run.pipelineCheckpoint as
        | {
            nextPhase?: string;
            state?: {
              orgId?: string;
              workerRouterTransportSmokeRequestId?: string;
            };
            createdAt?: number;
            lease?: {
              id?: string;
              phase?: string;
              expiresAt?: number;
              heartbeatAt?: number;
            };
          }
        | undefined;

      if (!checkpoint) {
        await setPolicyPipelineStatus(
          ctx,
          run.policyId,
          "error",
          "Extraction stalled without a resumable checkpoint",
        );
        await appendPolicyPipelineLog(ctx, run.policyId, {
          timestamp: now,
          message:
            "Marked extraction failed because no resumable checkpoint was available",
          phase: "watchdog",
          level: "error",
        });
        markedError.push(String(run.policyId));
        continue;
      }

      const lastLogAt =
        run.pipelineLog?.at(-1)?.timestamp ??
        checkpoint.createdAt ??
        run.updatedAt;
      const heartbeatAt = checkpoint.lease?.heartbeatAt;
      const heartbeatStale =
        heartbeatAt === undefined
          ? now - lastLogAt > olderThanMs
          : now - heartbeatAt > olderThanMs;
      if (!heartbeatStale) {
        skipped.push(String(run.policyId));
        continue;
      }

      const smokeRequestId =
        checkpoint.state?.workerRouterTransportSmokeRequestId;
      if (smokeRequestId) {
        const smoke = await ctx.db
          .query("workerRouterTransportSmokeRuns")
          .withIndex("request", (query) =>
            query.eq("requestId", smokeRequestId),
          )
          .unique();
        if (
          smoke?.policyId === run.policyId &&
          smoke.runId === run._id &&
          smoke.leaseId === checkpoint.lease?.id &&
          String(smoke.orgId) === checkpoint.state?.orgId
        ) {
          skipped.push(String(run.policyId));
          continue;
        }
      }

      // advance restarts checkpoints from removed phases or the extraction
      // worker from load_pdf.
      await appendPolicyPipelineLog(ctx, run.policyId, {
        timestamp: now,
        message: `Stale extraction lease detected; requeueing ${checkpoint.nextPhase ?? "pipeline"} phase`,
        phase: "watchdog",
        level: "warn",
      });
      await ctx.scheduler.runAfter(
        0,
        internal.actions.policyExtraction.advance,
        { jobId: String(run.policyId) },
      );
      requeued.push(String(run.policyId));
    }

    return {
      scanned: runs.length,
      requeued,
      markedError,
      skipped,
      cutoff,
    };
  },
});

export const pipelineReconcileTerminalState = internalMutation({
  args: { jobId: v.string() },
  handler: async (ctx, { jobId }) => {
    const policyId = jobId as DataModelId<"policies">;
    const [run, policy] = await Promise.all([
      getPolicyExtractionRun(ctx, policyId),
      ctx.db.get(policyId),
    ]);
    const status = (run?.pipelineStatus ?? policy?.pipelineStatus) as
      | "complete"
      | "error"
      | undefined;
    if (status !== "complete" && status !== "error") {
      return { terminal: false };
    }

    const error = run?.pipelineError ?? policy?.pipelineError;
    const runCheckpoint = run?.pipelineCheckpoint as
      | { state?: { traceId?: string } }
      | undefined;
    const policyCheckpoint = policy?.pipelineCheckpoint as
      | { state?: { traceId?: string } }
      | undefined;
    const traceIds = [
      runCheckpoint?.state?.traceId,
      policyCheckpoint?.state?.traceId,
    ].filter((traceId): traceId is string => Boolean(traceId));

    const clearsRetryState =
      (status === "complete" &&
        !isRetryablePrePromotionReplacement(policy, run?.pipelineCheckpoint)) ||
      error === "Cancelled by user";
    if (run && run.pipelineCheckpoint !== undefined && clearsRetryState) {
      await ctx.db.patch(run._id, {
        pipelineCheckpoint: undefined,
        updatedAt: nowMs(),
      });
    }
    if (policy) {
      await ctx.db.patch(
        policyId,
        policyPipelineStatusPatch(
          policy,
          run?.pipelineCheckpoint,
          status,
          error,
        ),
      );
    }

    return {
      terminal: true,
      status,
      error,
      traceIds: Array.from(new Set(traceIds)),
    };
  },
});

export const pipelineAcquireLease = internalMutation({
  args: {
    jobId: v.string(),
    leaseId: v.string(),
    leaseExpiresAt: v.number(),
  },
  handler: async (ctx, { jobId, leaseId, leaseExpiresAt }) => {
    const run = await ensurePolicyExtractionRun(
      ctx,
      jobId as DataModelId<"policies">,
    );
    if (!run || run.pipelineStatus !== "running" || !run.pipelineCheckpoint) {
      return null;
    }

    const checkpoint = run.pipelineCheckpoint as {
      nextPhase: string;
      state: unknown;
      createdAt: number;
      lease?: {
        id: string;
        phase: string;
        expiresAt: number;
        heartbeatAt?: number;
      };
    };
    const now = nowMs();
    if (checkpoint.lease && checkpoint.lease.expiresAt > now) {
      const lastLogAt =
        run.pipelineLog?.at(-1)?.timestamp ?? checkpoint.createdAt;
      const heartbeatAt = checkpoint.lease.heartbeatAt;
      const staleLegacyLease =
        heartbeatAt === undefined &&
        now - lastLogAt > PIPELINE_LEGACY_LEASE_STALE_MS;
      const staleHeartbeatLease =
        heartbeatAt !== undefined &&
        now - heartbeatAt > PIPELINE_LEGACY_LEASE_STALE_MS;
      if (!staleLegacyLease && !staleHeartbeatLease) {
        return null;
      }
    }

    const leasedCheckpoint = {
      ...checkpoint,
      lease: {
        id: leaseId,
        phase: checkpoint.nextPhase,
        expiresAt: leaseExpiresAt,
        heartbeatAt: now,
      },
    };
    await ctx.db.patch(run._id, {
      pipelineCheckpoint: leasedCheckpoint,
      updatedAt: now,
    });
    return leasedCheckpoint;
  },
});

export const pipelineSaveStateForLease = internalMutation({
  args: {
    jobId: v.string(),
    leaseId: v.string(),
    nextPhase: v.string(),
    state: v.any(),
    leaseExpiresAt: v.number(),
  },
  handler: async (
    ctx,
    { jobId, leaseId, nextPhase, state, leaseExpiresAt },
  ) => {
    const run = await ensurePolicyExtractionRun(
      ctx,
      jobId as DataModelId<"policies">,
    );
    const checkpoint = run?.pipelineCheckpoint as
      | {
          nextPhase: string;
          state: unknown;
          createdAt: number;
          lease?: {
            id: string;
            phase: string;
            expiresAt: number;
            heartbeatAt?: number;
          };
        }
      | undefined;
    if (!run || !checkpoint || checkpoint.lease?.id !== leaseId) {
      return false;
    }

    const now = nowMs();
    await ctx.db.patch(run._id, {
      pipelineCheckpoint: {
        nextPhase,
        state,
        createdAt: now,
        lease: {
          id: leaseId,
          phase: nextPhase,
          expiresAt: leaseExpiresAt,
          heartbeatAt: now,
        },
      },
      updatedAt: now,
    });
    return true;
  },
});

export const pipelineExtendLease = internalMutation({
  args: {
    jobId: v.string(),
    leaseId: v.string(),
    leaseExpiresAt: v.number(),
  },
  handler: async (ctx, { jobId, leaseId, leaseExpiresAt }) => {
    const run = await ensurePolicyExtractionRun(
      ctx,
      jobId as DataModelId<"policies">,
    );
    const checkpoint = run?.pipelineCheckpoint as
      | {
          nextPhase: string;
          state: unknown;
          createdAt: number;
          lease?: {
            id: string;
            phase: string;
            expiresAt: number;
            heartbeatAt?: number;
          };
        }
      | undefined;
    if (!run || !checkpoint || checkpoint.lease?.id !== leaseId) {
      return false;
    }

    const now = nowMs();
    await ctx.db.patch(run._id, {
      pipelineCheckpoint: {
        ...checkpoint,
        lease: {
          ...checkpoint.lease,
          expiresAt: leaseExpiresAt,
          heartbeatAt: now,
        },
      },
      updatedAt: now,
    });
    return true;
  },
});

export const pipelineCompleteLease = internalMutation({
  args: {
    jobId: v.string(),
    leaseId: v.string(),
    status: v.optional(
      v.union(v.literal("running"), v.literal("complete"), v.literal("error")),
    ),
    error: v.optional(v.union(v.string(), v.null())),
    checkpoint: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const policyId = args.jobId as DataModelId<"policies">;
    const run = await ensurePolicyExtractionRun(ctx, policyId);
    const checkpoint = run?.pipelineCheckpoint as
      | {
          nextPhase: string;
          state: unknown;
          createdAt: number;
          lease?: {
            id: string;
            phase: string;
            expiresAt: number;
            heartbeatAt?: number;
          };
        }
      | undefined;
    if (!run || !checkpoint || checkpoint.lease?.id !== args.leaseId) {
      return false;
    }

    const policy = await ctx.db.get(policyId);
    const patch: Record<string, unknown> = {};
    if ("checkpoint" in args) {
      patch.pipelineCheckpoint = args.checkpoint ?? undefined;
    }
    if (args.status) {
      const terminalCheckpoint =
        "checkpoint" in args ? args.checkpoint : checkpoint;
      Object.assign(
        patch,
        canonicalPipelineStatusPatch(
          policy,
          terminalCheckpoint,
          args.status,
          args.error,
        ),
      );
      if (
        args.status === "complete" ||
        (args.status === "error" && args.error === "Cancelled by user")
      ) {
        patch.pipelineCheckpoint = undefined;
      }
    }
    patch.updatedAt = nowMs();

    await ctx.db.patch(run._id, patch);
    if (args.status) {
      if (
        args.status === "complete" ||
        (args.status === "error" && args.error === "Cancelled by user")
      ) {
        await clearTransientPolicyExtractionArtifacts(ctx, policyId);
      }
      await ctx.db.patch(
        policyId,
        policyPipelineStatusPatch(policy, checkpoint, args.status, args.error),
      );
    }
    return true;
  },
});
