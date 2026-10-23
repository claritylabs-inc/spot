import dayjs from "dayjs";
import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";

import { components, internal } from "./_generated/api";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalQuery,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  copyLegacyMessage,
  copyLegacyThread,
  teamThreadForSequence,
} from "./lib/teamEmailStore";

/**
 * Procurement email -> team inbox cutover. Every step is idempotent, resumable
 * and keyed by the `legacy*Id` fields, so the same functions serve the bulk
 * copy, the catch-up pass after old writers stop, and live writers that adopt
 * a not-yet-copied thread. Order: `copyThreads`, `copyMessages`, the
 * `repoint*` migrations, `staleLegacyEmailThreadApprovals`,
 * `blockLegacyOperatorDrafts`; then `readback` must report `ok` for every
 * deployed target before the legacy tables and fields are dropped.
 *
 * Run (local backend only; never a deploy key):
 *   env -u CONVEX_DEPLOY_KEY -u CONVEX_DEPLOYMENT_TOKEN npx convex run \
 *     teamInboxMigrations:run '{"fn":"teamInboxMigrations:copyThreads","next":[...]}'
 * with `dryRun: true` first.
 */
const migrations = new Migrations<DataModel>(components.migrations);

const APPROVAL_TOOLS = new Set([
  "reply_procurement_email_thread",
  "update_procurement_email_thread",
  "file_procurement_email_quote",
]);
const SENDER_CHANGED = "Sender changed — update draft to re-sign.";

type Ctx = QueryCtx | MutationCtx;

export const copyThreads = migrations.define({
  table: "procurementEmailThreads",
  batchSize: 50,
  migrateOne: async (ctx, legacy) => {
    await copyLegacyThread(ctx, legacy);
  },
});

/** The team copy of one legacy message, copying its thread and the message if needed. */
async function teamMessageForLegacy(
  ctx: MutationCtx,
  legacy: Doc<"procurementEmailMessages">,
) {
  const parent = await ctx.db.get(legacy.threadId);
  if (!parent) return null;
  const thread = await copyLegacyThread(ctx, parent);
  const messageId = await copyLegacyMessage(ctx, legacy, thread, parent);
  return { threadId: thread._id, messageId };
}

export const copyMessages = migrations.define({
  table: "procurementEmailMessages",
  batchSize: 50,
  migrateOne: async (ctx, legacy) => {
    await teamMessageForLegacy(ctx, legacy);
  },
});

/** Request file items listed under an email message that still point at a legacy message. */
export const repointFileItems = migrations.define({
  table: "procurementFileItems",
  batchSize: 50,
  migrateOne: async (ctx, item) => {
    const source = item.sourceEmailMessageId;
    if (!source) return;
    const legacyId = ctx.db.normalizeId("procurementEmailMessages", source);
    if (!legacyId) return;
    const legacy = await ctx.db.get(legacyId);
    if (!legacy) return;
    const copied = await teamMessageForLegacy(ctx, legacy);
    if (copied) await ctx.db.patch(item._id, { sourceEmailMessageId: copied.messageId });
  },
});

/** Outreach sequences: the team pointer is written first, the legacy pointer cleared only then. */
export const repointSequences = migrations.define({
  table: "procurementOutreachSequences",
  batchSize: 10,
  migrateOne: async (ctx, sequence) => {
    if (!sequence.procurementEmailThreadId) return;
    await teamThreadForSequence(ctx, sequence);
  },
});

/** Email-thread extractions keep their source ref and fingerprint; only the pointer moves. */
export const repointExtractions = migrations.define({
  table: "companyInformationExtractions",
  batchSize: 50,
  migrateOne: async (ctx, extraction) => {
    if (!extraction.procurementEmailThreadId) return;
    const legacy = await ctx.db.get(extraction.procurementEmailThreadId);
    if (!legacy) return;
    const thread = await copyLegacyThread(ctx, legacy);
    await ctx.db.patch(extraction._id, {
      teamEmailThreadId: thread._id,
      procurementEmailThreadId: undefined,
    });
  },
});

type FactSourceWalk = { value: unknown; changed: boolean };

