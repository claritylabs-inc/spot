// convex/lib/access.ts
//
// Organization permission layer for Spot.
// Every public Convex function that takes an orgId calls getOrgAccess()
// then one or more assertCan* helpers before touching any data.

import { getAuthUserId } from "@convex-dev/auth/server";
import { QueryCtx, MutationCtx } from "../_generated/server";
import { Id, Doc } from "../_generated/dataModel";
import {
  assertImpersonatedSetupWrite,
  getActiveOperatorImpersonation,
  getActiveOperatorProfile,
} from "./operatorIdentity";
import {
  isUserFacingErrorCode,
  throwUserFacingError,
  userFacingErrorCodes,
} from "./userFacingErrors";

type Ctx = QueryCtx | MutationCtx;
type OrgAccessOptions = { allowOperator?: boolean };

export type OrgAccess = {
  userId: Id<"users">;
  org: Doc<"organizations">;
  orgType: "broker" | "client" | "partner";
  accessType: "member" | "connected_client" | "operator";
  role: "admin" | "member" | undefined;
  connectedClientOrgId?: Id<"organizations">;
};

export type CurrentOrgAccess = OrgAccess & {
  orgId: Id<"organizations">;
  accessType: "member";
  role: "admin" | "member";
};

type PolicyWithOrg = Doc<"policies"> & { orgId: Id<"organizations"> };
type PolicyAccessForQuery = { policy: PolicyWithOrg; access: OrgAccess };

function policyHasOrg(policy: Doc<"policies"> | null): policy is PolicyWithOrg {
  return !!policy?.orgId;
}

// ── Auth primitive ──────────────────────────────────────────────────────────

/** Require an authenticated session. Throws if not logged in. */
export async function requireAuth(ctx: Ctx): Promise<{ userId: Id<"users"> }> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
  return { userId };
}

// ── Core access resolver ────────────────────────────────────────────────────

/**
 * Resolve the calling user's access to `orgId`.
 *
 * Resolution order:
 * 1. Direct org membership       → accessType = "member"
 * 2. Opted-in active operator    → accessType = "operator"
 *    (explicit org-scoped support surfaces only; never current membership)
 * 3. No access                   → throws "Unauthorized"
 */
export async function getOrgAccess(
  ctx: Ctx,
  orgId: Id<"organizations">,
  options: OrgAccessOptions = {},
): Promise<OrgAccess> {
  const { userId } = await requireAuth(ctx);

  const org = await ctx.db.get(orgId);
  if (!org) throw new Error("Organization not found");

  const orgType: "broker" | "client" | "partner" =
    (org.type as "broker" | "client" | "partner") ?? "client";

  const impersonation = await getActiveOperatorImpersonation(ctx);
  if (impersonation) {
    if (impersonation.session.targetOrgId === orgId) {
      return {
        userId,
        org,
        orgType,
        accessType: "member",
        role: impersonation.session.targetRole,
      };
    }
  }

  // 1. Direct membership
  const membership = await ctx.db
    .query("orgMemberships")
    .withIndex("organization_user", (q) =>
      q.eq("orgId", orgId).eq("userId", userId),
    )
    .first();

  if (membership) {
    return {
      userId,
      org,
      orgType,
      accessType: "member",
      role: membership.role,
    };
  }

  // 2. Direct operator support access. Callers must explicitly opt in, and
  // active impersonation is resolved above so a live impersonation keeps its
  // existing read-only write gates. This branch is intentionally distinct from
  // membership.
  const operator = options.allowOperator
    ? await getActiveOperatorProfile(ctx)
    : null;
  if (operator && !impersonation) {
    return {
      userId,
      org,
      orgType,
      accessType: "operator",
      role: undefined,
    };
  }

  // 3. Connected client/vendor access: org members of a client/customer org
  // can read an approved vendor's selected insurance data. This is intentionally
  // one-hop and read-only; vendor access does not imply access to any vendors of
  // that vendor or to its broker portal capabilities.
  const activeRelationships = await ctx.db
    .query("connectedOrgRelationships")
    .withIndex("vendor_status", (q) =>
      q.eq("vendorOrgId", orgId).eq("status", "active"),
    )
    .collect();

  for (const relationship of activeRelationships) {
    const clientMembership = await ctx.db
      .query("orgMemberships")
      .withIndex("organization_user", (q) =>
        q.eq("orgId", relationship.clientOrgId).eq("userId", userId),
      )
      .first();
    if (clientMembership) {
      return {
        userId,
        org,
        orgType,
        accessType: "connected_client",
        role: undefined,
        connectedClientOrgId: relationship.clientOrgId,
      };
    }
  }

  throwUserFacingError(userFacingErrorCodes.orgAccessRequired);
}

function errorHasMessage(error: unknown, message: string) {
  return error instanceof Error && error.message === message;
}

async function shouldSuppressOperatorTeardownUnauthorized(
  ctx: Ctx,
  error: unknown,
) {
  if (
    !isUserFacingErrorCode(error, userFacingErrorCodes.orgAccessRequired) &&
    !errorHasMessage(error, "Unauthorized")
  ) {
    return false;
  }
  const [operator, impersonation] = await Promise.all([
    getActiveOperatorProfile(ctx),
    getActiveOperatorImpersonation(ctx),
  ]);
  return !!operator && !impersonation;
}

export async function getOrgAccessForQuery(
  ctx: Ctx,
  orgId: Id<"organizations">,
  options: OrgAccessOptions = {},
): Promise<OrgAccess | null> {
  try {
    return await getOrgAccess(ctx, orgId, options);
  } catch (error) {
    if (await shouldSuppressOperatorTeardownUnauthorized(ctx, error))
      return null;
    throw error;
  }
}

