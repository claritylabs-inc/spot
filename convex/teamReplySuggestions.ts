import { v } from "convex/values";
import dayjs from "dayjs";

import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, query, type QueryCtx } from "./_generated/server";
import { requireOperator } from "./lib/operatorIdentity";
import { readOrgWiki } from "./orgWiki";
import { readIntakeBusinessProfile } from "./lib/intakeApplication";
import { requestFacts } from "./lib/procurementInformationAccess";
import { teamTargetProblem } from "./lib/teamEmailStore";
import { providerForEmail } from "./lib/providerRecipients";
import { intakeCatalogCoverage } from "../lib/intake-acord-questions";
import { submittedIntakeApplication } from "../lib/intake-application";
import { intakeMarkdown } from "../lib/insurance-intake";

const MESSAGES = 12;
const MESSAGE_CHARS = 4_000;
const FACTS_CHARS = 12_000;

/**
 * What a suggested reply may draw on: the conversation's latest messages, the
 * client's submitted application and the request's answered information
 * questions. Null once the message is no longer the one to answer.
 */
export const contextInternal = internalQuery({
  args: { threadId: v.id("teamEmailThreads"), messageId: v.id("teamEmailMessages") },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.deletedAt !== undefined || thread.archivedAt) return null;
    if (await teamTargetProblem(ctx, thread)) return null;
    const recent = await ctx.db
      .query("teamEmailMessages")
      .withIndex("by_threadId_and_receivedAt", (q) => q.eq("threadId", thread._id))
      .order("desc")
      .take(MESSAGES);
    if (recent[0]?._id !== args.messageId) return null;
    const context = await replyContext(ctx, thread, recent);
    // Spot never emails a Do Not Contact provider, so there is no reply to draft.
    return context.provider?.relationship === "do_not_contact" ? null : context;
  },
});

/** What a reply may draw on: the client's application, answered questions and the messages. */
async function replyContext(
  ctx: QueryCtx,
  thread: Doc<"teamEmailThreads">,
  recent: Doc<"teamEmailMessages">[],
) {
  const latestInbound = recent.find((message) => message.direction === "inbound");
  const [client, request, provider] = await Promise.all([
    thread.clientOrgId ? ctx.db.get(thread.clientOrgId) : null,
    thread.requestId ? ctx.db.get(thread.requestId) : null,
    latestInbound ? providerForEmail(ctx, latestInbound.fromEmail) : null,
  ]);
  const application =
    (request && submittedIntakeApplication(request)) ??
    (thread.clientOrgId ? await readIntakeBusinessProfile(ctx, thread.clientOrgId) : null);
  const answered = request
    ? (await requestFacts(ctx, request._id)).flatMap((row) =>
        row.answer && !row.answer.unsure && row.answer.answer.trim()
          ? [{ question: row.question.label, answer: row.answer.answer }]
          : [],
      )
    : [];
  const facts = application
    ? intakeMarkdown(application.answers, undefined, application.details, intakeCatalogCoverage)
    : "";
  return {
    orgId: thread.clientOrgId ?? null,
    subject: thread.subject,
    clientName: client?.name ?? null,
    /** Set when the latest sender is an insurance provider we know. */
    provider: provider
      ? {
          name: provider.providerName,
          relationship:
            provider.networkStatus === "blacklisted"
              ? ("do_not_contact" as const)
              : provider.networkStatus === "active"
                ? ("active_relationship" as const)
                : ("cold" as const),
        }
      : null,
    requestTitle: request?.title ?? null,
    clientFacts: facts.slice(0, FACTS_CHARS) || null,
    answeredQuestions: answered,
    messages: recent.reverse().map((message) => ({
      direction: message.direction,
      from: message.fromName ? `${message.fromName} <${message.fromEmail}>` : message.fromEmail,
      sentAt: dayjs(message.receivedAt).toISOString(),
      text: message.currentText.slice(0, MESSAGE_CHARS),
    })),
  };
}

/**
 * Context for suggesting values for the blanks in a reply: the reply context
 * plus the client's wiki. Operators only.
 */
export const blankContext = query({
  args: { threadId: v.id("teamEmailThreads") },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.deletedAt !== undefined) return null;
    const recent = await ctx.db
      .query("teamEmailMessages")
      .withIndex("by_threadId_and_receivedAt", (q) => q.eq("threadId", thread._id))
      .order("desc")
      .take(MESSAGES);
    const context = await replyContext(ctx, thread, recent);
    const wiki = thread.clientOrgId ? await readOrgWiki(ctx, thread.clientOrgId) : null;
    return { ...context, clientWiki: wiki?.markdown.slice(0, FACTS_CHARS) || null };
  },
});

/** Stores the outcome only if no newer inbound message replaced the suggestion meanwhile. */
export const saveInternal = internalMutation({
  args: {
    threadId: v.id("teamEmailThreads"),
    messageId: v.id("teamEmailMessages"),
    reply: v.optional(v.string()),
    missing: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("teamEmailReplySuggestions")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .unique();
    if (!row || row.messageId !== args.messageId) return;
    await ctx.db.patch(row._id, {
      status: args.reply ? "ready" : "failed",
      reply: args.reply,
      missing: args.missing,
      updatedAt: dayjs().valueOf(),
    });
  },
});
