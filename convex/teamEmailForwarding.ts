import dayjs from "dayjs";
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { clientRecipientOptions } from "./lib/clientOutreach";
import {
  operatorEmailAliases,
  requireOperatorForUser,
  resolveActiveOperatorEmail,
} from "./lib/operatorIdentity";
import { normalizeProcurementEmail, uniqueProcurementEmails } from "./lib/procurement";
import { teamTargetProblem } from "./lib/teamEmailStore";
import {
  forwardRequestSignals,
  MAX_FORWARD_PARTICIPANTS,
  type ForwardEvidence,
  type ForwardRequestFacts,
} from "./lib/teamEmailForwards";
import { linkTeamEmailThreadByOperator } from "./procurementRequests";

/**
 * Backing queries and mutations for `actions/teamEmailForwarding:process`:
 * eligibility of a mirrored inbox message, the bounded open-request scan, the
 * one-shot attempt claim, and the guarded link/suggest write. Nothing here
 * trusts the action: every write re-reads the live thread, owner and target.
 */

const SCAN_PAGE_SIZE = 10;
const OUTREACH_LIMIT = 100;
const BROKER_ORG_LIMIT = 20;
const BROKER_CONTACT_LIMIT = 100;
const MEMBER_LIMIT = 50;
const THREAD_SUBJECT_LIMIT = 30;

const evidenceValidator = v.object({
  participants: v.array(v.string()),
  normalizedSubject: v.string(),
});

export type ForwardIneligibleReason =
  | "unknown_inbox"
  | "agent_inbox"
  | "thread_unavailable"
  | "not_eligible"
  | "message_mismatch"
  | "owner_inactive"
  | "already_attempted";

type Ctx = QueryCtx | MutationCtx;

/**
 * The thread, inbox owner and mirrored message a forward may be linked from.
 * The inbox must be a recorded operator inbox (never the agent inbox) owned by
 * the thread's owner, and the thread must be a live, unlinked, non-outreach
 * conversation holding this exact inbound message.
 */
async function forwardTarget(
  ctx: Ctx,
  args: { threadId: Id<"teamEmailThreads">; inboxId: string; emailId: string },
  options: { claimed?: number } = {},
) {
  const inboxes = await ctx.db
    .query("operatorOutreachInboxes")
    .withIndex("by_inboxId", (q) => q.eq("inboxId", args.inboxId))
    .take(2);
  if (inboxes.length !== 1) return { ok: false as const, reason: "unknown_inbox" as const };
  const inbox = inboxes[0];
  if (inbox.kind === "agent" || !inbox.userId)
    return { ok: false as const, reason: "agent_inbox" as const };
  const thread = await ctx.db.get(args.threadId);
  if (!thread || thread.deletedAt || thread.archivedAt)
    return { ok: false as const, reason: "thread_unavailable" as const };
  if (
    thread.source === "outreach" ||
    thread.clientOrgId ||
    thread.requestId ||
    thread.linkedAt !== undefined ||
    thread.ownerUserId !== inbox.userId
  )
    return { ok: false as const, reason: "not_eligible" as const };
  const attempt = thread.forwardLinkAttempt;
  // Before the claim any attempt blocks; the finishing write needs its own open claim.
  const attemptBlocks =
    options.claimed === undefined
      ? attempt !== undefined
      : attempt?.status !== "claimed" || attempt.startedAt !== options.claimed;
  if (attemptBlocks) return { ok: false as const, reason: "already_attempted" as const };
  const message = await ctx.db
    .query("teamEmailMessages")
    .withIndex("by_resendInboxEmailId", (q) => q.eq("resendInboxEmailId", args.emailId))
    .first();
  if (!message || message.threadId !== thread._id || message.direction !== "inbound")
    return { ok: false as const, reason: "message_mismatch" as const };
  let owner;
  try {
    owner = await requireOperatorForUser(ctx, inbox.userId);
  } catch {
    return { ok: false as const, reason: "owner_inactive" as const };
  }
  return { ok: true as const, inbox, thread, message, owner };
}

/** Read-only gate for the action: what the raw message must be checked against. */
export const forwardContext = internalQuery({
  args: {
    threadId: v.id("teamEmailThreads"),
    inboxId: v.string(),
    emailId: v.string(),
  },
  handler: async (ctx, args) => {
    const target = await forwardTarget(ctx, args);
    if (!target.ok) return target;
    return {
      ok: true as const,
      ownerUserId: target.owner.userId,
      inboxAddress: target.inbox.emailAddress.toLowerCase(),
      /** The forwarder's own addresses: never original correspondents. */
      ownerAddresses: [
        ...operatorEmailAliases(target.owner.user.email),
        target.inbox.emailAddress.toLowerCase(),
      ],
      message: {
        fromEmail: normalizeProcurementEmail(target.message.fromEmail),
        rfcMessageId: target.message.messageId ?? null,
      },
    };
  },
});

