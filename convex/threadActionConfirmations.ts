import dayjs from "dayjs";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { pendingEmailDraftFingerprint } from "./lib/actionConfirmationFingerprint";
import {
  threadActionActorsMatch,
  threadActionActorValidator,
  threadActionConfirmationPayloadValidator,
} from "./lib/threadActionConfirmationValidators";

type ThreadActionConfirmationResult =
  | "completed"
  | "stale"
  | "expired"
  | "needs_refresh";

function markStale(
  ctx: MutationCtx,
  confirmation: Doc<"threadActionConfirmations">,
  reason: string,
  now = dayjs().valueOf(),
) {
  return ctx.db.patch(confirmation._id, {
    status: "stale",
    invalidatedAt: now,
    invalidationReason: reason,
    updatedAt: now,
  });
}

async function invalidate(
  ctx: MutationCtx,
  confirmation: Doc<"threadActionConfirmations">,
  reason: string,
): Promise<"stale"> {
  await markStale(ctx, confirmation, reason);
  return "stale";
}

export async function invalidatePendingConfirmations(
  ctx: MutationCtx,
  threadId: Id<"threads">,
  reason: string,
  matches?: (confirmation: Doc<"threadActionConfirmations">) => boolean,
) {
  const now = dayjs().valueOf();
  const pending = await ctx.db
    .query("threadActionConfirmations")
    .withIndex("thread_status", (query) =>
      query.eq("threadId", threadId).eq("status", "pending"),
    )
    .collect();
  const selected = matches ? pending.filter(matches) : pending;
  for (const confirmation of selected) {
    await markStale(ctx, confirmation, reason, now);
  }
  return selected.length;
}

async function currentDraftFingerprints(
  ctx: MutationCtx,
  ids: Id<"pendingEmails">[],
) {
  const drafts = await Promise.all(ids.map((id) => ctx.db.get(id)));
  if (
    !drafts.every(
      (draft): draft is Doc<"pendingEmails"> =>
        draft !== null &&
        (draft.status === "draft" || draft.status === "pending"),
    )
  ) {
    return undefined;
  }
  return Promise.all(drafts.map(pendingEmailDraftFingerprint));
}

export async function confirmationMatchesTask(
  ctx: QueryCtx | MutationCtx,
  confirmation: Doc<"threadActionConfirmations">,
) {
  const state = await ctx.db
    .query("threadContextStates")
    .withIndex("thread", (query) => query.eq("threadId", confirmation.threadId))
    .unique();
  return (state?.taskEpoch ?? 0) === confirmation.taskEpoch;
}

async function confirmationMatchesCurrentState(
  ctx: MutationCtx,
  confirmation: Doc<"threadActionConfirmations">,
) {
  const { payload } = confirmation;
  if (
    payload.kind === "draft_snapshot" ||
    payload.kind === "email_send" ||
    payload.kind === "email_cancel"
  ) {
    const fingerprints = await currentDraftFingerprints(
      ctx,
      payload.pendingEmailIds,
    );
    return (
      fingerprints?.length === payload.draftFingerprints.length &&
      fingerprints.every(
        (fingerprint, index) =>
          fingerprint === payload.draftFingerprints[index],
      )
    );
  }
  if (payload.kind === "coi_batch_delivery") {
    const draft = await ctx.db.get(payload.pendingEmailId);
    if (!draft || draft.status !== "draft") return false;
    const fingerprint = await pendingEmailDraftFingerprint(draft);
    const fileIds = (draft.attachments ?? []).map(({ fileId }) =>
      String(fileId),
    );
    return (
      fingerprint === payload.draftFingerprint &&
      draft.recipientEmail.trim().toLowerCase() === payload.recipientEmail &&
      fileIds.length === payload.fileIds.length &&
      fileIds.every(
        (fileId, index) => fileId === String(payload.fileIds[index]),
      )
    );
  }
  return true;
}

