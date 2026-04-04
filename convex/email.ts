import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

// ── Email Template Helpers ──

const STYLES = {
  bg: "#faf8f4",
  text: "#111827",
  muted: "#8a8578",
  border: "#e5e2dc",
  accent: "#111827",
  font: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
} as const;

function baseWrapper(content: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${STYLES.bg};font-family:${STYLES.font};color:${STYLES.text};line-height:1.6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${STYLES.bg};padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:600px;background:#ffffff;border-radius:8px;border:1px solid ${STYLES.border};overflow:hidden;">
        ${content}
      </table>
      <p style="font-size:12px;color:${STYLES.muted};margin-top:24px;text-align:center;">
        Powered by <a href="https://claritylabs.inc" style="color:${STYLES.muted};text-decoration:underline;">Clarity Labs</a>
      </p>
    </td></tr>
  </table>
</body>
</html>`;
}

function headerRow(title: string): string {
  return `<tr><td style="padding:28px 32px 20px;border-bottom:1px solid ${STYLES.border};">
    <h1 style="margin:0;font-size:22px;font-weight:600;color:${STYLES.accent};">${title}</h1>
  </td></tr>`;
}

function fieldRow(label: string, value: string | undefined | null): string {
  if (!value) return "";
  return `<tr><td style="padding:8px 32px;">
    <span style="font-size:13px;color:${STYLES.muted};text-transform:uppercase;letter-spacing:0.5px;">${label}</span><br>
    <span style="font-size:15px;color:${STYLES.text};font-weight:500;">${value}</span>
  </td></tr>`;
}

function coverageTable(coverages: any[]): string {
  if (!coverages || coverages.length === 0) return "";
  const rows = coverages
    .filter((c: any) => c && (c.name || c.type))
    .slice(0, 15)
    .map((c: any) => {
      const name = c.name || c.type || "Coverage";
      const limit = c.limit || c.limitPerOccurrence || c.limitPerPerson || "";
      const deductible = c.deductible || "";
      return `<tr>
        <td style="padding:6px 12px;font-size:14px;color:${STYLES.text};border-bottom:1px solid ${STYLES.border};">${name}</td>
        <td style="padding:6px 12px;font-size:14px;color:${STYLES.text};border-bottom:1px solid ${STYLES.border};">${limit}</td>
        <td style="padding:6px 12px;font-size:14px;color:${STYLES.text};border-bottom:1px solid ${STYLES.border};">${deductible}</td>
      </tr>`;
    })
    .join("");

  return `<tr><td style="padding:16px 32px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${STYLES.border};border-radius:6px;overflow:hidden;">
      <tr style="background:${STYLES.bg};">
        <th style="padding:8px 12px;font-size:12px;color:${STYLES.muted};text-align:left;text-transform:uppercase;letter-spacing:0.5px;">Coverage</th>
        <th style="padding:8px 12px;font-size:12px;color:${STYLES.muted};text-align:left;text-transform:uppercase;letter-spacing:0.5px;">Limit</th>
        <th style="padding:8px 12px;font-size:12px;color:${STYLES.muted};text-align:left;text-transform:uppercase;letter-spacing:0.5px;">Deductible</th>
      </tr>
      ${rows}
    </table>
  </td></tr>`;
}

export function buildProofOfInsuranceEmail(
  policy: any,
  userName: string
): { subject: string; html: string } {
  const carrier = policy.carrier || "Insurance Carrier";
  const subject = `Proof of Insurance — ${carrier} Policy ${policy.policyNumber || ""}`.trim();

  const html = baseWrapper(`
    ${headerRow("Proof of Insurance")}
    <tr><td><table width="100%" cellpadding="0" cellspacing="0">
      ${fieldRow("Carrier", policy.carrier)}
      ${fieldRow("Policy Number", policy.policyNumber)}
      ${fieldRow("Named Insured", policy.insuredName || userName)}
      ${fieldRow("Effective Date", policy.effectiveDate)}
      ${fieldRow("Expiration Date", policy.expirationDate)}
      ${fieldRow("Premium", policy.premium)}
      ${fieldRow("Policy Type", policy.category)}
    </table></td></tr>
    ${coverageTable(policy.coverages || [])}
    <tr><td style="padding:20px 32px 28px;border-top:1px solid ${STYLES.border};">
      <p style="font-size:13px;color:${STYLES.muted};margin:0;">
        This email was sent by Spot on behalf of ${userName}. Spot is powered by Clarity Labs.
      </p>
    </td></tr>
  `);

  return { subject, html };
}

export function buildCoverageDetailEmail(
  policy: any,
  coverageNames: string[],
  customMessage?: string
): { subject: string; html: string } {
  const carrier = policy.carrier || "Insurance";
  const subject = `Coverage Details — ${carrier}`;

  const allCoverages: any[] = policy.coverages || [];
  const matchedCoverages = coverageNames.length > 0
    ? allCoverages.filter((c: any) => {
        const name = (c.name || c.type || "").toLowerCase();
        return coverageNames.some((n) => name.includes(n.toLowerCase()));
      })
    : allCoverages;

  const displayCoverages = matchedCoverages.length > 0 ? matchedCoverages : allCoverages;

  const customBlock = customMessage
    ? `<tr><td style="padding:16px 32px 8px;">
        <p style="font-size:15px;color:${STYLES.text};margin:0;">${customMessage}</p>
      </td></tr>`
    : "";

  const html = baseWrapper(`
    ${headerRow("Coverage Details")}
    ${customBlock}
    <tr><td><table width="100%" cellpadding="0" cellspacing="0">
      ${fieldRow("Carrier", policy.carrier)}
      ${fieldRow("Policy Number", policy.policyNumber)}
      ${fieldRow("Effective Date", policy.effectiveDate)}
      ${fieldRow("Expiration Date", policy.expirationDate)}
    </table></td></tr>
    ${coverageTable(displayCoverages)}
    <tr><td style="padding:20px 32px 28px;border-top:1px solid ${STYLES.border};">
      <p style="font-size:13px;color:${STYLES.muted};margin:0;">
        Sent by Spot, powered by Clarity Labs.
      </p>
    </td></tr>
  `);

  return { subject, html };
}

export function buildCoiEmail(
  policy: any,
  recipientName: string,
  purpose: string,
  userName: string
): { subject: string; html: string } {
  const carrier = policy.carrier || "Insurance Carrier";
  const subject = `Certificate of Insurance Summary — ${carrier}`;

  const html = baseWrapper(`
    ${headerRow("Certificate of Insurance Summary")}
    <tr><td style="padding:12px 32px 4px;">
      <p style="font-size:14px;color:${STYLES.muted};margin:0;">
        Provided for: <strong style="color:${STYLES.text};">${purpose}</strong><br>
        Requested by: <strong style="color:${STYLES.text};">${recipientName}</strong>
      </p>
    </td></tr>
    <tr><td><table width="100%" cellpadding="0" cellspacing="0">
      ${fieldRow("Carrier", policy.carrier)}
      ${fieldRow("Policy Number", policy.policyNumber)}
      ${fieldRow("Named Insured", policy.insuredName || userName)}
      ${fieldRow("Effective Date", policy.effectiveDate)}
      ${fieldRow("Expiration Date", policy.expirationDate)}
      ${fieldRow("Premium", policy.premium)}
    </table></td></tr>
    ${coverageTable(policy.coverages || [])}
    <tr><td style="padding:20px 32px 28px;border-top:1px solid ${STYLES.border};">
      <p style="font-size:13px;color:${STYLES.muted};margin:0;font-style:italic;">
        This is an informational summary, not an official ACORD certificate.
      </p>
      <p style="font-size:13px;color:${STYLES.muted};margin:8px 0 0;">
        This email was sent by Spot on behalf of ${userName}. Spot is powered by Clarity Labs.
      </p>
    </td></tr>
  `);

  return { subject, html };
}

// ── Convex Mutations & Queries ──

export const createPendingEmail = internalMutation({
  args: {
    userId: v.id("users"),
    recipientEmail: v.string(),
    recipientName: v.optional(v.string()),
    subject: v.string(),
    htmlBody: v.string(),
    ccEmail: v.optional(v.string()),
    purpose: v.string(),
    coiPdfStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("pendingEmails", {
      ...args,
      status: "awaiting_confirmation",
      createdAt: Date.now(),
    });
  },
});

export const updatePendingEmailStatus = internalMutation({
  args: {
    pendingEmailId: v.id("pendingEmails"),
    status: v.string(),
    scheduledFunctionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { pendingEmailId, ...fields } = args;
    await ctx.db.patch(pendingEmailId, fields);
  },
});

export const getPendingForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const pending = await ctx.db
      .query("pendingEmails")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .collect();

    return pending.find(
      (e) => e.status === "awaiting_confirmation" || e.status === "scheduled"
    ) ?? null;
  },
});

export const scheduleEmailSend = internalMutation({
  args: {
    pendingEmailId: v.id("pendingEmails"),
  },
  handler: async (ctx, args) => {
    const scheduledId = await ctx.scheduler.runAfter(
      20_000,
      internal.emailActions.sendEmailNow,
      { pendingEmailId: args.pendingEmailId }
    );
    await ctx.db.patch(args.pendingEmailId, {
      status: "scheduled",
      scheduledFunctionId: scheduledId.toString(),
    });
  },
});

export const cancelPendingEmail = internalMutation({
  args: {
    pendingEmailId: v.id("pendingEmails"),
  },
  handler: async (ctx, args) => {
    const pending = await ctx.db.get(args.pendingEmailId);
    if (!pending) return;

    if (pending.scheduledFunctionId) {
      try {
        await ctx.scheduler.cancel(pending.scheduledFunctionId as any);
      } catch {
        // Scheduled function may have already executed
      }
    }

    const newStatus = pending.status === "scheduled" ? "undone" : "cancelled";
    await ctx.db.patch(args.pendingEmailId, { status: newStatus });
  },
});

export const getPendingEmailById = internalQuery({
  args: { pendingEmailId: v.id("pendingEmails") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.pendingEmailId);
  },
});

// ── Email Thread Tracking ──

export const createEmailThread = internalMutation({
  args: {
    userId: v.id("users"),
    pendingEmailId: v.id("pendingEmails"),
    outboundMessageId: v.string(),
    recipientEmail: v.string(),
    recipientName: v.optional(v.string()),
    subject: v.string(),
    fromAddress: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("emailThreads", {
      ...args,
      status: "active",
      lastActivityAt: now,
      createdAt: now,
    });
  },
});

export const getThreadByFromAddress = internalQuery({
  args: { fromAddress: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("emailThreads")
      .withIndex("by_from_address", (q) => q.eq("fromAddress", args.fromAddress))
      .first();
  },
});

export const getThreadByOutboundMessageId = internalQuery({
  args: { outboundMessageId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("emailThreads")
      .withIndex("by_outbound_message_id", (q) => q.eq("outboundMessageId", args.outboundMessageId))
      .first();
  },
});

export const updateThreadActivity = internalMutation({
  args: { threadId: v.id("emailThreads") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.threadId, { lastActivityAt: Date.now() });
  },
});

export const buildEmailReplyHtml = internalQuery({
  args: { body: v.string() },
  handler: async (_ctx, args) => {
    // Simple wrapper for reply emails
    return `<!DOCTYPE html>
<html><body style="font-family:system-ui,-apple-system,sans-serif;color:#111827;line-height:1.6;margin:0;padding:20px;">
<div style="max-width:600px;">${args.body.replace(/\n/g, "<br>")}</div>
<p style="font-size:12px;color:#8a8578;margin-top:24px;border-top:1px solid #e5e2dc;padding-top:12px;">
  Sent by Spot, powered by <a href="https://claritylabs.inc" style="color:#8a8578;">Clarity Labs</a>
</p>
</body></html>`;
  },
});
