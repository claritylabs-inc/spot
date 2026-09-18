import dayjs from "dayjs";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { throwUserFacingError, userFacingErrorCodes } from "./userFacingErrors";
import { parseStandaloneEmailAddress } from "./emailAddress";

type Ctx = QueryCtx | MutationCtx;

export type OperatorRole = "operator" | "owner";

export function normalizeOperatorEmail(email: string | undefined | null) {
  return (email ?? "").trim().toLowerCase();
}

export const OPERATOR_EMAIL_DOMAINS = [
  "toolsforenlightenment.org",
  "spot.insure",
  "claritylabs.inc",
] as const;

export function operatorEmailAliases(email: string | undefined | null) {
  const normalized = normalizeOperatorEmail(email);
  const parts = normalized.split("@");
  if (
    parts.length !== 2 ||
    parseStandaloneEmailAddress(normalized) !== normalized
  )
    return [];
  return OPERATOR_EMAIL_DOMAINS.some((domain) => domain === parts[1])
    ? OPERATOR_EMAIL_DOMAINS.map((domain) => `${parts[0]}@${domain}`)
    : [];
}

export function isOperatorDomainEmail(email: string | undefined | null) {
  return operatorEmailAliases(email).length > 0;
}

export function isReservedOperatorEmail(email: string | undefined | null) {
  return operatorEmailAliases(email).includes("operator@spot.insure");
}

// Include all identity owners, not only active operators: a disabled profile or
// customer account must never be bypassed by signing in through another domain.
export async function operatorEmailIdentityUsers(ctx: Ctx, email: string) {
  const aliases = operatorEmailAliases(email);
  if (!aliases.length) return [];
  const ready = await ctx.db
    .query("operatorEmailIdentityBackfill")
    .withIndex("key", (q) => q.eq("key", "legacy"))
    .unique();
  if (!ready) {
    throwUserFacingError(
      userFacingErrorCodes.operatorRequired,
      "Operator email identity setup is still in progress.",
    );
  }
  const userIds = new Set<Id<"users">>();
  for (const alias of aliases) {
    const [users, profiles, accounts, legacyIdentities] = await Promise.all([
      ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", alias))
        .take(2),
      ctx.db
        .query("operatorProfiles")
        .withIndex("email", (q) => q.eq("email", alias))
        .take(2),
      ctx.db
        .query("authAccounts")
        .withIndex("providerAndAccountId", (q) =>
          q.eq("provider", "resend-otp").eq("providerAccountId", alias),
        )
        .take(2),
      ctx.db
        .query("operatorEmailIdentities")
        .withIndex("email", (q) => q.eq("email", alias))
        .take(2),
    ]);
    for (const user of users) userIds.add(user._id);
    for (const record of [...profiles, ...accounts, ...legacyIdentities])
      userIds.add(record.userId);
  }
  return [...userIds];
}

// Retain legacy mailbox ownership without rewriting canonical addresses or
// framework-owned auth accounts. These reservations are never reassigned by login.
export async function reserveLegacyOperatorEmailIdentity(
  ctx: MutationCtx,
  email: string | undefined,
  userId: Id<"users">,
) {
  const normalized = normalizeOperatorEmail(email);
  if (!isOperatorDomainEmail(normalized) || email === normalized) return;
  const existing = await ctx.db
    .query("operatorEmailIdentities")
    .withIndex("email_user", (q) =>
      q.eq("email", normalized).eq("userId", userId),
    )
    .unique();
  if (!existing) {
    await ctx.db.insert("operatorEmailIdentities", {
      email: normalized,
      userId,
    });
  }
}

export function operatorBootstrapEmails() {
  return new Set(
    (process.env.OPERATOR_BOOTSTRAP_EMAILS ?? "")
      .split(/[,\s]+/)
      .map((email) => normalizeOperatorEmail(email))
      .filter(Boolean),
  );
}

export function isBootstrapOperatorEmail(email: string | undefined | null) {
  const normalized = normalizeOperatorEmail(email);
  return (
    !!normalized &&
    (isOperatorDomainEmail(normalized) ||
      operatorBootstrapEmails().has(normalized))
  );
}

function operatorOwnerEmails() {
  return new Set(
    (process.env.OPERATOR_OWNER_EMAILS ?? "")
      .split(/[,\s]+/)
      .map((email) => normalizeOperatorEmail(email))
      .filter(Boolean),
  );
}

