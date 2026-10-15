import dayjs from "dayjs";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getClientPortalUrl } from "./lib/domains";

const escape = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
export async function queueIntakeSlack(
  ctx: MutationCtx,
  requestId: Id<"procurementRequests">,
  eventKey: string,
  progress: string,
  submitted = false,
) {
  const teamId = process.env.SLACK_CLARITY_TEAM_ID?.trim();
  const channelId = process.env.INTAKE_SLACK_CHANNEL_ID?.trim();
  if (!teamId || !channelId) return;
  const request = await ctx.db.get(requestId);
  if (!request || request.deletedAt) return;
  const answers = request.intakeAnswers ?? {};
  const name = escape(answers.legalName || answers.name || "New applicant");
  const link = request.clientOrgId
    ? `${getClientPortalUrl()}/operator/clients/${request.clientOrgId}/procurement/${requestId}`
    : `${getClientPortalUrl()}/operator/clients`;
  const add = async (key: string, content: string) => {
    const exists = await ctx.db
      .query("intakeSlackEvents")
      .withIndex("request_event", (q) =>
        q.eq("requestId", requestId).eq("eventKey", key),
      )
      .unique();
    if (!exists)
      await ctx.db.insert("intakeSlackEvents", {
        requestId,
        eventKey: key,
        teamId,
        channelId,
        content,
        status: "pending",
        attempts: 0,
      });
  };
  await add(
    "started",
    `**Insurance application started**\n${name}\nApplication ID: ${requestId}`,
  );
  if (eventKey !== "started")
    await add(
      eventKey,
      `**${escape(progress)}**\n${name}${submitted ? `\nCoverage: ${escape(answers.coverage || "Not specified")}\nEffective date: ${escape(answers.effectiveDate || "Not specified")}\n[Review application](${link})` : ""}`,
    );
  await ctx.scheduler.runAfter(0, internal.actions.intakeSlack.deliver, {
    requestId,
  });
}
export const claim = internalMutation({
  args: { requestId: v.id("procurementRequests") },
  handler: async (ctx, { requestId }) => {
    const request = await ctx.db.get(requestId);
    if (!request || request.deletedAt) return null;
    if ((request.intakeSlackLeaseUntil ?? 0) > dayjs().valueOf()) return null;
    const event = await ctx.db
      .query("intakeSlackEvents")
      .withIndex("request_status", (q) =>
        q.eq("requestId", requestId).eq("status", "pending"),
      )
      .first();
    if (
      !event ||
      (!request.intakeSlackThreadTs && event.eventKey !== "started")
    )
      return null;
    if (
      event.teamId !== process.env.SLACK_CLARITY_TEAM_ID?.trim() ||
      event.channelId !== process.env.INTAKE_SLACK_CHANNEL_ID?.trim()
    )
      return null;
    const lease = dayjs().add(1, "minute").valueOf();
    await ctx.db.patch(requestId, { intakeSlackLeaseUntil: lease });
    await ctx.db.patch(event._id, { attempts: event.attempts + 1 });
    // Recover a worker that stops after claiming; the Slack worker deduplicates the event ID.
    await ctx.scheduler.runAfter(61000, internal.actions.intakeSlack.deliver, {
      requestId,
    });
    return { event, threadTs: request.intakeSlackThreadTs, lease };
  },
});
export const finish = internalMutation({
  args: {
    eventId: v.id("intakeSlackEvents"),
    lease: v.number(),
    messageTs: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event) return;
    const request = await ctx.db.get(event.requestId);
    if (
      !request ||
      request.deletedAt ||
      request.intakeSlackLeaseUntil !== args.lease
    )
      return;
    const sent = !!args.messageTs;
    await ctx.db.patch(event._id, {
      status: sent ? "sent" : event.attempts >= 5 ? "failed" : "pending",
      error: args.error?.slice(0, 500),
    });
    await ctx.db.patch(request._id, {
      intakeSlackLeaseUntil: undefined,
      ...(sent && event.eventKey === "started"
        ? { intakeSlackThreadTs: args.messageTs }
        : {}),
    });
    await ctx.scheduler.runAfter(
      sent ? 0 : Math.min(60000, 2000 * 2 ** event.attempts),
      internal.actions.intakeSlack.deliver,
      { requestId: request._id },
    );
  },
});
