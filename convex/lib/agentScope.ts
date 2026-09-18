import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { throwUserFacingError, userFacingErrorCodes } from "./userFacingErrors";
import type { ActorRef } from "./actorRef";
import { isSlackOperatorClassification } from "./slackInteractions";

type AgentSurface = "web" | "email" | "imessage" | "slack" | "mcp" | "cli";

type AgentScopeOrg = {
  orgId: Id<"organizations">;
  name: string;
  type: "broker" | "client";
  isPrimary: boolean;
  canWrite: boolean;
};

export type AgentScope = {
  mode: "client";
  surface: AgentSurface;
  primaryOrgId: Id<"organizations">;
  readOrgIds: Id<"organizations">[];
  writableOrgIds: Id<"organizations">[];
  orgs: AgentScopeOrg[];
  focusedOrgId?: Id<"organizations">;
  brokerInternal: boolean;
  actorRef?: ActorRef;
  operatorInitiated?: {
    operatorUserId: Id<"users">;
    operatorEmail?: string;
    operatorName?: string;
    impersonationSessionId: Id<"operatorImpersonationSessions">;
    targetOrgId: Id<"organizations">;
    targetOrgName: string;
    targetRole: "admin" | "member";
    displayLabel: string;
    initiatedAt: number;
  };
};

const operatorInitiatedMessageIdArgs = {
  orgId: v.id("organizations"),
  userId: v.id("users"),
  userMessageId: v.id("threadMessages"),
};

function orgName(org: Doc<"organizations">): string {
  return org.name?.trim() || String(org._id);
}

async function validateOperatorInitiatedMessage(
  ctx: QueryCtx,
  args: {
    orgId: Id<"organizations">;
    userId: Id<"users">;
    userMessageId: Id<"threadMessages">;
  },
): Promise<AgentScope["operatorInitiated"] | null> {
  const message = await ctx.db.get(args.userMessageId);
  const operatorInitiated = message?.operatorInitiated;
  if (
    !message ||
    message.role !== "user" ||
    message.orgId !== args.orgId ||
    message.userId !== args.userId ||
    !operatorInitiated ||
    operatorInitiated.operatorUserId !== args.userId ||
    operatorInitiated.targetOrgId !== args.orgId
  ) {
    return null;
  }

  const [operatorUser, operatorProfile, impersonationSession] =
    await Promise.all([
      ctx.db.get(args.userId),
      ctx.db
        .query("operatorProfiles")
        .withIndex("user", (q) => q.eq("userId", args.userId))
        .first(),
      ctx.db.get(operatorInitiated.impersonationSessionId),
    ]);

  if (
    operatorUser?.accountKind !== "operator" ||
    !operatorProfile ||
    operatorProfile.status !== "active" ||
    impersonationSession?.operatorUserId !== args.userId ||
    impersonationSession.targetOrgId !== args.orgId
  ) {
    return null;
  }

  return operatorInitiated;
}

function summarizeOrg(
  org: Doc<"organizations">,
  args: {
    primaryOrgId: Id<"organizations">;
    canWrite: boolean;
  },
): AgentScopeOrg {
  return {
    orgId: org._id,
    name: orgName(org),
    type: (org.type as "broker" | "client") ?? "client",
    isPrimary: org._id === args.primaryOrgId,
    canWrite: args.canWrite,
  };
}

