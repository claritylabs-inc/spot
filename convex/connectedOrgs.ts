import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import dayjs from "dayjs";
import { internal as internalApi } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getOrgAccess, requireAuth } from "./lib/access";
import { sendResendEmail, getAuthFromAddress } from "./lib/resend";
import { buildEmailShell } from "./lib/emailTemplate";
import { getBrandingContext } from "./lib/branding";
import { getAuthSiteUrl } from "./lib/domains";
import { assertCustomerUser } from "./lib/operatorIdentity";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "./lib/userFacingErrors";

const internal = internalApi as any;

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("Enter a valid vendor email address");
  }
  return normalized;
}

function companyNameFromEmail(email: string): string {
  const domain = email.split("@")[1] ?? "vendor";
  const root = domain.split(".")[0] ?? "vendor";
  const words = root
    .replace(/[^a-z0-9-_ ]/gi, " ")
    .split(/[-_\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return (words.length > 0 ? words : ["Vendor"])
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ")
    .slice(0, 80);
}

async function sha256Hex(token: string): Promise<string> {
  const encoded = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function publicOrg(org: Doc<"organizations">) {
  return {
    _id: org._id,
    name: org.name,
    website: org.website,
    industry: org.industry,
    industryVertical: org.industryVertical,
    context: org.context,
    type: org.type ?? "client",
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendVendorRequestEmail(args: {
  vendorEmail: string;
  clientName: string;
  note?: string;
  requestUrl: string;
}) {
  const subject = `${args.clientName} invited you to share vendor insurance records`;
  const noteBlock = args.note
    ? `\n\nMessage from ${args.clientName}:\n${args.note}`
    : "";
  const text = `${args.clientName} invited you to connect as a vendor in Spot.\n\nUse this invite to share insurance records, upload policies or certificates, and help ${args.clientName} verify that your coverage meets their vendor requirements.${noteBlock}\n\nReview vendor invite:\n${args.requestUrl}\n\nThis vendor invite expires in 14 days. If you don't recognize this invite, you can ignore this email.`;
  const safeClientName = escapeHtml(args.clientName);
  const safeNote = args.note ? escapeHtml(args.note) : undefined;
  const bodyHtml = `
<tr><td style="padding:28px 40px 0 40px;">
  <p class="spot-email-text-secondary" style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;color:#374151;line-height:1.6;">
    <strong>${safeClientName}</strong> invited you to connect as a vendor in Spot.
  </p>
</td></tr>
<tr><td style="padding:12px 40px 0 40px;">
  <p class="spot-email-text-secondary" style="margin:0;font-family:-apple-system,sans-serif;font-size:14px;color:#4b5563;line-height:1.6;">
    Use this invite to share insurance records, upload policies or certificates, and help ${safeClientName} verify that your coverage meets their vendor requirements.
  </p>
</td></tr>
${safeNote ? `<tr><td style="padding:12px 40px 0 40px;"><p class="spot-email-text-secondary" style="margin:0;font-family:-apple-system,sans-serif;font-size:13px;color:#4b5563;line-height:1.6;font-style:italic;"><strong class="spot-email-text-secondary" style="font-style:normal;color:#374151;">Message from ${safeClientName}:</strong><br>${safeNote}</p></td></tr>` : ""}
<tr><td align="center" style="padding:24px 40px 0 40px;">
  <a href="${args.requestUrl}" class="spot-email-button" style="display:inline-block;padding:8px 22px;background-color:#000000;color:#ffffff;font-family:-apple-system,sans-serif;font-size:14px;font-weight:500;text-decoration:none;border-radius:999px;line-height:1.4;">Review vendor invite</a>
</td></tr>
<tr><td style="padding:20px 40px 0 40px;">
  <p class="spot-email-text-muted" style="margin:0;font-family:-apple-system,sans-serif;font-size:12px;color:#6b7280;line-height:1.6;">
    Or copy this link:<br><a href="${args.requestUrl}" class="spot-email-link" style="color:#6b7280;word-break:break-all;">${args.requestUrl}</a>
  </p>
</td></tr>
<tr><td style="padding:16px 40px 32px 40px;">
  <p class="spot-email-text-muted" style="margin:0;font-family:-apple-system,sans-serif;font-size:11px;color:#9ca3af;">This vendor invite expires in 14 days.</p>
</td></tr>`;

  const send = await sendResendEmail(
    {
      from: getAuthFromAddress("Spot"),
      to: args.vendorEmail,
      subject,
      html: buildEmailShell({
        title: subject,
        bodyHtml,
        branding: getBrandingContext(),
        siteUrl: getAuthSiteUrl(),
      }),
      text,
    },
    { retries: 2 },
  );
  if (!send.ok) {
    throw new Error(`Failed to send vendor invite email: ${send.error}`);
  }
}

async function requireOrgAdmin(ctx: QueryCtx | MutationCtx, orgId: Id<"organizations">) {
  const access = await getOrgAccess(ctx, orgId);
  if (access.accessType !== "member" || access.role !== "admin") {
    throwUserFacingError(userFacingErrorCodes.orgAdminRequired);
  }
  return access;
}

async function requireConnectClientOrg(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
) {
  const org = await ctx.db.get(orgId);
  if (!org) throw new Error("Organization not found");
  if ((org.type ?? "client") === "broker") {
    throw new Error("Connect vendor/client features are not available for broker organizations");
  }
  return org;
}

async function requireConnectVendorOrg(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
) {
  const org = await ctx.db.get(orgId);
  if (!org) throw new Error("Vendor organization not found");
  if ((org.type ?? "client") === "broker") {
    throw new Error("Broker organizations cannot be connected as vendors");
  }
  return org;
}

async function pickUserOrg(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  const memberships = await ctx.db
    .query("orgMemberships")
    .withIndex("user", (q) => q.eq("userId", userId))
    .collect();
  const membershipCandidates = await Promise.all(
    memberships.map(async (membership) => ({
      membership,
      org: await ctx.db.get(membership.orgId),
    })),
  );
  const eligible = membershipCandidates.filter(
    (candidate) => candidate.org && (candidate.org.type ?? "client") !== "broker",
  );
  const picked =
    eligible.find((candidate) => candidate.membership.role === "admin") ??
    eligible[0];
  const membership = picked?.membership;
  if (!membership) return null;
  const org = picked.org;
  if (!org) return null;
  return { membership, org };
}

async function enrichRelationship(ctx: QueryCtx, rel: Doc<"connectedOrgRelationships">) {
  const [clientOrg, vendorOrg] = await Promise.all([
    ctx.db.get(rel.clientOrgId),
    ctx.db.get(rel.vendorOrgId),
  ]);
  return {
    ...rel,
    kind: "relationship" as const,
    clientOrg: clientOrg ? publicOrg(clientOrg) : null,
    vendorOrg: vendorOrg ? publicOrg(vendorOrg) : null,
  };
}

async function enrichInvitation(ctx: QueryCtx, inv: Doc<"connectedOrgInvitations">) {
  const [clientOrg, vendorOrg] = await Promise.all([
    ctx.db.get(inv.clientOrgId),
    inv.vendorOrgId ? ctx.db.get(inv.vendorOrgId) : Promise.resolve(null),
  ]);
  return {
    ...inv,
    kind: "invitation" as const,
    clientOrg: clientOrg ? publicOrg(clientOrg) : null,
    vendorOrg: vendorOrg ? publicOrg(vendorOrg) : null,
  };
}

/** List vendor orgs this org can access, plus pending/revoked requests it created. */
export const listVendors = query({
  args: { orgId: v.optional(v.id("organizations")) },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const memberships = args.orgId
      ? [{ orgId: args.orgId }]
      : await ctx.db
          .query("orgMemberships")
          .withIndex("user", (q) => q.eq("userId", userId))
          .collect();

    const rows = [];
    for (const membership of memberships) {
      const access = await getOrgAccess(ctx, membership.orgId, {
        allowOperator: true,
      });
      if (
        access.accessType !== "member" &&
        access.accessType !== "operator"
      ) {
        continue;
      }
      const org = await ctx.db.get(membership.orgId);
      if ((org?.type ?? "client") === "broker") continue;
      const [relationships, invitations] = await Promise.all([
        ctx.db
          .query("connectedOrgRelationships")
          .withIndex("client", (q) => q.eq("clientOrgId", membership.orgId))
          .collect(),
        ctx.db
          .query("connectedOrgInvitations")
          .withIndex("client", (q) => q.eq("clientOrgId", membership.orgId))
          .collect(),
      ]);
      const invitationsByRelationshipId = new Map(
        invitations
          .filter((inv) => inv.relationshipId)
          .map((inv) => [inv.relationshipId!, inv]),
      );
      for (const rel of relationships) {
        const invitation = invitationsByRelationshipId.get(rel._id);
        rows.push({
          ...(await enrichRelationship(ctx, rel)),
          invitationId: invitation?._id,
          vendorEmail: invitation?.vendorEmail,
          invitationStatus: invitation?.status,
        });
      }
      for (const inv of invitations) {
        if (!inv.relationshipId) rows.push(await enrichInvitation(ctx, inv));
      }
    }
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

/** List client/customer orgs requesting or holding access to this vendor org. */
export const listClients = query({
  args: { orgId: v.optional(v.id("organizations")) },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const memberships = args.orgId
      ? [{ orgId: args.orgId }]
      : await ctx.db
          .query("orgMemberships")
          .withIndex("user", (q) => q.eq("userId", userId))
          .collect();

    const rows = [];
    for (const membership of memberships) {
      const access = await getOrgAccess(ctx, membership.orgId, {
        allowOperator: true,
      });
      if (
        access.accessType !== "member" &&
        access.accessType !== "operator"
      ) {
        continue;
      }
      const org = await ctx.db.get(membership.orgId);
      if ((org?.type ?? "client") === "broker") continue;
      const [relationships, invitations] = await Promise.all([
        ctx.db
          .query("connectedOrgRelationships")
          .withIndex("vendor", (q) => q.eq("vendorOrgId", membership.orgId))
          .collect(),
        ctx.db
          .query("connectedOrgInvitations")
          .withIndex("vendor", (q) => q.eq("vendorOrgId", membership.orgId))
          .collect(),
      ]);
      for (const rel of relationships) rows.push(await enrichRelationship(ctx, rel));
      for (const inv of invitations) {
        if (!inv.relationshipId) rows.push(await enrichInvitation(ctx, inv));
      }
    }
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

/**
 * Preferred request flow: requester enters a vendor email. Existing users are
 * resolved to their first/admin org; unknown emails receive a signup-backed
 * invitation and choose/create their vendor org when accepting.
 */
export const requestVendorAccessByEmail = action({
  args: {
    clientOrgId: v.id("organizations"),
    vendorEmail: v.string(),
    relationshipLabel: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ status: "pending"; email: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);

    const vendorEmail = normalizeEmail(args.vendorEmail);
    const rawToken = randomToken();
    const tokenHash = await sha256Hex(rawToken);
    const expiresAt = dayjs().add(14, "day").valueOf();

    const result = await ctx.runMutation(internal.connectedOrgs.createEmailRequestInternal, {
      clientOrgId: args.clientOrgId,
      requestedByUserId: userId,
      vendorEmail,
      inviteTokenHash: tokenHash,
      expiresAt,
      relationshipLabel: args.relationshipLabel,
      note: args.note,
    });

    const siteUrl = getAuthSiteUrl();
    const requestUrl = `${siteUrl}/connect/request/${rawToken}`;
    const clientName = result.clientOrgName ?? "A client";
    await sendVendorRequestEmail({
      vendorEmail,
      clientName,
      note: args.note,
      requestUrl,
    });
    return { status: "pending", email: vendorEmail };
  },
});

export const requestVendorAccessByEmailInternal = internalAction({
  args: {
    clientOrgId: v.id("organizations"),
    requestedByUserId: v.id("users"),
    vendorEmail: v.string(),
    relationshipLabel: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ status: "pending"; email: string }> => {
    const vendorEmail = normalizeEmail(args.vendorEmail);
    const rawToken = randomToken();
    const tokenHash = await sha256Hex(rawToken);
    const expiresAt = dayjs().add(14, "day").valueOf();

    const result = await ctx.runMutation(internal.connectedOrgs.createEmailRequestInternal, {
      clientOrgId: args.clientOrgId,
      requestedByUserId: args.requestedByUserId,
      vendorEmail,
      inviteTokenHash: tokenHash,
      expiresAt,
      relationshipLabel: args.relationshipLabel,
      note: args.note,
    });

    const siteUrl = getAuthSiteUrl();
    const requestUrl = `${siteUrl}/connect/request/${rawToken}`;
    const clientName = result.clientOrgName ?? "A client";
    await sendVendorRequestEmail({
      vendorEmail,
      clientName,
      note: args.note,
      requestUrl,
    });
    return { status: "pending", email: vendorEmail };
  },
});

export const resendVendorInvitation = action({
  args: { invitationId: v.id("connectedOrgInvitations") },
  handler: async (ctx, args): Promise<{ status: "resent"; email: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);

    const rawToken = randomToken();
    const tokenHash = await sha256Hex(rawToken);
    const expiresAt = Date.now() + 14 * 24 * 60 * 60 * 1000;

    const result = await ctx.runMutation(
      internal.connectedOrgs.refreshEmailRequestInternal,
      {
        invitationId: args.invitationId,
        requestedByUserId: userId,
        inviteTokenHash: tokenHash,
        expiresAt,
      },
    );

    const siteUrl = getAuthSiteUrl();
    await sendVendorRequestEmail({
      vendorEmail: result.vendorEmail,
      clientName: result.clientOrgName ?? "A client",
      note: result.note,
      requestUrl: `${siteUrl}/connect/request/${rawToken}`,
    });

    return { status: "resent", email: result.vendorEmail };
  },
});

export const requestVendorAccess = mutation({
  args: {
    clientOrgId: v.id("organizations"),
    vendorOrgId: v.id("organizations"),
    relationshipLabel: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.clientOrgId);
    if (access.accessType !== "member" || access.role !== "admin") {
      throwUserFacingError(
        userFacingErrorCodes.orgAdminRequired,
        "Only an organization admin can request vendor access.",
      );
    }
    await requireConnectClientOrg(ctx, args.clientOrgId);
    if (args.clientOrgId === args.vendorOrgId) throw new Error("Cannot connect an org to itself");
    await requireConnectVendorOrg(ctx, args.vendorOrgId);

    return await upsertRelationship(ctx, {
      clientOrgId: args.clientOrgId,
      vendorOrgId: args.vendorOrgId,
      requestedByUserId: access.userId,
      relationshipLabel: args.relationshipLabel,
      note: args.note,
    });
  },
});

async function upsertRelationship(
  ctx: MutationCtx,
  args: {
    clientOrgId: Id<"organizations">;
    vendorOrgId: Id<"organizations">;
    requestedByUserId: Id<"users">;
    relationshipLabel?: string;
    note?: string;
  },
) {
  await requireConnectClientOrg(ctx, args.clientOrgId);
  await requireConnectVendorOrg(ctx, args.vendorOrgId);
  const existing = await ctx.db
    .query("connectedOrgRelationships")
    .withIndex("client_vendor", (q) =>
      q.eq("clientOrgId", args.clientOrgId).eq("vendorOrgId", args.vendorOrgId),
    )
    .first();
  const now = Date.now();
  if (existing) {
    await ctx.db.patch(existing._id, {
      status: existing.status === "active" ? "active" : "pending",
      relationshipLabel: args.relationshipLabel,
      note: args.note,
      requestedByUserId: args.requestedByUserId,
      updatedAt: now,
    });
    return existing._id;
  }
  return await ctx.db.insert("connectedOrgRelationships", {
    clientOrgId: args.clientOrgId,
    vendorOrgId: args.vendorOrgId,
    status: "pending",
    requestedByUserId: args.requestedByUserId,
    relationshipLabel: args.relationshipLabel,
    note: args.note,
    createdAt: now,
    updatedAt: now,
  });
}

export const approve = mutation({
  args: { relationshipId: v.id("connectedOrgRelationships") },
  handler: async (ctx, args) => {
    const rel = await ctx.db.get(args.relationshipId);
    if (!rel) throw new Error("Connection request not found");
    await requireConnectVendorOrg(ctx, rel.vendorOrgId);
    const access = await requireOrgAdmin(ctx, rel.vendorOrgId);
    await ctx.db.patch(args.relationshipId, {
      status: "active",
      approvedByUserId: access.userId,
      updatedAt: Date.now(),
    });
  },
});

export const acceptInvitation = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    const tokenHash = await sha256Hex(args.token);
    const inv = await ctx.db
      .query("connectedOrgInvitations")
      .withIndex("token", (q) => q.eq("inviteTokenHash", tokenHash))
      .first();
    if (!inv) throw new Error("Invite not found");
    if (inv.status !== "pending") throw new Error("This vendor invite is no longer pending");
    if (inv.expiresAt < Date.now()) {
      await ctx.db.patch(inv._id, { status: "expired", updatedAt: Date.now() });
      throw new Error("This vendor invite has expired");
    }
    await assertCustomerUser(ctx, userId);

    await requireConnectClientOrg(ctx, inv.clientOrgId);
    let vendorOrgId = inv.vendorOrgId;
    if (!vendorOrgId) {
      const picked = await pickUserOrg(ctx, userId);
      if (picked) {
        if (picked.membership.role !== "admin") {
          throwUserFacingError(
            userFacingErrorCodes.orgAdminRequired,
            "Only an organization admin can accept this vendor invitation.",
          );
        }
        vendorOrgId = picked.org._id;
      } else {
        vendorOrgId = await ctx.db.insert("organizations", {
          name: companyNameFromEmail(inv.vendorEmail),
          type: "client",
          primaryInsuranceContactId: userId,
        });
        await ctx.db.insert("orgMemberships", { orgId: vendorOrgId, userId, role: "admin" });
      }
    } else {
      await requireConnectVendorOrg(ctx, vendorOrgId);
      await requireOrgAdmin(ctx, vendorOrgId);
    }

    const relationshipId = inv.relationshipId ?? await upsertRelationship(ctx, {
      clientOrgId: inv.clientOrgId,
      vendorOrgId,
      requestedByUserId: inv.requestedByUserId,
      relationshipLabel: inv.relationshipLabel,
      note: inv.note,
    });

    await ctx.db.patch(relationshipId, {
      status: "active",
      approvedByUserId: userId,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(inv._id, {
      status: "accepted",
      vendorOrgId,
      relationshipId,
      updatedAt: Date.now(),
    });
    return { relationshipId, vendorOrgId };
  },
});

export const getInvitationByToken = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const tokenHash = await sha256Hex(args.token);
    return await ctx.runQuery(internal.connectedOrgs.getInvitationByHashInternal, { tokenHash });
  },
});

export const getInvitationOtpCode = action({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<{ email: string; code: string } | null> => {
    const tokenHash = await sha256Hex(args.token);
    const inv = await ctx.runQuery(internal.connectedOrgs.getInvitationByHashInternal, { tokenHash });
    if (!inv) return null;
    if (inv.status !== "pending") return null;
    if (inv.expiresAt < Date.now()) return null;
    if (!inv.otpCode || !inv.vendorEmail) return null;
    if (inv.otpCodeExpiresAt && inv.otpCodeExpiresAt < Date.now()) return null;
    return { email: inv.vendorEmail, code: inv.otpCode };
  },
});

export const revokeInvitation = mutation({
  args: { invitationId: v.id("connectedOrgInvitations") },
  handler: async (ctx, args) => {
    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation) throw new Error("Vendor invitation not found");
    const access = await getOrgAccess(ctx, invitation.clientOrgId);
    if (access.accessType !== "member" || access.role !== "admin") {
      throwUserFacingError(userFacingErrorCodes.orgAdminRequired);
    }
    if (invitation.status === "accepted") {
      throw new Error("Revoke the active connection instead");
    }
    await ctx.db.patch(invitation._id, {
      status: "revoked",
      otpCode: undefined,
      otpCodeExpiresAt: undefined,
      updatedAt: dayjs().valueOf(),
    });
    if (invitation.relationshipId) {
      const relationship = await ctx.db.get(invitation.relationshipId);
      if (relationship?.status === "pending") {
        await ctx.db.patch(relationship._id, {
          status: "revoked",
          revokedByUserId: access.userId,
          updatedAt: dayjs().valueOf(),
        });
      }
    }
  },
});

export const revoke = mutation({
  args: { relationshipId: v.id("connectedOrgRelationships") },
  handler: async (ctx, args) => {
    const rel = await ctx.db.get(args.relationshipId);
    if (!rel) throw new Error("Connection not found");
    const { userId } = await requireAuth(ctx);
    const clientMembership = await ctx.db
      .query("orgMemberships")
      .withIndex("organization_user", (q) => q.eq("orgId", rel.clientOrgId).eq("userId", userId))
      .first();
    const vendorMembership = await ctx.db
      .query("orgMemberships")
      .withIndex("organization_user", (q) => q.eq("orgId", rel.vendorOrgId).eq("userId", userId))
      .first();
    if (clientMembership?.role !== "admin" && vendorMembership?.role !== "admin") {
      throwUserFacingError(
        userFacingErrorCodes.orgAdminRequired,
        "Only an organization admin can revoke this connection.",
      );
    }
    await ctx.db.patch(args.relationshipId, {
      status: "revoked",
      revokedByUserId: userId,
      updatedAt: dayjs().valueOf(),
    });
    const invitations = await ctx.db
      .query("connectedOrgInvitations")
      .withIndex("client", (q) => q.eq("clientOrgId", rel.clientOrgId))
      .filter((q) => q.eq(q.field("relationshipId"), rel._id))
      .collect();
    for (const invitation of invitations) {
      if (invitation.status !== "pending" && invitation.status !== "expired") continue;
      await ctx.db.patch(invitation._id, {
        status: "revoked",
        otpCode: undefined,
        otpCodeExpiresAt: undefined,
        updatedAt: dayjs().valueOf(),
      });
    }
  },
});

export const createEmailRequestInternal = internalMutation({
  args: {
    clientOrgId: v.id("organizations"),
    requestedByUserId: v.id("users"),
    vendorEmail: v.string(),
    inviteTokenHash: v.string(),
    expiresAt: v.number(),
    relationshipLabel: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("organization_user", (q) =>
        q.eq("orgId", args.clientOrgId).eq("userId", args.requestedByUserId),
      )
      .first();
    if (membership?.role !== "admin") {
      throwUserFacingError(
        userFacingErrorCodes.orgAdminRequired,
        "Only an organization admin can request vendor access.",
      );
    }

    const clientOrg = await requireConnectClientOrg(ctx, args.clientOrgId);
    const existingUser = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.vendorEmail))
      .first();
    const picked = existingUser ? await pickUserOrg(ctx, existingUser._id) : null;
    const vendorOrgId = picked?.org._id;
    if (vendorOrgId === args.clientOrgId) throw new Error("Cannot request access from your own organization");

    const now = Date.now();
    const relationshipId = vendorOrgId
      ? await upsertRelationship(ctx, {
          clientOrgId: args.clientOrgId,
          vendorOrgId,
          requestedByUserId: args.requestedByUserId,
          relationshipLabel: args.relationshipLabel,
          note: args.note,
        })
      : undefined;

    const invitationId = await ctx.db.insert("connectedOrgInvitations", {
      clientOrgId: args.clientOrgId,
      vendorOrgId,
      relationshipId,
      vendorEmail: args.vendorEmail,
      requestedByUserId: args.requestedByUserId,
      inviteTokenHash: args.inviteTokenHash,
      status: "pending",
      relationshipLabel: args.relationshipLabel,
      note: args.note,
      expiresAt: args.expiresAt,
      createdAt: now,
      updatedAt: now,
    });

    return {
      invitationId,
      relationshipId,
      clientOrgName: clientOrg.name,
      vendorOrgName: picked?.org.name,
    };
  },
});

