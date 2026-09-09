import { v } from "convex/values";
import {
  query,
  mutation,
  action,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import dayjs from "dayjs";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal as _internal } from "./_generated/api";
import {
  getCurrentOrgAccess as getOrgAccess,
  getOrgAccess as getOrgAccessNew,
  requireCurrentOrgAccess as requireOrgAccess,
  requireCurrentOrgAdminWrite as requireOrgAdminWrite,
} from "./lib/access";
import type { Id } from "./_generated/dataModel";
import { getBrandingContext } from "./lib/branding";
import { buildEmailShell, escapeHtml } from "./lib/emailTemplate";
import { getAuthSiteUrl } from "./lib/domains";
import { getAuthFromAddress, sendResendEmail } from "./lib/resend";
import {
  generateEmailChangeCode,
  sendEmailChangeVerificationEmail,
} from "./lib/emailChange";
import { normalizeAvailableUserPhone } from "./lib/userPhone";
import {
  assertCustomerUser,
  getActiveOperatorImpersonation,
  isBootstrapOperatorEmail,
  requireOperator,
  requireOperatorForUser,
  writeOperatorAudit,
} from "./lib/operatorIdentity";
import {
  assertFeatureFlagAllowedForOrg,
  setFeatureFlagPatch,
} from "./lib/featureFlags";
import { resolveEffectiveOrganizationProfile } from "./lib/orgProfileFacts";
import { IRS_ENTITY_TYPES } from "./lib/entityTypes";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "./lib/userFacingErrors";

const internal = _internal as any;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function createMemberInvitation(
  ctx: MutationCtx,
  args: {
    email: string;
    role: "admin" | "member";
    invitedByUserId?: Id<"users">;
    operatorClientOrgId?: Id<"organizations">;
  },
) {
  const access =
    args.operatorClientOrgId && args.invitedByUserId
      ? await requireOperatorClientForUser(
          ctx,
          args.invitedByUserId,
          args.operatorClientOrgId,
        )
      : args.invitedByUserId
        ? await requireOrgAdminForUser(ctx, args.invitedByUserId)
        : await requireOrgAdminWrite(ctx);
  const { userId, orgId } = access;
  const email = normalizeEmail(args.email);
  if (!email) throw new Error("Email is required");
  if (isBootstrapOperatorEmail(email)) {
    throw new Error(
      "Operator emails cannot be invited to customer organizations",
    );
  }

  const memberships = await ctx.db
    .query("orgMemberships")
    .withIndex("organization", (q) => q.eq("orgId", orgId))
    .collect();
  const existingUser = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", email))
    .first();
  if (existingUser && memberships.some((m) => m.userId === existingUser._id)) {
    throw new Error("User is already a member");
  }
  if (existingUser) await assertCustomerUser(ctx, existingUser._id);

  const now = dayjs().valueOf();
  const expiresAt = dayjs(now).add(7, "day").valueOf();
  const existingInvites = await ctx.db
    .query("orgInvitations")
    .withIndex("email", (q) => q.eq("email", email))
    .collect();
  const pendingForOrg = existingInvites.find(
    (i) => i.orgId === orgId && i.status === "pending",
  );

  if (pendingForOrg) {
    await ctx.db.patch(pendingForOrg._id, {
      role: args.role,
      invitedBy: userId,
      expiresAt,
    });
    return { invitationId: pendingForOrg._id, reusedExisting: true };
  }

  const invitationId = await ctx.db.insert("orgInvitations", {
    orgId,
    email,
    role: args.role,
    invitedBy: userId,
    status: "pending",
    expiresAt,
  });
  return { invitationId, reusedExisting: false };
}

async function requireOrgAdminForUser(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
) {
  const membership = await ctx.db
    .query("orgMemberships")
    .withIndex("user", (q) => q.eq("userId", userId))
    .first();
  if (!membership) {
    throwUserFacingError(userFacingErrorCodes.orgAccessRequired);
  }
  if (membership.role !== "admin") {
    throwUserFacingError(userFacingErrorCodes.orgAdminRequired);
  }

  const org = await ctx.db.get(membership.orgId);
  if (!org) throw new Error("Organization not found");
  return { userId, orgId: membership.orgId, role: membership.role, org };
}

async function requireOperatorClientForUser(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  clientOrgId: Id<"organizations">,
) {
  await requireOperatorForUser(ctx, userId);
  const org = await ctx.db.get(clientOrgId);
  if (!org || org.type !== "client") throw new Error("Client not found");
  return { userId, orgId: org._id, role: "admin" as const, org };
}

async function getTeamReadOrgId(
  ctx: QueryCtx,
  operatorClientOrgId?: Id<"organizations">,
) {
  if (operatorClientOrgId) {
    await requireOperator(ctx);
    const client = await ctx.db.get(operatorClientOrgId);
    if (!client || client.type !== "client")
      throw new Error("Client not found");
    return client._id;
  }
  return (await requireOrgAccess(ctx)).orgId;
}