export const resolveForAction = internalQuery({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    surface: v.union(
      v.literal("web"),
      v.literal("email"),
      v.literal("imessage"),
      v.literal("slack"),
      v.literal("mcp"),
      v.literal("cli"),
    ),
    focusedOrgId: v.optional(v.id("organizations")),
    operatorInitiatedUserMessageId: v.optional(v.id("threadMessages")),
    slackActorId: v.optional(v.id("slackActors")),
  },
  handler: async (ctx, args): Promise<AgentScope> => {
    const primaryOrg = await ctx.db.get(args.orgId);
    if (!primaryOrg || primaryOrg.deletedAt !== undefined)
      throw new Error("Organization not found");

    if (args.surface === "slack") {
      if (!args.slackActorId) {
        throwUserFacingError(userFacingErrorCodes.orgAccessRequired);
      }
      const actor = await ctx.db.get(args.slackActorId);
      const connection = actor ? await ctx.db.get(actor.connectionId) : null;
      const settings = actor
        ? await ctx.db
            .query("agentChannelSettings")
            .withIndex("client", (q) => q.eq("clientOrgId", actor.clientOrgId))
            .first()
        : null;
      if (
        !actor ||
        !connection ||
        connection.status !== "active" ||
        connection.clientOrgId !== args.orgId ||
        connection.serviceUserId !== args.userId ||
        (actor.classification !== "customer_member" &&
          !isSlackOperatorClassification(actor.classification)) ||
        settings?.slackEnabled !== true
      ) {
        throwUserFacingError(userFacingErrorCodes.orgAccessRequired);
      }
      return {
        mode: "client",
        surface: "slack",
        primaryOrgId: primaryOrg._id,
        readOrgIds: [primaryOrg._id],
        writableOrgIds: [primaryOrg._id],
        orgs: [
          summarizeOrg(primaryOrg, {
            primaryOrgId: primaryOrg._id,
            canWrite: true,
          }),
        ],
        brokerInternal: false,
        actorRef: {
          kind: "slack",
          actorId: actor._id,
          teamId: actor.teamId,
          userId: actor.slackUserId,
        },
      };
    }

    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("organization_user", (q) =>
        q.eq("orgId", args.orgId).eq("userId", args.userId),
      )
      .first();
    const operatorInitiated = membership
      ? null
      : args.operatorInitiatedUserMessageId
        ? await validateOperatorInitiatedMessage(ctx, {
            orgId: args.orgId,
            userId: args.userId,
            userMessageId: args.operatorInitiatedUserMessageId,
          })
        : null;
    if (!membership && !operatorInitiated) {
      throwUserFacingError(userFacingErrorCodes.orgAccessRequired);
    }

    const primaryType = (primaryOrg.type as "broker" | "client") ?? "client";
    if (primaryType === "broker") {
      throwUserFacingError(
        userFacingErrorCodes.orgAccessRequired,
        "Broker organizations have profile and team access only.",
      );
    }

    if (args.surface === "email" || args.surface === "imessage") {
      const settings = await ctx.db
        .query("agentChannelSettings")
        .withIndex("client", (q) => q.eq("clientOrgId", primaryOrg._id))
        .first();
      const enabled =
        args.surface === "email"
          ? settings?.emailEnabled !== false
          : settings?.imessageEnabled !== false;
      if (!enabled) {
        throwUserFacingError(
          userFacingErrorCodes.orgAccessRequired,
          `${args.surface === "email" ? "Email" : "iMessage"} agent access is disabled for this client.`,
        );
      }
    }

    return {
      mode: "client",
      surface: args.surface,
      primaryOrgId: primaryOrg._id,
      readOrgIds: [primaryOrg._id],
      writableOrgIds: [primaryOrg._id],
      orgs: [
        summarizeOrg(primaryOrg, {
          primaryOrgId: primaryOrg._id,
          canWrite: true,
        }),
      ],
      focusedOrgId: args.focusedOrgId,
      brokerInternal: false,
      operatorInitiated: operatorInitiated ?? undefined,
    };
  },
});

export const validateOperatorInitiatedForAction = internalQuery({
  args: operatorInitiatedMessageIdArgs,
  handler: async (ctx, args) => {
    const operatorInitiated = await validateOperatorInitiatedMessage(ctx, args);
    return operatorInitiated
      ? { allowed: true, operatorInitiated }
      : { allowed: false };
  },
});

export function orgLabelForScope(
  scope: AgentScope,
  orgId: Id<"organizations"> | string,
): string {
  return (
    scope.orgs.find((org) => String(org.orgId) === String(orgId))?.name ??
    String(orgId)
  );
}

export function isOrgReadableByScope(
  scope: AgentScope,
  orgId: Id<"organizations"> | string,
): boolean {
  return scope.readOrgIds.some((id) => String(id) === String(orgId));
}