/** Replaces `procurementEmailThreadId` with `teamEmailThreadId` on every email-thread fact source inside `value`. */
async function repointFactSources(
  ctx: MutationCtx,
  value: unknown,
): Promise<FactSourceWalk> {
  if (Array.isArray(value)) {
    let changed = false;
    const next: unknown[] = [];
    for (const item of value) {
      const walked = await repointFactSources(ctx, item);
      changed ||= walked.changed;
      next.push(walked.value);
    }
    return { value: next, changed };
  }
  if (!value || typeof value !== "object") return { value, changed: false };
  const record = value as Record<string, unknown>;
  if (
    record.sourceKind === "procurement_email_thread" &&
    typeof record.procurementEmailThreadId === "string"
  ) {
    const legacyId = ctx.db.normalizeId("procurementEmailThreads", record.procurementEmailThreadId);
    const legacy = legacyId ? await ctx.db.get(legacyId) : null;
    if (!legacy) return { value, changed: false };
    const thread = await copyLegacyThread(ctx, legacy);
    const { procurementEmailThreadId: _legacy, ...rest } = record;
    return { value: { ...rest, teamEmailThreadId: thread._id }, changed: true };
  }
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    const walked = await repointFactSources(ctx, child);
    changed ||= walked.changed;
    next[key] = walked.value;
  }
  return { value: next, changed };
}

/** Organization profile facts whose source is a procurement email thread. */
export const repointOrganizationFactSources = migrations.define({
  table: "organizations",
  batchSize: 50,
  migrateOne: async (ctx, organization) => {
    if (!organization.profileFacts) return;
    const walked = await repointFactSources(ctx, organization.profileFacts);
    if (walked.changed)
      await ctx.db.patch(organization._id, {
        profileFacts: walked.value as Doc<"organizations">["profileFacts"],
      });
  },
});

/** Notification deep links to an email thread. */
export const repointNotifications = migrations.define({
  table: "notifications",
  batchSize: 100,
  migrateOne: async (ctx, notification) => {
    const payload = notification.actionPayload;
    if (!payload || !("emailThreadId" in payload) || !payload.emailThreadId) return;
    const legacyId = ctx.db.normalizeId("procurementEmailThreads", payload.emailThreadId);
    if (!legacyId) return;
    const legacy = await ctx.db.get(legacyId);
    if (!legacy) return;
    const thread = await copyLegacyThread(ctx, legacy);
    await ctx.db.patch(notification._id, {
      actionPayload: { ...payload, emailThreadId: thread._id },
    });
  },
});

function approvalInputThreadId(input: string) {
  try {
    const parsed = JSON.parse(input) as { procurementEmailThreadId?: unknown };
    return typeof parsed.procurementEmailThreadId === "string"
      ? parsed.procurementEmailThreadId
      : null;
  } catch {
    return null;
  }
}

/**
 * Pending exact approvals bind an input hash to a legacy thread id. The input is
 * never rewritten (that would change what the operator approved): the approval
 * goes stale and the agent asks again. Completed approvals are history.
 */
export const staleLegacyEmailThreadApprovals = migrations.define({
  table: "operatorAgentConfirmations",
  batchSize: 100,
  migrateOne: async (ctx, confirmation) => {
    if (confirmation.status !== "pending" || !APPROVAL_TOOLS.has(confirmation.payload.toolName))
      return;
    const threadId = approvalInputThreadId(confirmation.payload.input);
    if (!threadId || !ctx.db.normalizeId("procurementEmailThreads", threadId)) return;
    await ctx.db.patch(confirmation._id, {
      status: "stale",
      invalidatedAt: dayjs().valueOf(),
      invalidationReason: "email_thread_migrated",
    });
  },
});

/** Operator drafts written under the client agent identity must be re-signed by a person before sending. */
export const blockLegacyOperatorDrafts = migrations.define({
  table: "pendingEmails",
  batchSize: 100,
  migrateOne: async (ctx, draft) => {
    if (
      !draft.operatorThreadId ||
      draft.status !== "draft" ||
      draft.senderUserId ||
      draft.transport ||
      draft.sendBlockedReason
    )
      return;
    await ctx.db.patch(draft._id, { sendBlockedReason: SENDER_CHANGED });
  },
});

export const run = migrations.runner();

// ---------------------------------------------------------------------------
// Readback
// ---------------------------------------------------------------------------

const READBACK_CHECKS = [
  "threads",
  "messages",
  "fileItems",
  "sequences",
  "extractions",
  "organizations",
  "notifications",
  "approvals",
  "operatorDrafts",
] as const;
type ReadbackCheck = (typeof READBACK_CHECKS)[number];
const readbackCheckValidator = v.union(...READBACK_CHECKS.map((name) => v.literal(name)));

const PAGE_SIZE = 100;
/** Pages one action run reads before it returns a cursor to resume from. */
const MAX_PAGES_PER_RUN = 150;
const MAX_SAMPLES = 10;