async function getTeamAdminWriteAccess(
  ctx: MutationCtx,
  operatorClientOrgId?: Id<"organizations">,
) {
  if (operatorClientOrgId) {
    const operator = await requireOperator(ctx);
    const client = await ctx.db.get(operatorClientOrgId);
    if (!client || client.type !== "client")
      throw new Error("Client not found");
    return {
      orgId: client._id,
      org: client,
      userId: operator.userId,
      operatorUserId: operator.userId,
    };
  }
  const access = await requireOrgAdminWrite(ctx);
  return { ...access, operatorUserId: undefined };
}

async function writeTeamSupportAudit(
  ctx: MutationCtx,
  access: { operatorUserId?: Id<"users">; orgId: Id<"organizations"> },
  args: {
    summary: string;
    targetUserId?: Id<"users">;
    metadata?: unknown;
  },
) {
  if (!access.operatorUserId) return;
  await writeOperatorAudit(ctx, {
    operatorUserId: access.operatorUserId,
    type: "setup_write",
    targetOrgId: access.orgId,
    targetUserId: args.targetUserId,
    summary: args.summary,
    metadata: args.metadata,
  });
}

// ── Queries ──

export const viewerOrg = query({
  args: {
    // Optional orgId — if provided, returns that specific org (for multi-org users)
    orgId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    let membership;
    const impersonation = await getActiveOperatorImpersonation(ctx);
    if (impersonation) {
      if (args.orgId && args.orgId !== impersonation.session.targetOrgId) {
        const target = await ctx.db.get(impersonation.session.targetOrgId);
        const requested = await ctx.db.get(args.orgId);
        if (
          !target ||
          target.type !== "client" ||
          !requested ||
          requested.type !== "client"
        ) {
          return null;
        }
        membership = {
          orgId: requested._id,
          userId,
          role: impersonation.session.targetRole,
        };
      } else {
        membership = {
          orgId: impersonation.session.targetOrgId,
          userId,
          role: impersonation.session.targetRole,
        };
      }
    } else if (args.orgId) {
      membership = await ctx.db
        .query("orgMemberships")
        .withIndex("organization_user", (q) =>
          q.eq("orgId", args.orgId!).eq("userId", userId),
        )
        .first();
    } else {
      membership = await ctx.db
        .query("orgMemberships")
        .withIndex("user", (q) => q.eq("userId", userId))
        .first();
    }

    if (!membership) return null;

    const org = await ctx.db.get(membership.orgId);
    if (!org) return null;

    const iconUrl = org.iconStorageId
      ? await ctx.storage.getUrl(org.iconStorageId)
      : null;

    return { org: { ...org, iconUrl }, membership, brokerOrg: null };
  },
});

export const listMembers = query({
  args: { operatorClientOrgId: v.optional(v.id("organizations")) },
  handler: async (ctx, args) => {
    const orgId = await getTeamReadOrgId(ctx, args.operatorClientOrgId);
    const now = dayjs().valueOf();

    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("organization", (q) => q.eq("orgId", orgId))
      .collect();

    const members = await Promise.all(
      memberships.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        if (!user || user.serviceAccountKind) return null;
        const authAccounts = await ctx.db
          .query("authAccounts")
          .withIndex("userIdAndProvider", (q) => q.eq("userId", m.userId))
          .collect();
        const pendingEmailChanges = await ctx.db
          .query("userEmailChangeRequests")
          .withIndex("target_status", (q) =>
            q.eq("targetUserId", m.userId).eq("status", "pending"),
          )
          .collect();
        const pendingEmailChange =
          pendingEmailChanges
            .filter((request) => request.expiresAt > now)
            .sort((a, b) => b.requestedAt - a.requestedAt)[0] ?? null;
        return {
          membershipId: m._id,
          userId: m.userId,
          role: m.role,
          name: user?.name,
          email: user?.email,
          phone: user?.phone,
          title: user?.title,
          isActivated: authAccounts.some(
            (account) => account.emailVerified || account.phoneVerified,
          ),
          pendingEmailChange: pendingEmailChange
            ? {
                requestId: pendingEmailChange._id,
                newEmail: pendingEmailChange.newEmail,
                requestedAt: pendingEmailChange.requestedAt,
                expiresAt: pendingEmailChange.expiresAt,
                requestedByUserId: pendingEmailChange.requestedByUserId,
              }
            : undefined,
        };
      }),
    );
    return members.filter((member) => member !== null);
  },
});

export const listInvitations = query({
  args: { operatorClientOrgId: v.optional(v.id("organizations")) },
  handler: async (ctx, args) => {
    const orgId = args.operatorClientOrgId
      ? await getTeamReadOrgId(ctx, args.operatorClientOrgId)
      : (await getOrgAccess(ctx))?.orgId;
    if (!orgId) return [];

    return await ctx.db
      .query("orgInvitations")
      .withIndex("organization", (q) => q.eq("orgId", orgId))
      .collect();
  },
});

