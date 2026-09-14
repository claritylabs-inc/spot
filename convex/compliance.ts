import {
  notificationActionTypeValidator,
  notificationActionPayloadValidator,
  notificationSourceRefValidator,
} from "./lib/notificationTypes";
import { readRequirementNotes, saveRequirementNotes } from "./certificateNotes";
import { v } from "convex/values";
import dayjs from "dayjs";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getOrgAccess, requireAuth, type OrgAccess } from "./lib/access";
import {
  assessRequirementCompliance,
  formatComplianceReasons,
  policyReadableForCompliance,
  type ComplianceCheckResult,
} from "./lib/complianceCheck";
import {
  complianceCheckStatusValidator,
  coverageRequirementSemanticKey,
  hasCheckableCoverageTerms,
  isRequirementLimitKind,
  isRequirementProvision,
  requirementKindValidator,
  requirementProvisionValidator,
  requirementScopeValidator,
  requirementSourceTypeValidator,
} from "./lib/complianceTypes";
import { isLobCode, policyLobCodes } from "./lib/linesOfBusiness";
import { notify } from "./lib/notify";
import {
  assertImpersonatedSetupWrite,
  writeOperatorAudit,
} from "./lib/operatorIdentity";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "./lib/userFacingErrors";
import { upsertCertificateHolder } from "./certificateHolders";

const sourceDocumentTypeValidator = v.union(
  v.literal("lease_agreement"),
  v.literal("client_contract"),
  v.literal("vendor_requirements"),
  v.literal("other"),
);

const coverageFormValidator = v.union(
  v.literal("occurrence"),
  v.literal("claims_made"),
);

const limitValidator = v.object({
  kind: v.string(),
  amount: v.number(),
  label: v.optional(v.string()),
});

const deductibleValidator = v.object({
  amount: v.number(),
  label: v.optional(v.string()),
});

const certificateHolderAddressValidator = v.object({
  line1: v.optional(v.string()),
  line2: v.optional(v.string()),
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  postalCode: v.optional(v.string()),
  country: v.optional(v.string()),
  formatted: v.optional(v.string()),
});

const requirementSourceHolderValidator = v.object({
  displayName: v.string(),
  contactName: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  address: v.optional(certificateHolderAddressValidator),
});

async function requirementSourceHolders(
  ctx: Pick<QueryCtx, "db">,
  source: Doc<"requirementSourceDocuments">,
) {
  const holderIds = [...new Set(source.certificateHolderIds ?? [])];
  return (
    await Promise.all(holderIds.map((holderId) => ctx.db.get(holderId)))
  ).filter((holder): holder is Doc<"certificateHolders"> => Boolean(holder));
}

const complianceMonitorCheckValidator = v.object({
  requirementId: v.id("insuranceRequirements"),
  requirementTitle: v.string(),
  status: complianceCheckStatusValidator,
  reasons: v.optional(v.array(v.string())),
  matchedPolicyIds: v.array(v.id("policies")),
  matchedSummary: v.optional(v.string()),
  expiresAt: v.optional(v.string()),
  daysUntilExpiration: v.optional(v.number()),
  notes: v.optional(v.string()),
});

const vendorComplianceMonitorRowValidator = v.object({
  relationshipId: v.id("connectedOrgRelationships"),
  vendorOrgId: v.id("organizations"),
  vendorName: v.string(),
  status: v.string(),
  requirementCount: v.number(),
  policyCount: v.number(),
  notMetCount: v.number(),
  missingCount: v.number(),
  expiringSoonCount: v.number(),
  unverifiedCount: v.number(),
  checks: v.array(complianceMonitorCheckValidator),
});

export type OwnComplianceEvent = {
  type: "own_compliance_gap" | "own_compliance_resolved";
  title: string;
  body: string;
  severity: "info" | "warning" | "critical";
  orgId: Id<"organizations">;
  orgName: string;
  requirementIds: Id<"insuranceRequirements">[];
  issueLines: string[];
};

async function requireOrgMember(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
) {
  const access = await getOrgAccess(ctx, orgId, { allowOperator: true });
  if (access.accessType !== "member" && access.accessType !== "operator") {
    throwUserFacingError(
      userFacingErrorCodes.readOnlyAccess,
      "Only members of this organization can manage its compliance requirements.",
    );
  }
  if (access.accessType === "member" && access.orgType !== "client") {
    throwUserFacingError(
      userFacingErrorCodes.orgAccessRequired,
      "Compliance workspaces are available only to client organizations.",
    );
  }
  return access;
}

async function requireOrgAdminWrite(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
  errorMessage: string,
) {
  const access = await requireOrgMember(ctx, orgId);
  await assertImpersonatedSetupWrite(ctx, orgId);
  if (access.accessType === "operator") return access;
  if (access.role !== "admin") {
    throwUserFacingError(userFacingErrorCodes.orgAdminRequired, errorMessage);
  }
  return access;
}

async function requireAdminWriteActor(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
  userId: Id<"users">,
  errorMessage: string,
) {
  const membership = await ctx.db
    .query("orgMemberships")
    .withIndex("organization_user", (q) =>
      q.eq("orgId", orgId).eq("userId", userId),
    )
    .first();
  if (membership?.role === "admin") {
    return { userId, accessType: "member" as const };
  }

  const access = await requireOrgMember(ctx, orgId);
  if (access.userId !== userId) {
    throwUserFacingError(userFacingErrorCodes.orgAccessRequired);
  }
  await assertImpersonatedSetupWrite(ctx, orgId);
  if (access.accessType === "operator") return access;
  if (access.role === "admin") return access;
  throwUserFacingError(userFacingErrorCodes.orgAdminRequired, errorMessage);
}

async function writeComplianceOperatorAudit(
  ctx: MutationCtx,
  access: Pick<OrgAccess, "userId" | "accessType">,
  orgId: Id<"organizations">,
  summary: string,
  metadata?: Record<string, unknown>,
) {
  if (access.accessType !== "operator") return;
  await writeOperatorAudit(ctx, {
    operatorUserId: access.userId,
    type: "setup_write",
    targetOrgId: orgId,
    summary,
    metadata: { domain: "compliance", ...metadata },
  });
}

function cleanOptionalString(value?: string) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function orgLegalNames(org: Doc<"organizations"> | null | undefined) {
  return [
    org?.name,
    ...(org?.relatedLegalEntities ?? []).map((entity) => entity.legalName),
  ].filter((name): name is string => Boolean(name?.trim()));
}

function sanitizeRequirementArgs(args: {
  kind: Doc<"insuranceRequirements">["kind"];
  scope: Doc<"insuranceRequirements">["scope"];
  title: string;
  requirementText: string;
  lineOfBusiness?: string;
  limits?: Array<{ kind: string; amount: number; label?: string }>;
  maxDeductible?: { amount: number; label?: string };
  coverageForm?: "occurrence" | "claims_made";
  retroactiveDateOnOrBefore?: string;
  provisions?: string[];
  requiredForms?: string[];
}) {
  if (args.kind !== "coverage") {
    throw new Error(
      "Only coverage requirements are supported. Carrier standards and administrative conditions are not tracked as compliance requirements.",
    );
  }
  const title = args.title.trim();
  const requirementText = args.requirementText.trim();
  if (!title || !requirementText) {
    throw new Error("Title and requirement text are required");
  }

  const lineOfBusiness = args.lineOfBusiness?.trim() || undefined;
  if (!lineOfBusiness || !isLobCode(lineOfBusiness)) {
    throw new Error(
      "Coverage requirements need a valid ACORD line of business",
    );
  }
  const limits = (args.limits ?? [])
    .filter((limit) => Number.isFinite(limit.amount) && limit.amount >= 0)
    .map((limit) => ({
      kind: isRequirementLimitKind(limit.kind) ? limit.kind : "other",
      amount: limit.amount,
      label: limit.label?.trim() || undefined,
    }));
  if (!hasCheckableCoverageTerms({ ...args, limits })) {
    throw new Error(
      "Coverage requirements need at least one limit, deductible, coverage form, retroactive date, provision, or required form",
    );
  }

  return {
    kind: args.kind,
    scope: args.scope,
    title,
    requirementText,
    lineOfBusiness,
    limits,
    maxDeductible: args.maxDeductible
      ? {
          amount: args.maxDeductible.amount,
          label: args.maxDeductible.label?.trim() || undefined,
        }
      : undefined,
    coverageForm: args.coverageForm,
    retroactiveDateOnOrBefore:
      args.retroactiveDateOnOrBefore?.trim() || undefined,
    provisions: Array.from(
      new Set((args.provisions ?? []).filter(isRequirementProvision)),
    ),
    requiredForms: (args.requiredForms ?? [])
      .map((form) => form.trim())
      .filter(Boolean),
    // Coverage rows do not carry insurer or administrative-condition criteria.
    minAmBestRating: undefined,
    minAmBestFinancialSize: undefined,
    admittedRequired: undefined,
    conditionType: undefined,
    noticeDays: undefined,
  };
}

