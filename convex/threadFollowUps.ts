import dayjs from "dayjs";
import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { writeOperatorAudit } from "./lib/operatorIdentity";
import { outreachCadenceSourceValidator } from "./lib/providerOutreachValidators";
import { threadFollowUpConversation } from "./lib/threadFollowUps";
import { insertThreadFollowUps } from "./providerOutreach";

/**
 * Starting conversation follow-ups for a team reply sent with them
 * (`pendingEmails.followUps`). `claimStartInternal` is a one-shot claim before
 * Jev picks the cadence, so the pick never runs twice; `insertInternal` then
 * creates the sequence once.
 */

async function sentReply(ctx: MutationCtx, pendingEmailId: Id<"pendingEmails">) {
  const pending = await ctx.db.get(pendingEmailId);
  if (
    !pending?.followUps ||
    pending.status !== "sent" ||
    pending.transport !== "operator_inbox" ||
    !pending.senderUserId ||
    !pending.teamEmailThreadId ||
    !pending.resendInboxEmailId
  )
    return null;
  const thread = await ctx.db.get(pending.teamEmailThreadId);
  if (!thread || thread.deletedAt !== undefined || thread.archivedAt) return null;
  return {
    pending: { ...pending, senderUserId: pending.senderUserId },
    followUps: pending.followUps,
    thread,
    emailId: pending.resendInboxEmailId,
  };
}

export const claimStartInternal = internalMutation({
  args: { pendingEmailId: v.id("pendingEmails") },
  handler: async (ctx, args) => {
    const reply = await sentReply(ctx, args.pendingEmailId);
    if (!reply || reply.followUps.startedAt !== undefined) return null;
    await ctx.db.patch(reply.pending._id, {
      followUps: { ...reply.followUps, startedAt: dayjs().valueOf() },
    });
    return {
      cadence: reply.followUps.cadence ?? null,
      conversation: await threadFollowUpConversation(ctx, reply.thread),
    };
  },
});

export const insertInternal = internalMutation({
  args: {
    pendingEmailId: v.id("pendingEmails"),
    cadence: v.object({ followUpCount: v.number(), intervalBusinessDays: v.number() }),
    cadenceSource: outreachCadenceSourceValidator,
  },
  handler: async (ctx, args) => {
    const reply = await sentReply(ctx, args.pendingEmailId);
    if (!reply || reply.followUps.startedAt === undefined || reply.followUps.sequenceId) return null;
    const { pending, thread, emailId } = reply;
    // The inbox it went from, and its thread there when already known.
    const attempt = (
      await ctx.db
        .query("emailDeliveryAttempts")
        .withIndex("pending", (q) => q.eq("pendingEmailId", pending._id))
        .take(20)
    ).find((row) => row.operatorStage === "sent" && row.resendEmailId === emailId);
    if (!attempt?.inboxId) return null;
    const message = await ctx.db
      .query("teamEmailMessages")
      .withIndex("by_resendInboxEmailId", (q) => q.eq("resendInboxEmailId", emailId))
      .first();
    const context = pending.directReplyContext;
    const resendThreadId =
      message?.resendThreadId ??
      (context?.mode === "thread" && context.inboxId === attempt.inboxId
        ? context.resendThreadId
        : undefined);
    const now = dayjs().valueOf();
    const started = await insertThreadFollowUps(ctx, {
      thread,
      pending,
      inboxId: attempt.inboxId,
      emailId,
      resendThreadId,
      cadence: args.cadence,
      cadenceSource: args.cadenceSource,
      now,
    });
    if (!started) return null;
    await ctx.db.patch(pending._id, {
      followUps: { ...reply.followUps, sequenceId: started.sequenceId },
    });
    await writeOperatorAudit(ctx, {
      operatorUserId: pending.directApproval?.actorUserId ?? pending.senderUserId,
      type: "setup_write",
      targetOrgId: thread.clientOrgId,
      summary: "Started follow-ups on a team conversation",
      metadata: {
        domain: "team_inbox",
        operation: "start_thread_follow_ups",
        teamEmailThreadId: thread._id,
        sequenceId: started.sequenceId,
        senderUserId: pending.senderUserId,
        cadence: args.cadence,
        cadenceSource: args.cadenceSource,
        followUpCount: started.followUpCount,
      },
    });
    return started;
  },
});
