import dayjs from "dayjs";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getClientPortalUrl } from "./lib/domains";
import {
  buildIntakeSlackContext,
  buildIntakeSlackChanges,
  type IntakeSlackSnapshot,
  escapeIntakeSlack as escape,
} from "./lib/intakeSlackContext";
async function savedContext(ctx: MutationCtx, request: Doc<"procurementRequests">, snapshot?: IntakeSlackSnapshot) {
  const owner = request.ownerUserId ? await ctx.db.get(request.ownerUserId) : null;
  const files = await ctx.db.query("requestIntakeFiles")
    .withIndex("request", q => q.eq("requestId", request._id)).take(100);
  return buildIntakeSlackContext(request, {
    snapshot,
    emailVerified: Boolean(owner?.emailVerificationTime),
    files: files.map(file => ({ name: file.name, category: file.category })),
  });
}

async function threadSummary(ctx: MutationCtx, request: Doc<"procurementRequests">) {
  return `**Insurance application — current saved details**\nApplication ID: ${request._id}\n${await savedContext(ctx, request)}`;
}

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
  const name = escape(answers.dba || answers.legalName || answers.name || "New applicant");
  const link = request.clientOrgId
    ? answers.intakeGoal === "savings"
      ? `${getClientPortalUrl()}/operator/clients/${request.clientOrgId}/policies`
      : `${getClientPortalUrl()}/operator/clients/${request.clientOrgId}/procurement/${requestId}`
    : `${getClientPortalUrl()}/operator/clients`;
  const snapshot: IntakeSlackSnapshot = {};
  const context = await savedContext(ctx, request, snapshot);
  const add = async (key: string, content: string) => {
    const exists = await ctx.db
      .query("intakeSlackEvents")
      .withIndex("request_event", (q) =>
        q.eq("requestId", requestId).eq("eventKey", key),
      )
      .unique();
    if (exists) return false;
    await ctx.db.insert("intakeSlackEvents", {
      requestId,
      eventKey: key,
      teamId,
      channelId,
      content,
      status: "pending",
      attempts: 0,
    });
    return true;
  };
  const started = await add(
    "started",
    `**Insurance application started**\n${name}\nApplication ID: ${requestId}\n${context}`,
  );
  // Summary-only autosaves must not advance this baseline: the next reply
  // includes every answer changed since the previous queued progress message.
  let baseline = started ? snapshot : request.intakeSlackProgressSnapshot;
  if (eventKey !== "started" && !eventKey.startsWith("summary:")) {
    const changes = buildIntakeSlackChanges(baseline ?? {}, snapshot);
    const added = await add(
      // Revisiting the same question can carry new answers at a new revision.
      submitted ? eventKey : `${eventKey}:revision:${request.intakeRevision ?? 0}`,
      `**${escape(progress)}**\n${name}\nApplication ID: ${requestId}\n${submitted ? context : changes || "No applicant answers changed."}${submitted && answers.intakeGoal === "savings" ? `\n[Review policies](${link})` : submitted ? `\nCoverage: ${escape(answers.coverage || "Not specified")}\nEffective date: ${escape(answers.effectiveDate || "Not specified")}\n[Review application](${link})` : ""}`,
    );
    if (added) baseline = snapshot;
  }
  if (baseline && baseline !== request.intakeSlackProgressSnapshot)
    await ctx.db.patch(requestId, { intakeSlackProgressSnapshot: baseline });
  await add(eventKey.startsWith("summary:") ? eventKey : `summary:${request.intakeRevision ?? 0}`, await threadSummary(ctx, request));
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
    const content = event.eventKey.startsWith("summary:")
      ? await threadSummary(ctx, request)
      : event.content;
    await ctx.db.patch(event._id, { attempts: event.attempts + 1, content });
    // Recover a delivery that stops after claiming; Slack send receipts deduplicate the event ID.
    await ctx.scheduler.runAfter(61000, internal.actions.intakeSlack.deliver, {
      requestId,
    });
    return { event: { ...event, content }, threadTs: request.intakeSlackThreadTs, lease };
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

// Exact-target backfill: only refresh this existing configured intake thread.
export const refresh = internalMutation({
  args: {
    requestId: v.id("procurementRequests"),
    expectedRevision: v.number(),
    expectedThreadTs: v.string(),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request || request.deletedAt) throw new Error("Application not found");
    if ((request.intakeRevision ?? 0) !== args.expectedRevision ||
        request.intakeSlackThreadTs !== args.expectedThreadTs)
      throw new Error("Application or Slack thread changed; inspect again before backfilling");
    if (!process.env.SLACK_CLARITY_TEAM_ID?.trim() || !process.env.INTAKE_SLACK_CHANNEL_ID?.trim())
      throw new Error("Intake Slack destination is not configured");
    const started = await ctx.db.query("intakeSlackEvents")
      .withIndex("request_event", q => q.eq("requestId", request._id).eq("eventKey", "started"))
      .unique();
    if (!started || started.teamId !== process.env.SLACK_CLARITY_TEAM_ID?.trim() ||
        started.channelId !== process.env.INTAKE_SLACK_CHANNEL_ID?.trim())
      throw new Error("Original intake thread destination does not match current configuration");
    await queueIntakeSlack(ctx, request._id, `summary:backfill:${args.expectedRevision}`, "Application saved");
    return { requestId: request._id, threadTs: request.intakeSlackThreadTs, revision: args.expectedRevision };
  },
});