async function listRequirementsForOrg(
  ctx: QueryCtx,
  orgId: Id<"organizations">,
) {
  const rows = await ctx.db
    .query("insuranceRequirements")
    .withIndex("organization_status", (q) =>
      q.eq("orgId", orgId).eq("status", "active"),
    )
    .collect();
  return rows.filter((row) => row.kind === "coverage");
}

function requirementsForVendor(
  _relationship: Doc<"connectedOrgRelationships"> | null | undefined,
  requirements: Doc<"insuranceRequirements">[],
) {
  return requirements.filter((requirement) => requirement.scope === "vendors");
}

async function listPoliciesForOrg(ctx: QueryCtx, orgId: Id<"organizations">) {
  return await ctx.db
    .query("policies")
    .withIndex("organization", (q) => q.eq("orgId", orgId))
    .collect();
}

async function latestChecksForSubject(
  ctx: QueryCtx,
  requirementId: Id<"insuranceRequirements">,
  subjectOrgId: Id<"organizations">,
) {
  return await ctx.db
    .query("complianceChecks")
    .withIndex("requirement_subject", (q) =>
      q.eq("requirementId", requirementId).eq("subjectOrgId", subjectOrgId),
    )
    .collect();
}

function resultNotes(result: ComplianceCheckResult) {
  if (result.matchedSummary) return result.matchedSummary;
  return result.reasons.length
    ? formatComplianceReasons(result.reasons)
    : undefined;
}

async function assessForSubject(
  ctx: QueryCtx,
  requirement: Doc<"insuranceRequirements">,
  policies: Doc<"policies">[],
  subjectOrgId: Id<"organizations">,
  subjectOrg: Doc<"organizations"> | null,
  options?: {
    relationshipId?: Id<"connectedOrgRelationships">;
    includePreviewPolicies?: boolean;
  },
) {
  const checks = await latestChecksForSubject(
    ctx,
    requirement._id,
    subjectOrgId,
  );
  const result = assessRequirementCompliance(requirement, policies, {
    expectedInsuredName: subjectOrg?.name,
    expectedInsuredNames: orgLegalNames(subjectOrg),
    includePreviewPolicies: options?.includePreviewPolicies,
    existingChecks: checks,
  });
  return {
    ...result,
    relationshipId: options?.relationshipId,
    notes: resultNotes(result),
  };
}

async function listClientRequirementsForVendor(
  ctx: QueryCtx,
  vendorOrgId: Id<"organizations">,
  vendorPolicies: Doc<"policies">[],
  vendorOrg: Doc<"organizations"> | null,
) {
  const relationships = await ctx.db
    .query("connectedOrgRelationships")
    .withIndex("vendor_status", (q) =>
      q.eq("vendorOrgId", vendorOrgId).eq("status", "active"),
    )
    .collect();
  const rows = [];
  for (const rel of relationships) {
    const clientOrg = await ctx.db.get(rel.clientOrgId);
    const requirements = requirementsForVendor(
      rel,
      await listRequirementsForOrg(ctx, rel.clientOrgId),
    );
    for (const requirement of requirements) {
      rows.push({
        ...requirement,
        complianceCheck: await assessForSubject(
          ctx,
          requirement,
          vendorPolicies,
          vendorOrgId,
          vendorOrg,
          { relationshipId: rel._id },
        ),
        canArchive: false,
        clientRequirementSource: {
          relationshipId: rel._id,
          clientOrg: clientOrg
            ? {
                _id: clientOrg._id,
                name: clientOrg.name,
                website: clientOrg.website,
              }
            : null,
        },
      });
    }
  }
  return rows;
}

async function listRequirementsVisibleToOrg(
  ctx: QueryCtx,
  orgId: Id<"organizations">,
) {
  const [ownRequirementRows, orgPolicies, org] = await Promise.all([
    ctx.db
      .query("insuranceRequirements")
      .withIndex("organization_status", (q) =>
        q.eq("orgId", orgId).eq("status", "active"),
      )
      .order("desc")
      .collect(),
    listPoliciesForOrg(ctx, orgId),
    ctx.db.get(orgId),
  ]);
  const ownRequirements = ownRequirementRows.filter(
    (row) => row.kind === "coverage",
  );
  const clientRequirements = await listClientRequirementsForVendor(
    ctx,
    orgId,
    orgPolicies,
    org,
  );
  const ownRows = [];
  for (const requirement of ownRequirements) {
    ownRows.push({
      ...requirement,
      complianceCheck:
        requirement.scope === "own_org"
          ? await assessForSubject(ctx, requirement, orgPolicies, orgId, org)
          : undefined,
      canArchive: true,
    });
  }
  const rows = [...ownRows, ...clientRequirements].sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
  const sourceIds = Array.from(
    new Set(
      rows
        .map((requirement) => requirement.sourceDocumentId)
        .filter((sourceId): sourceId is Id<"requirementSourceDocuments"> =>
          Boolean(sourceId),
        ),
    ),
  );
  const sourceEntries = await Promise.all(
    sourceIds.map(async (sourceId) => {
      const source = await ctx.db.get(sourceId);
      if (!source || source.archivedAt) return [sourceId, null] as const;
      const holders = await requirementSourceHolders(ctx, source);
      return [
        sourceId,
        {
          title: source.title,
          sourceType: source.sourceType,
          dealName: source.dealName,
          dealType: source.dealType,
          holder: holders[0]
            ? {
                displayName: holders[0].displayName,
                contactName: holders[0].contactName,
                email: holders[0].email,
                phone: holders[0].phone,
                address: holders[0].address,
              }
            : null,
          holders: holders.map((holder) => ({
            displayName: holder.displayName,
            contactName: holder.contactName,
            email: holder.email,
            phone: holder.phone,
            address: holder.address,
          })),
        },
      ] as const;
    }),
  );
  const sourcesById = new Map(sourceEntries);
  return rows.map((requirement) => ({
    ...requirement,
    requirementSource: requirement.sourceDocumentId
      ? (sourcesById.get(requirement.sourceDocumentId) ?? undefined)
      : undefined,
  }));
}

export const listRequirements = query({
  args: { orgId: v.optional(v.id("organizations")) },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    let orgId = args.orgId;
    if (!orgId) {
      const membership = await ctx.db
        .query("orgMemberships")
        .withIndex("user", (q) => q.eq("userId", userId))
        .first();
      if (!membership) throw new Error("Organization required");
      orgId = membership.orgId;
    }
    await requireOrgMember(ctx, orgId);
    return await listRequirementsVisibleToOrg(ctx, orgId);
  },
});

async function enrichRequirementSource(
  ctx: QueryCtx,
  source: Doc<"requirementSourceDocuments">,
  requirements: Doc<"insuranceRequirements">[],
  includePrivate = false,
) {
  const holders = await requirementSourceHolders(ctx, source);
  return {
    ...source,
    internalNotes: await readRequirementNotes(ctx, source, includePrivate),
    holder: holders[0] ?? null,
    holders,
    requirementCount: requirements.filter(
      (requirement) => requirement.sourceDocumentId === source._id,
    ).length,
  };
}

