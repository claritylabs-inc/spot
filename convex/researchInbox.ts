import dayjs from "dayjs";
import { v } from "convex/values";
import { httpAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { RESEARCH_EMAIL_DOMAIN } from "./lib/websiteTech";

const INBOX_TTL_MS = 30 * 60 * 1_000;
const MAX_EMAILS = 10;

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomHex(bytes: number) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

// Signup identities only need to look like a person: first names of Spanish conquistadors, in ASCII.
const SIGNUP_NAMES = [
  "Hernan",
  "Francisco",
  "Diego",
  "Pedro",
  "Vasco",
  "Hernando",
  "Gonzalo",
  "Juan",
  "Alvar",
  "Panfilo",
  "Sebastian",
  "Lope",
];

/** A fresh named address for one browser-agent run, readable only with the returned capability token. */
export const issue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const name =
      SIGNUP_NAMES[crypto.getRandomValues(new Uint32Array(1))[0] % SIGNUP_NAMES.length];
    const address = `${name.toLowerCase()}-${randomHex(2)}@${RESEARCH_EMAIL_DOMAIN}`;
    const token = randomHex(32);
    await ctx.db.insert("researchInboxes", {
      address,
      tokenHash: await sha256Hex(token),
      expiresAt: dayjs().valueOf() + INBOX_TTL_MS,
    });
    return { address, token, name };
  },
});

/** Records inbound research mail, but only for an address a live run issued. */
export const record = internalMutation({
  args: {
    address: v.string(),
    resendEmailId: v.string(),
    from: v.string(),
    subject: v.string(),
  },
  handler: async (ctx, args) => {
    const address = args.address.trim().toLowerCase();
    const inbox = await ctx.db
      .query("researchInboxes")
      .withIndex("address", (q) => q.eq("address", address))
      .unique();
    if (!inbox || inbox.expiresAt < dayjs().valueOf()) return false;
    const duplicate = await ctx.db
      .query("researchInboxEmails")
      .withIndex("resend_email", (q) => q.eq("resendEmailId", args.resendEmailId))
      .first();
    if (duplicate) return false;
    await ctx.db.insert("researchInboxEmails", {
      address,
      resendEmailId: args.resendEmailId,
      from: args.from.slice(0, 320),
      subject: args.subject.slice(0, 500),
      receivedAt: dayjs().valueOf(),
    });
    return true;
  },
});

export const emailsForToken = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    const inbox = await ctx.db
      .query("researchInboxes")
      .withIndex("token", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    if (!inbox || inbox.expiresAt < dayjs().valueOf()) return null;
    const emails = await ctx.db
      .query("researchInboxEmails")
      .withIndex("address", (q) => q.eq("address", inbox.address))
      .order("desc")
      .take(MAX_EMAILS);
    return { address: inbox.address, emails };
  },
});

function decodeEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Links and likely one-time codes, the only parts of a verification email the agent needs. */
function extractVerification(text: string, html: string, subject: string) {
  const links = [
    ...[...html.matchAll(/href=["']([^"']+)["']/gi)].map((match) => decodeEntities(match[1])),
    ...(text.match(/https?:\/\/[^\s<>"')\]]+/g) ?? []),
  ].filter((link) => /^https:\/\//i.test(link) && !/unsubscribe|preferences/i.test(link));
  const plain = `${subject}\n${text || html.replace(/<[^>]+>/g, " ")}`;
  const codes = [...plain.matchAll(/\b(\d{4,8})\b/g)]
    .map((match) => match[1])
    .filter((code) => !/^(19|20)\d{2}$/.test(code));
  return {
    links: [...new Set(links)].slice(0, 15),
    codes: [...new Set(codes)].slice(0, 5),
  };
}

/** GET /research-inbox?token=… — the browser agent's read-only view of its own run inbox. */
export const readInbox = httpAction(async (ctx, request) => {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!/^[a-f0-9]{64}$/.test(token)) return new Response("Not found", { status: 404 });
  const inbox = await ctx.runQuery(internal.researchInbox.emailsForToken, {
    tokenHash: await sha256Hex(token),
  });
  if (!inbox) return new Response("Not found", { status: 404 });
  const emails = await Promise.all(
    inbox.emails.map(async (email) => {
      let text = "";
      let html = "";
      try {
        const response = await fetch(
          `https://api.resend.com/emails/receiving/${encodeURIComponent(email.resendEmailId)}`,
          { headers: { Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}` } },
        );
        if (response.ok) {
          const body = (await response.json()) as { text?: string | null; html?: string | null };
          text = (body.text ?? "").slice(0, 50_000);
          html = (body.html ?? "").slice(0, 200_000);
        }
      } catch {
        // The agent can check again; a missing body only means no links yet.
      }
      return {
        from: email.from,
        subject: email.subject,
        receivedAt: dayjs(email.receivedAt).toISOString(),
        ...extractVerification(text, html, email.subject),
      };
    }),
  );
  return new Response(JSON.stringify({ address: inbox.address, emails }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
});
