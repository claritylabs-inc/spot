import dayjs from "dayjs";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { resolveActiveOperatorEmail } from "./lib/operatorIdentity";
import { normalizeProcurementEmail } from "./lib/procurement";
import {
  INBOX_EVENT_GIVE_UP_MS,
  INBOX_EVENT_LEASE_MS,
  INBOX_EVENT_MAPPING_WINDOW_MS,
  INBOX_EVENT_RETRY_MS,
  inboxAttachmentValidator,
  inboxEmailValidator,
  inboxEventTypeValidator,
  type InboxEmail,
  type InboxRecord,
} from "./lib/providerOutreachValidators";
import {
  mirrorTeamEmail,
  type MirrorTeamEmailResult,
  type NewTeamThread,
  type TeamThread,
} from "./lib/teamEmailStore";
import { clipEventError, fencedEvent, finishEvent, knownInbox } from "./lib/teamInboxEventLease";
import { emitOperatorNotification } from "./lib/operatorNotify";
import { holdForInboundReply, mappingMayAppear, sequenceForInboxEvent } from "./providerOutreach";

type Ctx = QueryCtx | MutationCtx;
type EventDoc = Doc<"providerOutreachWebhookEvents">;
type InboxDoc = Doc<"operatorOutreachInboxes">;

/** How long a sent event with no conversation yet waits for the send that created it to be mirrored. */
const SENT_EVENT_BINDING_WAIT_MS = 30 * 1000;

// ---------------------------------------------------------------------------
// Recording, routing and leases
// ---------------------------------------------------------------------------

/**
 * Persists a verified webhook event once and schedules `handleInboxEvent`.
 * A newly recorded `received` event for a known thread holds the sequence in
 * `reply_check` in this same transaction. `occurredAt` is the email's Resend
 * `received_at` (epoch ms), used only to order replies.
 */