export const listCertificateRequirementSources = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.orgId, { allowOperator: true });
    if (access.accessType === "connected_client") {
      throwUserFacingError(
        userFacingErrorCodes.readOnlyAccess,
        "Connected organization access is read-only.",
      );
    }
    const requirements = (
      await listRequirementsVisibleToOrg(ctx, args.orgId)
    ).filter(
      (requirement) =>
        requirement.sourceDocumentId &&
        (requirement.scope === "own_org" ||
          "clientRequirementSource" in requirement),
    );
    const sourceIds = Array.from(
      new Set(requirements.map((requirement) => requirement.sourceDocumentId!)),
    );
    const sources = (
      await Promise.all(sourceIds.map((sourceId) => ctx.db.get(sourceId)))
    )
      .filter((source): source is Doc<"requirementSourceDocuments"> =>
        Boolean(source && !source.archivedAt),
      )
      .sort((left, right) => right.updatedAt - left.updatedAt);
    return await Promise.all(
      sources.map(async (source) => {
        const sourceRequirements = requirements.filter(
          (requirement) => requirement.sourceDocumentId === source._id,
        );
        const connectedClientOrg = sourceRequirements.find(
          (requirement) => "clientRequirementSource" in requirement,
        )?.clientRequirementSource.clientOrg;
        const storedHolders = await requirementSourceHolders(ctx, source);
        const holders =
          storedHolders.length > 0
            ? storedHolders
            : connectedClientOrg
              ? [{ displayName: connectedClientOrg.name }]
              : [];
        const holder = holders[0] ?? null;
        if (source.orgId !== args.orgId) {
          return {
            _id: source._id,
            orgId: source.orgId,
            sourceType: source.sourceType,
            title: source.title,
            dealName: source.dealName,
            dealType: source.dealType,
            status: source.status,
            createdAt: source.createdAt,
            updatedAt: source.updatedAt,
            holder,
            holders,
            requirementCount: sourceRequirements.length,
            requirements: sourceRequirements.map((requirement) => ({
              requirementId: requirement._id,
              title: requirement.title,
              status: requirement.complianceCheck?.status ?? "unverified",
              reasons: requirement.complianceCheck?.reasons ?? [],
              summary: requirement.complianceCheck?.matchedSummary,
            })),
          };
        }
        return {
          ...source,
          internalNotes: await readRequirementNotes(ctx, source, access.accessType === "operator"),
          holder,
          holders,
          requirementCount: sourceRequirements.length,
          requirements: sourceRequirements.map((requirement) => ({
            requirementId: requirement._id,
            title: requirement.title,
            status: requirement.complianceCheck?.status ?? "unverified",
            reasons: requirement.complianceCheck?.reasons ?? [],
            summary: requirement.complianceCheck?.matchedSummary,
          })),
        };
      }),
    );
  },
});

export const listRequirementSources = query({
  args: { orgId: v.optional(v.id("organizations")) },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    let orgId = args.orgId;
    if (!orgId) {
      const membership = await ctx.db
        .query("orgMemberships")
        .withIndex("user", (q) => q.eq("userId", userId))
        .first();
      if (!membership) throw new Error("Organization required");
      orgId = membership.orgId;
    }
    const access = await requireOrgMember(ctx, orgId);
    const [sources, requirements] = await Promise.all([
      ctx.db
        .query("requirementSourceDocuments")
        .withIndex("organization", (q) => q.eq("orgId", orgId))
        .collect(),
      listRequirementsForOrg(ctx, orgId),
    ]);
    return await Promise.all(
      sources
        .filter((source) => !source.archivedAt)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((source) => enrichRequirementSource(ctx, source, requirements, access.accessType === "operator")),
    );
  },
});

export const upsertRequirement = mutation({
  args: {
    orgId: v.id("organizations"),
    requirementId: v.optional(v.id("insuranceRequirements")),
    kind: requirementKindValidator,
    scope: requirementScopeValidator,
    title: v.string(),
    requirementText: v.string(),
    lineOfBusiness: v.optional(v.string()),
    limits: v.optional(v.array(limitValidator)),
    maxDeductible: v.optional(deductibleValidator),
    coverageForm: v.optional(coverageFormValidator),
    retroactiveDateOnOrBefore: v.optional(v.string()),
    provisions: v.optional(v.array(requirementProvisionValidator)),
    requiredForms: v.optional(v.array(v.string())),
    sourceDocumentId: v.optional(v.id("requirementSourceDocuments")),
    sourceDocumentName: v.optional(v.string()),
    sourceType: v.optional(requirementSourceTypeValidator),
    sourceExcerpt: v.optional(v.string()),
    sourcePageStart: v.optional(v.number()),
    sourcePageEnd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const access = await requireOrgAdminWrite(
      ctx,
      args.orgId,
      "Only an organization admin can update compliance requirements.",
    );
    const now = dayjs().valueOf();
    const sanitized = sanitizeRequirementArgs(args);
    const source = args.sourceDocumentId
      ? await ctx.db.get(args.sourceDocumentId)
      : null;
    if (
      args.sourceDocumentId &&
      (!source || source.orgId !== args.orgId || source.archivedAt)
    ) {
      throw new Error("Requirement source not found");
    }
    const patch = {
      ...sanitized,
      sourceDocumentId: source?._id,
      sourceDocumentName: source?.title,
      sourceType: (source?.sourceType ?? "manual") as NonNullable<
        Doc<"insuranceRequirements">["sourceType"]
      >,
      sourceExcerpt: args.sourceExcerpt?.trim() || undefined,
      sourcePageStart: args.sourcePageStart,
      sourcePageEnd: args.sourcePageEnd,
      updatedByUserId: access.userId,
      updatedAt: now,
    };
    let requirementId = args.requirementId;
    if (requirementId) {
      const existing = await ctx.db.get(requirementId);
      if (!existing || existing.orgId !== args.orgId) {
        throw new Error("Requirement not found");
      }
      await ctx.db.patch(requirementId, patch);
    } else {
      requirementId = await ctx.db.insert("insuranceRequirements", {
        orgId: args.orgId,
        ...patch,
        status: "active",
        createdByUserId: access.userId,
        createdAt: now,
      });
    }
    await writeComplianceOperatorAudit(
      ctx,
      access,
      args.orgId,
      `${args.requirementId ? "Updated" : "Added"} compliance requirement ${sanitized.title}`,
      { requirementId },
    );
    return requirementId;
  },
});

export const updateRequirementSource = mutation({
  args: {
    orgId: v.id("organizations"),
    sourceDocumentId: v.id("requirementSourceDocuments"),
    title: v.optional(v.string()),
    sourceType: v.optional(sourceDocumentTypeValidator),
    holder: v.optional(requirementSourceHolderValidator),
    dealName: v.optional(v.string()),
    dealType: v.optional(v.string()),
    internalNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireOrgAdminWrite(
      ctx,
      args.orgId,
      "Only an organization admin can update requirement sources.",
    );
    const source = await ctx.db.get(args.sourceDocumentId);
    if (!source || source.orgId !== args.orgId || source.archivedAt) {
      throw new Error("Requirement source not found");
    }
    const title = args.title?.trim();
    if (args.title !== undefined && !title)
      throw new Error("Source name is required");
    if (
      title === undefined &&
      args.sourceType === undefined &&
      args.holder === undefined &&
      args.dealName === undefined &&
      args.dealType === undefined &&
      args.internalNotes === undefined
    ) {
      throw new Error("No source updates provided");
    }
    const now = dayjs().valueOf();
    const sourcePatch: Partial<Doc<"requirementSourceDocuments">> = {
      updatedAt: now,
    };
    if (title !== undefined) sourcePatch.title = title;
    if (args.sourceType !== undefined) sourcePatch.sourceType = args.sourceType;
    if (args.holder !== undefined) {
      const displayName = args.holder.displayName.trim();
      if (!displayName) throw new Error("Certificate holder name is required");
      const certificateHolderId = await upsertCertificateHolder(ctx, {
        orgId: args.orgId,
        displayName,
        contactName: args.holder.contactName,
        email: args.holder.email,
        phone: args.holder.phone,
        address: args.holder.address,
        source: "manual",
        sourceRef: String(args.sourceDocumentId),
        createdByUserId: access.userId,
        updatedByUserId: access.userId,
      });
      const previousPrimary = source.certificateHolderIds?.[0];
      sourcePatch.certificateHolderIds = [
        certificateHolderId,
        ...(source.certificateHolderIds ?? []).filter(
          (holderId) => holderId !== previousPrimary && holderId !== certificateHolderId,
        ),
      ];
    }
    if (args.dealName !== undefined)
      sourcePatch.dealName = cleanOptionalString(args.dealName);
    if (args.dealType !== undefined)
      sourcePatch.dealType = cleanOptionalString(args.dealType);
    await ctx.db.patch(args.sourceDocumentId, sourcePatch);
    if (args.internalNotes !== undefined) await saveRequirementNotes(ctx, { ...source, ...sourcePatch }, args.internalNotes, { actorUserId: access.userId });
    const requirements = await ctx.db
      .query("insuranceRequirements")
      .withIndex("organization_status", (q) =>
        q.eq("orgId", args.orgId).eq("status", "active"),
      )
      .collect();
    for (const requirement of requirements) {
      if (requirement.sourceDocumentId !== args.sourceDocumentId) continue;
      const requirementPatch: Partial<Doc<"insuranceRequirements">> = {
        updatedByUserId: access.userId,
        updatedAt: now,
      };
      if (title !== undefined) requirementPatch.sourceDocumentName = title;
      if (args.sourceType !== undefined)
        requirementPatch.sourceType = args.sourceType;
      await ctx.db.patch(requirement._id, requirementPatch);
    }
    await writeComplianceOperatorAudit(
      ctx,
      access,
      args.orgId,
      `Updated compliance source ${source.title}`,
      { sourceDocumentId: args.sourceDocumentId },
    );
  },
});