function toCurrentOrgAccess(access: OrgAccess): CurrentOrgAccess {
  if (access.accessType !== "member" || !access.role) {
    throwUserFacingError(
      userFacingErrorCodes.orgAccessRequired,
      "You need an organization membership to access this workspace.",
    );
  }
  return {
    ...access,
    orgId: access.org._id,
    accessType: "member",
    role: access.role,
  };
}

async function getFirstOrgMembershipForUser(ctx: Ctx, userId: Id<"users">) {
  return await ctx.db
    .query("orgMemberships")
    .withIndex("user", (q) => q.eq("userId", userId))
    .first();
}

async function resolveCurrentOrgAccess(
  ctx: Ctx,
  userId: Id<"users">,
  options: { requireMembership: boolean },
): Promise<CurrentOrgAccess | null> {
  const impersonation = await getActiveOperatorImpersonation(ctx);
  if (impersonation) {
    return toCurrentOrgAccess(
      await getOrgAccess(ctx, impersonation.session.targetOrgId),
    );
  }

  const membership = await getFirstOrgMembershipForUser(ctx, userId);
  if (!membership) {
    if (options.requireMembership) {
      throwUserFacingError(
        userFacingErrorCodes.orgAccessRequired,
        "You need an organization membership to access this workspace.",
      );
    }
    return null;
  }

  try {
    return toCurrentOrgAccess(await getOrgAccess(ctx, membership.orgId));
  } catch (error) {
    if (
      !options.requireMembership &&
      errorHasMessage(error, "Organization not found")
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * Resolve the viewer's current org context.
 *
 * This is the canonical helper for legacy "current org" surfaces that do not
 * take an explicit orgId. Operator impersonation is treated as current direct
 * membership in the impersonated target org.
 */
export async function requireCurrentOrgAccess(
  ctx: Ctx,
): Promise<CurrentOrgAccess> {
  const { userId } = await requireAuth(ctx);
  const access = await resolveCurrentOrgAccess(ctx, userId, {
    requireMembership: true,
  });
  if (!access) {
    throwUserFacingError(
      userFacingErrorCodes.orgAccessRequired,
      "You need an organization membership to access this workspace.",
    );
  }
  return access;
}

/**
 * Non-throwing current-org lookup for query surfaces that can render an empty
 * state while auth or operator impersonation is tearing down.
 */
export async function getCurrentOrgAccess(
  ctx: Ctx,
): Promise<CurrentOrgAccess | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  return await resolveCurrentOrgAccess(ctx, userId, {
    requireMembership: false,
  });
}

export async function requireCurrentOrgAdmin(
  ctx: Ctx,
): Promise<CurrentOrgAccess> {
  const access = await requireCurrentOrgAccess(ctx);
  if (access.role !== "admin") {
    throwUserFacingError(userFacingErrorCodes.orgAdminRequired);
  }
  return access;
}

export async function requireCurrentOrgAdminWrite(
  ctx: MutationCtx,
): Promise<CurrentOrgAccess> {
  const access = await requireCurrentOrgAdmin(ctx);
  await assertImpersonatedSetupWrite(ctx, access.orgId);
  return access;
}

// ── Capability helpers ──────────────────────────────────────────────────────

export function assertClientOrg(access: OrgAccess): void {
  if (access.orgType !== "client") {
    throwUserFacingError(
      userFacingErrorCodes.orgAccessRequired,
      "This action is available only in a client organization.",
    );
  }
}

export function assertCanUseTenantAgent(access: OrgAccess): void {
  if (access.orgType === "broker") {
    throwUserFacingError(
      userFacingErrorCodes.orgAccessRequired,
      "Broker organizations have profile and team access only.",
    );
  }
}

export function assertCanReadPolicies(access: OrgAccess): void {
  if (access.accessType === "member" && access.orgType === "broker") {
    throwUserFacingError(
      userFacingErrorCodes.orgAccessRequired,
      "Broker organizations have profile and team access only.",
    );
  }
}

export function assertCanUploadPolicy(access: OrgAccess): void {
  if (access.accessType !== "operator") {
    throwUserFacingError(
      userFacingErrorCodes.readOnlyAccess,
      "Policy uploads are managed by Spot staff.",
    );
  }
}

export function assertCanEditPolicyExtractedFields(access: OrgAccess): void {
  if (access.accessType === "operator") return;
  throwUserFacingError(
    userFacingErrorCodes.readOnlyAccess,
    "Policy corrections are managed by Spot staff.",
  );
}

export function assertCanArchivePolicy(
  access: OrgAccess,
  policy: {
    uploadedBySide?: string;
  },
): void {
  void policy;
  if (access.accessType !== "operator") {
    throwUserFacingError(
      userFacingErrorCodes.readOnlyAccess,
      "Policy archive changes are managed by Spot staff.",
    );
  }
}

export function assertCanReadPolicy(access: OrgAccess): void {
  assertCanReadPolicies(access);
}

export async function getPolicyAccessForQuery(
  ctx: Ctx,
  policyId: Id<"policies">,
): Promise<PolicyAccessForQuery | null> {
  const result = await resolvePolicyAccessForQuery(ctx, policyId);
  if (!result) return null;
  assertCanReadPolicy(result.access);
  return result;
}

async function resolvePolicyAccessForQuery(
  ctx: Ctx,
  policyId: Id<"policies">,
): Promise<PolicyAccessForQuery | null> {
  const policy = await ctx.db.get(policyId);
  if (!policyHasOrg(policy)) return null;
  const access = await getOrgAccessForQuery(ctx, policy.orgId, {
    allowOperator: true,
  });
  if (!access) return null;
  return { policy, access };
}
