import dayjs from "dayjs";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getOrgAccess } from "./lib/access";
import { effectiveConnectedEmailAutomation, resolveMailboxAutomationPolicy } from "./lib/mailboxAutomation";
import { assertImpersonatedSetupWrite } from "./lib/operatorIdentity";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "./lib/userFacingErrors";

const automationValidator = v.object({
  policyImports: v.boolean(),
  requirementImports: v.boolean(),
});

type ConnectedEmailScanState = Doc<"connectedEmailScanStates"> | null;

function publicAccount(
  account: Doc<"connectedEmailAccounts">,
  scanState: ConnectedEmailScanState = null,
) {
  return {
    _id: account._id,
    orgId: account.orgId,
    userId: account.userId,
    scope: account.scope,
    label: account.label,
    emailAddress: account.emailAddress,
    host: account.host,
    port: account.port,
    secure: account.secure,
    username: account.username,
    automation: account.automation === undefined
      ? undefined
      : effectiveConnectedEmailAutomation(account.automation),
    automationConfigured: account.automation !== undefined,
    status: account.status,
    lastError: account.lastError,
    lastTestedAt: account.lastTestedAt,
    lastScanAt: scanState?.lastSuccessfulAt ?? scanState?.lastAttemptedAt,
    lastScanError: scanState?.lastError,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

function isAutomationEligible(account: Doc<"connectedEmailAccounts">) {
  if (account.status !== "active") return false;
  return resolveMailboxAutomationPolicy(account).eligible;
}

function canManageConnectedMailbox(
  account: Doc<"connectedEmailAccounts">,
  userId: Id<"users">,
  role: "admin" | "member" | undefined,
) {
  return (
    account.userId === userId ||
    (account.scope === "org" && role === "admin")
  );
}

async function requireDirectOrgMember(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
) {
  const access = await getOrgAccess(ctx, orgId);
  if (access.accessType !== "member") {
    throwUserFacingError(
      userFacingErrorCodes.orgAccessRequired,
      "Connected email is available only to members of this organization.",
    );
  }
  return access;
}

export const list = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const access = await requireDirectOrgMember(ctx, args.orgId);
    const accounts = await ctx.db
      .query("connectedEmailAccounts")
      .withIndex("organization", (q) => q.eq("orgId", args.orgId))
      .collect();
    const visible = accounts.filter(
      (account) =>
        account.status !== "revoked" &&
        (account.scope === "org" || account.userId === access.userId),
    );
    return await Promise.all(
      visible.map(async (account) => {
        const scanState = await ctx.db
          .query("connectedEmailScanStates")
          .withIndex("account_mailbox", (query) =>
            query.eq("accountId", account._id).eq("mailbox", "INBOX"),
          )
          .first();
        return publicAccount(account, scanState);
      }),
    );
  },
});

export const getAccessibleInternal = internalQuery({
  args: {
    accountId: v.id("connectedEmailAccounts"),
    orgId: v.id("organizations"),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account || account.orgId !== args.orgId || account.status !== "active") {
      return null;
    }
    if (account.scope === "user" && (!args.userId || account.userId !== args.userId)) {
      return null;
    }
    return account;
  },
});

export const listAccessibleInternal = internalQuery({
  args: {
    orgId: v.id("organizations"),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const accounts = await ctx.db
      .query("connectedEmailAccounts")
      .withIndex("organization_status", (q) =>
        q.eq("orgId", args.orgId).eq("status", "active"),
      )
      .collect();
    return accounts.filter(
      (account) =>
        account.scope === "org" || (!!args.userId && account.userId === args.userId),
    );
  },
});

export const listAutomationEligibleInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const accounts = await ctx.db
      .query("connectedEmailAccounts")
      .withIndex("status", (query) => query.eq("status", "active"))
      .collect();
    return accounts.filter(isAutomationEligible);
  },
});

export const listAutomationEligibleForOrgInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const accounts = await ctx.db
      .query("connectedEmailAccounts")
      .withIndex("organization_status", (query) =>
        query.eq("orgId", args.orgId).eq("status", "active"),
      )
      .collect();
    return accounts.filter(isAutomationEligible);
  },
});

export const getAutomationEligibleInternal = internalQuery({
  args: { accountId: v.id("connectedEmailAccounts") },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account || account.status !== "active") return null;
    const policy = resolveMailboxAutomationPolicy(account);
    if (!policy.eligible) return null;
    return {
      account,
      automation: policy.automation,
      alertOnly: policy.alertOnly,
    };
  },
});