export const checkHandleAvailability = query({
  args: { handle: v.string(), excludeOrgId: v.optional(v.id("organizations")) },
  handler: async (ctx, args) => {
    const normalized = args.handle.toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (normalized.length < 3 || normalized.length > 30) {
      return {
        available: false,
        normalized,
        reason: "Handle must be 3-30 characters",
      };
    }
    if (
      !/^[a-z][a-z0-9-]*[a-z0-9]$/.test(normalized) &&
      normalized.length > 1
    ) {
      return {
        available: false,
        normalized,
        reason: "Must start with a letter and end with a letter or number",
      };
    }
    const existingOrg = await ctx.db
      .query("organizations")
      .withIndex("handle", (q) => q.eq("agentHandle", normalized))
      .first();
    const taken = !!existingOrg && existingOrg._id !== args.excludeOrgId;
    return {
      available: !taken,
      normalized,
      reason: taken ? "Handle already taken" : undefined,
    };
  },
});

/** Get pending invitation details for the current user (with org info). */
export const pendingInvitationForViewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const user = await ctx.db.get(userId);
    if (!user?.email) return null;

    // Check both original case and lowercase
    const byOriginal = await ctx.db
      .query("orgInvitations")
      .withIndex("email", (q) => q.eq("email", user.email!))
      .collect();
    const lowerEmail = normalizeEmail(user.email!);
    const byLower =
      user.email !== lowerEmail
        ? await ctx.db
            .query("orgInvitations")
            .withIndex("email", (q) => q.eq("email", lowerEmail))
            .collect()
        : [];
    const all = [...byOriginal, ...byLower];
    const pending = all.find(
      (i) => i.status === "pending" && i.expiresAt > dayjs().valueOf(),
    );
    if (!pending) return null;

    const org = await ctx.db.get(pending.orgId);
    if (!org) return null;

    const invitedBy = await ctx.db.get(pending.invitedBy);

    return {
      invitationId: pending._id,
      orgName: org.name,
      role: pending.role,
      invitedByName: invitedBy?.name ?? invitedBy?.email ?? "a team member",
    };
  },
});

// ── Mutations ──

/** Create a client org during orphan client signup wizard. */
export const createClientOrg = mutation({
  args: {
    name: v.string(),
    website: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    await assertCustomerUser(ctx, userId);

    // Check if user already has an org membership
    const existingMembership = await ctx.db
      .query("orgMemberships")
      .withIndex("user", (q) => q.eq("userId", userId))
      .first();
    if (existingMembership) {
      throw new Error("User already belongs to an organization");
    }

    const orgId = await ctx.db.insert("organizations", {
      name: args.name,
      type: "client",
      primaryInsuranceContactId: userId,
      ...(args.website && { website: args.website }),
    });

    await ctx.db.insert("orgMemberships", {
      orgId,
      userId,
      role: "admin",
    });

    return orgId;
  },
});

export const updateOrg = mutation({
  args: {
    name: v.optional(v.string()),
    website: v.optional(v.string()),
    context: v.optional(v.string()),
    industry: v.optional(v.string()),
    industryVertical: v.optional(v.string()),
    relatedLegalEntities: v.optional(
      v.array(
        v.object({
          legalName: v.string(),
          relationship: v.optional(
            v.union(
              v.literal("current"),
              v.literal("fka"),
              v.literal("dba"),
              v.literal("subsidiary"),
              v.literal("parent"),
              v.literal("affiliate"),
              v.literal("other"),
            ),
          ),
          incorporationNumber: v.optional(v.string()),
          taxId: v.optional(v.string()),
          jurisdiction: v.optional(v.string()),
          notes: v.optional(v.string()),
        }),
      ),
    ),
    chatEmailNotifications: v.optional(v.boolean()),
    bccRequesterOnAgentEmails: v.optional(v.boolean()),
    emailSendDelay: v.optional(v.number()),
    allowedEmails: v.optional(v.array(v.string())),
    allowedDomains: v.optional(v.array(v.string())),
    emailVerification: v.optional(
      v.union(v.literal("strict"), v.literal("domain"), v.literal("open")),
    ),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireOrgAdminWrite(ctx);
    await ctx.db.patch(orgId, args);
  },
});

const editableOrganizationAddressValidator = v.object({
  street1: v.optional(v.string()),
  street2: v.optional(v.string()),
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  zip: v.optional(v.string()),
  country: v.optional(v.string()),
  formatted: v.optional(v.string()),
});

const irsEntityTypeValueValidator = v.union(
  v.literal("sole_proprietorship"),
  v.literal("partnership"),
  v.literal("corporation"),
  v.literal("s_corporation"),
  v.literal("limited_liability_company"),
  v.literal("trust_estate"),
  v.literal("tax_exempt_organization"),
  v.literal("government_entity"),
  v.literal("other"),
);

