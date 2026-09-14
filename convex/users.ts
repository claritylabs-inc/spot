import { v } from "convex/values";
import dayjs from "dayjs";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal as _internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  EMAIL_CHANGE_PROVIDER,
  EMAIL_CHANGE_TTL_MS,
  generateEmailChangeCode,
  sendEmailChangeVerificationEmail,
} from "./lib/emailChange";
import { normalizeEmailAddress } from "./lib/emailAddress";
import {
  normalizeAvailableUserPhone,
  normalizeUserPhone,
} from "./lib/userPhone";
import {
  assertCustomerUser,
  isBootstrapOperatorEmail,
  requireOperatorForUser,
} from "./lib/operatorIdentity";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "./lib/userFacingErrors";

const internal = _internal as any;
const EMAIL_INVALID_MESSAGE = "Enter a valid email address.";
const EMAIL_CURRENT_MESSAGE = "That is already the current email address.";
const EMAIL_IN_USE_MESSAGE = "This email is already used by another user.";
const EMAIL_PENDING_MESSAGE =
  "This email already has a pending change request.";

type EmailChangeCtx = QueryCtx | MutationCtx;
type EmailAvailabilityReason =
  | "invalid"
  | "current"
  | "user_exists"
  | "auth_account_exists"
  | "pending";

function normalizeEmailForChange(email: string) {
  const normalized = normalizeEmailAddress(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error(EMAIL_INVALID_MESSAGE);
  }
  if (isBootstrapOperatorEmail(normalized)) {
    throw new Error("Operator emails cannot be used for customer accounts");
  }
  return normalized;
}

async function sha256Hex(input: string) {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function latestActiveEmailChangeRequest(
  ctx: EmailChangeCtx,
  targetUserId: Id<"users">,
) {
  const now = dayjs().valueOf();
  const pending = await ctx.db
    .query("userEmailChangeRequests")
    .withIndex("target_status", (q) =>
      q.eq("targetUserId", targetUserId).eq("status", "pending"),
    )
    .collect();
  return (
    pending
      .filter((request) => request.expiresAt > now)
      .sort((a, b) => b.requestedAt - a.requestedAt)[0] ?? null
  );
}

async function emailAvailabilityForTarget(
  ctx: EmailChangeCtx,
  normalizedEmail: string,
  targetUserId: Id<"users">,
): Promise<{ available: boolean; reason?: EmailAvailabilityReason }> {
  const target = await ctx.db.get(targetUserId);
  if (!target) throw new Error("User not found");
  if (target.email?.trim().toLowerCase() === normalizedEmail) {
    return { available: false, reason: "current" };
  }

  const existingUser = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", normalizedEmail))
    .first();
  if (existingUser && existingUser._id !== targetUserId) {
    return { available: false, reason: "user_exists" };
  }

  const existingAccount = await ctx.db
    .query("authAccounts")
    .withIndex("providerAndAccountId", (q) =>
      q
        .eq("provider", EMAIL_CHANGE_PROVIDER)
        .eq("providerAccountId", normalizedEmail),
    )
    .first();
  if (existingAccount && existingAccount.userId !== targetUserId) {
    return { available: false, reason: "auth_account_exists" };
  }

  const now = dayjs().valueOf();
  const pending = await ctx.db
    .query("userEmailChangeRequests")
    .withIndex("email_status", (q) =>
      q.eq("newEmail", normalizedEmail).eq("status", "pending"),
    )
    .collect();
  if (
    pending.some(
      (request) =>
        request.targetUserId !== targetUserId && request.expiresAt > now,
    )
  ) {
    return { available: false, reason: "pending" };
  }

  return { available: true };
}

function emailAvailabilityError(reason: EmailAvailabilityReason | undefined) {
  if (reason === "current") return EMAIL_CURRENT_MESSAGE;
  if (reason === "pending") return EMAIL_PENDING_MESSAGE;
  return EMAIL_IN_USE_MESSAGE;
}

async function deleteVerificationCodesForAccount(
  ctx: MutationCtx,
  accountId: Id<"authAccounts">,
) {
  const codes = await ctx.db
    .query("authVerificationCodes")
    .withIndex("accountId", (q) => q.eq("accountId", accountId))
    .collect();
  for (const code of codes) await ctx.db.delete(code._id);
}

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db.get(userId);
  },
});