export const recordInboxEventInternal = internalMutation({
  args: {
    emailId: v.string(),
    eventType: inboxEventTypeValidator,
    inboxId: v.string(),
    threadId: v.string(),
    occurredAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // The Resend webhook is account-wide; only inboxes this deployment created
    // matter (retired ones included, so replies to old threads still map).
    const known = await knownInbox(ctx, args.inboxId);
    if (!known) return { recorded: false as const, reason: "unknown_inbox" as const };
    const now = dayjs().valueOf();
    const existing = await ctx.db
      .query("providerOutreachWebhookEvents")
      .withIndex("by_emailId_and_eventType", (q) =>
        q.eq("emailId", args.emailId).eq("eventType", args.eventType),
      )
      .first();
    if (existing) {
      if (existing.status === "failed") {
        await ctx.db.patch(existing._id, {
          status: "pending",
          error: undefined,
          leaseToken: undefined,
          leaseUntil: undefined,
          updatedAt: now,
        });
        await ctx.scheduler.runAfter(0, internal.actions.teamInboxEvents.handleInboxEvent, {
          eventId: existing._id,
        });
      }
      return { recorded: true as const, eventId: existing._id, duplicate: true as const };
    }
    const eventId = await ctx.db.insert("providerOutreachWebhookEvents", {
      emailId: args.emailId,
      eventType: args.eventType,
      inboxId: args.inboxId,
      threadId: args.threadId,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    if (args.eventType === "inbox.email.received") {
      // Includes a reply on the old thread of a sequence that moved to a new inbox.
      const owned = await sequenceForInboxEvent(ctx, args);
      if (owned)
        await holdForInboundReply(ctx, owned.sequence, {
          emailId: args.emailId,
          occurredAt: args.occurredAt ?? null,
          fallbackAt: now,
          now,
        });
    }
    await ctx.scheduler.runAfter(0, internal.actions.teamInboxEvents.handleInboxEvent, {
      eventId,
    });
    return { recorded: true as const, eventId, duplicate: false as const };
  },
});

type InboxEventRoute =
  | {
      kind: "sequence";
      sequenceId: Id<"procurementOutreachSequences">;
      stepId: Id<"procurementOutreachSteps"> | null;
      requestId: Id<"procurementRequests">;
      outreachId: Id<"procurementBrokerOutreaches"> | null;
      sequenceStatus: Doc<"procurementOutreachSequences">["status"];
      recipientEmail: string;
      resendThreadId: string | null;
      senderUserId: Id<"users">;
    }
  /** An existing team conversation: by thread id, by a linked extra thread, or by the sent email it was bound from. */
  | {
      kind: "thread";
      threadId: Id<"teamEmailThreads">;
      via: "thread" | "link" | "sent_binding";
    }
  /** Normal mail in a known operator inbox that no conversation owns: becomes an unlinked team thread. */
  | { kind: "team" }
  /** The shared command-channel inbox: never imported as mail. */
  | { kind: "agent" }
  | { kind: "unmatched" };

export type ClaimInboxEventResult =
  | { status: "skipped"; reason: string }
  | { status: "retry_scheduled"; runAt: number }
  | {
      status: "claimed";
      leaseToken: string;
      event: {
        eventId: Id<"providerOutreachWebhookEvents">;
        emailId: string;
        eventType: "inbox.email.received" | "inbox.email.sent";
        inboxId: string;
        threadId: string;
      };
      route: InboxEventRoute;
      /** The operator who owns the inbox; null for the agent inbox. */
      inboxOwnerUserId: Id<"users"> | null;
      inbox: InboxRecord | null;
    };

/**
 * Routing order: the known-inbox guard, then the outreach sequence, a team
 * thread by Resend thread id, a link row, the sent email a conversation was
 * bound from, and finally an unlinked team thread. Unknown inboxes are never
 * imported and the command-channel inbox is reserved.
 */
async function routeInboxEvent(ctx: Ctx, event: EventDoc): Promise<InboxEventRoute> {
  const inbox = await knownInbox(ctx, event.inboxId);
  if (!inbox) return { kind: "unmatched" };
  if (inbox.kind === "agent") return { kind: "agent" };
  const owned = await sequenceForInboxEvent(ctx, event);
  if (owned) {
    const { sequence, step } = owned;
    return {
      kind: "sequence",
      sequenceId: sequence._id,
      stepId: step?._id ?? null,
      requestId: sequence.requestId,
      outreachId: sequence.outreachId ?? null,
      sequenceStatus: sequence.status,
      recipientEmail: sequence.recipient.email,
      resendThreadId: sequence.resendThreadId ?? null,
      senderUserId: sequence.senderUserId,
    };
  }
  const byThread = await ctx.db
    .query("teamEmailThreads")
    .withIndex("by_resendThreadId", (q) => q.eq("resendThreadId", event.threadId))
    .first();
  if (byThread && !byThread.deletedAt)
    return { kind: "thread", threadId: byThread._id, via: "thread" };
  const link = await ctx.db
    .query("teamEmailThreadLinks")
    .withIndex("by_inboxId_and_resendThreadId", (q) =>
      q.eq("inboxId", event.inboxId).eq("resendThreadId", event.threadId),
    )
    .first();
  const linked = link ? await ctx.db.get(link.threadId) : null;
  if (linked && !linked.deletedAt) return { kind: "thread", threadId: linked._id, via: "link" };
  if (event.eventType === "inbox.email.sent") {
    const sent = await ctx.db
      .query("teamEmailMessages")
      .withIndex("by_resendInboxEmailId", (q) => q.eq("resendInboxEmailId", event.emailId))
      .first();
    const bound = sent ? await ctx.db.get(sent.threadId) : null;
    if (bound && !bound.deletedAt)
      return { kind: "thread", threadId: bound._id, via: "sent_binding" };
  }
  return { kind: "team" };
}

/**
 * Whether a conversation event that nothing owns yet could still gain an owner:
 * an inbound email can be the copy of a sent email (in any inbox) whose own
 * event has not been processed, and a sent email can belong to a send that has
 * not been mirrored.
 */
async function teamBindingMayAppear(ctx: MutationCtx, event: EventDoc, now: number) {
  if (event.eventType === "inbox.email.sent")
    return now - event.createdAt < SENT_EVENT_BINDING_WAIT_MS;
  const LIMIT = 100;
  for (const status of ["pending", "processing"] as const) {
    const open = await ctx.db
      .query("providerOutreachWebhookEvents")
      .withIndex("by_status_and_updatedAt", (q) => q.eq("status", status))
      .take(LIMIT);
    if (open.length >= LIMIT) return true;
    if (
      open.some(
        (row) => row._id !== event._id && row.eventType === "inbox.email.sent",
      )
    )
      return true;
  }
  return false;
}

/**
 * Leases a webhook event and resolves its sequence. Until the outbound
 * email/thread mapping exists the claim reschedules itself (bounded); after the
 * window an unmapped event is returned as `unmatched` so the action can label
 * it for the operator.
 */
export const claimInboxEventInternal = internalMutation({
  args: { eventId: v.id("providerOutreachWebhookEvents") },
  handler: async (ctx, { eventId }): Promise<ClaimInboxEventResult> => {
    const now = dayjs().valueOf();
    const event = await ctx.db.get(eventId);
    if (!event) return { status: "skipped", reason: "event_missing" };
    if (event.status === "completed" || event.status === "failed")
      return { status: "skipped", reason: `event_${event.status}` };
    if (event.status === "processing" && (event.leaseUntil ?? 0) > now)
      return { status: "skipped", reason: "leased" };
    if (now - event.createdAt > INBOX_EVENT_GIVE_UP_MS) {
      await ctx.db.patch(event._id, {
        status: "failed",
        error: "event_expired",
        leaseToken: undefined,
        leaseUntil: undefined,
        updatedAt: now,
      });
      return { status: "skipped", reason: "event_expired" };
    }
    let route = await routeInboxEvent(ctx, event);
    if (route.kind === "sequence" && event.eventType === "inbox.email.received") {
      const sequence = await ctx.db.get(route.sequenceId);
      if (sequence) {
        const held = await holdForInboundReply(ctx, sequence, {
          emailId: event.emailId,
          occurredAt: null,
          fallbackAt: event.createdAt,
          now,
        });
        route = { ...route, sequenceStatus: held.status };
      }
    }
    if (
      (route.kind === "unmatched" || route.kind === "team") &&
      now - event.createdAt < INBOX_EVENT_MAPPING_WINDOW_MS &&
      ((await mappingMayAppear(ctx, event, now)) ||
        (route.kind === "team" && (await teamBindingMayAppear(ctx, event, now))))
    ) {
      const runAt = now + INBOX_EVENT_RETRY_MS;
      await ctx.db.patch(event._id, {
        status: "pending",
        leaseToken: undefined,
        leaseUntil: undefined,
        updatedAt: now,
      });
      await ctx.scheduler.runAt(runAt, internal.actions.teamInboxEvents.handleInboxEvent, {
        eventId: event._id,
      });
      return { status: "retry_scheduled", runAt };
    }
    const leaseToken = crypto.randomUUID();
    await ctx.db.patch(event._id, {
      status: "processing",
      leaseToken,
      leaseUntil: now + INBOX_EVENT_LEASE_MS,
      updatedAt: now,
    });
    const operatorInbox = await knownInbox(ctx, event.inboxId);
    return {
      status: "claimed",
      leaseToken,
      event: {
        eventId: event._id,
        emailId: event.emailId,
        eventType:
          event.eventType === "inbox.email.sent" ? "inbox.email.sent" : "inbox.email.received",
        inboxId: event.inboxId,
        threadId: event.threadId,
      },
      route,
      inboxOwnerUserId: operatorInbox?.userId ?? null,
      inbox: operatorInbox
        ? {
            inboxId: operatorInbox.inboxId,
            emailAddress: operatorInbox.emailAddress,
            fromName: operatorInbox.fromName,
            labelIds: operatorInbox.labelIds,
          }
        : null,
    };
  },
});

/** Completes (or fails) an event that needs no state change, e.g. an unmatched event. */
export const completeInboxEventInternal = internalMutation({
  args: {
    eventId: v.id("providerOutreachWebhookEvents"),
    leaseToken: v.string(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const event = await fencedEvent(ctx, args.eventId, args.leaseToken, now);
    if (!event) return { applied: false as const };
    await finishEvent(ctx, event, now, args.error);
    return { applied: true as const };
  },
});

/** Returns an event whose handling failed transiently to `pending` for recovery. */
export const releaseInboxEventInternal = internalMutation({
  args: {
    eventId: v.id("providerOutreachWebhookEvents"),
    leaseToken: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const event = await fencedEvent(ctx, args.eventId, args.leaseToken, now);
    if (!event) return { applied: false as const };
    await ctx.db.patch(event._id, {
      status: "pending",
      error: clipEventError(args.error),
      leaseToken: undefined,
      leaseUntil: undefined,
      updatedAt: now,
    });
    return { applied: true as const };
  },
});

// ---------------------------------------------------------------------------
// Team conversation mirror
// ---------------------------------------------------------------------------

/**
 * Mail from one of our own inboxes may be the copy of a send whose
 * `inbox.email.sent` has not landed to supply its Message-ID: wait briefly,
 * then treat it as ordinary (internal) mail. The sender address only delays.
 * Returns whether the event was put back to retry.
 */
async function awaitSentBinding(
  ctx: MutationCtx,
  args: {
    event: EventDoc;
    email: InboxEmail;
    teamRoute: boolean;
    received: boolean;
    now: number;
  },
) {
  const { event, email, received, now } = args;
  if (!args.teamRoute || !received || now - event.createdAt >= SENT_EVENT_BINDING_WAIT_MS)
    return false;
  const ownCopyPending = await ctx.db
    .query("operatorOutreachInboxes")
    .withIndex("by_emailAddress", (q) =>
      q.eq("emailAddress", normalizeProcurementEmail(email.fromEmail)),
    )
    .first();
  if (!ownCopyPending) return false;
  const retryAt = now + INBOX_EVENT_RETRY_MS;
  await ctx.db.patch(event._id, {
    status: "pending",
    leaseToken: undefined,
    leaseUntil: undefined,
    updatedAt: now,
  });
  await ctx.scheduler.runAt(retryAt, internal.actions.teamInboxEvents.handleInboxEvent, {
    eventId: event._id,
  });
  return true;
}

/** An existing conversation, or a new unlinked one owned by the inbox's operator. */
async function resolveTarget(
  ctx: MutationCtx,
  args: {
    route: Extract<InboxEventRoute, { kind: "thread" | "team" }>;
    event: EventDoc;
    inbox: InboxDoc;
  },
): Promise<{ thread: TeamThread } | { create: NewTeamThread } | null> {
  const { route, event, inbox } = args;
  if (route.kind === "thread") {
    const thread = await ctx.db.get(route.threadId);
    return !thread || thread.deletedAt ? null : { thread };
  }
  return {
    create: {
      source: "team",
      ownerUserId: inbox.userId,
      resendThreadId: event.threadId,
      category: "other",
      categoryReason: "Unlinked team mail",
    },
  };
}

async function mirror(
  ctx: MutationCtx,
  args: {
    event: EventDoc;
    inbox: InboxDoc;
    email: InboxEmail;
    attachments: { fileId: Id<"_storage">; filename: string; contentType: string; size: number }[];
    target: { thread: TeamThread } | { create: NewTeamThread };
    received: boolean;
    now: number;
  },
) {
  const { event, inbox, received } = args;
  return await mirrorTeamEmail(ctx, {
    target: args.target,
    email: args.email,
    direction: received ? "inbound" : "outbound",
    attachments: args.attachments,
    resendThreadId: event.threadId,
    inboxId: event.inboxId,
    sentByUserId: received ? undefined : inbox.userId,
    now: args.now,
  });
}

/**
 * Inbound mail not from an operator forwards for matching and alerts the
 * operator. Returns whether the owner is emailed about unlinked mail.
 */
async function notifyInbound(
  ctx: MutationCtx,
  args: {
    event: EventDoc;
    inbox: InboxDoc;
    email: InboxEmail;
    mirrored: Exclude<MirrorTeamEmailResult, { rejected: true }>;
    now: number;
  },
) {
  const { event, inbox, email, mirrored, now } = args;
  let notifyOwner = false;
  if (!mirrored.duplicate) {
    await ctx.scheduler.runAfter(0, internal.actions.teamEmailForwarding.process, {
      threadId: mirrored.threadId,
      inboxId: event.inboxId,
      emailId: event.emailId,
    });
  }
  const senderAddress = normalizeProcurementEmail(email.fromEmail);
  const operatorSender =
    (await resolveActiveOperatorEmail(ctx, senderAddress)) ||
    (await ctx.db.query("operatorOutreachInboxes")
      .withIndex("by_emailAddress", (q) => q.eq("emailAddress", senderAddress))
      .first());
  if (!mirrored.duplicate && !operatorSender) {
    await emitOperatorNotification(ctx, {
      eventKey: `inbox:team_mail:${mirrored.messageId}`,
      category: "inbox",
      target: { kind: "inbox", threadId: mirrored.threadId },
    });
    const thread = (await ctx.db.get(mirrored.threadId))!;
    const ownerUserId = thread.ownerUserId ?? inbox.userId;
    if (ownerUserId) {
      if (thread.clientOrgId && thread.requestId) {
        // Linked conversations reach the owner the same way outreach handoffs do.
        await ctx.scheduler.runAfter(0, internal.lib.notify.notifyInternal, {
          orgId: thread.clientOrgId,
          userId: ownerUserId,
          type: "mailbox_attention",
          severity: "warning",
          actionType: "view_operator_procurement",
          actionPayload: {
            clientOrgId: thread.clientOrgId,
            requestId: thread.requestId,
            view: "email",
            emailThreadId: thread._id,
          },
          title: "New email in your conversation",
          body: `${thread.subject.slice(0, 200)}: review it in the request Inbox.`,
          coalesceKeyParts: ["team_email_thread", String(thread._id)],
          nowMs: now,
        });
      } else {
        // No client to file a notification under: the badge shows it and the owner is emailed.
        await ctx.scheduler.runAfter(0, internal.actions.teamInbox.notifyOwnerOfUnlinkedMail, {
          userId: ownerUserId,
          threadId: thread._id,
        });
        notifyOwner = true;
      }
    }
  }
  return notifyOwner;
}

/**
 * `inbox.email.received` / `inbox.email.sent` for mail no outreach sequence
 * owns: mirrors it into its team conversation (found by thread id, link, or
 * the send it was bound from) or into a new unlinked conversation owned by the
 * inbox's operator. The route is recomputed here from the stored event; the
 * action's claim is never trusted. A copy of mail Spot itself sent (for example
 * a CC in another inbox) is bound to the original conversation, not stored again.
 */
export const applyTeamInboxEmailInternal = internalMutation({
  args: {
    eventId: v.id("providerOutreachWebhookEvents"),
    leaseToken: v.string(),
    email: inboxEmailValidator,
    /** Uploaded attachment bytes; empty while Resend exposes no byte download. */
    attachments: v.optional(v.array(inboxAttachmentValidator)),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const attachments = args.attachments ?? [];
    const dropUploads = () =>
      Promise.all(attachments.map((file) => ctx.storage.delete(file.fileId)));
    const event = await fencedEvent(ctx, args.eventId, args.leaseToken, now);
    if (!event) {
      await dropUploads();
      return { applied: false as const, reason: "stale_lease" };
    }
    const reject = async (reason: string) => {
      await dropUploads();
      await finishEvent(ctx, event, now, reason);
      return { applied: false as const, reason };
    };
    if (event.emailId !== args.email.resendInboxEmailId) return await reject("event_email_mismatch");
    const inbox = await knownInbox(ctx, event.inboxId);
    if (!inbox) return await reject("unknown_inbox");
    if (inbox.kind === "agent") return await reject("agent_inbox_reserved");
    const route = await routeInboxEvent(ctx, event);
    if (route.kind !== "thread" && route.kind !== "team") return await reject("event_route_mismatch");
    const received = event.eventType === "inbox.email.received";
    if (
      await awaitSentBinding(ctx, {
        event,
        email: args.email,
        teamRoute: route.kind === "team",
        received,
        now,
      })
    ) {
      await dropUploads();
      return { applied: false as const, reason: "awaiting_sent_event" };
    }
    const target = await resolveTarget(ctx, { route, event, inbox });
    if (!target) return await reject("thread_missing");
    const mirrored = await mirror(ctx, {
      event,
      inbox,
      email: args.email,
      attachments,
      target,
      received,
      now,
    });
    // A dead client/request target takes nothing (uploads already deleted); the event is final.
    if ("rejected" in mirrored) {
      await finishEvent(ctx, event, now, mirrored.reason);
      return { applied: false as const, reason: mirrored.reason };
    }
    const notifyOwner = received
      ? await notifyInbound(ctx, { event, inbox, email: args.email, mirrored, now })
      : false;
    await finishEvent(ctx, event, now);
    return {
      applied: true as const,
      duplicate: mirrored.duplicate,
      internalCopy: mirrored.internalCopy,
      threadId: mirrored.threadId,
      notifyOwner,
    };
  },
});