function roleForBootstrapEmail(email: string): "operator" | "owner" {
  const owners = operatorOwnerEmails();
  if (owners.has(email)) return "owner";
  return "operator";
}

export async function bootstrapOperatorUser(
  ctx: MutationCtx,
  userId: Id<"users">,
) {
  const user = await ctx.db.get(userId);
  const email = normalizeOperatorEmail(user?.email);
  if (!user || !email || isReservedOperatorEmail(email)) {
    throwUserFacingError(
      userFacingErrorCodes.operatorRequired,
      "This account is not authorized for Spot operator access.",
    );
  }

  const identityUsers = await operatorEmailIdentityUsers(ctx, email);
  if (identityUsers.some((candidate) => candidate !== userId)) {
    throwUserFacingError(
      userFacingErrorCodes.operatorRequired,
      "Operator email identities conflict. Contact an operator owner to resolve the existing accounts.",
    );
  }

  const memberships = await ctx.db
    .query("orgMemberships")
    .withIndex("user", (q) => q.eq("userId", userId))
    .first();
  if (memberships) {
    throwUserFacingError(
      userFacingErrorCodes.operatorRequired,
      "Customer organization accounts cannot be converted into operator accounts.",
    );
  }

  const profiles = await ctx.db
    .query("operatorProfiles")
    .withIndex("user", (q) => q.eq("userId", userId))
    .take(2);
  if (profiles.length) {
    const profile = profiles[0];
    if (
      profiles.length !== 1 ||
      user.accountKind !== "operator" ||
      user.isAnonymous ||
      user.serviceAccountKind ||
      profile.status !== "active" ||
      normalizeOperatorEmail(profile.email) !== email
    ) {
      throwUserFacingError(userFacingErrorCodes.operatorRequired);
    }
    // Login acknowledges existing access; allowlists cannot change its role
    // or restore a disabled profile.
    return { ok: true, role: profile.role };
  }
  if (
    user.accountKind === "operator" ||
    user.accountKind === "customer" ||
    user.isAnonymous ||
    user.serviceAccountKind ||
    user.emailVerificationTime === undefined ||
    !isBootstrapOperatorEmail(email)
  ) {
    throwUserFacingError(userFacingErrorCodes.operatorRequired);
  }
  const now = dayjs().valueOf();
  const role = roleForBootstrapEmail(email);
  await ctx.db.patch(userId, {
    accountKind: "operator",
    onboardingComplete: true,
  });
  await ctx.db.insert("operatorProfiles", {
    userId,
    email,
    role,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await writeOperatorAudit(ctx, {
    operatorUserId: userId,
    type: "operator_bootstrap",
    summary: `Operator account bootstrapped for ${email}`,
  });
  return { ok: true, role };
}

export async function assertCustomerUser(
  ctx: Ctx,
  userId: Id<"users">,
  message = "Operator accounts cannot join customer organizations",
) {
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("User not found");
  if (user.accountKind === "operator" || isBootstrapOperatorEmail(user.email)) {
    throwUserFacingError(userFacingErrorCodes.orgAccessRequired, message);
  }
  return user;
}

export async function assertCustomerEmail(
  email: string,
  message = "Operator emails cannot be used for customer accounts",
) {
  if (isBootstrapOperatorEmail(email)) {
    throwUserFacingError(userFacingErrorCodes.orgAccessRequired, message);
  }
}

type ActiveOperator = {
  userId: Id<"users">;
  user: Doc<"users">;
  profile: Doc<"operatorProfiles">;
};

async function activeOperatorForUser(
  ctx: Ctx,
  userId: Id<"users">,
): Promise<ActiveOperator | null> {
  const [user, profiles] = await Promise.all([
    ctx.db.get(userId),
    ctx.db
      .query("operatorProfiles")
      .withIndex("user", (q) => q.eq("userId", userId))
      .take(2),
  ]);
  if (!user || user.accountKind !== "operator") return null;
  if (user.isAnonymous || user.serviceAccountKind) return null;
  if (profiles.length !== 1 || profiles[0].status !== "active") return null;
  return { userId, user, profile: profiles[0] };
}

export async function resolveActiveOperatorEmail(
  ctx: Ctx,
  email: string,
): Promise<ActiveOperator | null> {
  if (!isOperatorDomainEmail(email) || isReservedOperatorEmail(email))
    return null;
  const userIds = await operatorEmailIdentityUsers(ctx, email);
  if (userIds.length !== 1) return null;
  const operator = await activeOperatorForUser(ctx, userIds[0]);
  if (
    !operator ||
    !operatorEmailAliases(email).includes(
      normalizeOperatorEmail(operator.user.email),
    )
  )
    return null;
  const membership = await ctx.db
    .query("orgMemberships")
    .withIndex("user", (q) => q.eq("userId", operator.userId))
    .first();
  return membership ? null : operator;
}

export async function getActiveOperatorProfile(
  ctx: Ctx,
): Promise<ActiveOperator | null> {
  const userId = await getAuthUserId(ctx);
  return userId ? activeOperatorForUser(ctx, userId) : null;
}

export async function requireOperator(ctx: Ctx) {
  const operator = await getActiveOperatorProfile(ctx);
  if (!operator) throwUserFacingError(userFacingErrorCodes.operatorRequired);
  return operator;
}

export async function requireOperatorForUser(ctx: Ctx, userId: Id<"users">) {
  const operator = await activeOperatorForUser(ctx, userId);
  if (!operator) throwUserFacingError(userFacingErrorCodes.operatorRequired);
  return operator;
}

export async function requireOperatorOwner(ctx: Ctx) {
  const operator = await requireOperator(ctx);
  if (operator.profile.role !== "owner") {
    throwUserFacingError(userFacingErrorCodes.operatorOwnerRequired);
  }
  return operator;
}

export async function writeOperatorAudit(
  ctx: MutationCtx,
  args: {
    type:
      | "employee_provisioned"
      | "operator_bootstrap"
      | "broker_created"
      | "broker_status_changed"
      | "broker_launch_email_sent"
      | "client_created"
      | "client_status_changed"
      | "client_launch_email_sent"
      | "impersonation_started"
      | "impersonation_stopped"
      | "impersonation_chat_message"
      | "demo_lead_deleted"
      | "memory_cleared"
      | "setup_write";
    targetOrgId?: Id<"organizations">;
    targetUserId?: Id<"users">;
    summary: string;
    metadata?: unknown;
  } & (
    | { operatorUserId: Id<"users">; serviceActor?: never }
    | {
        operatorUserId?: never;
        serviceActor: "central_employee_provisioning";
        type: "employee_provisioned";
      }
  ),
) {
  const metadata =
    args.metadata && typeof args.metadata === "object"
      ? (args.metadata as Record<string, unknown>)
      : null;
  const requestId =
    typeof metadata?.requestId === "string"
      ? (ctx.db.normalizeId("procurementRequests", metadata.requestId) ??
        undefined)
      : undefined;
  return await ctx.db.insert("operatorAuditEvents", {
    operatorUserId: args.operatorUserId,
    serviceActor: args.serviceActor,
    type: args.type,
    targetOrgId: args.targetOrgId,
    targetUserId: args.targetUserId,
    requestId,
    summary: args.summary,
    metadata: args.metadata,
    createdAt: dayjs().valueOf(),
  });
}

export async function getActiveOperatorImpersonation(ctx: Ctx) {
  const operator = await getActiveOperatorProfile(ctx);
  if (!operator) return null;
  const session = await ctx.db
    .query("operatorImpersonationSessions")
    .withIndex("operator_status", (q) =>
      q.eq("operatorUserId", operator.userId).eq("status", "active"),
    )
    .first();
  if (!session) return null;
  const targetOrg = await ctx.db.get(session.targetOrgId);
  if (!targetOrg || targetOrg.deletedAt !== undefined) return null;
  return { operator, session, targetOrg };
}

export async function assertImpersonatedSetupWrite(
  ctx: Ctx,
  orgId: Id<"organizations">,
) {
  const active = await getActiveOperatorImpersonation(ctx);
  if (!active) return null;

  if (
    active.targetOrg._id !== orgId ||
    (active.targetOrg.operatorStatus ?? "live") !== "onboarding"
  ) {
    throwUserFacingError(userFacingErrorCodes.impersonationReadOnly);
  }
  return active;
}