export const archiveRequirementSources = mutation({
  args: {
    orgId: v.id("organizations"),
    sourceDocumentIds: v.array(v.id("requirementSourceDocuments")),
  },
  handler: async (ctx, args) => {
    const access = await requireOrgAdminWrite(
      ctx,
      args.orgId,
      "Only an organization admin can archive requirement sources.",
    );
    const sourceDocumentIds = Array.from(new Set(args.sourceDocumentIds));
    if (sourceDocumentIds.length === 0) {
      throw new Error("Select at least one requirement source");
    }
    const now = dayjs().valueOf();
    let archivedSourceCount = 0;
    for (const sourceDocumentId of sourceDocumentIds) {
      const source = await ctx.db.get(sourceDocumentId);
      if (!source || source.orgId !== args.orgId || source.archivedAt) continue;
      await ctx.db.patch(sourceDocumentId, {
        archivedAt: now,
        archivedByUserId: access.userId,
        updatedAt: now,
      });
      archivedSourceCount += 1;
    }
    const selected = new Set(sourceDocumentIds);
    const requirements = await ctx.db
      .query("insuranceRequirements")
      .withIndex("organization_status", (q) =>
        q.eq("orgId", args.orgId).eq("status", "active"),
      )
      .collect();
    let archivedRequirementCount = 0;
    for (const requirement of requirements) {
      if (
        !requirement.sourceDocumentId ||
        !selected.has(requirement.sourceDocumentId)
      )
        continue;
      await ctx.db.patch(requirement._id, {
        status: "archived",
        updatedByUserId: access.userId,
        updatedAt: now,
      });
      archivedRequirementCount += 1;
    }
    await writeComplianceOperatorAudit(
      ctx,
      access,
      args.orgId,
      `Archived ${archivedSourceCount} compliance source${archivedSourceCount === 1 ? "" : "s"}`,
      {
        sourceDocumentIds,
        archivedRequirementCount,
      },
    );
    return { archivedSourceCount, archivedRequirementCount };
  },
});

export const archiveRequirement = mutation({
  args: {
    orgId: v.id("organizations"),
    requirementId: v.id("insuranceRequirements"),
  },
  handler: async (ctx, args) => {
    const access = await requireOrgAdminWrite(
      ctx,
      args.orgId,
      "Only an organization admin can archive compliance requirements.",
    );
    const existing = await ctx.db.get(args.requirementId);
    if (!existing || existing.orgId !== args.orgId) {
      throw new Error("Requirement not found");
    }
    await ctx.db.patch(args.requirementId, {
      status: "archived",
      updatedByUserId: access.userId,
      updatedAt: dayjs().valueOf(),
    });
    await writeComplianceOperatorAudit(
      ctx,
      access,
      args.orgId,
      `Archived compliance requirement ${existing.title}`,
      { requirementId: args.requirementId },
    );
  },
});

export const generateRequirementImportUploadUrl = mutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireOrgAdminWrite(
      ctx,
      args.orgId,
      "Only an organization admin can import compliance requirements.",
    );
    return await ctx.storage.generateUploadUrl();
  },
});

async function vendorComplianceRows(
  ctx: QueryCtx,
  clientOrgId: Id<"organizations">,
  includePreviewPolicies = true,
) {
  const clientRequirements = await listRequirementsForOrg(ctx, clientOrgId);
  const relationships = await ctx.db
    .query("connectedOrgRelationships")
    .withIndex("client_status", (q) =>
      q.eq("clientOrgId", clientOrgId).eq("status", "active"),
    )
    .collect();
  const rows = [];
  for (const rel of relationships) {
    const vendorOrg = await ctx.db.get(rel.vendorOrgId);
    const requirements = requirementsForVendor(rel, clientRequirements);
    const policies = await listPoliciesForOrg(ctx, rel.vendorOrgId);
    const policyCount = policies.filter((policy) =>
      policyReadableForCompliance(policy, includePreviewPolicies),
    ).length;
    const checks = [];
    for (const requirement of requirements) {
      const check = await assessForSubject(
        ctx,
        requirement,
        policies,
        rel.vendorOrgId,
        vendorOrg,
        {
          relationshipId: rel._id,
          includePreviewPolicies,
        },
      );
      checks.push({
        requirement,
        ...check,
      });
    }
    const notMetCount = checks.filter(
      (check) => check.status === "not_met" || check.status === "expired",
    ).length;
    const expiringSoonCount = checks.filter(
      (check) => check.status === "expiring_soon",
    ).length;
    const unverifiedCount = checks.filter(
      (check) => check.status === "unverified",
    ).length;
    rows.push({
      relationshipId: rel._id,
      vendorOrg: vendorOrg
        ? {
            _id: vendorOrg._id,
            name: vendorOrg.name,
            website: vendorOrg.website,
          }
        : null,
      vendorOrgId: rel.vendorOrgId,
      vendorName: vendorOrg?.name ?? "Unknown vendor",
      status:
        notMetCount > 0
          ? "non_compliant"
          : expiringSoonCount > 0 || unverifiedCount > 0
            ? "attention"
            : requirements.length === 0
              ? "no_requirements"
              : "compliant",
      requirementCount: requirements.length,
      policyCount,
      metCount: checks.filter((check) => check.status === "met").length,
      notMetCount,
      missingCount: notMetCount,
      expiringSoonCount,
      unverifiedCount,
      checks,
    });
  }
  return rows;
}

export const listVendorCompliance = query({
  args: { clientOrgId: v.optional(v.id("organizations")) },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    let clientOrgId = args.clientOrgId;
    if (!clientOrgId) {
      const membership = await ctx.db
        .query("orgMemberships")
        .withIndex("user", (q) => q.eq("userId", userId))
        .first();
      if (!membership) throw new Error("Organization required");
      clientOrgId = membership.orgId;
    }
    await requireOrgMember(ctx, clientOrgId);
    return await vendorComplianceRows(ctx, clientOrgId, true);
  },
});

export const listRequirementsInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) =>
    await listRequirementsVisibleToOrg(ctx, args.orgId),
});

