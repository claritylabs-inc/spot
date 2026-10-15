import dayjs from "dayjs";
import { paginationOptsValidator } from "convex/server";
import { getSessionUserId as getAuthUserId } from "./lib/sessionIdentity";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

const PREVIEW_FRESHNESS_MS = 5 * 60 * 1000;
const AGENT_RUN_LEASE_MS = 30 * 60 * 1000;
const THREAD_PAGE_SIZE = 20;
const MESSAGE_PAGE_SIZE = 50;
const DELETE_BATCH_SIZE = 25;
type ImessageDeletionStage = NonNullable<
  Doc<"imessageHistoryDeletionTargets">["stage"]
>;

async function requireUserId(ctx: Parameters<typeof getAuthUserId>[0]) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("You must be signed in.");
  return userId;
}

async function getOrCreatePrivacyState(ctx: MutationCtx, userId: Id<"users">) {
  const existing = await ctx.db
    .query("imessagePrivacyStates")
    .withIndex("user", (q) => q.eq("userId", userId))
    .unique();
  if (existing) return existing;
  const now = dayjs().valueOf();
  const id = await ctx.db.insert("imessagePrivacyStates", {
    userId,
    historyGeneration: 0,
    createdAt: now,
    updatedAt: now,
  });
  const created = await ctx.db.get(id);
  if (!created) throw new Error("Could not initialize iMessage privacy state.");
  return created;
}

async function assertNoActiveDeletion(
  ctx: MutationCtx,
  state: Doc<"imessagePrivacyStates">,
) {
  if (!state.activeDeletionJobId) return;
  const activeJob = await ctx.db.get(state.activeDeletionJobId);
  if (activeJob && ["queued", "running"].includes(activeJob.status)) {
    throw new Error("Your iMessage history deletion is already running.");
  }
}

function initialDeletionJob(
  userId: Id<"users">,
  generationCutoff: number,
  kind: "preview" | "deletion",
  now: number,
) {
  return {
    userId,
    kind,
    status: kind === "preview" ? ("preparing" as const) : ("queued" as const),
    generationCutoff,
    threadCount: 0,
    messageCount: 0,
    fileCount: 0,
    processedThreadCount: 0,
    deletedMessageCount: 0,
    deletedFileCount: 0,
    preservedFileCount: 0,
    requestedAt: now,
    updatedAt: now,
  };
}

async function findActiveTargetedLease(
  ctx: Pick<QueryCtx, "db">,
  userId: Id<"users">,
  generationCutoff: number,
  now: number,
) {
  return ctx.db
    .query("imessageAgentRunLeases")
    .withIndex("user_expiration", (q) =>
      q.eq("userId", userId).gt("expiresAt", now),
    )
    .filter((q) => q.lte(q.field("generation"), generationCutoff))
    .first();
}

async function scheduleInventory(
  ctx: MutationCtx,
  jobId: Id<"imessageHistoryDeletionJobs">,
  cursor: string | null = null,
) {
  await ctx.scheduler.runAfter(0, internal.imessagePrivacy.inventoryThreads, {
    jobId,
    paginationOpts: { cursor, numItems: THREAD_PAGE_SIZE },
  });
}

function publicJob(job: Doc<"imessageHistoryDeletionJobs"> | null) {
  if (!job) return null;
  return {
    id: job._id,
    kind: job.kind,
    status: job.status,
    threadCount: job.threadCount,
    messageCount: job.messageCount,
    fileCount: job.fileCount,
    processedThreadCount: job.processedThreadCount,
    deletedMessageCount: job.deletedMessageCount,
    deletedFileCount: job.deletedFileCount,
    preservedFileCount: job.preservedFileCount,
    requestedAt: job.requestedAt,
    readyAt: job.readyAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    updatedAt: job.updatedAt,
    lastError: job.lastError,
  };
}

export const preparePersonalImessageDeletionPreview = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const state = await getOrCreatePrivacyState(ctx, userId);
    await assertNoActiveDeletion(ctx, state);
    const now = dayjs().valueOf();
    const jobId = await ctx.db.insert(
      "imessageHistoryDeletionJobs",
      initialDeletionJob(userId, state.historyGeneration, "preview", now),
    );
    await scheduleInventory(ctx, jobId);
    return { previewJobId: jobId };
  },
});

