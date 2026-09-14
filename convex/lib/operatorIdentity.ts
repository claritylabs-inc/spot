import dayjs from "dayjs";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { throwUserFacingError, userFacingErrorCodes } from "./userFacingErrors";

type Ctx = QueryCtx | MutationCtx;

export type OperatorRole = "operator" | "owner";

export function normalizeOperatorEmail(email: string | undefined | null) {
  return (email ?? "").trim().toLowerCase();
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
  return !!normalized && operatorBootstrapEmails().has(normalized);
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
  const [user, profile] = await Promise.all([
    ctx.db.get(userId),
    ctx.db
      .query("operatorProfiles")
      .withIndex("user", (q) => q.eq("userId", userId))
      .first(),
  ]);
  if (!user || user.accountKind !== "operator") return null;
  if (!profile || profile.status !== "active") return null;
  return { userId, user, profile };
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
    | { operatorUserId?: never; serviceActor: "central_employee_provisioning"; type: "employee_provisioned" }
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
  if (!targetOrg) return null;
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
