import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { invalidatePendingConfirmations } from "../threadActionConfirmations";
import { normalizeEmailAddress } from "./emailAddress";

export async function invalidateDraftConfirmations(
  ctx: MutationCtx,
  pending: Doc<"pendingEmails">,
  reason: string,
) {
  const threadId = pending.threadId;
  if (!threadId) return;
  await invalidatePendingConfirmations(ctx, threadId, reason, (confirmation) => {
    const payload = confirmation.payload;
    return (
      payload.kind === "draft_snapshot" ||
      payload.kind === "email_send" ||
      payload.kind === "email_cancel"
        ? payload.pendingEmailIds.includes(pending._id)
        : payload.kind === "coi_batch_delivery" &&
            payload.pendingEmailId === pending._id
    );
  });
}

export async function restoreCancelledEmailAsDraft(
  ctx: MutationCtx,
  id: Id<"pendingEmails">,
) {
  const pending = await ctx.db.get(id);
  if (!pending || pending.status !== "cancelled") {
    return null;
  }

  await ctx.db.patch(id, {
    status: "draft",
    scheduledSendTime: 0,
    sentMessageId: undefined,
    explicitSendAuthorization: undefined,
    coiBatchAuthorization: undefined,
  });
  await invalidateDraftConfirmations(ctx, pending, "draft_restored");

  if (pending.threadMessageId) {
    await ctx.db.patch(pending.threadMessageId, {
      content: pending.emailBody,
      toAddresses: [pending.recipientEmail],
      ccAddresses: pending.ccAddresses,
      bccAddresses: pending.bccAddresses,
      subject: pending.subject,
      attachments: pending.attachments,
      referencedPolicyIds: undefined,
      pendingEmailId: id,
      responseMessageId: undefined,
      status: "draft_email",
      error: undefined,
    });
  }

  if (pending.chatMessageId) {
    await ctx.db.patch(pending.chatMessageId, {
      content: "Email restored as a draft. Review it in the email draft card.",
      status: undefined,
      pendingEmailId: id,
    });
  }

  return pending;
}

export async function cancelDraftOrPendingEmail(
  ctx: MutationCtx,
  id: Id<"pendingEmails">,
) {
  const pending = await ctx.db.get(id);
  if (
    !pending ||
    (pending.status !== "pending" && pending.status !== "draft")
  ) {
    return false;
  }

  await ctx.db.patch(id, {
    status: "cancelled",
    explicitSendAuthorization: undefined,
  });
  await invalidateDraftConfirmations(ctx, pending, "draft_cancelled");

  if (pending.threadMessageId) {
    await ctx.db.patch(pending.threadMessageId, {
      status: "cancelled",
    });
  }

  if (pending.chatMessageId) {
    await ctx.db.patch(pending.chatMessageId, {
      content: "Email cancelled.",
      status: undefined,
      pendingEmailId: id,
    });
  }
  return true;
}

export async function updateDraftRecipient(
  ctx: MutationCtx,
  id: Id<"pendingEmails">,
  recipientEmailInput: string,
) {
  const pending = await ctx.db.get(id);
  if (!pending || pending.status !== "draft") return null;

  const recipientEmail = normalizeEmailAddress(recipientEmailInput);
  const ccAddresses = (pending.ccAddresses ?? [])
    .map(normalizeEmailAddress)
    .filter((email) => email && email !== recipientEmail);
  const bccAddresses = (pending.bccAddresses ?? [])
    .map(normalizeEmailAddress)
    .filter(
      (email) =>
        email && email !== recipientEmail && !ccAddresses.includes(email),
    );

  await ctx.db.patch(id, {
    recipientEmail,
    ccAddresses,
    bccAddresses,
    sendBlockedReason: undefined,
    coiBatchAuthorization: undefined,
  });
  await invalidateDraftConfirmations(ctx, pending, "draft_recipient_changed");

  if (pending.threadMessageId) {
    await ctx.db.patch(pending.threadMessageId, {
      toAddresses: [recipientEmail],
      ccAddresses,
      bccAddresses,
      error: undefined,
    });
  }

  return await ctx.db.get(id);
}