export const getCertificateRequirementSourcePlanInternal = internalQuery({
  args: {
    orgId: v.id("organizations"),
    sourceDocumentId: v.optional(v.id("requirementSourceDocuments")),
    requirementId: v.optional(v.id("insuranceRequirements")),
  },
  handler: async (ctx, args) => {
    if (Boolean(args.sourceDocumentId) === Boolean(args.requirementId)) {
      throw new Error(
        "Choose either one requirement source or one requirement.",
      );
    }
    const [requirements, policies, org] = await Promise.all([
      listRequirementsVisibleToOrg(ctx, args.orgId),
      listPoliciesForOrg(ctx, args.orgId),
      ctx.db.get(args.orgId),
    ]);
    const requestedRequirement = args.requirementId
      ? requirements.find((row) => row._id === args.requirementId)
      : undefined;
    if (args.requirementId && !requestedRequirement) {
      throw new Error("Certificate requirement not found.");
    }
    const sourceDocumentId =
      args.sourceDocumentId ?? requestedRequirement?.sourceDocumentId;
    if (!sourceDocumentId) {
      throw new Error(
        "This requirement is not connected to a requirement source.",
      );
    }
    const sourceRequirements = requirements.filter(
      (requirement) =>
        requirement.sourceDocumentId === sourceDocumentId &&
        (requirement.scope === "own_org" ||
          "clientRequirementSource" in requirement),
    );
    const source = await ctx.db.get(sourceDocumentId);
    if (!source || source.archivedAt || sourceRequirements.length === 0) {
      throw new Error("Certificate requirement source not found.");
    }
    const storedHolder =
      (await requirementSourceHolders(ctx, source))[0] ?? null;
    const selectedForHolder = requestedRequirement ?? sourceRequirements[0];
    const connectedClientOrg =
      selectedForHolder && "clientRequirementSource" in selectedForHolder
        ? (
            selectedForHolder as {
              clientRequirementSource: {
                clientOrg: { name: string } | null;
              };
            }
          ).clientRequirementSource.clientOrg
        : null;
    const holder =
      storedHolder ??
      (connectedClientOrg ? { displayName: connectedClientOrg.name } : null);
    if (!holder) {
      throw new Error(
        "Add certificate holder details to this requirement source before generating certificates.",
      );
    }
    const selected = sourceRequirements.filter(
      (requirement) =>
        !args.requirementId || requirement._id === args.requirementId,
    );
    if (selected.length === 0) {
      throw new Error(
        "This source has no active requirements for your organization.",
      );
    }
    return {
      source,
      holder,
      requirements: selected.map((requirement) => {
        const assessment =
          requirement.complianceCheck ??
          assessRequirementCompliance(requirement, policies, {
            expectedInsuredName: org?.name,
            expectedInsuredNames: orgLegalNames(org),
            includePreviewPolicies: false,
          });
        return {
          requirementId: requirement._id,
          status: assessment.status,
          matchedPolicyIds: assessment.matchedPolicyIds,
          reasons: assessment.reasons,
          summary: assessment.matchedSummary,
          snapshot: {
            requirementId: requirement._id,
            title: requirement.title,
            requirementText: requirement.requirementText,
            lineOfBusiness: requirement.lineOfBusiness,
            limits: requirement.limits,
            maxDeductible: requirement.maxDeductible,
            coverageForm: requirement.coverageForm,
            retroactiveDateOnOrBefore: requirement.retroactiveDateOnOrBefore,
            provisions: requirement.provisions,
            requiredForms: requirement.requiredForms,
            sourceDocumentId: requirement.sourceDocumentId,
            sourceDocumentName: requirement.sourceDocumentName,
            sourceExcerpt: requirement.sourceExcerpt,
            updatedAt: requirement.updatedAt,
          },
        };
      }),
    };
  },
});

export type OwnComplianceAssessment = Awaited<
  ReturnType<typeof assessForSubject>
> & { title: string };

export const assessOwnRequirementsInternal = internalQuery({
  args: {
    orgId: v.id("organizations"),
    requirementIds: v.optional(v.array(v.id("insuranceRequirements"))),
    includePreviewPolicies: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<OwnComplianceAssessment[]> => {
    const [requirements, policies, org] = await Promise.all([
      listRequirementsForOrg(ctx, args.orgId),
      listPoliciesForOrg(ctx, args.orgId),
      ctx.db.get(args.orgId),
    ]);
    const requestedIds = args.requirementIds
      ? new Set(args.requirementIds)
      : null;
    const ownRequirements = requirements.filter(
      (requirement) =>
        requirement.scope === "own_org" &&
        (!requestedIds || requestedIds.has(requirement._id)),
    );

    return await Promise.all(
      ownRequirements.map(async (requirement) => ({
        title: requirement.title,
        ...(await assessForSubject(
          ctx,
          requirement,
          policies,
          args.orgId,
          org,
          { includePreviewPolicies: args.includePreviewPolicies },
        )),
      })),
    );
  },
});

export const listOrgIdsWithActiveOwnRequirementsInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const requirements = await ctx.db
      .query("insuranceRequirements")
      .withIndex("status_scope", (query) =>
        query.eq("status", "active").eq("scope", "own_org"),
      )
      .collect();
    return [
      ...new Set<Id<"organizations">>(
        requirements
          .filter((requirement) => requirement.kind === "coverage")
          .map((requirement) => requirement.orgId),
      ),
    ];
  },
});

export const getManualComplianceReviewContextInternal = internalQuery({
  args: {
    orgId: v.id("organizations"),
    requirementId: v.id("insuranceRequirements"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireAdminWriteActor(
      ctx,
      args.orgId,
      args.userId,
      "Only an organization admin can run a deeper compliance check.",
    );
    const requirement = await ctx.db.get(args.requirementId);
    if (
      !requirement ||
      requirement.orgId !== args.orgId ||
      requirement.status !== "active"
    ) {
      throw new Error("Requirement not found");
    }
    if (requirement.scope !== "own_org" || requirement.kind !== "coverage") {
      throw new Error("Only own coverage requirements can be deeply rechecked");
    }
    const [org, policies] = await Promise.all([
      ctx.db.get(args.orgId),
      listPoliciesForOrg(ctx, args.orgId),
    ]);
    const activePolicies = policies.filter((policy) =>
      policyReadableForCompliance(policy, true),
    );
    return {
      org: org
        ? {
            _id: org._id,
            name: org.name,
            relatedLegalEntities: org.relatedLegalEntities ?? [],
          }
        : null,
      requirement,
      deterministicCheck: assessRequirementCompliance(
        requirement,
        activePolicies,
        {
          expectedInsuredName: org?.name,
          expectedInsuredNames: orgLegalNames(org),
        },
      ),
      policies: activePolicies.map((policy) => ({
        _id: policy._id,
        carrier: policy.carrier || policy.security,
        policyNumber: policy.policyNumber,
        insuredName: policy.insuredName,
        effectiveDate: policy.effectiveDate,
        expirationDate: policy.expirationDate,
        linesOfBusiness: policyLobCodes(policy),
        policyTypes: policyLobCodes(policy),
        summary: policy.summary,
        formInventory: policy.formInventory,
        operationalProfile: policy.operationalProfile,
        coverages: (policy.coverages ?? []).map((coverage) => ({
          name: coverage.name,
          lineOfBusiness: coverage.lineOfBusiness,
          coverageCode: coverage.coverageCode,
          limit: coverage.limit,
          limitAmount: coverage.limitAmount,
          limitType: coverage.limitType,
          limits: coverage.limits,
          deductible: coverage.deductible,
          deductibleAmount: coverage.deductibleAmount,
          deductibleType: coverage.deductibleType,
          formNumber: coverage.formNumber,
          pageNumber: coverage.pageNumber,
          sectionRef: coverage.sectionRef,
          originalContent: coverage.originalContent,
        })),
      })),
    };
  },
});

export const saveManualComplianceReviewInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    requirementId: v.id("insuranceRequirements"),
    userId: v.id("users"),
    status: complianceCheckStatusValidator,
    matchedPolicyIds: v.array(v.id("policies")),
    expiresAt: v.optional(v.string()),
    daysUntilExpiration: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireAdminWriteActor(
      ctx,
      args.orgId,
      args.userId,
      "Admin role required",
    );
    const requirement = await ctx.db.get(args.requirementId);
    if (!requirement || requirement.orgId !== args.orgId) {
      throw new Error("Requirement not found");
    }
    const checkId = await ctx.db.insert("complianceChecks", {
      orgId: args.orgId,
      requirementId: args.requirementId,
      subjectOrgId: args.orgId,
      status: args.status,
      reasons: args.status === "met" ? [] : ["agent_review"],
      matchedPolicyIds: args.matchedPolicyIds,
      matchedSummary: args.notes?.trim() || undefined,
      expiresAt: args.expiresAt,
      checkedAt: dayjs().valueOf(),
      checkedBy: "agent",
      checkedByUserId: args.userId,
    });
    await writeComplianceOperatorAudit(
      ctx,
      access,
      args.orgId,
      `Rechecked compliance requirement ${requirement.title}`,
      { requirementId: args.requirementId, checkId },
    );
    return checkId;
  },
});