const editableOrganizationProfileValidator = v.object({
  mailingAddress: editableOrganizationAddressValidator,
  entityType: v.union(irsEntityTypeValueValidator, v.literal("")),
  fein: v.string(),
  businessNumber: v.string(),
  operationsDescription: v.string(),
});

function normalizedProfileString(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizedFein(value: string) {
  const compact = value.replace(/[^0-9]/g, "");
  if (!compact) return "";
  if (compact.length !== 9) throw new Error("FEIN must contain 9 digits");
  return `${compact.slice(0, 2)}-${compact.slice(2)}`;
}

function normalizedBusinessNumber(value: string) {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!compact) return "";
  if (!/^\d{9}(?:[A-Z]{2}\d{4})?$/.test(compact)) {
    throw new Error(
      "Business number must be 9 digits, optionally followed by a program account",
    );
  }
  return compact;
}

function normalizedProfileAddress(address: {
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  formatted?: string;
}) {
  return Object.fromEntries(
    Object.entries(address)
      .map(([key, value]) => [key, normalizedProfileString(value ?? "")])
      .filter(([, value]) => value),
  );
}

export const updateOrganizationProfile = mutation({
  args: {
    operatorClientOrgId: v.optional(v.id("organizations")),
    profile: v.union(editableOrganizationProfileValidator, v.null()),
  },
  handler: async (ctx, args) => {
    const access = await getTeamAdminWriteAccess(ctx, args.operatorClientOrgId);
    const { orgId, userId, org } = access;
    if ((org.type ?? "client") !== "client") {
      throw new Error(
        "Organization insurance profiles are available for clients only",
      );
    }
    if (args.profile === null) {
      await ctx.db.patch(orgId, {
        profileOverrides: undefined,
        profileOverridesUpdatedAt: undefined,
        profileOverridesUpdatedByUserId: undefined,
      });
      await writeTeamSupportAudit(ctx, access, {
        summary: `Restored the extracted organization profile for ${org.name}`,
      });
      const refreshed = await ctx.db.get(orgId);
      return refreshed
        ? resolveEffectiveOrganizationProfile(
            refreshed as unknown as Record<string, unknown>,
          )
        : null;
    }

    const profileInput = args.profile;
    if (
      profileInput.entityType &&
      !IRS_ENTITY_TYPES.some(
        (option) => option.value === profileInput.entityType,
      )
    ) {
      throw new Error("Select a standard IRS entity type");
    }

    const fein = normalizedFein(profileInput.fein);
    const businessNumber = normalizedBusinessNumber(
      profileInput.businessNumber,
    );
    const operationsDescription = profileInput.operationsDescription.trim();
    const storedProfile = {
      mailingAddress: normalizedProfileAddress(profileInput.mailingAddress),
      ...(profileInput.entityType
        ? { entityType: profileInput.entityType }
        : {}),
      fein,
      businessNumber,
      operationsDescription,
    };
    await ctx.db.patch(orgId, {
      profileOverrides: storedProfile,
      profileOverridesUpdatedAt: dayjs().valueOf(),
      profileOverridesUpdatedByUserId: userId,
    });
    await writeTeamSupportAudit(ctx, access, {
      summary: `Updated the organization profile for ${org.name}`,
    });
    return {
      ...storedProfile,
      entityType: profileInput.entityType,
    };
  },
});

export const setFeatureFlag = mutation({
  args: {
    flagId: v.union(
      v.literal("connect_features"),
      v.literal("coverage_recovery_v2"),
      v.literal("imessage_app_cards"),
    ),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { orgId, org } = await requireOrgAdminWrite(ctx);
    assertFeatureFlagAllowedForOrg(args.flagId, org);
    await ctx.db.patch(orgId, {
      featureFlags: setFeatureFlagPatch(
        org.featureFlags,
        args.flagId,
        args.enabled,
      ),
    });
  },
});