export const getManageableForUserInternal = internalQuery({
  args: {
    accountId: v.id("connectedEmailAccounts"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account || account.status !== "active") return null;
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("organization_user", (q) =>
        q.eq("orgId", account.orgId).eq("userId", args.userId),
      )
      .first();
    if (!membership) return null;
    if (!canManageConnectedMailbox(account, args.userId, membership.role)) {
      return null;
    }
    const policy = resolveMailboxAutomationPolicy(account);
    return {
      account,
      automation: policy.automation,
      alertOnly: policy.alertOnly,
    };
  },
});

export const upsertInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    scope: v.union(v.literal("user"), v.literal("org")),
    label: v.optional(v.string()),
    emailAddress: v.string(),
    host: v.string(),
    port: v.number(),
    secure: v.boolean(),
    username: v.string(),
    encryptedPassword: v.string(),
    encryptionKeyVersion: v.optional(v.string()),
    automation: v.optional(automationValidator),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const existing = await ctx.db
      .query("connectedEmailAccounts")
      .withIndex("organization", (q) => q.eq("orgId", args.orgId))
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), args.userId),
          q.eq(q.field("emailAddress"), args.emailAddress),
          q.neq(q.field("status"), "revoked"),
        ),
      )
      .first();
    const patch = {
      scope: args.scope,
      label: args.label,
      emailAddress: args.emailAddress,
      host: args.host,
      port: args.port,
      secure: args.secure,
      username: args.username,
      encryptedPassword: args.encryptedPassword,
      encryptionKeyVersion: args.encryptionKeyVersion,
      ...(args.automation !== undefined ? { automation: args.automation } : {}),
      status: "active" as const,
      lastError: undefined,
      lastTestedAt: now,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("connectedEmailAccounts", {
      orgId: args.orgId,
      userId: args.userId,
      createdAt: now,
      ...patch,
    });
  },
});

export const updateScope = mutation({
  args: {
    accountId: v.id("connectedEmailAccounts"),
    scope: v.union(v.literal("user"), v.literal("org")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    const account = await ctx.db.get(args.accountId);
    if (!account || account.status === "revoked") throw new Error("Email account not found");
    const access = await requireDirectOrgMember(ctx, account.orgId);
    if (!canManageConnectedMailbox(account, userId, access.role)) {
      throwUserFacingError(
        userFacingErrorCodes.orgAccessRequired,
        "Only the mailbox owner can manage a personal mailbox. Organization admins can manage shared mailboxes.",
      );
    }
    if (args.scope === "org" && access.role !== "admin") {
      throwUserFacingError(
        userFacingErrorCodes.orgAdminRequired,
        "Only an organization admin can make a mailbox available to the organization.",
      );
    }
    await assertImpersonatedSetupWrite(ctx, account.orgId);
    await ctx.db.patch(account._id, {
      scope: args.scope,
      updatedAt: dayjs().valueOf(),
    });
  },
});

export const updateSettings = mutation({
  args: {
    accountId: v.id("connectedEmailAccounts"),
    scope: v.union(v.literal("user"), v.literal("org")),
    automation: automationValidator,
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    const account = await ctx.db.get(args.accountId);
    if (!account || account.status === "revoked") {
      throw new Error("Email account not found");
    }
    const access = await requireDirectOrgMember(ctx, account.orgId);
    if (!canManageConnectedMailbox(account, userId, access.role)) {
      throwUserFacingError(
        userFacingErrorCodes.orgAccessRequired,
        "Only the mailbox owner can manage a personal mailbox. Organization admins can manage shared mailboxes.",
      );
    }
    if (args.scope === "org" && access.role !== "admin") {
      throwUserFacingError(
        userFacingErrorCodes.orgAdminRequired,
        "Only an organization admin can make a mailbox available to the organization.",
      );
    }
    await assertImpersonatedSetupWrite(ctx, account.orgId);
    await ctx.db.patch(account._id, {
      scope: args.scope,
      automation: args.automation,
      updatedAt: dayjs().valueOf(),
    });
    const scanState = await ctx.db
      .query("connectedEmailScanStates")
      .withIndex("account_mailbox", (query) =>
        query.eq("accountId", account._id).eq("mailbox", "INBOX"),
      )
      .first();
    return publicAccount(
      { ...account, scope: args.scope, automation: args.automation },
      scanState,
    );
  },
});

export const revoke = mutation({
  args: { accountId: v.id("connectedEmailAccounts") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    const account = await ctx.db.get(args.accountId);
    if (!account || account.status === "revoked") return;
    const access = await requireDirectOrgMember(ctx, account.orgId);
    if (!canManageConnectedMailbox(account, userId, access.role)) {
      throwUserFacingError(
        userFacingErrorCodes.orgAccessRequired,
        "Only the mailbox owner can manage a personal mailbox. Organization admins can manage shared mailboxes.",
      );
    }
    await assertImpersonatedSetupWrite(ctx, account.orgId);
    await ctx.db.patch(account._id, {
      status: "revoked",
      updatedAt: dayjs().valueOf(),
    });
  },
});