export const checkEmailAvailability = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    await assertCustomerUser(ctx, userId);

    let normalized = "";
    try {
      normalized = normalizeEmailForChange(args.email);
    } catch {
      return {
        available: false,
        normalized,
        reason: "invalid" as const,
      };
    }

    const availability = await emailAvailabilityForTarget(
      ctx,
      normalized,
      userId,
    );
    return { ...availability, normalized };
  },
});

export const getMyPendingEmailChange = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    const request = await latestActiveEmailChangeRequest(ctx, userId);
    if (!request) return null;

    const requestedBy = await ctx.db.get(request.requestedByUserId);
    return {
      requestId: request._id,
      oldEmail: request.oldEmail,
      newEmail: request.newEmail,
      requestedAt: request.requestedAt,
      expiresAt: request.expiresAt,
      requestedByUserId: request.requestedByUserId,
      requestedByName: requestedBy?.name,
      requestedByEmail: requestedBy?.email,
    };
  },
});

export const checkPhoneAvailability = query({
  args: { phone: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);

    let normalized: string | undefined;
    try {
      normalized = normalizeUserPhone(args.phone);
    } catch {
      return { available: false, normalized: "" };
    }
    if (!normalized) return { available: false, normalized: "" };

    const existing = await ctx.db
      .query("users")
      .withIndex("phone", (q) => q.eq("phone", normalized))
      .first();

    return {
      available: !existing || existing._id === userId,
      current: existing?._id === userId,
      normalized,
    };
  },
});

// Personal profile fields only — company fields live on organizations.
export const updateProfile = mutation({
  args: {
    name: v.optional(v.string()),
    title: v.optional(v.string()),
    phone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    const patch: { name?: string; title?: string; phone?: string | undefined } =
      {};
    if (args.name !== undefined) patch.name = args.name;
    if (args.title !== undefined) patch.title = args.title;
    if (args.phone !== undefined) {
      const normalized = await normalizeAvailableUserPhone(
        ctx,
        args.phone,
        userId,
      );
      if (normalized) {
        patch.phone = normalized;
      } else {
        patch.phone = undefined;
      }
    }
    await ctx.db.patch(userId, patch);
  },
});

export const requestEmailChange = action({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);

    const code = generateEmailChangeCode();
    const request = await ctx.runMutation(
      internal.users.createEmailChangeRequestInternal,
      {
        targetUserId: userId,
        requestedByUserId: userId,
        newEmail: args.email,
        code,
      },
    );
    const result = await sendEmailChangeVerificationEmail({
      to: request.newEmail,
      code,
    });

    if (!result.ok) {
      await ctx.runMutation(internal.users.cancelEmailChangeRequestInternal, {
        requestId: request.requestId,
        cancelledByUserId: userId,
      });
      throw new Error(`Failed to send verification email: ${result.error}`);
    }

    return request;
  },
});