export const sendMemberInvitation = action({
  args: {
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("member")),
    operatorClientOrgId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    if (args.operatorClientOrgId) {
      await ctx.runQuery(internal.operator.requireOperatorForUserInternal, {
        userId,
      });
    }

    const invitationResult = await ctx.runMutation(
      internal.orgs.createMemberInvitationInternal,
      {
        ...args,
        invitedByUserId: userId,
      },
    );
    const invitationId = invitationResult.invitationId;
    const context = await ctx.runQuery(
      internal.orgs.getMemberInvitationEmailContextInternal,
      {
        invitationId,
      },
    );
    if (!context) throw new Error("Invitation not found");

    const siteUrl = getAuthSiteUrl();
    const invitedEmail = context.invitation.email;
    const inviteUrl = `${siteUrl.replace(/\/$/, "")}/login?email=${encodeURIComponent(invitedEmail)}&next=${encodeURIComponent("/")}`;
    const orgName = context.org.name;
    const inviterName =
      context.invitedBy.name ?? context.invitedBy.email ?? "A team member";
    const roleLabel = context.invitation.role === "admin" ? "admin" : "member";
    const subject = `${inviterName} invited you to join ${orgName} on Spot`;
    const escapedOrgName = escapeHtml(orgName);
    const escapedInviterName = escapeHtml(inviterName);
    const escapedInviteUrl = escapeHtml(inviteUrl);
    const escapedEmail = escapeHtml(invitedEmail);
    const branding = getBrandingContext();
    const bodyHtml = `
<tr><td style="padding:28px 40px 0 40px;">
  <p class="spot-email-text-secondary" style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;color:#374151;line-height:1.6;">
    <strong>${escapedInviterName}</strong> invited you to join <strong>${escapedOrgName}</strong> on Spot as a ${roleLabel}.
  </p>
</td></tr>
<tr><td align="center" style="padding:24px 40px 0 40px;">
  <a href="${escapedInviteUrl}" class="spot-email-button" style="display:inline-block;padding:8px 22px;background-color:#000000;color:#ffffff;font-family:-apple-system,sans-serif;font-size:14px;font-weight:500;text-decoration:none;border-radius:999px;line-height:1.4;">Accept invitation</a>
</td></tr>
<tr><td style="padding:20px 40px 0 40px;">
  <p class="spot-email-text-muted" style="margin:0;font-family:-apple-system,sans-serif;font-size:12px;color:#6b7280;line-height:1.6;">
    Sign in or create an account with ${escapedEmail}. You can also copy this link:<br>
    <a href="${escapedInviteUrl}" class="spot-email-link" style="color:#6b7280;word-break:break-all;">${escapedInviteUrl}</a>
  </p>
</td></tr>
<tr><td style="padding:16px 40px 32px 40px;">
  <p class="spot-email-text-muted" style="margin:0;font-family:-apple-system,sans-serif;font-size:11px;color:#9ca3af;">This invitation expires in 7 days.</p>
</td></tr>`;
    const html = buildEmailShell({
      title: subject,
      bodyHtml,
      branding,
      siteUrl,
    });
    const text = `${inviterName} invited you to join ${orgName} on Spot as a ${roleLabel}.\n\nAccept invitation:\n${inviteUrl}\n\nSign in or create an account with ${invitedEmail}. This invitation expires in 7 days.`;

    const result = await sendResendEmail(
      {
        from: getAuthFromAddress(orgName),
        to: invitedEmail,
        subject,
        html,
        text,
      },
      { retries: 2 },
    );

    if (!result.ok) {
      if (!invitationResult.reusedExisting) {
        await ctx.runMutation(internal.orgs.deleteInvitationInternal, {
          invitationId,
        });
      }
      throw new Error(`Failed to send invitation email: ${result.error}`);
    }

    if (args.operatorClientOrgId) {
      await ctx.runMutation(internal.orgs.writeTeamSupportAuditInternal, {
        operatorUserId: userId,
        clientOrgId: args.operatorClientOrgId,
        summary: `Invited ${invitedEmail} to ${orgName} as ${roleLabel}`,
        metadata: {
          invitationId,
          email: invitedEmail,
          role: context.invitation.role,
        },
      });
    }

    return invitationId;
  },
});

export const requestMemberEmailChange = action({
  args: {
    membershipId: v.id("orgMemberships"),
    email: v.string(),
    operatorClientOrgId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    if (args.operatorClientOrgId) {
      await ctx.runQuery(internal.operator.requireOperatorForUserInternal, {
        userId,
      });
    }

    const target = await ctx.runQuery(
      internal.orgs.getMemberEmailChangeTargetInternal,
      {
        membershipId: args.membershipId,
        requestedByUserId: userId,
        operatorClientOrgId: args.operatorClientOrgId,
      },
    );
    const code = generateEmailChangeCode();
    const request = await ctx.runMutation(
      internal.users.createEmailChangeRequestInternal,
      {
        targetUserId: target.targetUserId,
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

    if (args.operatorClientOrgId) {
      await ctx.runMutation(internal.orgs.writeTeamSupportAuditInternal, {
        operatorUserId: userId,
        clientOrgId: args.operatorClientOrgId,
        targetUserId: target.targetUserId,
        summary: `Requested a verified account email change to ${request.newEmail}`,
        metadata: { requestId: request.requestId },
      });
    }

    return request;
  },
});

export const createMemberInvitationInternal = internalMutation({
  args: {
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("member")),
    invitedByUserId: v.id("users"),
    operatorClientOrgId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    return await createMemberInvitation(ctx, args);
  },
});

export const getMemberEmailChangeTargetInternal = internalQuery({
  args: {
    membershipId: v.id("orgMemberships"),
    requestedByUserId: v.id("users"),
    operatorClientOrgId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    const { orgId } = args.operatorClientOrgId
      ? await requireOperatorClientForUser(
          ctx,
          args.requestedByUserId,
          args.operatorClientOrgId,
        )
      : await requireOrgAdminForUser(ctx, args.requestedByUserId);
    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.orgId !== orgId) {
      throw new Error("Membership not found");
    }
    await assertCustomerUser(ctx, membership.userId);
    return { targetUserId: membership.userId };
  },
});