export const upsertRequirementInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    kind: requirementKindValidator,
    scope: requirementScopeValidator,
    title: v.string(),
    requirementText: v.string(),
    lineOfBusiness: v.optional(v.string()),
    limits: v.optional(v.array(limitValidator)),
    maxDeductible: v.optional(deductibleValidator),
    coverageForm: v.optional(coverageFormValidator),
    retroactiveDateOnOrBefore: v.optional(v.string()),
    provisions: v.optional(v.array(requirementProvisionValidator)),
    requiredForms: v.optional(v.array(v.string())),
    sourceDocumentId: v.optional(v.id("requirementSourceDocuments")),
    sourceDocumentName: v.optional(v.string()),
    sourceType: v.optional(requirementSourceTypeValidator),
    sourceExcerpt: v.optional(v.string()),
    sourcePageStart: v.optional(v.number()),
    sourcePageEnd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const access = await requireAdminWriteActor(
      ctx,
      args.orgId,
      args.userId,
      "Admin role required",
    );
    const now = dayjs().valueOf();
    const sanitized = sanitizeRequirementArgs(args);
    const requirementId = await ctx.db.insert("insuranceRequirements", {
      orgId: args.orgId,
      ...sanitized,
      sourceDocumentId: args.sourceDocumentId,
      sourceDocumentName: args.sourceDocumentName?.trim() || undefined,
      sourceType: args.sourceType ?? "manual",
      sourceExcerpt: args.sourceExcerpt?.trim() || undefined,
      sourcePageStart: args.sourcePageStart,
      sourcePageEnd: args.sourcePageEnd,
      status: "active",
      createdByUserId: args.userId,
      updatedByUserId: args.userId,
      createdAt: now,
      updatedAt: now,
    });
    await writeComplianceOperatorAudit(
      ctx,
      access,
      args.orgId,
      `Added compliance requirement ${sanitized.title}`,
      { requirementId },
    );
    return requirementId;
  },
});

export const getRequirementImportContextInternal = internalQuery({
  args: {
    orgId: v.id("organizations"),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const access = args.userId
      ? null
      : await requireOrgAdminWrite(
          ctx,
          args.orgId,
          "Only an organization admin can import compliance requirements.",
        );
    if (args.userId) {
      await requireAdminWriteActor(
        ctx,
        args.orgId,
        args.userId,
        "Only an organization admin can import compliance requirements.",
      );
    }
    const existing = await listRequirementsForOrg(ctx, args.orgId);
    return {
      userId: args.userId ?? access!.userId,
      existingRequirements: existing.map((requirement) => ({
        kind: requirement.kind,
        scope: requirement.scope,
        title: requirement.title,
        requirementText: requirement.requirementText,
        lineOfBusiness: requirement.lineOfBusiness,
        conditionType: requirement.conditionType,
        limits: requirement.limits,
        maxDeductible: requirement.maxDeductible,
        coverageForm: requirement.coverageForm,
        retroactiveDateOnOrBefore: requirement.retroactiveDateOnOrBefore,
        provisions: requirement.provisions,
        requiredForms: requirement.requiredForms,
      })),
    };
  },
});

export const getRequirementImportContextForUserInternal = internalQuery({
  args: { orgId: v.id("organizations"), userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireAdminWriteActor(
      ctx,
      args.orgId,
      args.userId,
      "Only an organization admin can import compliance requirements.",
    );
    const existing = await listRequirementsForOrg(ctx, args.orgId);
    return {
      userId: args.userId,
      existingRequirements: existing.map((requirement) => ({
        kind: requirement.kind,
        scope: requirement.scope,
        title: requirement.title,
        requirementText: requirement.requirementText,
        lineOfBusiness: requirement.lineOfBusiness,
        conditionType: requirement.conditionType,
        limits: requirement.limits,
        maxDeductible: requirement.maxDeductible,
        coverageForm: requirement.coverageForm,
        retroactiveDateOnOrBefore: requirement.retroactiveDateOnOrBefore,
        provisions: requirement.provisions,
        requiredForms: requirement.requiredForms,
      })),
    };
  },
});

export const createRequirementSourceDocumentInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    extractionRunId: v.optional(v.string()),
    fileId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    contentType: v.optional(v.string()),
    sourceType: sourceDocumentTypeValidator,
    title: v.string(),
    sourceTextExcerpt: v.optional(v.string()),
    parserBackend: v.optional(
      v.union(
        v.literal("liteparse"),
        v.literal("pdfjs"),
        v.literal("mammoth"),
        v.literal("plain_text"),
      ),
    ),
    parsedAt: v.optional(v.number()),
    holder: v.optional(requirementSourceHolderValidator),
    holders: v.optional(v.array(requirementSourceHolderValidator)),
    dealName: v.optional(v.string()),
    dealType: v.optional(v.string()),
    internalNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdminWriteActor(
      ctx,
      args.orgId,
      args.userId,
      "Admin role required",
    );
    const now = dayjs().valueOf();
    const holderInputs = [
      ...(args.holder ? [args.holder] : []),
      ...(args.holders ?? []),
    ];
    const certificateHolderIds: Id<"certificateHolders">[] = [];
    for (const [index, holder] of holderInputs.entries()) {
      const holderName = holder.displayName.trim();
      if (!holderName) continue;
      const holderId = await upsertCertificateHolder(ctx, {
        orgId: args.orgId,
        displayName: holderName,
        contactName: holder.contactName,
        email: holder.email,
        phone: holder.phone,
        address: holder.address,
        source: index === 0 && args.holder ? "agent" : "extraction",
        sourceRef: args.title,
        createdByUserId: args.userId,
        updatedByUserId: args.userId,
      });
      if (
        !certificateHolderIds.some(
          (candidate) => String(candidate) === String(holderId),
        )
      ) {
        certificateHolderIds.push(holderId);
      }
    }
    const sourceDocumentId = await ctx.db.insert("requirementSourceDocuments", {
      orgId: args.orgId,
      extractionRunId: args.extractionRunId,
      certificateHolderIds:
        certificateHolderIds.length > 0 ? certificateHolderIds : undefined,
      dealName: cleanOptionalString(args.dealName),
      dealType: cleanOptionalString(args.dealType),
      fileId: args.fileId,
      fileName: args.fileName,
      contentType: args.contentType,
      sourceType: args.sourceType,
      title: args.title.trim() || args.fileName || "Requirement source",
      sourceTextExcerpt: args.sourceTextExcerpt?.trim() || undefined,
      parserBackend: args.parserBackend,
      parsedAt: args.parsedAt,
      status: "complete",
      createdByUserId: args.userId,
      createdAt: now,
      updatedAt: now,
    });
    if (args.internalNotes !== undefined) {
      const source = await ctx.db.get(sourceDocumentId);
      if (source) await saveRequirementNotes(ctx, source, args.internalNotes, { actorUserId: args.userId });
    }
    return sourceDocumentId;
  },
});