type ScanRequest = {
  requestId: Id<"procurementRequests">;
  clientOrgId: Id<"organizations">;
  title: string;
  clientName: string;
  status: Doc<"procurementRequests">["status"];
  signals: ReturnType<typeof forwardRequestSignals>;
  /** A bounded source hit its limit, so signals may be missing. */
  truncated: boolean;
};

/** Open means live, company-linked, in a live client, and not completed or cancelled. */
async function evaluateRequest(
  ctx: Ctx,
  request: Doc<"procurementRequests">,
  evidence: ForwardEvidence,
  brokerContactCache: Map<Id<"organizations">, { emails: string[]; truncated: boolean }>,
): Promise<ScanRequest | null> {
  const clientOrgId = request.clientOrgId;
  if (
    !clientOrgId ||
    request.deletedAt ||
    request.intakeAnswers?.intakeGoal === "savings" ||
    request.status === "completed" ||
    request.status === "cancelled" ||
    (await teamTargetProblem(ctx, { clientOrgId, requestId: request._id }))
  )
    return null;
  const client = (await ctx.db.get(clientOrgId))!;
  const [outreaches, memberships, people, threads] = await Promise.all([
    ctx.db
      .query("procurementBrokerOutreaches")
      .withIndex("request", (q) => q.eq("requestId", request._id))
      .take(OUTREACH_LIMIT + 1),
    ctx.db
      .query("orgMemberships")
      .withIndex("organization", (q) => q.eq("orgId", clientOrgId))
      .take(MEMBER_LIMIT + 1),
    clientRecipientOptions(ctx, request, clientOrgId),
    ctx.db
      .query("teamEmailThreads")
      .withIndex("by_requestId_and_latestMessageAt", (q) => q.eq("requestId", request._id))
      .order("desc")
      .take(THREAD_SUBJECT_LIMIT + 1),
  ]);
  const brokerOrgIds = [
    ...new Set(
      outreaches.slice(0, OUTREACH_LIMIT).flatMap((outreach) =>
        outreach.brokerOrgId ? [outreach.brokerOrgId] : [],
      ),
    ),
  ];
  let truncated =
    outreaches.length > OUTREACH_LIMIT ||
    memberships.length > MEMBER_LIMIT ||
    threads.length > THREAD_SUBJECT_LIMIT ||
    brokerOrgIds.length > BROKER_ORG_LIMIT;
  const brokerEmails: string[] = [];
  for (const brokerOrgId of brokerOrgIds.slice(0, BROKER_ORG_LIMIT)) {
    let contacts = brokerContactCache.get(brokerOrgId);
    if (!contacts) {
      const rows = await ctx.db
        .query("brokerContacts")
        .withIndex("by_brokerOrgId_and_deletedAt", (q) =>
          q.eq("brokerOrgId", brokerOrgId).eq("deletedAt", undefined),
        )
        .take(BROKER_CONTACT_LIMIT + 1);
      contacts = {
        emails: rows.slice(0, BROKER_CONTACT_LIMIT).flatMap((row) => (row.email ? [row.email] : [])),
        truncated: rows.length > BROKER_CONTACT_LIMIT,
      };
      brokerContactCache.set(brokerOrgId, contacts);
    }
    brokerEmails.push(...contacts.emails);
    truncated ||= contacts.truncated;
  }
  const facts: ForwardRequestFacts = {
    outreachContacts: outreaches.flatMap((outreach) =>
      outreach.contactEmail ? [outreach.contactEmail] : [],
    ),
    brokerContacts: brokerEmails,
    clientPeople: people.map((person) => person.email),
    clientWebsite: client.website,
    threadSubjects: threads.slice(0, THREAD_SUBJECT_LIMIT).map((thread) => thread.normalizedSubject),
  };
  return {
    requestId: request._id,
    clientOrgId,
    title: request.title.slice(0, 200),
    clientName: client.name.slice(0, 200),
    status: request.status,
    signals: forwardRequestSignals(evidence, facts),
    truncated,
  };
}

/**
 * One page of the open-request scan, newest request first. `unknown` counts
 * open requests that matched nothing but could have (a source hit its limit);
 * the action reports the scan as incomplete when it is non-zero or the scan
 * did not reach the end.
 */
export const scanOpenRequests = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), evidence: evidenceValidator },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("procurementRequests")
      .order("desc")
      .paginate({ cursor: args.cursor, numItems: SCAN_PAGE_SIZE });
    const brokerContactCache = new Map<Id<"organizations">, { emails: string[]; truncated: boolean }>();
    const candidates: Array<Omit<ScanRequest, "truncated">> = [];
    let unknown = 0;
    for (const request of page.page) {
      const evaluated = await evaluateRequest(ctx, request, args.evidence, brokerContactCache);
      if (!evaluated) continue;
      const { truncated, ...candidate } = evaluated;
      if (candidate.signals.length) candidates.push(candidate);
      else if (truncated) unknown += 1;
    }
    return {
      candidates,
      unknown,
      scanned: page.page.length,
      cursor: page.isDone ? null : page.continueCursor,
      isDone: page.isDone,
    };
  },
});