export const getMemberInvitationEmailContextInternal = internalQuery({
  args: { invitationId: v.id("orgInvitations") },
  handler: async (ctx, args) => {
    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation) return null;
    const org = await ctx.db.get(invitation.orgId);
    const invitedBy = await ctx.db.get(invitation.invitedBy);
    if (!org || !invitedBy) return null;
    return {
      invitation,
      org: {
        name: org.name,
      },
      invitedBy: {
        name: invitedBy.name,
        email: invitedBy.email,
      },
    };
  },
});

export const deleteInvitationInternal = internalMutation({
  args: { invitationId: v.id("orgInvitations") },
  handler: async (ctx, args) => {
    const invitation = await ctx.db.get(args.invitationId);
    if (invitation?.status === "pending") {
      await ctx.db.delete(args.invitationId);
    }
  },
});

export const writeTeamSupportAuditInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    clientOrgId: v.id("organizations"),
    targetUserId: v.optional(v.id("users")),
    summary: v.string(),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const access = await requireOperatorClientForUser(
      ctx,
      args.operatorUserId,
      args.clientOrgId,
    );
    await writeTeamSupportAudit(
      ctx,
      {
        orgId: access.orgId,
        operatorUserId: access.userId,
      },
      {
        summary: args.summary,
        targetUserId: args.targetUserId,
        metadata: args.metadata,
      },
    );
  },
});

export const acceptInvitation = mutation({
  args: { invitationId: v.id("orgInvitations") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);

    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation) throw new Error("Invitation not found");
    if (invitation.status !== "pending")
      throw new Error("Invitation is no longer valid");
    if (invitation.expiresAt < dayjs().valueOf()) {
      await ctx.db.patch(args.invitationId, { status: "expired" });
      throw new Error("Invitation has expired");
    }

    const user = await ctx.db.get(userId);
    if (user?.email?.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new Error("Invitation was sent to a different email address");
    }
    await assertCustomerUser(ctx, userId);

    // Check not already a member
    const existing = await ctx.db
      .query("orgMemberships")
      .withIndex("organization_user", (q) =>
        q.eq("orgId", invitation.orgId).eq("userId", userId),
      )
      .first();
    if (existing) {
      await ctx.db.patch(args.invitationId, { status: "accepted" });
      await ctx.db.patch(userId, { onboardingComplete: true });
      return existing._id;
    }

    // Create membership
    const membershipId = await ctx.db.insert("orgMemberships", {
      orgId: invitation.orgId,
      userId,
      role: invitation.role,
    });

    await ctx.db.patch(args.invitationId, { status: "accepted" });
    await ctx.db.patch(userId, { onboardingComplete: true });
    return membershipId;
  },
});

async function humanTeamMemberships(ctx: QueryCtx, orgId: Id<"organizations">) {
  const memberships = await ctx.db
    .query("orgMemberships")
    .withIndex("organization", (q) => q.eq("orgId", orgId))
    .collect();
  const people = await Promise.all(
    memberships.map(async (membership) => {
      const user = await ctx.db.get(membership.userId);
      return user && !user.serviceAccountKind ? membership : null;
    }),
  );
  return people.filter((membership) => membership !== null);
}

export const removeMember = mutation({
  args: {
    membershipId: v.id("orgMemberships"),
    operatorClientOrgId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    const access = await getTeamAdminWriteAccess(ctx, args.operatorClientOrgId);
    const { orgId, org } = access;

    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.orgId !== orgId)
      throw new Error("Membership not found");

    const memberships = await humanTeamMemberships(ctx, orgId);

    if (membership.role === "admin") {
      const adminCount = memberships.filter((m) => m.role === "admin").length;
      if (adminCount <= 1) throw new Error("Cannot remove the last admin");
    }

    await ctx.db.delete(args.membershipId);

    const remainingMemberships = memberships.filter(
      (m) => m._id !== args.membershipId,
    );
    let primaryInsuranceContactId = org.primaryInsuranceContactId;
    if (
      org.primaryInsuranceContactId === membership.userId ||
      (!org.primaryInsuranceContactId && remainingMemberships.length === 1)
    ) {
      primaryInsuranceContactId =
        remainingMemberships.length === 1
          ? remainingMemberships[0].userId
          : undefined;
      await ctx.db.patch(orgId, {
        primaryInsuranceContactId,
      });
    }
    await writeTeamSupportAudit(ctx, access, {
      summary: `Removed a team member from ${org.name}`,
      targetUserId: membership.userId,
    });
    return { primaryInsuranceContactId: primaryInsuranceContactId ?? null };
  },
});