async function teamForLegacyThread(ctx: Ctx, legacyId: Id<"procurementEmailThreads">) {
  return await ctx.db
    .query("teamEmailThreads")
    .withIndex("by_legacyThreadId", (q) => q.eq("legacyThreadId", legacyId))
    .first();
}

/** A failure reason for one source document, or null when it resolves. */
async function readbackProblem(
  ctx: Ctx,
  check: ReadbackCheck,
  doc: Record<string, unknown> & { _id: string },
): Promise<string | null> {
  switch (check) {
    case "threads": {
      const legacy = doc as unknown as Doc<"procurementEmailThreads">;
      const team = await teamForLegacyThread(ctx, legacy._id);
      if (!team) return "no team copy";
      // Identity never changes after the copy; everything else may legitimately
      // move once live mail or an operator touches the copy, so it is compared
      // only while the copy is untouched (`updatedAt` is copied verbatim).
      const untouched = team.updatedAt === legacy.updatedAt;
      const mismatched = (
        [
          ["clientOrgId", team.clientOrgId, legacy.clientOrgId, true],
          ["resendThreadId", team.resendThreadId, legacy.resendThreadId, true],
          ["createdAt", team.createdAt, legacy.createdAt, true],
          ["requestId", team.requestId, legacy.requestId, untouched],
          ["addressedRequestId", team.addressedRequestId, legacy.addressedRequestId, untouched],
          ["archivedAt", team.archivedAt, legacy.archivedAt, untouched],
          ["category", team.category, legacy.category, untouched],
          ["messageCount", team.messageCount, legacy.messageCount, untouched],
          ["latestMessageAt", team.latestMessageAt, legacy.latestMessageAt, untouched],
        ] as const
      ).filter(([, copy, original, compared]) => compared && copy !== original);
      return mismatched.length
        ? `fields differ: ${mismatched.map(([field]) => field).join(", ")}`
        : null;
    }
    case "messages": {
      const legacy = doc as unknown as Doc<"procurementEmailMessages">;
      const copy = await ctx.db
        .query("teamEmailMessages")
        .withIndex("by_legacyMessageId", (q) => q.eq("legacyMessageId", legacy._id))
        .first();
      if (!copy) return "no team copy";
      const team = await teamForLegacyThread(ctx, legacy.threadId);
      return team?._id === copy.threadId ? null : "copy is in another thread";
    }
    case "fileItems": {
      const item = doc as unknown as Doc<"procurementFileItems">;
      if (!item.sourceEmailMessageId) return null;
      const message = await ctx.db.get(item.sourceEmailMessageId);
      return message && ctx.db.normalizeId("teamEmailMessages", item.sourceEmailMessageId)
        ? null
        : "still points at a legacy or missing message";
    }
    case "sequences": {
      const sequence = doc as unknown as Doc<"procurementOutreachSequences">;
      if (sequence.procurementEmailThreadId) return "legacy thread pointer still set";
      if (!sequence.teamEmailThreadId) return null;
      return (await ctx.db.get(sequence.teamEmailThreadId)) ? null : "team thread missing";
    }
    case "extractions": {
      const extraction = doc as unknown as Doc<"companyInformationExtractions">;
      if (extraction.sourceKind !== "procurement_email_thread") return null;
      if (extraction.procurementEmailThreadId) return "legacy thread pointer still set";
      if (!extraction.teamEmailThreadId) return "no thread pointer";
      return (await ctx.db.get(extraction.teamEmailThreadId)) ? null : "team thread missing";
    }
    case "organizations": {
      const organization = doc as unknown as Doc<"organizations">;
      return JSON.stringify(organization.profileFacts ?? null).includes("procurementEmailThreadId")
        ? "profile fact source still has a legacy thread id"
        : null;
    }
    case "notifications": {
      const notification = doc as unknown as Doc<"notifications">;
      const payload = notification.actionPayload;
      if (!payload || !("emailThreadId" in payload) || !payload.emailThreadId) return null;
      if (ctx.db.normalizeId("procurementEmailThreads", payload.emailThreadId))
        return "link still has a legacy thread id";
      return (await ctx.db.get(payload.emailThreadId as Id<"teamEmailThreads">))
        ? null
        : "team thread missing";
    }
    case "approvals": {
      const confirmation = doc as unknown as Doc<"operatorAgentConfirmations">;
      if (confirmation.status !== "pending" || !APPROVAL_TOOLS.has(confirmation.payload.toolName))
        return null;
      const threadId = approvalInputThreadId(confirmation.payload.input);
      return threadId && ctx.db.normalizeId("procurementEmailThreads", threadId)
        ? "pending approval for a legacy thread"
        : null;
    }
    case "operatorDrafts": {
      const draft = doc as unknown as Doc<"pendingEmails">;
      return draft.operatorThreadId &&
        draft.status === "draft" &&
        !draft.senderUserId &&
        !draft.transport &&
        !draft.sendBlockedReason
        ? "unsigned operator draft is not blocked"
        : null;
    }
  }
}