export const getPersonalImessageDeletionState = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const state = await ctx.db
      .query("imessagePrivacyStates")
      .withIndex("user", (q) => q.eq("userId", userId))
      .unique();
    const jobs = await ctx.db
      .query("imessageHistoryDeletionJobs")
      .withIndex("user_requested", (q) => q.eq("userId", userId))
      .order("desc")
      .take(8);
    const generation = state?.historyGeneration ?? 0;
    const activeDeletion = state?.activeDeletionJobId
      ? (jobs.find((job) => job._id === state.activeDeletionJobId) ??
        (await ctx.db.get(state.activeDeletionJobId)))
      : (jobs.find(
          (job) =>
            job.kind === "deletion" &&
            ["queued", "running", "failed"].includes(job.status),
        ) ?? null);
    const now = dayjs().valueOf();
    const preview =
      jobs.find(
        (job) =>
          job.kind === "preview" &&
          job.generationCutoff === generation &&
          (job.status !== "ready" ||
            (job.readyAt !== undefined &&
              now - job.readyAt <= PREVIEW_FRESHNESS_MS)),
      ) ?? null;
    const latestCompleted =
      jobs.find(
        (job) => job.kind === "deletion" && job.status === "completed",
      ) ?? null;
    const activeLease = await findActiveTargetedLease(
      ctx,
      userId,
      generation,
      now,
    );
    return {
      historyGeneration: generation,
      hasActiveAgentTurn: Boolean(activeLease),
      preview: publicJob(preview),
      deletion: publicJob(activeDeletion),
      latestCompleted: publicJob(latestCompleted),
    };
  },
});

export const requestPersonalImessageDeletion = mutation({
  args: { previewJobId: v.id("imessageHistoryDeletionJobs") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const [state, preview] = await Promise.all([
      getOrCreatePrivacyState(ctx, userId),
      ctx.db.get(args.previewJobId),
    ]);
    const now = dayjs().valueOf();
    if (
      !preview ||
      preview.userId !== userId ||
      preview.kind !== "preview" ||
      preview.status !== "ready" ||
      !preview.readyAt ||
      now - preview.readyAt > PREVIEW_FRESHNESS_MS ||
      preview.generationCutoff !== state.historyGeneration
    ) {
      throw new Error("That inventory is no longer current. Prepare it again.");
    }
    const activeLease = await findActiveTargetedLease(
      ctx,
      userId,
      state.historyGeneration,
      now,
    );
    if (activeLease) {
      throw new Error(
        "Wait for the active iMessage response to finish, then try again.",
      );
    }
    await assertNoActiveDeletion(ctx, state);

    const jobId = await ctx.db.insert(
      "imessageHistoryDeletionJobs",
      initialDeletionJob(userId, state.historyGeneration, "deletion", now),
    );
    await ctx.db.patch(state._id, {
      historyGeneration: state.historyGeneration + 1,
      activeDeletionJobId: jobId,
      updatedAt: now,
    });
    await scheduleInventory(ctx, jobId);
    console.log("[imessage-privacy] Deletion requested", {
      userId,
      jobId,
      generationCutoff: state.historyGeneration,
    });
    return { deletionJobId: jobId };
  },
});

export const claimAgentRun = internalMutation({
  args: { userId: v.id("users"), leaseKey: v.string() },
  handler: async (ctx, args) => {
    const state = await getOrCreatePrivacyState(ctx, args.userId);
    const now = dayjs().valueOf();
    const existing = await ctx.db
      .query("imessageAgentRunLeases")
      .withIndex("lease", (q) => q.eq("leaseKey", args.leaseKey))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        expiresAt: now + AGENT_RUN_LEASE_MS,
        updatedAt: now,
      });
      return { leaseId: existing._id, generation: existing.generation };
    }
    const leaseId = await ctx.db.insert("imessageAgentRunLeases", {
      userId: args.userId,
      generation: state.historyGeneration,
      leaseKey: args.leaseKey,
      expiresAt: now + AGENT_RUN_LEASE_MS,
      createdAt: now,
      updatedAt: now,
    });
    return { leaseId, generation: state.historyGeneration };
  },
});