export const updateMemberRole = mutation({
  args: {
    membershipId: v.id("orgMemberships"),
    role: v.union(v.literal("admin"), v.literal("member")),
    operatorClientOrgId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    const access = await getTeamAdminWriteAccess(ctx, args.operatorClientOrgId);
    const { orgId } = access;

    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.orgId !== orgId)
      throw new Error("Membership not found");

    // Can't demote the last admin
    if (membership.role === "admin" && args.role === "member") {
      const admins = await humanTeamMemberships(ctx, orgId);
      const adminCount = admins.filter((m) => m.role === "admin").length;
      if (adminCount <= 1) throw new Error("Cannot demote the last admin");
    }

    await ctx.db.patch(args.membershipId, { role: args.role });
    await writeTeamSupportAudit(ctx, access, {
      summary: `Changed a client team member role to ${args.role}`,
      targetUserId: membership.userId,
      metadata: { previousRole: membership.role, nextRole: args.role },
    });
  },
});

export const updateMemberProfile = mutation({
  args: {
    membershipId: v.id("orgMemberships"),
    name: v.optional(v.string()),
    title: v.optional(v.string()),
    phone: v.optional(v.string()),
    operatorClientOrgId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    const access = await getTeamAdminWriteAccess(ctx, args.operatorClientOrgId);
    const { orgId } = access;

    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.orgId !== orgId)
      throw new Error("Membership not found");
    await assertCustomerUser(ctx, membership.userId);

    const patch: { name?: string; title?: string; phone?: string | undefined } =
      {};
    if (args.name !== undefined) patch.name = args.name.trim() || undefined;
    if (args.title !== undefined) patch.title = args.title.trim() || undefined;
    if (args.phone !== undefined) {
      patch.phone = await normalizeAvailableUserPhone(
        ctx,
        args.phone,
        membership.userId,
      );
    }
    await ctx.db.patch(membership.userId, patch);
    await writeTeamSupportAudit(ctx, access, {
      summary: "Updated a client team member profile",
      targetUserId: membership.userId,
      metadata: {
        name: patch.name,
        title: patch.title,
        phoneChanged: args.phone !== undefined,
      },
    });
  },
});

export const cancelMemberEmailChange = mutation({
  args: {
    membershipId: v.id("orgMemberships"),
    requestId: v.id("userEmailChangeRequests"),
    operatorClientOrgId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    const access = await getTeamAdminWriteAccess(ctx, args.operatorClientOrgId);
    const { orgId, userId } = access;
    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.orgId !== orgId) {
      throw new Error("Membership not found");
    }

    const request = await ctx.db.get(args.requestId);
    if (
      !request ||
      request.targetUserId !== membership.userId ||
      request.status !== "pending"
    ) {
      throw new Error("Email change request not found");
    }

    await ctx.db.patch(request._id, {
      status: "cancelled",
      cancelledAt: dayjs().valueOf(),
      cancelledByUserId: userId,
    });
    await writeTeamSupportAudit(ctx, access, {
      summary: "Cancelled a client team member email change",
      targetUserId: membership.userId,
      metadata: { requestId: request._id },
    });
    return { requestId: request._id };
  },
});

export const setPrimaryInsuranceContact = mutation({
  args: {
    userId: v.id("users"),
    operatorClientOrgId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    const access = await getTeamAdminWriteAccess(ctx, args.operatorClientOrgId);
    const { orgId } = access;

    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("organization_user", (q) =>
        q.eq("orgId", orgId).eq("userId", args.userId),
      )
      .first();
    if (!membership)
      throw new Error("User is not a member of this organization");

    const user = await ctx.db.get(args.userId);
    if (!user || user.serviceAccountKind)
      throw new Error("Primary contact must be a person");
    await ctx.db.patch(orgId, { primaryInsuranceContactId: args.userId });
    await writeTeamSupportAudit(ctx, access, {
      summary: "Updated the client primary contact",
      targetUserId: args.userId,
    });
  },
});

export const ensurePrimaryInsuranceContact = mutation({
  args: { operatorClientOrgId: v.optional(v.id("organizations")) },
  handler: async (ctx, args) => {
    const operatorAccess = args.operatorClientOrgId
      ? await getTeamAdminWriteAccess(ctx, args.operatorClientOrgId)
      : null;
    const { orgId } = operatorAccess ?? (await requireOrgAccess(ctx));
    const org = await ctx.db.get(orgId);
    if (!org) throw new Error("Organization not found");

    const memberships = await humanTeamMemberships(ctx, orgId);

    const currentPrimaryStillMember = org.primaryInsuranceContactId
      ? memberships.some(
          (membership) => membership.userId === org.primaryInsuranceContactId,
        )
      : false;
    if (currentPrimaryStillMember) {
      return { userId: org.primaryInsuranceContactId, updated: false };
    }

    if (memberships.length !== 1) {
      return { userId: null, updated: false };
    }

    const userId = memberships[0].userId;
    await ctx.db.patch(orgId, { primaryInsuranceContactId: userId });
    if (operatorAccess) {
      await writeTeamSupportAudit(ctx, operatorAccess, {
        summary: "Set the client primary contact",
        targetUserId: userId,
      });
    }
    return { userId, updated: true };
  },
});

