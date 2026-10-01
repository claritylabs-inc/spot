import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  assertCustomerUser,
  requireOperatorForUser,
} from "./lib/operatorIdentity";

const DEFAULT_CLIENT_VIEWS = [
  "policies",
  "certificates",
  "compliance",
  "requests",
  "files",
  "company",
  "mailbox",
  "activity",
  "settings",
] as const;

const BROKER_VIEWS = ["profile", "team", "settings"] as const;
const OPERATOR_VIEWS = [...DEFAULT_CLIENT_VIEWS, "proposals"] as const;
const OPERATOR_ORGANIZATION_PAGE_SIZE = 50;

type OrganizationPrincipalArgs = {
  userId: Id<"users">;
  principalKind: "organization";
  orgId?: Id<"organizations">;
  organizationId?: Id<"organizations">;
  operatorRole?: "operator" | "owner";
  canWrite: boolean;
  websiteUrl: string;
  cursor?: string;
};

type OperatorPrincipalArgs = {
  userId: Id<"users">;
  principalKind: "operator";
  orgId?: Id<"organizations">;
  organizationId?: Id<"organizations">;
  operatorRole?: "operator" | "owner";
  canWrite: boolean;
  websiteUrl: string;
  cursor?: string;
};

type WorkspaceArgs = OrganizationPrincipalArgs | OperatorPrincipalArgs;

function displayOrganization(org: {
  _id: Id<"organizations">;
  name: string;
  type?: "client" | "broker";
}) {
  if (org.type !== "client" && org.type !== "broker") {
    throw new Error("Unsupported organization principal");
  }
  return { id: org._id, name: org.name, type: org.type };
}

async function membershipForUserAndOrganization(
  ctx: QueryCtx,
  userId: Id<"users">,
  orgId: Id<"organizations">,
) {
  return await ctx.db
    .query("orgMemberships")
    .withIndex("organization_user", (q) =>
      q.eq("orgId", orgId).eq("userId", userId),
    )
    .first();
}

async function brokerWorkspaceDetails(
  ctx: QueryCtx,
  orgId: Id<"organizations">,
) {
  const [profile, memberships] = await Promise.all([
    ctx.db
      .query("brokerProfiles")
      .withIndex("broker", (q) => q.eq("brokerOrgId", orgId))
      .unique(),
    ctx.db
      .query("orgMemberships")
      .withIndex("organization", (q) => q.eq("orgId", orgId))
      .take(100),
  ]);

  const team = (
    await Promise.all(
      memberships.map(async (membership) => {
        const user = await ctx.db.get(membership.userId);
        if (!user) return null;
        return {
          id: user._id,
          ...(user.name ? { name: user.name } : {}),
          ...(user.email ? { email: user.email } : {}),
          role: membership.role,
        };
      }),
    )
  )
    .filter((member): member is NonNullable<typeof member> => member !== null)
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));

  return {
    ...(profile
      ? {
          brokerProfile: {
            networkStatus: profile.networkStatus,
            writingStates: profile.writingStates,
            lineOfBusinessCodes: profile.lineOfBusinessCodes,
            ...(profile.officeAddress
              ? { officeAddress: profile.officeAddress }
              : {}),
          },
        }
      : {}),
    team,
  };
}

function baseContext(args: WorkspaceArgs, input: {
  kind: "client" | "broker" | "operator";
  role: string;
  organizations: Array<{ id: string; name: string; type: "client" | "broker" }>;
  activeOrganizationId: string | null;
  views: readonly string[];
}) {
  return {
    version: 1 as const,
    principal: {
      kind: input.kind,
      role: input.role,
      canWrite: args.canWrite,
    },
    organizations: input.organizations,
    activeOrganizationId: input.activeOrganizationId,
    views: [...input.views],
    websiteUrl: args.websiteUrl,
  };
}

async function getOrganizationContext(
  ctx: QueryCtx,
  args: OrganizationPrincipalArgs,
) {
  if (!args.orgId) throw new Error("Organization binding is required");
  if (args.organizationId && args.organizationId !== args.orgId) {
    throw new Error("Organization principal cannot switch organizations");
  }
  if (args.operatorRole !== undefined || args.cursor !== undefined) {
    throw new Error("Invalid organization principal context");
  }

  // A customer principal must remain a customer even if a caller forges the
  // principalKind field or a stale token is replayed after an operator change.
  await assertCustomerUser(ctx, args.userId);
  const [org, membership] = await Promise.all([
    ctx.db.get(args.orgId),
    membershipForUserAndOrganization(ctx, args.userId, args.orgId),
  ]);
  if (
    !org ||
    org.deletedAt !== undefined ||
    (org.type !== "client" && org.type !== "broker") ||
    !membership
  ) {
    throw new Error("Organization access is no longer valid");
  }

  const organization = displayOrganization(org);
  const context = baseContext(args, {
    kind: org.type,
    role: membership.role,
    organizations: [organization],
    activeOrganizationId: organization.id,
    views: org.type === "broker" ? BROKER_VIEWS : DEFAULT_CLIENT_VIEWS,
  });

  if (org.type !== "broker") return context;
  return {
    ...context,
    ...(await brokerWorkspaceDetails(ctx, org._id)),
  };
}

async function getOperatorContext(
  ctx: QueryCtx,
  args: OperatorPrincipalArgs,
) {
  if (args.orgId !== undefined) {
    throw new Error("Operator principals cannot carry an organization binding");
  }
  const operator = await requireOperatorForUser(ctx, args.userId);
  if (
    args.operatorRole !== undefined &&
    args.operatorRole !== operator.profile.role
  ) {
    throw new Error("Operator role is stale");
  }

  let activeOrganizationId: string | null = null;
  if (args.organizationId !== undefined) {
    const organization = await ctx.db.get(args.organizationId);
    if (
      !organization ||
      organization.deletedAt !== undefined ||
      organization.type !== "client"
    ) {
      throw new Error("Selected client organization is not available");
    }
    activeOrganizationId = organization._id;
  }

  const page = await ctx.db
    .query("organizations")
    .withIndex("deletion_type", (q) =>
      q.eq("deletedAt", undefined).eq("type", "client"),
    )
    .order("asc")
    .paginate({
      numItems: OPERATOR_ORGANIZATION_PAGE_SIZE,
      cursor: args.cursor ?? null,
    });

  const organizations = page.page.map(displayOrganization);
  const context = baseContext(args, {
    kind: "operator",
    role: operator.profile.role,
    organizations,
    activeOrganizationId,
    views: OPERATOR_VIEWS,
  });
  return page.isDone
    ? context
    : { ...context, organizationCursor: page.continueCursor };
}

export const getContext = internalQuery({
  args: {
    userId: v.id("users"),
    principalKind: v.union(v.literal("organization"), v.literal("operator")),
    orgId: v.optional(v.id("organizations")),
    organizationId: v.optional(v.id("organizations")),
    operatorRole: v.optional(v.union(v.literal("operator"), v.literal("owner"))),
    canWrite: v.boolean(),
    websiteUrl: v.string(),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.principalKind === "organization") {
      return await getOrganizationContext(
        ctx,
        args as OrganizationPrincipalArgs,
      );
    }
    return await getOperatorContext(ctx, args as OperatorPrincipalArgs);
  },
});
