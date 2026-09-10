import dayjs from "dayjs";
import { confirmationMatchesTask } from "./threadActionConfirmations";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { pendingEmailDraftFingerprint } from "./lib/actionConfirmationFingerprint";
import { getClientPortalUrl } from "./lib/domains";
import {
  createMagicLinkToken,
  hashMagicLinkToken,
} from "./lib/magicLinkTokens";
import {
  threadActionActorsMatch,
  threadActionActorValidator,
} from "./lib/threadActionConfirmationValidators";

const channelValidator = v.union(
  v.literal("imessage"),
  v.literal("slack"),
  v.literal("email"),
  v.literal("other"),
);

type ReviewActor = Doc<"threadActionConfirmations">["actor"];
type ReviewConfirmation = Doc<"threadActionConfirmations">;

function confirmationIncludesDraft(
  confirmation: ReviewConfirmation,
  pendingEmailId: Id<"pendingEmails">,
  draftFingerprint: string,
) {
  const payload = confirmation.payload;
  if (payload.kind === "coi_batch_delivery") {
    return (
      payload.pendingEmailId === pendingEmailId &&
      payload.draftFingerprint === draftFingerprint
    );
  }
  if (payload.kind !== "email_send") return false;
  const index = payload.pendingEmailIds.findIndex(
    (id) => id === pendingEmailId,
  );
  return index >= 0 && payload.draftFingerprints[index] === draftFingerprint;
}

async function confirmationCanAuthorize(
  ctx: QueryCtx | MutationCtx,
  confirmation: ReviewConfirmation,
  args: {
    draft: Doc<"pendingEmails">;
    fingerprint: string;
    actor: ReviewActor;
  },
) {
  return (
    confirmation.orgId === args.draft.orgId &&
    confirmation.threadId === args.draft.threadId &&
    (confirmation.status === "pending" ||
      confirmation.status === "completed") &&
    (await confirmationMatchesTask(ctx, confirmation)) &&
    threadActionActorsMatch(confirmation.actor, args.actor) &&
    confirmationIncludesDraft(confirmation, args.draft._id, args.fingerprint)
  );
}

async function latestMatchingConfirmation(
  ctx: MutationCtx,
  draft: Doc<"pendingEmails">,
  fingerprint: string,
) {
  if (!draft.threadId) return null;
  const candidates = await ctx.db
    .query("threadActionConfirmations")
    .withIndex("thread_status", (query) =>
      query.eq("threadId", draft.threadId!).eq("status", "pending"),
    )
    .order("desc")
    .take(8);
  return (
    candidates.find((confirmation) =>
      confirmationIncludesDraft(confirmation, draft._id, fingerprint),
    ) ?? null
  );
}

async function resolveLinkByToken(ctx: QueryCtx | MutationCtx, token: string) {
  const normalized = token.trim();
  if (!normalized) return null;
  const tokenHash = await hashMagicLinkToken(normalized);
  return ctx.db
    .query("emailDraftReviewLinks")
    .withIndex("token", (query) => query.eq("tokenHash", tokenHash))
    .unique();
}

export const createInternal = internalMutation({
  args: {
    pendingEmailId: v.id("pendingEmails"),
    channel: channelValidator,
    confirmationId: v.optional(v.id("threadActionConfirmations")),
    actor: v.optional(threadActionActorValidator),
    sourceThreadMessageId: v.optional(v.id("threadMessages")),
  },
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.pendingEmailId);
    if (!draft || draft.status !== "draft" || !draft.threadId) {
      throw new Error("A current thread email draft is required.");
    }
    const fingerprint = await pendingEmailDraftFingerprint(draft);
    const explicitConfirmation = args.confirmationId
      ? await ctx.db.get(args.confirmationId)
      : null;
    const confirmation =
      explicitConfirmation ??
      (!args.actor
        ? await latestMatchingConfirmation(ctx, draft, fingerprint)
        : null);
    const actor = args.actor ?? confirmation?.actor;
    if (!actor) {
      throw new Error("A review-link actor or exact confirmation is required.");
    }
    const now = dayjs().valueOf();
    if (
      confirmation &&
      !(await confirmationCanAuthorize(ctx, confirmation, {
        draft,
        fingerprint,
        actor,
      }))
    ) {
      throw new Error("The draft confirmation is stale or does not match.");
    }

    const existing = await ctx.db
      .query("emailDraftReviewLinks")
      .withIndex("draft_channel", (query) =>
        query.eq("pendingEmailId", draft._id).eq("channel", args.channel),
      )
      .collect();
    for (const link of existing) {
      if (!link.revokedAt && !link.sendCompletedAt) {
        await ctx.db.patch(link._id, { revokedAt: now, updatedAt: now });
      }
    }

    const token = createMagicLinkToken();
    const id = await ctx.db.insert("emailDraftReviewLinks", {
      orgId: draft.orgId,
      pendingEmailId: draft._id,
      tokenHash: await hashMagicLinkToken(token),
      channel: args.channel,
      draftFingerprint: fingerprint,
      confirmationId: confirmation?._id,
      actor,
      sourceThreadId: draft.threadId,
      sourceThreadMessageId: args.sourceThreadMessageId,
      sendAttempts: 0,
      createdAt: now,
      updatedAt: now,
    });
    return {
      id,
      url: `${getClientPortalUrl()}/share/email/${token}`,
      token,
    };
  },
});