export const confirmEmailChange = mutation({
  args: {
    requestId: v.id("userEmailChangeRequests"),
    code: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);

    const request = await ctx.db.get(args.requestId);
    if (!request || request.targetUserId !== userId) {
      throw new Error("Email change request not found");
    }
    if (request.status !== "pending") {
      throw new Error("Email change request is no longer pending");
    }

    const now = dayjs().valueOf();
    if (request.expiresAt < now) {
      await ctx.db.patch(request._id, { status: "expired" });
      throw new Error("This code has expired. Request a new one.");
    }

    const codeHash = await sha256Hex(args.code.trim());
    if (codeHash !== request.codeHash) {
      throw new Error(
        "That code didn't work. Please double-check and try again.",
      );
    }

    const normalized = normalizeEmailForChange(request.newEmail);
    const availability = await emailAvailabilityForTarget(
      ctx,
      normalized,
      userId,
    );
    if (!availability.available) {
      throw new Error(emailAvailabilityError(availability.reason));
    }

    const providerAccounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) =>
        q.eq("userId", userId).eq("provider", EMAIL_CHANGE_PROVIDER),
      )
      .collect();
    const existingNewAccount = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q
          .eq("provider", EMAIL_CHANGE_PROVIDER)
          .eq("providerAccountId", normalized),
      )
      .first();
    if (existingNewAccount && existingNewAccount.userId !== userId) {
      throw new Error(EMAIL_IN_USE_MESSAGE);
    }

    const accountToKeep =
      existingNewAccount ??
      providerAccounts.find(
        (account) => account.providerAccountId === request.oldEmail,
      ) ??
      providerAccounts[0];

    if (accountToKeep) {
      await deleteVerificationCodesForAccount(ctx, accountToKeep._id);
      await ctx.db.patch(accountToKeep._id, {
        providerAccountId: normalized,
        emailVerified: normalized,
      });
    } else {
      await ctx.db.insert("authAccounts", {
        userId,
        provider: EMAIL_CHANGE_PROVIDER,
        providerAccountId: normalized,
        emailVerified: normalized,
      });
    }

    for (const account of providerAccounts) {
      if (account._id === accountToKeep?._id) continue;
      await deleteVerificationCodesForAccount(ctx, account._id);
      await ctx.db.delete(account._id);
    }

    await ctx.db.patch(userId, {
      email: normalized,
      emailVerificationTime: now,
    });
    await ctx.db.patch(request._id, {
      status: "confirmed",
      confirmedAt: now,
      confirmedByUserId: userId,
    });

    return { email: normalized };
  },
});

export const cancelEmailChange = mutation({
  args: { requestId: v.id("userEmailChangeRequests") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    const request = await ctx.db.get(args.requestId);
    if (!request || request.targetUserId !== userId) {
      throw new Error("Email change request not found");
    }
    if (request.status !== "pending") return { requestId: request._id };

    await ctx.db.patch(request._id, {
      status: "cancelled",
      cancelledAt: dayjs().valueOf(),
      cancelledByUserId: userId,
    });
    return { requestId: request._id };
  },
});

export const createEmailChangeRequestInternal = internalMutation({
  args: {
    targetUserId: v.id("users"),
    requestedByUserId: v.id("users"),
    newEmail: v.string(),
    code: v.string(),
  },
  handler: async (ctx, args) => {
    const target = await assertCustomerUser(ctx, args.targetUserId);
    const requestedBy = await ctx.db.get(args.requestedByUserId);
    if (requestedBy?.accountKind === "operator") {
      await requireOperatorForUser(ctx, args.requestedByUserId);
    } else {
      await assertCustomerUser(ctx, args.requestedByUserId);
    }
    const normalized = normalizeEmailForChange(args.newEmail);
    const availability = await emailAvailabilityForTarget(
      ctx,
      normalized,
      args.targetUserId,
    );
    if (!availability.available) {
      throw new Error(emailAvailabilityError(availability.reason));
    }

    const now = dayjs().valueOf();
    const existing = await ctx.db
      .query("userEmailChangeRequests")
      .withIndex("target_status", (q) =>
        q.eq("targetUserId", args.targetUserId).eq("status", "pending"),
      )
      .collect();
    for (const request of existing) {
      await ctx.db.patch(request._id, {
        status: "cancelled",
        cancelledAt: now,
        cancelledByUserId: args.requestedByUserId,
      });
    }

    const requestId = await ctx.db.insert("userEmailChangeRequests", {
      targetUserId: args.targetUserId,
      requestedByUserId: args.requestedByUserId,
      oldEmail: target.email,
      newEmail: normalized,
      codeHash: await sha256Hex(args.code),
      status: "pending",
      requestedAt: now,
      expiresAt: now + EMAIL_CHANGE_TTL_MS,
    });

    return {
      requestId,
      newEmail: normalized,
      requestedAt: now,
      expiresAt: now + EMAIL_CHANGE_TTL_MS,
    };
  },
});

