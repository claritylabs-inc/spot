import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * A message sent to an operator conversation while a run holds it: `queue`
 * starts the next turn when the conversation is free, `steer` is guidance the
 * working run takes at its next step. See docs/architecture/operator-queue-steer.md.
 */
export const operatorInputModeValidator = v.union(
  v.literal("queue"),
  v.literal("steer"),
);
export type OperatorInputMode = Infer<typeof operatorInputModeValidator>;

/** What a message does when the conversation is busy; `replace` supersedes. */
export const operatorWhenBusyValidator = v.union(
  v.literal("queue"),
  v.literal("steer"),
  v.literal("replace"),
);
export type OperatorWhenBusy = Infer<typeof operatorWhenBusyValidator>;

export const operatorInputStatusValidator = v.union(
  v.literal("pending"),
  // A steer its run took into the model history.
  v.literal("applied"),
  // A queue item that became a turn.
  v.literal("started"),
  v.literal("cancelled"),
  v.literal("failed"),
);

/** Where a channel reply goes once the run an input starts finishes. */
export const operatorChannelDeliveryValidator = v.object({
  channel: v.literal("slack"),
  teamId: v.string(),
  channelId: v.string(),
  threadTs: v.optional(v.string()),
  eventId: v.optional(v.id("slackInboundEvents")),
  clientMessageId: v.string(),
});

export const MAX_PENDING_INPUTS_PER_THREAD = 20;
export const MAX_PENDING_INPUTS_PER_AUTHOR = 10;
export const OPERATOR_STEER_ARTIFACT = "operator_steer";

export type OperatorSteerArtifact = {
  runId: Id<"operatorAgentRuns">;
  inputId: Id<"operatorAgentInputs">;
  /** The steered run's user message: the turn this guidance belongs to. */
  userMessageId: Id<"operatorAgentMessages">;
  iteration: number;
};

export function operatorSteerArtifact(message: {
  toolArtifacts?: unknown;
}): OperatorSteerArtifact | undefined {
  if (!Array.isArray(message.toolArtifacts)) return undefined;
  const artifact = message.toolArtifacts.find(
    (item) =>
      item && typeof item === "object" && item.type === OPERATOR_STEER_ARTIFACT,
  ) as { data?: OperatorSteerArtifact } | undefined;
  return artifact?.data;
}

/** The model message for steering; its framing travels with it, not in the system prompt. */
export function operatorSteerModelText(steer: {
  authorName: string;
  content: string;
}) {
  return `GUIDANCE FROM ${steer.authorName.toUpperCase()} WHILE YOU WORK (it changes the current task; it does not start a new one; keep completed work unless it says otherwise):\n${steer.content}`;
}

export async function pendingOperatorInputs(
  ctx: QueryCtx | MutationCtx,
  threadId: Id<"operatorAgentThreads">,
  limit = MAX_PENDING_INPUTS_PER_THREAD,
) {
  return ctx.db
    .query("operatorAgentInputs")
    .withIndex("by_threadId_and_status_and_createdAt", (q) =>
      q.eq("threadId", threadId).eq("status", "pending"),
    )
    .take(limit);
}

/** Files an input held that no message references are deleted with it. */
export async function deleteOperatorInputFiles(
  ctx: MutationCtx,
  input: Doc<"operatorAgentInputs">,
) {
  for (const attachment of input.attachments ?? []) {
    const reference = await ctx.db
      .query("operatorAgentAttachments")
      .withIndex("file", (index) => index.eq("fileId", attachment.fileId))
      .first();
    if (!reference && (await ctx.db.system.get("_storage", attachment.fileId)))
      await ctx.storage.delete(attachment.fileId);
  }
}

export async function resolveOperatorInput(
  ctx: MutationCtx,
  input: Doc<"operatorAgentInputs">,
  patch: Partial<Doc<"operatorAgentInputs">> & {
    status: Doc<"operatorAgentInputs">["status"];
  },
  now: number,
) {
  await ctx.db.patch(input._id, { ...patch, updatedAt: now, resolvedAt: now });
  if (patch.status === "cancelled" || patch.status === "failed")
    await deleteOperatorInputFiles(ctx, input);
}

/** A steer belongs to its run: a stopped or replaced run takes its pending guidance with it. */
export async function cancelPendingSteers(
  ctx: MutationCtx,
  runId: Id<"operatorAgentRuns">,
  now: number,
) {
  const steers = await ctx.db
    .query("operatorAgentInputs")
    .withIndex("by_targetRunId_and_status", (q) =>
      q.eq("targetRunId", runId).eq("status", "pending"),
    )
    .take(MAX_PENDING_INPUTS_PER_THREAD);
  for (const steer of steers) {
    if (steer.mode !== "steer") continue;
    await resolveOperatorInput(
      ctx,
      steer,
      { status: "cancelled", error: "The request it was steering stopped." },
      now,
    );
  }
}