const CHECK_TABLE = {
  threads: "procurementEmailThreads",
  messages: "procurementEmailMessages",
  fileItems: "procurementFileItems",
  sequences: "procurementOutreachSequences",
  extractions: "companyInformationExtractions",
  organizations: "organizations",
  notifications: "notifications",
  approvals: "operatorAgentConfirmations",
  operatorDrafts: "pendingEmails",
} as const satisfies Record<ReadbackCheck, string>;

/** One page of one readback check: how many documents were read and which do not resolve. */
export const readbackPage = internalQuery({
  args: {
    check: readbackCheckValidator,
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query(CHECK_TABLE[args.check])
      .paginate({ cursor: args.cursor, numItems: PAGE_SIZE });
    const problems: { id: string; reason: string }[] = [];
    let unresolved = 0;
    for (const doc of page.page) {
      const reason = await readbackProblem(
        ctx,
        args.check,
        doc as Record<string, unknown> & { _id: string },
      );
      if (!reason) continue;
      unresolved += 1;
      if (problems.length < MAX_SAMPLES) problems.push({ id: String(doc._id), reason });
    }
    return {
      scanned: page.page.length,
      unresolved,
      samples: problems,
      cursor: page.isDone ? null : page.continueCursor,
      isDone: page.isDone,
    };
  },
});

type CheckReport = {
  check: ReadbackCheck;
  scanned: number;
  unresolved: number;
  samples: { id: string; reason: string }[];
  /** Resume point when the run stopped before the table ended; null when finished. */
  cursor: string | null;
  complete: boolean;
};

/**
 * Cutover readback. Reads every source table page by page and reports, per
 * check, how many documents were scanned and which do not resolve. `ok` is true
 * only when every check finished (`complete`) with nothing unresolved: a run
 * that stops at its page budget returns `cursor`s, passed back as `cursors`, and
 * is never reported as success. `scanned` for the thread and message checks is
 * the legacy row count.
 */
export const readback = internalAction({
  args: {
    checks: v.optional(v.array(readbackCheckValidator)),
    cursors: v.optional(v.record(v.string(), v.union(v.string(), v.null()))),
  },
  handler: async (ctx, args) => {
    const reports: CheckReport[] = [];
    let pagesLeft = MAX_PAGES_PER_RUN;
    for (const check of args.checks ?? READBACK_CHECKS) {
      let cursor: string | null = args.cursors?.[check] ?? null;
      const report: CheckReport = {
        check,
        scanned: 0,
        unresolved: 0,
        samples: [],
        cursor: null,
        complete: false,
      };
      while (pagesLeft > 0) {
        pagesLeft -= 1;
        const page: ReadbackPage = await readOnePage(ctx, check, cursor);
        report.scanned += page.scanned;
        report.unresolved += page.unresolved;
        report.samples.push(...page.samples.slice(0, MAX_SAMPLES - report.samples.length));
        cursor = page.cursor;
        if (page.isDone) {
          report.complete = true;
          break;
        }
      }
      report.cursor = report.complete ? null : cursor;
      reports.push(report);
    }
    const complete = reports.every((report) => report.complete);
    return {
      ok: complete && reports.every((report) => report.unresolved === 0),
      complete,
      reports,
      resumeWith: complete
        ? null
        : {
            checks: reports.filter((report) => !report.complete).map((report) => report.check),
            cursors: Object.fromEntries(
              reports
                .filter((report) => !report.complete)
                .map((report) => [report.check, report.cursor]),
            ),
          },
      readAt: dayjs().valueOf(),
    };
  },
});

type ReadbackPage = {
  scanned: number;
  unresolved: number;
  samples: { id: string; reason: string }[];
  cursor: string | null;
  isDone: boolean;
};

function readOnePage(ctx: ActionCtx, check: ReadbackCheck, cursor: string | null): Promise<ReadbackPage> {
  return ctx.runQuery(internal.teamInboxMigrations.readbackPage, { check, cursor });
}
