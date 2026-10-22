import dayjs from "dayjs";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** Sequence statuses that can still send; everything else is already terminal or handed off. */
const LIVE_SEQUENCE_STATUSES = ["active", "reply_check"] as const;
/** Steps that have not finished: a `sending` step may be mid-flight in `sendStep`. */
const PENDING_STEP_STATUSES = new Set<
  Doc<"procurementOutreachSteps">["status"]
>(["scheduled", "sending"]);
const MAX_SEQUENCES_PER_STOP = 100;
const MAX_STEPS_PER_SEQUENCE = 20;

export type StopOutreachReason =
  | "outreach_status_changed"
  | "provider_changed"
  | "request_cancelled"
  | "request_completed"
  | "request_deleted"
  | "proposal_filed";

export type StopOutreachSequencesArgs = (
  | { requestId: Id<"procurementRequests"> }
  | { outreachId: Id<"procurementBrokerOutreaches"> }
) & {
  reason: StopOutreachReason;
  /** Defaults to the current time; pass the caller's timestamp to keep one mutation consistent. */
  now?: number;
};

export type StopOutreachSequencesResult = {
  stoppedSequenceIds: Id<"procurementOutreachSequences">[];
  cancelledStepCount: number;
};

/** Request statuses after which provider follow-ups must not continue. */
export function requestStatusStopsOutreach(
  status: Doc<"procurementRequests">["status"] | undefined,
): StopOutreachReason | undefined {
  if (status === "cancelled") return "request_cancelled";
  if (status === "completed") return "request_completed";
  return undefined;
}

/** Only `request_sent` outreach is eligible for automated follow-ups. */
export function outreachLeavesRequestSent(
  previous: Doc<"procurementBrokerOutreaches">["status"],
  next: Doc<"procurementBrokerOutreaches">["status"] | undefined,
) {
  return (
    previous === "request_sent" && next !== undefined && next !== "request_sent"
  );
}

/**
 * Terminalizes the `active`/`reply_check` sequences of one outreach or one request and
 * cancels their `scheduled`/`sending` steps. Idempotent: sequences already `responded`,
 * `completed`, `stopped`, or `failed` are left as they are. Every step claim re-checks the
 * sequence, request, and outreach, so an in-flight or already-scheduled `sendStep` cannot
 * send after this commits; a `sending` step's finisher must treat `cancelled` as final.
 */
export async function stopOutreachSequences(
  ctx: MutationCtx,
  args: StopOutreachSequencesArgs,
): Promise<StopOutreachSequencesResult> {
  const now = args.now ?? dayjs().valueOf();
  const sequences: Doc<"procurementOutreachSequences">[] = [];
  if ("outreachId" in args) {
    const rows = await ctx.db
      .query("procurementOutreachSequences")
      .withIndex("by_outreachId", (q) => q.eq("outreachId", args.outreachId))
      .take(MAX_SEQUENCES_PER_STOP);
    sequences.push(
      ...rows.filter((row) =>
        (LIVE_SEQUENCE_STATUSES as readonly string[]).includes(row.status),
      ),
    );
  } else {
    for (const status of LIVE_SEQUENCE_STATUSES) {
      sequences.push(
        ...(await ctx.db
          .query("procurementOutreachSequences")
          .withIndex("by_requestId_and_status", (q) =>
            q.eq("requestId", args.requestId).eq("status", status),
          )
          .take(MAX_SEQUENCES_PER_STOP)),
      );
    }
  }

  let cancelledStepCount = 0;
  for (const sequence of sequences) {
    const steps = await ctx.db
      .query("procurementOutreachSteps")
      .withIndex("by_sequenceId_and_index", (q) =>
        q.eq("sequenceId", sequence._id),
      )
      .take(MAX_STEPS_PER_SEQUENCE);
    for (const step of steps) {
      if (!PENDING_STEP_STATUSES.has(step.status)) continue;
      await ctx.db.patch(step._id, {
        status: "cancelled",
        leaseToken: undefined,
        leaseUntil: undefined,
        updatedAt: now,
      });
      cancelledStepCount += 1;
    }
    await ctx.db.patch(sequence._id, {
      status: "stopped",
      stopReason: args.reason,
      updatedAt: now,
    });
  }
  return {
    stoppedSequenceIds: sequences.map((sequence) => sequence._id),
    cancelledStepCount,
  };
}
