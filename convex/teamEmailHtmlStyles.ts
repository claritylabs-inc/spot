import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { classifyEmailHtml, emailHtmlSignals } from "../lib/email-html-style";

const senderKey = (email: string) => email.trim().toLowerCase();
const MAX_MARKUP_CHARS = 4000;

/** A message whose HTML style its markup leaves unclear, with any verdict already given for the sender's same-shaped mail. */
export const candidateInternal = internalQuery({
  args: { messageId: v.id("teamEmailMessages") },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message?.bodyHtml || message.htmlStyle !== undefined) return null;
    const signals = emailHtmlSignals(message.bodyHtml);
    if (classifyEmailHtml(signals)) return null;
    const signalsKey = JSON.stringify(signals);
    const known = await ctx.db
      .query("teamEmailHtmlStyleJudgments")
      .withIndex("by_fromEmail_and_signals", (q) =>
        q
          .eq("fromEmail", senderKey(message.fromEmail))
          .eq("signals", signalsKey),
      )
      .first();
    return {
      clientOrgId: message.clientOrgId,
      subject: message.subject,
      fromName: message.fromName ?? null,
      fromEmail: message.fromEmail,
      text: message.currentText.slice(0, 2000),
      markup: message.bodyHtml
        .replace(/<(style|head)\b[\s\S]*?<\/\1>/gi, "")
        .replace(/\s+/g, " ")
        .slice(0, MAX_MARKUP_CHARS),
      signals,
      signalsKey,
      known: known?.style ?? null,
    };
  },
});

/** Records the message's HTML style and remembers it for the sender's same-shaped mail. */
export const saveInternal = internalMutation({
  args: {
    messageId: v.id("teamEmailMessages"),
    signals: v.string(),
    style: v.union(v.literal("conversational"), v.literal("designed")),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message || message.htmlStyle !== undefined) return;
    await ctx.db.patch(args.messageId, { htmlStyle: args.style });
    const fromEmail = senderKey(message.fromEmail);
    const known = await ctx.db
      .query("teamEmailHtmlStyleJudgments")
      .withIndex("by_fromEmail_and_signals", (q) =>
        q.eq("fromEmail", fromEmail).eq("signals", args.signals),
      )
      .first();
    if (!known)
      await ctx.db.insert("teamEmailHtmlStyleJudgments", {
        fromEmail,
        signals: args.signals,
        style: args.style,
      });
  },
});