export const bindConfirmationInternal = internalMutation({
  args: {
    id: v.id("emailDraftReviewLinks"),
    confirmationId: v.id("threadActionConfirmations"),
  },
  handler: async (ctx, args) => {
    const [link, confirmation] = await Promise.all([
      ctx.db.get(args.id),
      ctx.db.get(args.confirmationId),
    ]);
    if (!link || !confirmation) throw new Error("Review link not found.");
    const draft = await ctx.db.get(link.pendingEmailId);
    const now = dayjs().valueOf();
    if (
      !draft ||
      draft.status !== "draft" ||
      link.revokedAt ||
      (await pendingEmailDraftFingerprint(draft)) !== link.draftFingerprint ||
      !(await confirmationCanAuthorize(ctx, confirmation, {
        draft,
        fingerprint: link.draftFingerprint,
        actor: link.actor,
      }))
    ) {
      throw new Error("The review link no longer matches this draft.");
    }
    await ctx.db.patch(link._id, {
      confirmationId: confirmation._id,
      updatedAt: now,
    });
  },
});

export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const link = await resolveLinkByToken(ctx, args.token);
    if (!link || link.revokedAt) return null;
    const [draft, org, confirmation] = await Promise.all([
      ctx.db.get(link.pendingEmailId),
      ctx.db.get(link.orgId),
      link.confirmationId ? ctx.db.get(link.confirmationId) : null,
    ]);
    if (!draft || !org || draft.orgId !== link.orgId) return null;
    const fingerprint = await pendingEmailDraftFingerprint(draft);
    if (fingerprint !== link.draftFingerprint) {
      return { state: "stale" as const, orgName: org.name };
    }

    const confirmationReady = Boolean(
      confirmation &&
      (await confirmationCanAuthorize(ctx, confirmation, {
        draft,
        fingerprint,
        actor: link.actor,
      })),
    );
    const state =
      draft.status === "draft" && link.sendStartedAt ? "sending" : draft.status;
    return {
      state,
      orgName: org.name,
      recipientEmail: draft.recipientEmail,
      ccAddresses: draft.ccAddresses ?? [],
      bccAddresses: draft.bccAddresses ?? [],
      subject: draft.subject,
      renderedText: draft.renderedText ?? draft.emailBody,
      renderedHtml: draft.renderedHtml,
      attachments: (draft.attachments ?? []).map((attachment) => ({
        filename: attachment.filename,
        contentType: attachment.contentType,
        size: attachment.size,
      })),
      canSend:
        draft.status === "draft" &&
        !link.sendStartedAt &&
        !link.sendCompletedAt &&
        confirmationReady,
    };
  },
});

export const claimSendInternal = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const link = await resolveLinkByToken(ctx, args.token);
    const now = dayjs().valueOf();
    if (!link || link.revokedAt) {
      throw new Error("This email draft review link is no longer available.");
    }
    if (link.sendCompletedAt) {
      throw new Error("This email draft has already been sent.");
    }
    if (link.sendStartedAt) {
      throw new Error("This email draft is already being sent.");
    }
    const siblingLinks = await ctx.db
      .query("emailDraftReviewLinks")
      .withIndex("draft_channel", (query) =>
        query.eq("pendingEmailId", link.pendingEmailId),
      )
      .collect();
    if (
      siblingLinks.some(
        (candidate) =>
          candidate._id !== link._id &&
          Boolean(candidate.sendStartedAt) &&
          !candidate.sendCompletedAt,
      )
    ) {
      throw new Error("This email draft is already being sent.");
    }
    const [draft, confirmation] = await Promise.all([
      ctx.db.get(link.pendingEmailId),
      link.confirmationId ? ctx.db.get(link.confirmationId) : null,
    ]);
    if (!draft || draft.status !== "draft") {
      throw new Error("This email draft is no longer available to send.");
    }
    const fingerprint = await pendingEmailDraftFingerprint(draft);
    if (
      fingerprint !== link.draftFingerprint ||
      !confirmation ||
      !(await confirmationCanAuthorize(ctx, confirmation, {
        draft,
        fingerprint,
        actor: link.actor,
      }))
    ) {
      throw new Error(
        "This draft changed or its confirmation is no longer current.",
      );
    }
    await ctx.db.patch(link._id, {
      sendStartedAt: now,
      sendAttempts: link.sendAttempts + 1,
      sendLastError: undefined,
      updatedAt: now,
    });
    return {
      linkId: link._id,
      pendingEmailId: draft._id,
      confirmationId: confirmation._id,
      confirmationStatus: confirmation.status,
      actor: link.actor,
    };
  },
});

export const releaseSendInternal = internalMutation({
  args: {
    id: v.id("emailDraftReviewLinks"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.id);
    if (!link || link.sendCompletedAt) return;
    await ctx.db.patch(link._id, {
      sendStartedAt: undefined,
      sendLastError: args.error,
      updatedAt: dayjs().valueOf(),
    });
  },
});

export const completeSendInternal = internalMutation({
  args: { id: v.id("emailDraftReviewLinks") },
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.id);
    if (!link) return;
    const now = dayjs().valueOf();
    await ctx.db.patch(link._id, {
      sendStartedAt: undefined,
      sendCompletedAt: now,
      updatedAt: now,
    });
  },
});

export const sweepExpired = internalMutation({
  args: { batchSize: v.optional(v.number()) },
  // Previously scheduled sweeps must not delete durable review links.
  handler: async () => ({ deleted: 0 }),
});