export const cancelInvitation = mutation({
  args: {
    invitationId: v.id("orgInvitations"),
    operatorClientOrgId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    const access = await getTeamAdminWriteAccess(ctx, args.operatorClientOrgId);
    const { orgId } = access;
    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation || invitation.orgId !== orgId)
      throw new Error("Invitation not found");
    await ctx.db.delete(args.invitationId);
    await writeTeamSupportAudit(ctx, access, {
      summary: `Cancelled the invitation for ${invitation.email}`,
      metadata: { invitationId: invitation._id },
    });
  },
});

// ── Internal queries ──

type SenderMatch = "email" | "domain" | "member";

async function senderMatchesOrg(
  ctx: QueryCtx,
  org: {
    _id: Id<"organizations">;
    allowedEmails?: string[];
    allowedDomains?: string[];
    emailVerification?: "strict" | "domain" | "open";
  },
  email: string,
  domain: string,
): Promise<SenderMatch | null> {
  const allowed = (org.allowedEmails ?? []).map((e) => e.toLowerCase());
  if (allowed.includes(email)) return "email";

  if (org.emailVerification === "domain") {
    const domains = (org.allowedDomains ?? []).map((d) => d.toLowerCase());
    if (domain && domains.includes(domain)) return "domain";
  }

  if (org.emailVerification !== "strict") {
    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("organization", (q) => q.eq("orgId", org._id))
      .collect();
    for (const membership of memberships) {
      const user = await ctx.db.get(membership.userId);
      if (user?.email?.toLowerCase() === email) return "member";
    }
  }

  return null;
}

/**
 * Resolve which standalone client org a sender is authorized to act on behalf
 * of for email addressed to an agent handle.
 */
export const resolveClientBySender = internalQuery({
  args: { handle: v.string(), senderEmail: v.string() },
  handler: async (ctx, args) => {
    const email = args.senderEmail.toLowerCase();
    const domain = email.split("@")[1] ?? "";

    const handleOwner = await ctx.db
      .query("organizations")
      .withIndex("handle", (q) => q.eq("agentHandle", args.handle))
      .first();

    if (handleOwner) {
      if ((handleOwner.type ?? "client") !== "client") return null;
      const matchedBy = await senderMatchesOrg(ctx, handleOwner, email, domain);
      return matchedBy ? { org: handleOwner, matchedBy } : null;
    }
    if (args.handle !== "agent") return null;

    const organizations = await ctx.db.query("organizations").collect();
    for (const org of organizations) {
      if ((org.type ?? "client") !== "client") continue;
      const matchedBy = await senderMatchesOrg(ctx, org, email, domain);
      if (matchedBy) return { org, matchedBy };
    }
    return null;
  },
});

export const getOrgsByUserId = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("user", (q) => q.eq("userId", args.userId))
      .collect();

    const orgs = await Promise.all(
      memberships.map((membership) => ctx.db.get(membership.orgId)),
    );

    return orgs.filter(Boolean);
  },
});

export const getInternal = internalQuery({
  args: { id: v.id("organizations") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getMembersInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("organization", (q) => q.eq("orgId", args.orgId))
      .collect();
    return Promise.all(
      memberships.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        return { ...m, user };
      }),
    );
  },
});

export const getUserMemberships = internalQuery({
  args: { userIds: v.array(v.id("users")) },
  handler: async (ctx, args) => {
    const uniqueUserIds = [...new Set(args.userIds)];
    const memberships = await Promise.all(
      uniqueUserIds.map((userId) =>
        ctx.db
          .query("orgMemberships")
          .withIndex("user", (q) => q.eq("userId", userId))
          .first(),
      ),
    );
    return memberships.filter(Boolean);
  },
});

export const hasMembershipInternal = internalQuery({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("organization_user", (q) =>
        q.eq("orgId", args.orgId).eq("userId", args.userId),
      )
      .first();
    return !!membership;
  },
});

export const setIconInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    iconStorageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    if (org?.iconStorageId && org.iconStorageId !== args.iconStorageId) {
      await ctx.storage.delete(org.iconStorageId).catch(() => {});
    }
    await ctx.db.patch(args.orgId, { iconStorageId: args.iconStorageId });
  },
});

export const updateProfileInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    context: v.optional(v.string()),
    industry: v.optional(v.string()),
    industryVertical: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId, ...patch } = args;
    await ctx.db.patch(orgId, patch);
  },
});

export const listAllInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("organizations").collect();
  },
});

export const getById = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    try {
      await getOrgAccessNew(ctx, args.orgId);
    } catch {
      return null;
    }
    return ctx.db.get(args.orgId);
  },
});
