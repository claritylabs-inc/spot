import dayjs from "dayjs";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Starts a suggested reply to a new inbound message. The conversation keeps one
 * suggestion, always for its latest inbound message; an older one is replaced.
 */
export async function queueTeamReplySuggestion(
  ctx: MutationCtx,
  args: { threadId: Id<"teamEmailThreads">; messageId: Id<"teamEmailMessages"> },
) {
  const existing = await ctx.db
    .query("teamEmailReplySuggestions")
    .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
    .unique();
  const fields = {
    messageId: args.messageId,
    status: "pending" as const,
    reply: undefined,
    missing: undefined,
    updatedAt: dayjs().valueOf(),
  };
  if (existing) await ctx.db.patch(existing._id, fields);
  else await ctx.db.insert("teamEmailReplySuggestions", { threadId: args.threadId, ...fields });
  await ctx.scheduler.runAfter(0, internal.actions.teamReplySuggestions.generate, args);
}

const MAX_SUGGESTION_CHARS = 10_000;

/**
 * Replaces the conversation's suggested reply with the AI panel's revision. It
 * answers the newest message and shows in the reply box; nothing is sent.
 */
export async function reviseTeamReplySuggestion(
  ctx: MutationCtx,
  args: { threadId: Id<"teamEmailThreads">; reply: string },
) {
  const reply = args.reply.replace(/\r\n/g, "\n").trim();
  if (!reply || reply.length > MAX_SUGGESTION_CHARS) throw new Error("The draft must be 1–10,000 characters.");
  const thread = await ctx.db.get(args.threadId);
  if (!thread || thread.deletedAt !== undefined) throw new Error("Email conversation not found");
  if (thread.archivedAt) throw new Error("This conversation is archived; restore it before drafting a reply.");
  const newest = await ctx.db
    .query("teamEmailMessages")
    .withIndex("by_threadId_and_receivedAt", (q) => q.eq("threadId", thread._id))
    .order("desc")
    .first();
  if (!newest) throw new Error("There is no message to reply to yet.");
  const missing = [...reply.matchAll(/\[needs:\s*([^\]]+)\]/g)].map((match) => match[1].trim());
  const fields = { messageId: newest._id, status: "ready" as const, reply, missing, updatedAt: dayjs().valueOf() };
  const existing = await ctx.db
    .query("teamEmailReplySuggestions")
    .withIndex("by_threadId", (q) => q.eq("threadId", thread._id))
    .unique();
  if (existing) await ctx.db.patch(existing._id, fields);
  else await ctx.db.insert("teamEmailReplySuggestions", { threadId: thread._id, ...fields });
  return { teamEmailThreadId: thread._id, repliesTo: newest._id, reply, missing };
}