export const attachAgentRunThread = internalMutation({
  args: {
    leaseId: v.id("imessageAgentRunLeases"),
    threadId: v.id("threads"),
  },
  handler: async (ctx, args) => {
    const lease = await ctx.db.get(args.leaseId);
    if (!lease) return;
    await ctx.db.patch(lease._id, {
      threadId: args.threadId,
      updatedAt: dayjs().valueOf(),
    });
  },
});

export const releaseAgentRun = internalMutation({
  args: { leaseId: v.id("imessageAgentRunLeases") },
  handler: async (ctx, args) => {
    const lease = await ctx.db.get(args.leaseId);
    if (lease) await ctx.db.delete(lease._id);
  },
});

export const inventoryThreads = internalMutation({
  args: {
    jobId: v.id("imessageHistoryDeletionJobs"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || ["completed", "failed"].includes(job.status)) return;
    try {
      const page = await ctx.db
        .query("threads")
        .withIndex("private_history", (q) =>
          q
            .eq("createdBy", job.userId)
            .eq("originChannel", "imessage")
            .eq("visibility", "user_private"),
        )
        .paginate(args.paginationOpts);
      let added = 0;
      for (const thread of page.page) {
        if (thread.imessageIsGroup === true) continue;
        if ((thread.imessageHistoryGeneration ?? 0) > job.generationCutoff) {
          continue;
        }
        const existing = await ctx.db
          .query("imessageHistoryDeletionTargets")
          .withIndex("job_thread", (q) =>
            q.eq("jobId", job._id).eq("threadId", thread._id),
          )
          .unique();
        if (existing) continue;
        const now = dayjs().valueOf();
        await ctx.db.insert("imessageHistoryDeletionTargets", {
          jobId: job._id,
          threadId: thread._id,
          chatGuid: thread.imessageChatGuid,
          status: "pending_inventory",
          createdAt: now,
          updatedAt: now,
        });
        added += 1;
      }
      const now = dayjs().valueOf();
      await ctx.db.patch(job._id, {
        threadCount: job.threadCount + added,
        updatedAt: now,
      });
      if (page.isDone) {
        await ctx.scheduler.runAfter(
          0,
          internal.imessagePrivacy.inventoryNextTarget,
          { jobId: job._id },
        );
      } else {
        await scheduleInventory(ctx, job._id, page.continueCursor);
      }
    } catch (error) {
      await markJobFailed(ctx, job, error);
    }
  },
});