export const createInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    threadId: v.id("threads"),
    actor: threadActionActorValidator,
    promptMessageId: v.id("threadMessages"),
    payload: threadActionConfirmationPayloadValidator,
  },
  handler: async (ctx, args) => {
    const prompt = await ctx.db.get(args.promptMessageId);
    if (
      !prompt ||
      prompt.orgId !== args.orgId ||
      prompt.threadId !== args.threadId ||
      prompt.role !== "agent"
    ) {
      throw new Error("Confirmation prompt not found");
    }
    const state = await ctx.db
      .query("threadContextStates")
      .withIndex("thread", (query) => query.eq("threadId", args.threadId))
      .unique();
    await invalidatePendingConfirmations(ctx, args.threadId, "superseded");
    const now = dayjs().valueOf();
    return ctx.db.insert("threadActionConfirmations", {
      ...args,
      taskEpoch: state?.taskEpoch ?? 0,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const consumeInternal = internalMutation({
  args: {
    id: v.id("threadActionConfirmations"),
    actor: threadActionActorValidator,
    currentMessageId: v.optional(v.id("threadMessages")),
    requireAdjacentPrompt: v.boolean(),
  },
  handler: async (ctx, args): Promise<ThreadActionConfirmationResult> => {
    const confirmation = await ctx.db.get(args.id);
    if (!confirmation || confirmation.status !== "pending") {
      return "needs_refresh";
    }
    const now = dayjs().valueOf();
    if (!threadActionActorsMatch(confirmation.actor, args.actor)) {
      return "needs_refresh";
    }
    if (!(await confirmationMatchesTask(ctx, confirmation))) {
      return invalidate(ctx, confirmation, "task_reset");
    }
    if (args.requireAdjacentPrompt) {
      if (!args.currentMessageId) return "needs_refresh";
      const messages = await ctx.db
        .query("threadMessages")
        .withIndex("thread", (query) =>
          query.eq("threadId", confirmation.threadId),
        )
        .order("desc")
        .take(6);
      const persistedTurnMessages = messages.filter(
        (message) => message.status !== "processing",
      );
      if (
        persistedTurnMessages.length < 2 ||
        persistedTurnMessages[0]?._id !== args.currentMessageId ||
        persistedTurnMessages[1]?._id !== confirmation.promptMessageId
      ) {
        return invalidate(ctx, confirmation, "intervening_message");
      }
    }
    if (!(await confirmationMatchesCurrentState(ctx, confirmation))) {
      return invalidate(ctx, confirmation, "content_changed");
    }
    await ctx.db.patch(confirmation._id, {
      status: "completed",
      completedAt: now,
      updatedAt: now,
    });
    if (confirmation.payload.kind === "coi_batch_delivery") {
      await ctx.db.patch(confirmation.payload.pendingEmailId, {
        coiBatchAuthorization: {
          recipientEmail: confirmation.payload.recipientEmail,
          fileIds: confirmation.payload.fileIds,
          draftFingerprint: confirmation.payload.draftFingerprint,
          confirmedBy: confirmation.actor,
          confirmationId: confirmation._id,
          confirmedAt: now,
        },
      });
    }
    return "completed";
  },
});

export const invalidatePendingForThread = internalMutation({
  args: { threadId: v.id("threads"), reason: v.string() },
  handler: async (ctx, args) => {
    return invalidatePendingConfirmations(ctx, args.threadId, args.reason);
  },
});

export const latestPendingInternal = internalQuery({
  args: { threadId: v.id("threads") },
  handler: (ctx, args) =>
    ctx.db
      .query("threadActionConfirmations")
      .withIndex("thread_status", (query) =>
        query.eq("threadId", args.threadId).eq("status", "pending"),
      )
      .order("desc")
      .first(),
});

export const getInternal = internalQuery({
  args: { id: v.id("threadActionConfirmations") },
  handler: async (ctx, args) => {
    const confirmation = await ctx.db.get(args.id);
    return confirmation && (await confirmationMatchesTask(ctx, confirmation))
      ? confirmation
      : null;
  },
});