/**
 * Records the single attempt for this thread before any inference, and turns
 * the thread into an authenticated forward: `source: "forward"` with the
 * original correspondents as participants. The owner stays the forwarder.
 * Re-checks eligibility and that `sender` is the owner's login alias. Returns
 * the attempt's `startedAt`, which the finishing write must present.
 */
export const claimForward = internalMutation({
  args: {
    threadId: v.id("teamEmailThreads"),
    inboxId: v.string(),
    emailId: v.string(),
    sender: v.string(),
    participants: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const target = await forwardTarget(ctx, args);
    if (!target.ok) return { claimed: false as const, reason: target.reason };
    const operator = await resolveActiveOperatorEmail(ctx, args.sender);
    if (operator?.userId !== target.owner.userId)
      return { claimed: false as const, reason: "owner_inactive" as const };
    const now = dayjs().valueOf();
    await ctx.db.patch(target.thread._id, {
      source: "forward",
      participantEmails: uniqueProcurementEmails(args.participants, MAX_FORWARD_PARTICIPANTS),
      forwardLinkAttempt: {
        messageId: target.message._id,
        status: "claimed",
        startedAt: now,
      },
    });
    return { claimed: true as const, startedAt: now };
  },
});

const outcomeValidator = v.union(
  v.object({
    kind: v.literal("link"),
    requestId: v.id("procurementRequests"),
    via: v.union(v.literal("deterministic"), v.literal("model")),
  }),
  v.object({
    kind: v.literal("suggest"),
    requestId: v.id("procurementRequests"),
    confidence: v.number(),
    reason: v.string(),
  }),
  v.object({ kind: v.literal("none"), reason: v.string() }),
);

export type ForwardFinishResult =
  | { applied: true; linked: boolean; suggested: boolean }
  | { applied: false; reason: string };

/**
 * Applies the outcome only if this is still the claimed attempt on a thread
 * that is unchanged where it matters: live, unarchived, unlinked, owned by the
 * same active operator, and the chosen request still open and still matching
 * the evidence. Anything else records the attempt as completed without
 * touching the thread. Links go through the canonical writer (audit, category,
 * attachment filing); a suggestion only sets `linkSuggestion`.
 */
export const finishForward = internalMutation({
  args: {
    threadId: v.id("teamEmailThreads"),
    inboxId: v.string(),
    emailId: v.string(),
    startedAt: v.number(),
    evidence: evidenceValidator,
    outcome: outcomeValidator,
  },
  handler: async (ctx, args): Promise<ForwardFinishResult> => {
    const now = dayjs().valueOf();
    const target = await forwardTarget(ctx, args, { claimed: args.startedAt });
    const settle = async (reason: string) => {
      const thread = await ctx.db.get(args.threadId);
      if (
        thread?.forwardLinkAttempt?.status === "claimed" &&
        thread.forwardLinkAttempt.startedAt === args.startedAt
      )
        await ctx.db.patch(thread._id, {
          forwardLinkAttempt: {
            ...thread.forwardLinkAttempt,
            status: "completed",
            finishedAt: now,
            reason: reason.slice(0, 200),
          },
        });
      return { applied: false as const, reason };
    };
    if (!target.ok) return await settle(target.reason);
    const { outcome } = args;
    if (outcome.kind === "none") return await settle(outcome.reason);

    const request = await ctx.db.get(outcome.requestId);
    const evaluated = request
      ? await evaluateRequest(ctx, request, args.evidence, new Map())
      : null;
    if (!evaluated || !evaluated.signals.length) return await settle("candidate_unavailable");

    const completed = {
      messageId: target.message._id,
      status: "completed" as const,
      startedAt: args.startedAt,
      finishedAt: now,
    };
    if (outcome.kind === "suggest") {
      await ctx.db.patch(target.thread._id, {
        linkSuggestion: {
          requestId: evaluated.requestId,
          clientOrgId: evaluated.clientOrgId,
          confidence: Math.min(1, Math.max(0, outcome.confidence)),
          reason: outcome.reason.slice(0, 300),
        },
        forwardLinkAttempt: { ...completed, reason: "suggested" },
      });
      return { applied: true, linked: false, suggested: true };
    }
    await linkTeamEmailThreadByOperator(ctx, {
      operatorUserId: target.owner.userId,
      threadId: target.thread._id,
      requestId: evaluated.requestId,
      source: "suggestion",
    });
    await ctx.db.patch(target.thread._id, {
      forwardLinkAttempt: { ...completed, reason: `linked:${outcome.via}` },
    });
    return { applied: true, linked: true, suggested: false };
  },
});

/** Marks a claimed attempt failed after an error; it is never retried automatically. */
export const failForward = internalMutation({
  args: {
    threadId: v.id("teamEmailThreads"),
    startedAt: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    const attempt = thread?.forwardLinkAttempt;
    if (!thread || attempt?.status !== "claimed" || attempt.startedAt !== args.startedAt) return;
    await ctx.db.patch(thread._id, {
      forwardLinkAttempt: {
        ...attempt,
        status: "failed",
        finishedAt: dayjs().valueOf(),
        reason: args.reason.slice(0, 200),
      },
    });
  },
});