export const inventoryNextTarget = internalMutation({
  args: { jobId: v.id("imessageHistoryDeletionJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || ["completed", "failed"].includes(job.status)) return;
    try {
      const target = await ctx.db
        .query("imessageHistoryDeletionTargets")
        .withIndex("job_status", (q) =>
          q.eq("jobId", job._id).eq("status", "pending_inventory"),
        )
        .first();
      if (!target) {
        const now = dayjs().valueOf();
        if (job.kind === "preview") {
          await ctx.db.patch(job._id, {
            status: "ready",
            readyAt: now,
            updatedAt: now,
          });
          return;
        }
        await ctx.db.patch(job._id, {
          status: "running",
          startedAt: job.startedAt ?? now,
          updatedAt: now,
        });
        await ctx.scheduler.runAfter(
          0,
          internal.imessagePrivacy.deleteNextTarget,
          { jobId: job._id },
        );
        return;
      }
      await ctx.scheduler.runAfter(
        0,
        internal.imessagePrivacy.inventoryTargetMessages,
        {
          targetId: target._id,
          paginationOpts: {
            cursor: target.inventoryCursor ?? null,
            numItems: MESSAGE_PAGE_SIZE,
          },
        },
      );
    } catch (error) {
      await markJobFailed(ctx, job, error);
    }
  },
});

export const inventoryTargetMessages = internalMutation({
  args: {
    targetId: v.id("imessageHistoryDeletionTargets"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const target = await ctx.db.get(args.targetId);
    if (!target) return;
    const job = await ctx.db.get(target.jobId);
    if (!job || ["completed", "failed"].includes(job.status)) return;
    try {
      const page = await ctx.db
        .query("threadMessages")
        .withIndex("thread", (q) => q.eq("threadId", target.threadId))
        .order("asc")
        .paginate(args.paginationOpts);
      let addedFiles = 0;
      for (const message of page.page) {
        for (const attachment of message.attachments ?? []) {
          const fileId = attachment.fileId;
          if (!fileId) continue;
          const existing = await ctx.db
            .query("imessageHistoryDeletionFiles")
            .withIndex("job_file", (q) =>
              q.eq("jobId", job._id).eq("fileId", fileId),
            )
            .first();
          if (existing) continue;
          const now = dayjs().valueOf();
          await ctx.db.insert("imessageHistoryDeletionFiles", {
            jobId: job._id,
            targetId: target._id,
            fileId,
            status: "pending",
            createdAt: now,
            updatedAt: now,
          });
          addedFiles += 1;
        }
      }
      const now = dayjs().valueOf();
      await ctx.db.patch(target._id, {
        inventoryCursor: page.isDone ? undefined : page.continueCursor,
        status: page.isDone ? "inventoried" : "pending_inventory",
        updatedAt: now,
      });
      await ctx.db.patch(job._id, {
        messageCount: job.messageCount + page.page.length,
        fileCount: job.fileCount + addedFiles,
        updatedAt: now,
      });
      if (page.isDone) {
        await ctx.scheduler.runAfter(
          0,
          internal.imessagePrivacy.inventoryNextTarget,
          { jobId: job._id },
        );
      } else {
        await ctx.scheduler.runAfter(
          0,
          internal.imessagePrivacy.inventoryTargetMessages,
          {
            targetId: target._id,
            paginationOpts: {
              cursor: page.continueCursor,
              numItems: MESSAGE_PAGE_SIZE,
            },
          },
        );
      }
    } catch (error) {
      await markJobFailed(ctx, job, error);
    }
  },
});

async function markJobFailed(
  ctx: MutationCtx,
  job: Doc<"imessageHistoryDeletionJobs">,
  error: unknown,
) {
  const lastError = error instanceof Error ? error.message : String(error);
  await ctx.db.patch(job._id, {
    status: "failed",
    lastError: lastError.slice(0, 500),
    updatedAt: dayjs().valueOf(),
  });
  console.error("[imessage-privacy] Job failed", {
    jobId: job._id,
    kind: job.kind,
    error: lastError,
  });
}

async function scheduleDeleteTarget(
  ctx: MutationCtx,
  targetId: Id<"imessageHistoryDeletionTargets">,
) {
  await ctx.scheduler.runAfter(0, internal.imessagePrivacy.deleteTargetBatch, {
    targetId,
  });
}

export const deleteNextTarget = internalMutation({
  args: { jobId: v.id("imessageHistoryDeletionJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.kind !== "deletion" || job.status !== "running") return;
    const target =
      (await ctx.db
        .query("imessageHistoryDeletionTargets")
        .withIndex("job_status", (q) =>
          q.eq("jobId", job._id).eq("status", "deleting"),
        )
        .first()) ??
      (await ctx.db
        .query("imessageHistoryDeletionTargets")
        .withIndex("job_status", (q) =>
          q.eq("jobId", job._id).eq("status", "inventoried"),
        )
        .first());
    if (!target) {
      const now = dayjs().valueOf();
      await ctx.db.patch(job._id, {
        status: "completed",
        completedAt: now,
        updatedAt: now,
      });
      const state = await ctx.db
        .query("imessagePrivacyStates")
        .withIndex("user", (q) => q.eq("userId", job.userId))
        .unique();
      if (state?.activeDeletionJobId === job._id) {
        await ctx.db.patch(state._id, {
          activeDeletionJobId: undefined,
          updatedAt: now,
        });
      }
      console.log("[imessage-privacy] Deletion completed", {
        jobId: job._id,
        threadCount: job.threadCount,
        deletedMessageCount: job.deletedMessageCount,
        deletedFileCount: job.deletedFileCount,
        preservedFileCount: job.preservedFileCount,
      });
      return;
    }
    if (target.status !== "deleting") {
      await ctx.db.patch(target._id, {
        status: "deleting",
        stage: "connected_email",
        updatedAt: dayjs().valueOf(),
      });
    }
    await scheduleDeleteTarget(ctx, target._id);
  },
});

async function unlinkByThreadId(
  ctx: MutationCtx,
  table: "connectedEmailAutomationItems" | "certificateWorkflowJobs",
  threadId: Id<"threads">,
) {
  const rows = await ctx.db
    .query(table)
    .withIndex("thread", (q) => q.eq("threadId", threadId))
    .take(DELETE_BATCH_SIZE);
  for (const row of rows) {
    await ctx.db.patch(row._id, {
      threadId: undefined,
      updatedAt: dayjs().valueOf(),
    });
  }
  return rows.length;
}

async function fileHasBusinessReference(
  ctx: MutationCtx,
  fileId: Id<"_storage">,
) {
  const checks = await Promise.all([
    ctx.db
      .query("policies")
      .withIndex("file", (q) => q.eq("fileId", fileId))
      .first(),
    ctx.db
      .query("policyFiles")
      .withIndex("file", (q) => q.eq("fileId", fileId))
      .first(),
    ctx.db
      .query("requirementSourceDocuments")
      .withIndex("file", (q) => q.eq("fileId", fileId))
      .first(),
    ctx.db
      .query("certificates")
      .withIndex("file", (q) => q.eq("fileId", fileId))
      .first(),
    ctx.db
      .query("certificateVersions")
      .withIndex("file", (q) => q.eq("fileId", fileId))
      .first(),
  ]);
  return checks.some(Boolean);
}

async function scrubInboundEvents(
  ctx: MutationCtx,
  rows: Doc<"imessageInboundEvents">[],
) {
  const updatedAt = dayjs().valueOf();
  for (const row of rows) {
    await ctx.db.patch(row._id, {
      fromPhone: undefined,
      chatGuid: undefined,
      messageText: undefined,
      response: undefined,
      error: undefined,
      recoveryFailure: undefined,
      threadId: undefined,
      historyGeneration: undefined,
      privacyContextPending: undefined,
      updatedAt,
    });
  }
}

export const deleteTargetBatch = internalMutation({
  args: { targetId: v.id("imessageHistoryDeletionTargets") },
  handler: async (ctx, args) => {
    const target = await ctx.db.get(args.targetId);
    if (!target || target.status !== "deleting") return;
    const job = await ctx.db.get(target.jobId);
    if (!job || job.kind !== "deletion" || job.status !== "running") return;
    const stage = target.stage ?? "connected_email";
    const advance = async (next: ImessageDeletionStage) => {
      await ctx.db.patch(target._id, {
        stage: next,
        updatedAt: dayjs().valueOf(),
      });
      await scheduleDeleteTarget(ctx, target._id);
    };
    try {
      if (stage === "connected_email") {
        if (
          await unlinkByThreadId(
            ctx,
            "connectedEmailAutomationItems",
            target.threadId,
          )
        ) {
          await scheduleDeleteTarget(ctx, target._id);
        } else await advance("certificate_workflow");
        return;
      }
      if (stage === "certificate_workflow") {
        if (
          await unlinkByThreadId(
            ctx,
            "certificateWorkflowJobs",
            target.threadId,
          )
        ) {
          await scheduleDeleteTarget(ctx, target._id);
        } else await advance("audit");
        return;
      }
      if (stage === "audit") {
        const rows = await ctx.db
          .query("agentActionAuditEvents")
          .withIndex("thread_created", (q) => q.eq("threadId", target.threadId))
          .take(DELETE_BATCH_SIZE);
        for (const row of rows) {
          await ctx.db.patch(row._id, {
            threadId: undefined,
            threadMessageId: undefined,
            input: undefined,
            output: undefined,
          });
        }
        if (rows.length) await scheduleDeleteTarget(ctx, target._id);
        else await advance("outbound");
        return;
      }
      if (stage === "outbound") {
        const rows = await ctx.db
          .query("imessageOutboundSends")
          .withIndex("thread", (q) => q.eq("threadId", target.threadId))
          .take(DELETE_BATCH_SIZE);
        for (const row of rows) {
          await ctx.db.patch(row._id, {
            threadId: undefined,
            threadMessageId: undefined,
            error: undefined,
            updatedAt: dayjs().valueOf(),
          });
        }
        if (rows.length) await scheduleDeleteTarget(ctx, target._id);
        else await advance("app_cards");
        return;
      }
      if (stage === "app_cards") {
        const rows = await ctx.db
          .query("appCardAccessLinks")
          .withIndex("thread", (q) => q.eq("sourceThreadId", target.threadId))
          .take(DELETE_BATCH_SIZE);
        for (const row of rows) {
          await ctx.db.patch(row._id, {
            sourceThreadId: undefined,
            sourceThreadMessageId: undefined,
            updatedAt: dayjs().valueOf(),
          });
        }
        if (rows.length) await scheduleDeleteTarget(ctx, target._id);
        else await advance("email_draft_links");
        return;
      }
      if (stage === "email_draft_links") {
        const rows = await ctx.db
          .query("emailDraftReviewLinks")
          .withIndex("thread", (q) => q.eq("sourceThreadId", target.threadId))
          .take(DELETE_BATCH_SIZE);
        for (const row of rows) await ctx.db.delete(row._id);
        if (rows.length) await scheduleDeleteTarget(ctx, target._id);
        else await advance("pending_email");
        return;
      }
      if (stage === "pending_email") {
        const rows = await ctx.db
          .query("pendingEmails")
          .withIndex("thread", (q) => q.eq("threadId", target.threadId))
          .take(DELETE_BATCH_SIZE);
        let preservedFiles = 0;
        for (const row of rows) {
          for (const attachment of row.attachments ?? []) {
            const file = await ctx.db
              .query("imessageHistoryDeletionFiles")
              .withIndex("job_file", (q) =>
                q.eq("jobId", job._id).eq("fileId", attachment.fileId),
              )
              .first();
            if (file?.status === "pending") {
              await ctx.db.patch(file._id, {
                status: "preserved",
                reason: "retained_email",
                updatedAt: dayjs().valueOf(),
              });
              preservedFiles += 1;
            }
          }
          await ctx.db.patch(row._id, {
            threadId: undefined,
            chatMessageId: undefined,
            threadMessageId: undefined,
          });
        }
        if (preservedFiles > 0) {
          await ctx.db.patch(job._id, {
            preservedFileCount: job.preservedFileCount + preservedFiles,
            updatedAt: dayjs().valueOf(),
          });
        }
        if (rows.length) await scheduleDeleteTarget(ctx, target._id);
        else await advance("delivery_attempt");
        return;
      }
      if (stage === "delivery_attempt") {
        const rows = await ctx.db
          .query("emailDeliveryAttempts")
          .withIndex("thread", (q) => q.eq("threadId", target.threadId))
          .take(DELETE_BATCH_SIZE);
        for (const row of rows) {
          await ctx.db.patch(row._id, {
            threadId: undefined,
            threadMessageId: undefined,
            recipientEmail: undefined,
            ccAddresses: undefined,
            bccAddresses: undefined,
            subject: undefined,
            error: undefined,
          });
        }
        if (rows.length) await scheduleDeleteTarget(ctx, target._id);
        else await advance("inbound_event");
        return;
      }
      if (stage === "inbound_event") {
        const rows = await ctx.db
          .query("imessageInboundEvents")
          .withIndex("thread", (q) => q.eq("threadId", target.threadId))
          .take(DELETE_BATCH_SIZE);
        await scrubInboundEvents(ctx, rows);
        if (rows.length) await scheduleDeleteTarget(ctx, target._id);
        else await advance("legacy_inbound_event");
        return;
      }
      if (stage === "legacy_inbound_event") {
        const rows = target.chatGuid
          ? await ctx.db
              .query("imessageInboundEvents")
              .withIndex("chat", (q) => q.eq("chatGuid", target.chatGuid))
              .filter((q) =>
                q.and(
                  q.lte(q.field("createdAt"), job.requestedAt),
                  q.neq(q.field("privacyContextPending"), true),
                ),
              )
              .take(DELETE_BATCH_SIZE)
          : [];
        await scrubInboundEvents(ctx, rows);
        if (rows.length) await scheduleDeleteTarget(ctx, target._id);
        else await advance("leases");
        return;
      }
      if (stage === "leases") {
        const rows = await ctx.db
          .query("imessageAgentRunLeases")
          .withIndex("thread", (q) => q.eq("threadId", target.threadId))
          .take(DELETE_BATCH_SIZE);
        for (const row of rows) await ctx.db.delete(row._id);
        if (rows.length) await scheduleDeleteTarget(ctx, target._id);
        else await advance("messages");
        return;
      }
      if (stage === "messages") {
        const rows = await ctx.db
          .query("threadMessages")
          .withIndex("thread", (q) => q.eq("threadId", target.threadId))
          .take(DELETE_BATCH_SIZE);
        for (const row of rows) await ctx.db.delete(row._id);
        if (rows.length) {
          await ctx.db.patch(job._id, {
            deletedMessageCount: job.deletedMessageCount + rows.length,
            updatedAt: dayjs().valueOf(),
          });
          await scheduleDeleteTarget(ctx, target._id);
        } else await advance("summary");
        return;
      }
      if (stage === "summary") {
        const summary = await ctx.db
          .query("threadContextStates")
          .withIndex("thread", (q) => q.eq("threadId", target.threadId))
          .unique();
        if (summary) await ctx.db.delete(summary._id);
        await advance("files");
        return;
      }
      if (stage === "files") {
        const files = await ctx.db
          .query("imessageHistoryDeletionFiles")
          .withIndex("target_status", (q) =>
            q.eq("targetId", target._id).eq("status", "pending"),
          )
          .take(10);
        let deleted = 0;
        let preserved = 0;
        for (const file of files) {
          if (await fileHasBusinessReference(ctx, file.fileId)) {
            await ctx.db.patch(file._id, {
              status: "preserved",
              reason: "business_record",
              updatedAt: dayjs().valueOf(),
            });
            preserved += 1;
          } else {
            await ctx.storage.delete(file.fileId);
            await ctx.db.patch(file._id, {
              status: "deleted",
              updatedAt: dayjs().valueOf(),
            });
            deleted += 1;
          }
        }
        if (files.length) {
          await ctx.db.patch(job._id, {
            deletedFileCount: job.deletedFileCount + deleted,
            preservedFileCount: job.preservedFileCount + preserved,
            updatedAt: dayjs().valueOf(),
          });
          await scheduleDeleteTarget(ctx, target._id);
        } else await advance("thread");
        return;
      }
      if (stage === "thread") {
        const thread = await ctx.db.get(target.threadId);
        if (thread) await ctx.db.delete(thread._id);
        const now = dayjs().valueOf();
        await ctx.db.patch(target._id, {
          status: "completed",
          stage: undefined,
          updatedAt: now,
        });
        await ctx.db.patch(job._id, {
          processedThreadCount: job.processedThreadCount + 1,
          updatedAt: now,
        });
        console.log("[imessage-privacy] Target completed", {
          jobId: job._id,
          targetId: target._id,
          processedThreadCount: job.processedThreadCount + 1,
          threadCount: job.threadCount,
        });
        await ctx.scheduler.runAfter(
          0,
          internal.imessagePrivacy.deleteNextTarget,
          { jobId: job._id },
        );
        return;
      }
      const unhandledStage: never = stage;
      return unhandledStage;
    } catch (error) {
      await markJobFailed(ctx, job, error);
    }
  },
});