export const refreshEmailRequestInternal = internalMutation({
  args: {
    invitationId: v.id("connectedOrgInvitations"),
    requestedByUserId: v.id("users"),
    inviteTokenHash: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const inv = await ctx.db.get(args.invitationId);
    if (!inv) throw new Error("Vendor invitation not found");
    if (inv.status === "accepted" || inv.status === "revoked") {
      throw new Error("Only pending or expired vendor invitations can be resent");
    }

    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("organization_user", (q) =>
        q.eq("orgId", inv.clientOrgId).eq("userId", args.requestedByUserId),
      )
      .first();
    if (membership?.role !== "admin") {
      throwUserFacingError(
        userFacingErrorCodes.orgAdminRequired,
        "Only an organization admin can resend vendor invitations.",
      );
    }

    const clientOrg = await ctx.db.get(inv.clientOrgId);
    if (!clientOrg) throw new Error("Client organization not found");

    await ctx.db.patch(inv._id, {
      requestedByUserId: args.requestedByUserId,
      inviteTokenHash: args.inviteTokenHash,
      status: "pending",
      expiresAt: args.expiresAt,
      updatedAt: Date.now(),
    });

    return {
      vendorEmail: inv.vendorEmail,
      clientOrgName: clientOrg.name,
      note: inv.note,
    };
  },
});

export const getInvitationByHashInternal = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    const inv = await ctx.db
      .query("connectedOrgInvitations")
      .withIndex("token", (q) => q.eq("inviteTokenHash", args.tokenHash))
      .first();
    if (!inv) return null;
    return await enrichInvitation(ctx, inv);
  },
});

export const listActiveVendorsInternal = internalQuery({
  args: { clientOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const relationships = await ctx.db
      .query("connectedOrgRelationships")
      .withIndex("client_status", (q) =>
        q.eq("clientOrgId", args.clientOrgId).eq("status", "active"),
      )
      .collect();
    return await Promise.all(relationships.map((rel) => enrichRelationship(ctx, rel)));
  },
});

export const hasActiveConnectionInternal = internalQuery({
  args: { clientOrgId: v.id("organizations"), vendorOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const rel = await ctx.db
      .query("connectedOrgRelationships")
      .withIndex("client_vendor", (q) =>
        q.eq("clientOrgId", args.clientOrgId).eq("vendorOrgId", args.vendorOrgId),
      )
      .first();
    return !!rel && rel.status === "active";
  },
});
