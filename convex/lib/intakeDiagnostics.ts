import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireOperatorForUser } from "./operatorIdentity";
import { submittedIntakeApplication } from "../../lib/intake-application";

/** Exact-ID diagnostic read only; company attachment still gates fulfillment. */
export async function readUnlinkedIntakeByOperator(
  ctx: QueryCtx | MutationCtx,
  args: { operatorUserId: Id<"users">; requestId: Id<"procurementRequests"> },
) {
  await requireOperatorForUser(ctx, args.operatorUserId);
  const request = await ctx.db.get(args.requestId);
  if (!request || request.deletedAt)
    throw new Error("Procurement request not found");
  if (request.clientOrgId) return null;
  const events = await ctx.db
    .query("intakeSlackEvents")
    .withIndex("request_event", (q) => q.eq("requestId", args.requestId))
    .take(40);
  // Do not spread the record: it contains inbox and email-verification capabilities.
  return {
    _id: request._id,
    title: request.title,
    diagnosticStatus: request.intakeSubmittedAt ? "submitted" : "draft",
    clientOrgId: null,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    intakeStep: request.intakeStep,
    intakeRevision: request.intakeRevision ?? 0,
    intakeSubmittedAt: request.intakeSubmittedAt ?? null,
    intakeAnswers: request.intakeAnswers ?? {},
    intakeDetails: request.intakeDetails ?? null,
    intakeCompletedSteps: request.intakeCompletedSteps ?? [],
    intakeSkippedSteps: request.intakeSkippedSteps ?? [],
    application: submittedIntakeApplication(request),
    fulfillmentAvailable: false,
    slackEvents: events.map((event) => ({
      createdAt: event._creationTime,
      eventKey: event.eventKey,
      status: event.status,
      attempts: event.attempts,
    })),
    slackEventsBounded: events.length === 40,
  };
}