export const cancelEmailChangeRequestInternal = internalMutation({
  args: {
    requestId: v.id("userEmailChangeRequests"),
    cancelledByUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request || request.status !== "pending") return null;
    await ctx.db.patch(request._id, {
      status: "cancelled",
      cancelledAt: dayjs().valueOf(),
      cancelledByUserId: args.cancelledByUserId,
    });
    return { requestId: request._id };
  },
});

export const completeOnboarding = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    await ctx.db.patch(userId, { onboardingComplete: true });

    // Also mark org as onboarded if user has one
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("user", (q) => q.eq("userId", userId))
      .first();
    if (membership) {
      await ctx.db.patch(membership.orgId, { onboardingComplete: true });
    }
  },
});

export const restartOnboarding = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    await ctx.db.patch(userId, { onboardingComplete: false });

    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("user", (q) => q.eq("userId", userId))
      .first();
    if (membership) {
      await ctx.db.patch(membership.orgId, { onboardingComplete: false });
    }
  },
});

export const getInternal = internalQuery({
  args: { id: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const findManyByPhones = internalQuery({
  args: { phones: v.array(v.string()) },
  handler: async (ctx, args) => {
    const uniquePhones = [...new Set(args.phones)];
    const users = await Promise.all(
      uniquePhones.map((phone) =>
        ctx.db
          .query("users")
          .withIndex("phone", (q) => q.eq("phone", phone))
          .first(),
      ),
    );
    return users.filter((user) => user && !user.serviceAccountKind);
  },
});

export const listByOrgInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("organization", (q) => q.eq("orgId", args.orgId))
      .collect();
    const users = await Promise.all(
      memberships.map((m) => ctx.db.get(m.userId)),
    );
    return users.filter(Boolean);
  },
});

export const getPrimaryOrgAdminInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    if (!org) return null;

    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("organization", (q) => q.eq("orgId", args.orgId))
      .collect();
    const firstAdmin = memberships.find(
      (membership) => membership.role === "admin",
    );
    const preferredUserId = org.primaryInsuranceContactId ?? firstAdmin?.userId;
    if (!preferredUserId) return null;

    const preferredUser = await ctx.db.get(preferredUserId);
    if (preferredUser?.email) return preferredUser;

    if (firstAdmin && firstAdmin.userId !== preferredUserId) {
      const adminUser = await ctx.db.get(firstAdmin.userId);
      if (adminUser?.email) return adminUser;
    }

    return preferredUser;
  },
});

export const resetAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);

    const user = await ctx.db.get(userId);
    if (!user?.isAdmin) throw new Error("Not authorized");

    // Get user's org
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("user", (q) => q.eq("userId", userId))
      .first();
    const orgId = membership?.orgId;

    // Delete all policies + their stored files (by org or user)
    const policies = orgId
      ? await ctx.db
          .query("policies")
          .withIndex("organization", (q) => q.eq("orgId", orgId))
          .collect()
      : await ctx.db
          .query("policies")
          .withIndex("user", (q) => q.eq("userId", userId))
          .collect();
    for (const policy of policies) {
      if (policy.fileId) {
        await ctx.storage.delete(policy.fileId);
      }
      await ctx.db.delete(policy._id);
    }

    // Delete all threads and messages
    const threads = orgId
      ? await ctx.db
          .query("threads")
          .withIndex("organization", (q) => q.eq("orgId", orgId))
          .collect()
      : [];
    for (const thread of threads) {
      const messages = await ctx.db
        .query("threadMessages")
        .withIndex("thread", (q) => q.eq("threadId", thread._id))
        .collect();
      for (const message of messages) {
        await ctx.db.delete(message._id);
      }
      await ctx.db.delete(thread._id);
    }

    // Reset user profile fields
    await ctx.db.patch(userId, {
      onboardingComplete: false,
    });

    // Reset org if exists
    if (orgId) {
      await ctx.db.patch(orgId, {
        name: "My Organization",
        website: undefined,
        industry: undefined,
        industryVertical: undefined,
        agentHandle: undefined,
        onboardingComplete: false,
      });
    }
  },
});
