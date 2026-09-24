import dayjs from "dayjs";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { action, internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { buildEmailShell, escapeHtml } from "./lib/emailTemplate";
import { getBrandingContext } from "./lib/branding";
import { getAuthFromAddress, sendResendEmail } from "./lib/resend";
import { getAuthSiteUrl } from "./lib/domains";
import {
  EMPLOYEE_OTP_PROVIDER,
  inspectEmployeeIdentity,
} from "./lib/employeeProvisioning";
import {
  isOperatorDomainEmail,
  isReservedOperatorEmail,
  normalizeOperatorEmail,
  operatorEmailIdentityUsers,
  requireOperatorForUser,
  writeOperatorAudit,
} from "./lib/operatorIdentity";
import { assertNoOperatorImpersonation } from "./lib/clientFiles";

type InviteResult = { email: string; outcome: "created" | "adopted"; emailSent: boolean };

export function normalizeInviteEmail(email: string) {
  const normalized = normalizeOperatorEmail(email);
  if (!isOperatorDomainEmail(normalized) || isReservedOperatorEmail(normalized)) {
    throw new Error("Use a company email address that is eligible for operator access.");
  }
  return normalized;
}

export async function validateOperatorInvitation(ctx: MutationCtx, value: string) {
  const email = normalizeInviteEmail(value);
  const owners = await operatorEmailIdentityUsers(ctx, email);
  const identity = await inspectEmployeeIdentity(ctx, email);
  if (identity.status === "blocked" ||
      (identity.status === "absent" && owners.length > 0) ||
      (identity.status === "member" && owners.some((id) => id !== identity.user._id))) {
    throw new Error("This address has an existing or conflicting identity. Use the operator’s primary email or contact an owner.");
  }
  return { email, identity };
}

async function createOrAdoptOperator(
  ctx: MutationCtx,
  args: { email: string; invitedByUserId: Id<"users"> },
) {
  const { email, identity } = await validateOperatorInvitation(ctx, args.email);

  if (identity.status === "member") {
    await writeOperatorAudit(ctx, {
      operatorUserId: args.invitedByUserId,
      targetUserId: identity.user._id,
      type: "operator_invited",
      summary: `Requested operator invitation email for ${email}`,
      metadata: { email, outcome: "adopted" },
    });
    return { email, userId: identity.user._id, outcome: "adopted" as const };
  }

  const now = dayjs().valueOf();
  const userId = await ctx.db.insert("users", {
    email,
    accountKind: "operator",
    onboardingComplete: true,
  });
  await ctx.db.insert("authAccounts", {
    userId,
    provider: EMPLOYEE_OTP_PROVIDER,
    providerAccountId: email,
  });
  await ctx.db.insert("operatorProfiles", {
    userId,
    email,
    role: "operator",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await writeOperatorAudit(ctx, {
    operatorUserId: args.invitedByUserId,
    targetUserId: userId,
    type: "operator_invited",
    summary: `Invited ${email} as a Spot operator`,
    metadata: { email, outcome: "created" },
  });
  return { email, userId, outcome: "created" as const };
}

async function sendOperatorInvitationEmail(email: string) {
  const siteUrl = getAuthSiteUrl();
  const inviteUrl = `${siteUrl.replace(/\/$/, "")}/operator/login?email=${encodeURIComponent(email)}`;
  const subject = "You’re invited to Spot operator access";
  const escapedInviteUrl = escapeHtml(inviteUrl);
  const escapedEmail = escapeHtml(email);
  const branding = getBrandingContext();
  const bodyHtml = `
<tr><td style="padding:28px 40px 0 40px;">
  <p class="spot-email-text-secondary" style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;color:#374151;line-height:1.6;">
    You’ve been invited to use Spot’s operator console.
  </p>
</td></tr>
<tr><td align="center" style="padding:24px 40px 0 40px;">
  <a href="${escapedInviteUrl}" class="spot-email-button" style="display:inline-block;padding:8px 22px;background-color:#000000;color:#ffffff;font-family:-apple-system,sans-serif;font-size:14px;text-decoration:none;border-radius:999px;line-height:1.4;">Open operator login</a>
</td></tr>
<tr><td style="padding:20px 40px 0 40px;">
  <p class="spot-email-text-muted" style="margin:0;font-family:-apple-system,sans-serif;font-size:12px;color:#6b7280;line-height:1.6;">
    Sign in with ${escapedEmail}. Spot will send a one-time code to that mailbox.<br>
    <a href="${escapedInviteUrl}" class="spot-email-link" style="color:#6b7280;word-break:break-all;">${escapedInviteUrl}</a>
  </p>
</td></tr>
<tr><td style="padding:16px 40px 32px 40px;"><p class="spot-email-text-muted" style="margin:0;font-family:-apple-system,sans-serif;font-size:11px;color:#9ca3af;line-height:1.6;">If you weren’t expecting this, you can ignore the message.</p></td></tr>`;
  const html = buildEmailShell({
    title: subject,
    bodyHtml,
    branding,
    siteUrl,
  });
  const result = await sendResendEmail(
    {
      from: getAuthFromAddress("Spot"),
      to: email,
      subject,
      html,
      text: `You’ve been invited to use Spot’s operator console.\n\nOpen operator login: ${inviteUrl}\n\nSign in with ${email}; Spot will send a one-time code to that mailbox.`,
    },
    { retries: 2 },
  );
  return result.ok;
}

export const inviteOperatorInternal = internalMutation({
  args: {
    email: v.string(),
    invitedByUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperatorForUser(ctx, args.invitedByUserId);
    await assertNoOperatorImpersonation(ctx, operator.userId);
    return await createOrAdoptOperator(ctx, args);
  },
});

export const inviteOperator = action({
  args: { email: v.string() },
  handler: async (ctx, args): Promise<InviteResult> => {
    const invitedByUserId = await getAuthUserId(ctx);
    if (!invitedByUserId) throw new Error("Authentication required");
    const invitation = await ctx.runMutation(
      internal.operatorInvitations.inviteOperatorInternal,
      { email: args.email, invitedByUserId },
    );
    const emailSent = await sendOperatorInvitationEmail(invitation.email).catch(() => false);
    return { email: invitation.email, outcome: invitation.outcome, emailSent };
  },
});

export const inviteOperatorForAgentInternal = internalAction({
  args: {
    email: v.string(),
    operatorUserId: v.id("users"),
  },
  handler: async (ctx, args): Promise<InviteResult> => {
    const invitation = await ctx.runMutation(
      internal.operatorInvitations.inviteOperatorInternal,
      { email: args.email, invitedByUserId: args.operatorUserId },
    );
    const emailSent = await sendOperatorInvitationEmail(invitation.email).catch(() => false);
    return { email: invitation.email, outcome: invitation.outcome, emailSent };
  },
});