export const createRequirementsInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    sourceDocumentId: v.optional(v.id("requirementSourceDocuments")),
    sourceDocumentName: v.optional(v.string()),
    sourceType: v.optional(requirementSourceTypeValidator),
    requirements: v.array(
      v.object({
        kind: requirementKindValidator,
        scope: requirementScopeValidator,
        title: v.string(),
        requirementText: v.string(),
        lineOfBusiness: v.optional(v.string()),
        limits: v.optional(v.array(limitValidator)),
        maxDeductible: v.optional(deductibleValidator),
        coverageForm: v.optional(coverageFormValidator),
        retroactiveDateOnOrBefore: v.optional(v.string()),
        provisions: v.optional(v.array(v.string())),
        requiredForms: v.optional(v.array(v.string())),
        sourceExcerpt: v.optional(v.string()),
        sourcePageStart: v.optional(v.number()),
        sourcePageEnd: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const access = await requireAdminWriteActor(
      ctx,
      args.orgId,
      args.userId,
      "Admin role required",
    );
    const existing = await listRequirementsForOrg(ctx, args.orgId);
    const seen = new Set(existing.map(coverageRequirementSemanticKey));
    const now = dayjs().valueOf();
    const ids: Id<"insuranceRequirements">[] = [];
    for (const requirement of args.requirements) {
      const sanitized = sanitizeRequirementArgs(requirement);
      const key = coverageRequirementSemanticKey(sanitized);
      if (seen.has(key)) continue;
      seen.add(key);
      ids.push(
        await ctx.db.insert("insuranceRequirements", {
          orgId: args.orgId,
          ...sanitized,
          sourceDocumentId: args.sourceDocumentId,
          sourceDocumentName: args.sourceDocumentName?.trim() || undefined,
          sourceType: args.sourceType ?? "bulk_import",
          sourceExcerpt:
            requirement.sourceExcerpt?.trim() || sanitized.requirementText,
          sourcePageStart: requirement.sourcePageStart,
          sourcePageEnd: requirement.sourcePageEnd,
          status: "active",
          createdByUserId: args.userId,
          updatedByUserId: args.userId,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
    await writeComplianceOperatorAudit(
      ctx,
      access,
      args.orgId,
      `Imported ${ids.length} compliance requirement${ids.length === 1 ? "" : "s"}`,
      {
        requirementIds: ids,
        sourceDocumentId: args.sourceDocumentId,
      },
    );
    return ids;
  },
});

export const listVendorComplianceInternal = internalQuery({
  args: {
    clientOrgId: v.id("organizations"),
    includePreviewPolicies: v.optional(v.boolean()),
  },
  handler: async (ctx, args) =>
    await vendorComplianceRows(
      ctx,
      args.clientOrgId,
      args.includePreviewPolicies !== false,
    ),
});

export const listClientOrgIdsWithActiveVendorsInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const relationships = await ctx.db
      .query("connectedOrgRelationships")
      .collect();
    return [
      ...new Set(
        relationships
          .filter((relationship) => relationship.status === "active")
          .map((relationship) => relationship.clientOrgId),
      ),
    ];
  },
});

export const getConnectedVendorContactInternal = internalQuery({
  args: {
    clientOrgId: v.id("organizations"),
    vendorOrgId: v.id("organizations"),
    relationshipId: v.id("connectedOrgRelationships"),
  },
  handler: async (ctx, args) => {
    const invitations = await ctx.db
      .query("connectedOrgInvitations")
      .withIndex("client", (q) => q.eq("clientOrgId", args.clientOrgId))
      .collect();
    const invitation = invitations
      .filter(
        (row) =>
          row.relationshipId === args.relationshipId ||
          row.vendorOrgId === args.vendorOrgId,
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("organization", (q) => q.eq("orgId", args.vendorOrgId))
      .collect();
    const vendorUsers = (
      await Promise.all(
        memberships.map((membership) => ctx.db.get(membership.userId)),
      )
    ).filter(Boolean);
    return {
      vendorEmail:
        invitation?.vendorEmail ??
        vendorUsers.find((user) => user?.email)?.email,
      vendorUserEmails: vendorUsers
        .map((user) => user?.email)
        .filter((email): email is string => Boolean(email)),
    };
  },
});

const OWN_COMPLIANCE_REMINDER_MS = 7 * 24 * 60 * 60 * 1000;

function isOwnComplianceIssue(status: Doc<"complianceChecks">["status"]) {
  return (
    status === "not_met" || status === "expiring_soon" || status === "expired"
  );
}

function ownComplianceIssueLine(check: {
  requirementTitle: string;
  status: Doc<"complianceChecks">["status"];
  daysUntilExpiration?: number;
  notes?: string;
}) {
  const status =
    check.status === "expiring_soon" && check.daysUntilExpiration !== undefined
      ? `expires in ${check.daysUntilExpiration} days`
      : check.status.replaceAll("_", " ");
  return `${check.requirementTitle}: ${status}${check.notes ? ` - ${check.notes}` : ""}`;
}

function ownComplianceCheckChanged(
  previous: Doc<"complianceChecks">,
  check: {
    status: Doc<"complianceChecks">["status"];
    reasons?: string[];
    matchedPolicyIds: Id<"policies">[];
    matchedSummary?: string;
    notes?: string;
    expiresAt?: string;
  },
) {
  const previousPolicyIds = previous.matchedPolicyIds
    .map(String)
    .sort()
    .join("|");
  const nextPolicyIds = check.matchedPolicyIds.map(String).sort().join("|");
  return (
    previous.status !== check.status ||
    (previous.reasons ?? []).join("|") !== (check.reasons ?? []).join("|") ||
    previousPolicyIds !== nextPolicyIds ||
    previous.matchedSummary !== (check.matchedSummary ?? check.notes) ||
    previous.expiresAt !== check.expiresAt
  );
}

export const recordOwnComplianceRunInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    checks: v.array(complianceMonitorCheckValidator),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<OwnComplianceEvent[]> => {
    const now = args.nowMs ?? dayjs().valueOf();
    const org = await ctx.db.get(args.orgId);
    const previousByRequirement = new Map<
      Id<"insuranceRequirements">,
      Doc<"complianceChecks"> | null
    >();

    for (const check of args.checks) {
      const latest = await ctx.db
        .query("complianceChecks")
        .withIndex("review_history", (query) =>
          query
            .eq("requirementId", check.requirementId)
            .eq("subjectOrgId", args.orgId)
            .eq("checkedBy", "system"),
        )
        .order("desc")
        .first();
      previousByRequirement.set(check.requirementId, latest ?? null);
    }

    const currentIssues = args.checks.filter((check) =>
      isOwnComplianceIssue(check.status),
    );
    const emitGap = currentIssues.some((check) => {
      const previous = previousByRequirement.get(check.requirementId);
      return (
        !previous ||
        previous.status !== check.status ||
        previous.alertedAt === undefined ||
        now - previous.alertedAt >= OWN_COMPLIANCE_REMINDER_MS
      );
    });
    const resolvedChecks = args.checks.filter((check) => {
      const previous = previousByRequirement.get(check.requirementId);
      return (
        check.status === "met" &&
        Boolean(previous && isOwnComplianceIssue(previous.status))
      );
    });
    const emitResolved =
      currentIssues.length === 0 && resolvedChecks.length > 0;
    const resolvedRequirementIds = new Set(
      resolvedChecks.map((check) => check.requirementId),
    );

    for (const check of args.checks) {
      const previous = previousByRequirement.get(check.requirementId);
      const issueIncludedInAlert =
        emitGap && isOwnComplianceIssue(check.status);
      const resolvedIncludedInAlert =
        emitResolved && resolvedRequirementIds.has(check.requirementId);
      if (
        previous &&
        !ownComplianceCheckChanged(previous, check) &&
        !issueIncludedInAlert &&
        !resolvedIncludedInAlert
      ) {
        continue;
      }
      let alertedAt =
        previous?.status === check.status ? previous.alertedAt : undefined;
      if (issueIncludedInAlert || resolvedIncludedInAlert) alertedAt = now;
      await ctx.db.insert("complianceChecks", {
        orgId: args.orgId,
        requirementId: check.requirementId,
        subjectOrgId: args.orgId,
        status: check.status,
        reasons: check.reasons,
        matchedPolicyIds: check.matchedPolicyIds,
        matchedSummary: check.matchedSummary ?? check.notes,
        expiresAt: check.expiresAt,
        checkedAt: now,
        alertedAt,
        checkedBy: "system",
      });
    }

    const orgName = org?.name ?? "Your organization";
    if (emitGap) {
      const issueLines = currentIssues.map(ownComplianceIssueLine);
      const hasExpired = currentIssues.some(
        (check) => check.status === "expired",
      );
      const issueCount = currentIssues.length;
      return [
        {
          type: "own_compliance_gap",
          title: hasExpired
            ? "Your insurance has expired coverage"
            : "Your insurance has compliance gaps",
          body: `${issueCount} ${issueCount === 1 ? "requirement needs" : "requirements need"} attention for ${orgName}: ${issueLines.slice(0, 3).join("; ")}${issueLines.length > 3 ? `; +${issueLines.length - 3} more` : ""}`,
          severity: hasExpired ? "critical" : "warning",
          orgId: args.orgId,
          orgName,
          requirementIds: currentIssues.map((check) => check.requirementId),
          issueLines,
        },
      ];
    }

    if (emitResolved) {
      const resolvedTitles = resolvedChecks.map(
        (check) => check.requirementTitle,
      );
      return [
        {
          type: "own_compliance_resolved",
          title: "Your insurance requirements are now met",
          body: `${orgName} now meets all ${args.checks.length} active insurance requirements in Spot.`,
          severity: "info",
          orgId: args.orgId,
          orgName,
          requirementIds: resolvedChecks.map((check) => check.requirementId),
          issueLines: resolvedTitles,
        },
      ];
    }

    return [];
  },
});

export const notifyOwnComplianceEventInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    type: v.union(
      v.literal("own_compliance_gap"),
      v.literal("own_compliance_resolved"),
    ),
    title: v.string(),
    body: v.string(),
    severity: v.union(
      v.literal("info"),
      v.literal("warning"),
      v.literal("critical"),
    ),
    threadId: v.id("threads"),
    requirementIds: v.array(v.id("insuranceRequirements")),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) =>
    await notify(ctx, {
      orgId: args.orgId,
      type: args.type,
      title: args.title,
      body: args.body,
      severity: args.severity,
      actionType: "view_thread",
      actionPayload: { threadId: args.threadId },
      sourceRef: {
        threadId: args.threadId,
        requirementIds: args.requirementIds,
      },
      coalesceKeyParts: [args.type, String(args.orgId)],
      nowMs: args.nowMs,
    }),
});

export const recordVendorComplianceRunInternal = internalMutation({
  args: {
    clientOrgId: v.id("organizations"),
    rows: v.array(vendorComplianceMonitorRowValidator),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.nowMs ?? dayjs().valueOf();
    const reminderWindowMs = 7 * 24 * 60 * 60 * 1000;
    const clientOrg = await ctx.db.get(args.clientOrgId);
    const events: Array<{
      type:
        | "vendor_compliance_met"
        | "vendor_compliance_gap"
        | "vendor_policy_expiring"
        | "vendor_policy_expired";
      title: string;
      body: string;
      severity: "info" | "warning" | "critical";
      clientOrgId: Id<"organizations">;
      clientName: string;
      vendorOrgId: Id<"organizations">;
      vendorName: string;
      relationshipId: Id<"connectedOrgRelationships">;
      issueLines: string[];
    }> = [];

    for (const row of args.rows) {
      const previousSnapshots = await ctx.db
        .query("complianceChecks")
        .withIndex("relationship", (q) =>
          q.eq("relationshipId", row.relationshipId),
        )
        .collect();
      const latestByRequirement = new Map<
        Id<"insuranceRequirements">,
        Doc<"complianceChecks">
      >();
      for (const snapshot of previousSnapshots) {
        const current = latestByRequirement.get(snapshot.requirementId);
        if (!current || snapshot.checkedAt > current.checkedAt) {
          latestByRequirement.set(snapshot.requirementId, snapshot);
        }
      }
      const issueChecks = row.checks.filter(
        (check) =>
          check.status === "not_met" ||
          check.status === "expired" ||
          check.status === "expiring_soon",
      );
      const alertableIssueChecks = issueChecks.filter((check) => {
        const latest = latestByRequirement.get(check.requirementId);
        return (
          !latest ||
          latest.status !== check.status ||
          now - latest.checkedAt >= reminderWindowMs
        );
      });
      const previousHadIssue = [...latestByRequirement.values()].some(
        (snapshot) =>
          snapshot.status === "not_met" ||
          snapshot.status === "expired" ||
          snapshot.status === "expiring_soon",
      );
      const currentIsCompliant =
        row.requirementCount > 0 &&
        row.checks.length > 0 &&
        row.checks.every((check) => check.status === "met");

      for (const check of row.checks) {
        await ctx.db.insert("complianceChecks", {
          orgId: args.clientOrgId,
          requirementId: check.requirementId,
          subjectOrgId: row.vendorOrgId,
          relationshipId: row.relationshipId,
          status: check.status,
          reasons: check.reasons,
          matchedPolicyIds: check.matchedPolicyIds,
          matchedSummary: check.matchedSummary ?? check.notes,
          expiresAt: check.expiresAt,
          checkedAt: now,
          checkedBy: "system",
        });
      }

      if (currentIsCompliant && previousHadIssue) {
        events.push({
          type: "vendor_compliance_met",
          title: `${row.vendorName} is now vendor compliant`,
          body: `${row.vendorName} now meets all ${row.requirementCount} vendor requirements for ${clientOrg?.name ?? "your organization"}.`,
          severity: "info",
          clientOrgId: args.clientOrgId,
          clientName: clientOrg?.name ?? "your organization",
          vendorOrgId: row.vendorOrgId,
          vendorName: row.vendorName,
          relationshipId: row.relationshipId,
          issueLines: [],
        });
        continue;
      }
      if (alertableIssueChecks.length === 0) continue;
      const hasExpired = alertableIssueChecks.some(
        (check) => check.status === "expired",
      );
      const hasGap = alertableIssueChecks.some(
        (check) => check.status === "not_met",
      );
      const type = hasExpired
        ? "vendor_policy_expired"
        : hasGap
          ? "vendor_compliance_gap"
          : "vendor_policy_expiring";
      const severity = hasExpired ? "critical" : "warning";
      const issueLines = alertableIssueChecks.map((check) => {
        const status =
          check.status === "expiring_soon" &&
          check.daysUntilExpiration !== undefined
            ? `expires in ${check.daysUntilExpiration} days`
            : check.status.replace(/_/g, " ");
        return `${check.requirementTitle}: ${status}${check.notes ? ` - ${check.notes}` : ""}`;
      });
      const issueCount = alertableIssueChecks.length;
      const noun = issueCount === 1 ? "requirement needs" : "requirements need";
      const title =
        row.policyCount === 0
          ? `${row.vendorName} is waiting on policies`
          : type === "vendor_policy_expired"
            ? `${row.vendorName} has expired vendor coverage`
            : type === "vendor_policy_expiring"
              ? `${row.vendorName} has vendor coverage expiring soon`
              : `${row.vendorName} is missing vendor requirements`;
      const body = `${issueCount} vendor ${noun} attention for ${row.vendorName}: ${issueLines
        .slice(0, 3)
        .join(
          "; ",
        )}${issueLines.length > 3 ? `; +${issueLines.length - 3} more` : ""}`;
      events.push({
        type,
        title,
        body,
        severity,
        clientOrgId: args.clientOrgId,
        clientName: clientOrg?.name ?? "your organization",
        vendorOrgId: row.vendorOrgId,
        vendorName: row.vendorName,
        relationshipId: row.relationshipId,
        issueLines,
      });
    }
    return events;
  },
});

export const notifyVendorComplianceEventInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    vendorOrgId: v.id("organizations"),
    relationshipId: v.id("connectedOrgRelationships"),
    type: v.union(
      v.literal("vendor_compliance_met"),
      v.literal("vendor_compliance_gap"),
      v.literal("vendor_policy_expiring"),
      v.literal("vendor_policy_expired"),
    ),
    title: v.string(),
    body: v.string(),
    severity: v.union(
      v.literal("info"),
      v.literal("warning"),
      v.literal("critical"),
    ),
    actionType: notificationActionTypeValidator,
    actionPayload: notificationActionPayloadValidator,
    sourceRef: v.optional(notificationSourceRefValidator),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) =>
    await notify(ctx, {
      orgId: args.orgId,
      type: args.type,
      title: args.title,
      body: args.body,
      severity: args.severity,
      relatedOrgId: args.vendorOrgId,
      actionType: args.actionType,
      actionPayload: args.actionPayload,
      sourceRef: args.sourceRef,
      coalesceKeyParts: [
        args.type,
        String(args.orgId),
        String(args.relationshipId),
      ],
      nowMs: args.nowMs,
    }),
});
