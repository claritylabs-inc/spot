import dayjs from "dayjs";
import { paginationOptsValidator, makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { googleWorkspaceCredentialEnvelope } from "./lib/googleWorkspaceCredentials";
import {
  GOOGLE_WORKSPACE_SCAN_LIMITS as LIMITS,
  type GoogleWorkspaceScanStatus,
} from "./lib/googleWorkspaceScan";
import {
  scanIntervalValidator,
  scanEvidenceValidator,
} from "./lib/googleWorkspaceScanSchema";
import {
  assertGoogleWorkspaceScanSourceLease,
  requireLiveScan,
  scanConfig,
} from "./lib/googleWorkspaceScanState";
import {
  getActiveOperatorImpersonation,
  requireOperator,
  requireOperatorForUser,
  writeOperatorAudit,
} from "./lib/operatorIdentity";

export { assertGoogleWorkspaceScanSourceLease } from "./lib/googleWorkspaceScanState";
const dispatchRef = makeFunctionReference<
  "mutation",
  Record<string, never>,
  null
>("operatorGoogleWorkspaceScan:dispatchInternal");
const discoveryRef = makeFunctionReference<
  "action",
  { runId: Id<"operatorGoogleWorkspaceScanRuns"> },
  null
>("actions/operatorGoogleWorkspaceScan:discover");
const mailboxRef = makeFunctionReference<
  "action",
  { mailboxId: Id<"operatorGoogleWorkspaceScanMailboxes"> },
  null
>("actions/operatorGoogleWorkspaceScan:collectMailbox");
const sourceRef = makeFunctionReference<
  "action",
  { sourceId: Id<"operatorGoogleWorkspaceScanSources"> },
  null
>("actions/operatorGoogleWorkspaceScan:collectSource");
const reconcileRef = makeFunctionReference<
  "action",
  { sourceId: Id<"operatorGoogleWorkspaceScanSources"> },
  null
>("actions/operatorGoogleWorkspaceReconciliation:reconcileSource");
const terminalPhases = new Set(["completed", "partial", "paused"]);

async function requireWriter(ctx: MutationCtx) {
  const operator = await requireOperator(ctx);
  if (await getActiveOperatorImpersonation(ctx))
    throw new Error("Operator impersonation is read-only.");
  return operator;
}
async function beginRun(
  ctx: MutationCtx,
  config: Doc<"operatorGoogleWorkspaceScanConfig">,
) {
  const existing = config.currentRunId
    ? await ctx.db.get(config.currentRunId)
    : null;
  if (existing && !terminalPhases.has(existing.phase))
    return { runId: existing._id, alreadyRunning: true };
  const now = dayjs().valueOf();
  const runId = await ctx.db.insert("operatorGoogleWorkspaceScanRuns", {
    authorizationRevision: config.authorizationRevision,
    phase: "discovery",
    startedAt: now,
    windowStartAt:
      config.windowStartAt ?? dayjs(now).subtract(90, "day").valueOf(),
    directoryComplete: false,
    discoveredMailboxes: 0,
    completedMailboxes: 0,
    failedMailboxes: 0,
    collectedMessages: 0,
    failedSources: 0,
    pendingSources: 0,
    reconciledSources: 0,
    nextAttemptAt: now,
    attempts: 0,
  });
  await ctx.db.patch(config._id, {
    currentRunId: runId,
    nextRunAt: now + config.intervalMinutes * 60_000,
  });
  await ctx.scheduler.runAfter(0, dispatchRef, {});
  return { runId, alreadyRunning: false };
}

export const getStatus = query({
  args: {},
  handler: async (ctx): Promise<GoogleWorkspaceScanStatus> => {
    await requireOperator(ctx);
    const config = await scanConfig(ctx);
    const run = config?.currentRunId
      ? await ctx.db.get(config.currentRunId)
      : null;
    const sponsor = config
      ? await ctx.db.get(config.authorizingOperatorId)
      : null;
    return {
      config: {
        enabled: config?.enabled ?? false,
        intervalMinutes: config?.intervalMinutes ?? 60,
        authorizationRevision: config?.authorizationRevision ?? 0,
        settingsUpdatedAt: config?.updatedAt ?? 0,
        authorizingOperatorId: config?.authorizingOperatorId ?? null,
        pausedReason: config?.pausedReason ?? null,
        authorizingOperatorLabel: sponsor?.name ?? sponsor?.email ?? null,
      },
      nextRunAt: config?.enabled ? config.nextRunAt : null,
      lastSuccessAt: config?.lastSuccessAt ?? null,
      latestRun: run
        ? {
            id: run._id,
            phase: run.phase,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt ?? null,
            error: run.error ?? null,
            coverage: {
              windowStartAt: run.windowStartAt,
              discoveredMailboxes: run.discoveredMailboxes,
              completedMailboxes: run.completedMailboxes,
              failedMailboxes: run.failedMailboxes,
              failedSources: run.failedSources,
              collectedMessages: run.collectedMessages,
              pendingSources: run.pendingSources,
              reconciledSources: run.reconciledSources,
              directoryComplete: run.directoryComplete,
            },
          }
        : null,
    };
  },
});
export const updateSettings = mutation({
  args: {
    expectedAuthorizationRevision: v.optional(v.number()),
    expectedSettingsUpdatedAt: v.optional(v.number()),
    enabled: v.boolean(),
    intervalMinutes: scanIntervalValidator,
    authorizingOperatorId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const operator = await requireWriter(ctx);
    const existing = await scanConfig(ctx);
    if (
      args.expectedSettingsUpdatedAt !== undefined &&
      args.expectedSettingsUpdatedAt !== (existing?.updatedAt ?? 0)
    )
      throw new Error(
        "Scan settings changed. Reload and review the current schedule before saving.",
      );
    if (
      args.expectedAuthorizationRevision !== undefined &&
      args.expectedAuthorizationRevision !==
        (existing?.authorizationRevision ?? 0)
    )
      throw new Error(
        "Scan authorization changed. Reload and review the current settings before saving.",
      );
    const sponsor =
      args.authorizingOperatorId ??
      existing?.authorizingOperatorId ??
      operator.userId;
    if (args.enabled) await requireOperatorForUser(ctx, sponsor);
    const connector = await ctx.db
      .query("operatorGoogleWorkspaceConfig")
      .withIndex("key", (q) => q.eq("key", "default"))
      .unique();
    const credential = await googleWorkspaceCredentialEnvelope();
    if (
      args.enabled &&
      existing?.enabled &&
      args.expectedAuthorizationRevision !== undefined &&
      (existing.connectorRevision !== connector?.updatedAt ||
        existing.credentialRevision !== credential.revision)
    )
      throw new Error(
        "Workspace access changed. Pause scanning and review the new connection before enabling it again.",
      );
    if (
      args.enabled &&
      (!connector?.enabled ||
        connector.mailboxMode !== "directory" ||
        !connector.directoryAdminEmail ||
        !credential.credentials)
    )
      throw new Error(
        "Enable Directory access with valid Workspace credentials before enabling scanning.",
      );
    const now = Math.max(dayjs().valueOf(), (existing?.updatedAt ?? 0) + 1);
    const changed =
      !existing ||
      existing.enabled !== args.enabled ||
      existing.authorizingOperatorId !== sponsor ||
      existing.connectorRevision !== connector?.updatedAt ||
      existing.credentialRevision !== credential.revision;
    const value = {
      enabled: args.enabled,
      intervalMinutes: args.intervalMinutes,
      authorizingOperatorId: sponsor,
      authorizationRevision:
        (existing?.authorizationRevision ?? 0) + (changed ? 1 : 0),
      connectorRevision: connector?.updatedAt ?? 0,
      credentialRevision: credential.revision ?? "",
      pausedReason: undefined,
      windowStartAt:
        existing?.windowStartAt ??
        (args.enabled
          ? dayjs(now).subtract(LIMITS.initialLookbackDays, "day").valueOf()
          : undefined),
      nextRunAt: changed ? now : now + args.intervalMinutes * 60_000,
      updatedAt: now,
    };
    const id =
      existing?._id ??
      (await ctx.db.insert("operatorGoogleWorkspaceScanConfig", {
        key: "default",
        ...value,
      }));
    if (existing) await ctx.db.patch(id, value);
    if (changed && existing?.currentRunId) {
      const run = await ctx.db.get(existing.currentRunId);
      if (run && !terminalPhases.has(run.phase))
        await ctx.db.patch(run._id, { phase: "paused", finishedAt: now });
    }
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      summary: args.enabled
        ? "Authorized scheduled Workspace reconciliation"
        : "Paused scheduled Workspace reconciliation",
      metadata: {
        enabled: args.enabled,
        intervalMinutes: args.intervalMinutes,
        authorizingOperatorId: sponsor,
        authorizationRevision: value.authorizationRevision,
      },
    });
    if (args.enabled && changed) await beginRun(ctx, (await ctx.db.get(id))!);
    return null;
  },
});
export const startScan = mutation({
  args: {},
  handler: async (ctx) => {
    await requireWriter(ctx);
    const { config } = await requireLiveScan(ctx);
    return beginRun(ctx, config);
  },
});
export const listMailboxes = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const config = await scanConfig(ctx);
    if (!config?.currentRunId)
      return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db
      .query("operatorGoogleWorkspaceScanMailboxes")
      .withIndex("run_status", (q) => q.eq("runId", config.currentRunId!))
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(100, args.paginationOpts.numItems),
      });
    return {
      ...result,
      page: await Promise.all(
        result.page.map(async (row) => ({
          id: row._id,
          mailbox: row.mailbox,
          phase: row.phase,
          status: row.status,
          collectedMessages: row.collectedMessages,
          error:
            row.error ??
            (
              await ctx.db
                .query("operatorGoogleWorkspaceScanSources")
                .withIndex("mailbox_errors", (q) =>
                  q.eq("mailboxId", row._id).eq("hasError", true),
                )
                .first()
            )?.error ??
            null,
          lastSuccessAt: row.lastSuccessAt ?? null,
        })),
      ),
    };
  },
});

async function claimSource(
  ctx: MutationCtx,
  sourceId: Id<"operatorGoogleWorkspaceScanSources">,
  collecting: boolean,
) {
  const { config } = await requireLiveScan(ctx);
  const source = await ctx.db.get(sourceId);
  const now = dayjs().valueOf();
  if (
    !source ||
    source.authorizationRevision !== config.authorizationRevision ||
    source.status !== (collecting ? "collecting" : "ready")
  )
    return null;
  if (source.leaseToken && (source.leaseUntil ?? 0) > now) return null;
  const mailbox = await ctx.db.get(source.mailboxId);
  if (mailbox?.runId !== config.currentRunId) return null;
  if (!source.active || (source.leaseUntil ?? 0) <= now) {
    if (source.nextAttemptAt > now) return null;
    const active = await ctx.db
      .query("operatorGoogleWorkspaceScanSources")
      .withIndex("active", (q) =>
        q
          .eq("authorizationRevision", config.authorizationRevision)
          .eq("active", true)
          .gt("leaseUntil", now),
      )
      .take(LIMITS.sourceBatchSize);
    if (active.length >= LIMITS.sourceBatchSize) return null;
  }
  const leaseToken = crypto.randomUUID();
  const patch = {
    originalContentFingerprint:
      source.originalContentFingerprint ??
      (source.evidence?.bodyComplete
        ? source.evidence.contentFingerprint
        : undefined),
    status: collecting ? ("collecting" as const) : ("running" as const),
    active: true,
    leaseToken,
    leaseUntil: now + LIMITS.leaseMs,
    nextAttemptAt: now + LIMITS.leaseMs,
  };
  await ctx.db.patch(source._id, patch);
  return {
    source: { ...source, ...patch },
    leaseToken,
    authorizationRevision: config.authorizationRevision,
    authorizingOperatorId: config.authorizingOperatorId,
  };
}
export const claimSourceInternal = internalMutation({
  args: { sourceId: v.id("operatorGoogleWorkspaceScanSources") },
  handler: (ctx, args) => claimSource(ctx, args.sourceId, false),
});
export const claimCollectionInternal = internalMutation({
  args: { sourceId: v.id("operatorGoogleWorkspaceScanSources") },
  handler: (ctx, args) => claimSource(ctx, args.sourceId, true),
});
export const getSourceContextInternal = internalQuery({
  args: {
    sourceId: v.id("operatorGoogleWorkspaceScanSources"),
    leaseToken: v.string(),
  },
  handler: (ctx, args) => assertGoogleWorkspaceScanSourceLease(ctx, args),
});
export const getSourcePartsInternal = internalQuery({
  args: {
    sourceId: v.id("operatorGoogleWorkspaceScanSources"),
    leaseToken: v.string(),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    await assertGoogleWorkspaceScanSourceLease(ctx, args);
    return ctx.db
      .query("operatorGoogleWorkspaceScanSourceParts")
      .withIndex("source_ordinal", (q) => q.eq("sourceId", args.sourceId))
      .paginate({ cursor: args.cursor, numItems: 8 });
  },
});
export const finishSourceInternal = internalMutation({
  args: {
    sourceId: v.id("operatorGoogleWorkspaceScanSources"),
    leaseToken: v.string(),
    status: v.union(
      v.literal("completed"),
      v.literal("failed"),
      v.literal("needs_attention"),
    ),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { source } = await assertGoogleWorkspaceScanSourceLease(ctx, args);
    const failed = args.status === "failed" || !source.evidence?.bodyComplete;
    await ctx.db.patch(source._id, {
      status: args.status,
      active: false,
      hasError: failed,
      error: args.error,
      leaseToken: undefined,
      leaseUntil: undefined,
      reconciledAt: dayjs().valueOf(),
    });
    const run = await ctx.db.get(source.runId);
    if (run)
      await ctx.db.patch(run._id, {
        pendingSources: Math.max(0, run.pendingSources - 1),
        reconciledSources: run.reconciledSources + (failed ? 0 : 1),
        failedSources: run.failedSources + (failed ? 1 : 0),
      });
    await ctx.scheduler.runAfter(0, dispatchRef, {});
    return null;
  },
});

export const dispatchInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const saved = await scanConfig(ctx);
    if (!saved?.enabled) return null;
    let config;
    try {
      config = (await requireLiveScan(ctx)).config;
    } catch {
      await ctx.db.patch(saved._id, {
        enabled: false,
        authorizationRevision: saved.authorizationRevision + 1,
        pausedReason:
          "Workspace access or the authorizing operator changed. Review settings and re-enable scanning.",
      });
      if (saved.currentRunId) {
        const oldRun = await ctx.db.get(saved.currentRunId);
        if (oldRun && !terminalPhases.has(oldRun.phase))
          await ctx.db.patch(oldRun._id, {
            phase: "paused",
            finishedAt: dayjs().valueOf(),
          });
      }
      return null;
    }
    const now = dayjs().valueOf();
    const run = config.currentRunId
      ? await ctx.db.get(config.currentRunId)
      : null;
    if (!run || terminalPhases.has(run.phase)) {
      if (config.nextRunAt <= now) await beginRun(ctx, config);
      return null;
    }
    if (!run.directoryComplete) {
      if (run.nextAttemptAt <= now && (run.leaseUntil ?? 0) <= now)
        await ctx.scheduler.runAfter(0, discoveryRef, { runId: run._id });
      return null;
    }
    let active = 0;
    for (const status of ["running", "pending", "failed"] as const) {
      const rows = await ctx.db
        .query("operatorGoogleWorkspaceScanMailboxes")
        .withIndex("run_status", (q) =>
          q.eq("runId", run._id).eq("status", status),
        )
        .take(LIMITS.activeMailboxes);
      for (const row of rows) {
        if (status === "running" && (row.leaseUntil ?? 0) > now) {
          active++;
          continue;
        }
        if (active >= LIMITS.activeMailboxes || row.nextAttemptAt > now)
          continue;
        await ctx.scheduler.runAfter(0, mailboxRef, { mailboxId: row._id });
        active++;
      }
    }
    const expired = await ctx.db
      .query("operatorGoogleWorkspaceScanSources")
      .withIndex("active", (q) =>
        q
          .eq("authorizationRevision", config.authorizationRevision)
          .eq("active", true)
          .lte("leaseUntil", now),
      )
      .take(LIMITS.sourceBatchSize);
    for (const source of expired)
      await ctx.db.patch(source._id, {
        active: false,
        leaseToken: undefined,
        leaseUntil: undefined,
        status: source.status === "running" ? "ready" : source.status,
        nextAttemptAt: now,
      });
    const activeSources = await ctx.db
      .query("operatorGoogleWorkspaceScanSources")
      .withIndex("active", (q) =>
        q
          .eq("authorizationRevision", config.authorizationRevision)
          .eq("active", true),
      )
      .take(LIMITS.sourceBatchSize);
    let capacity = LIMITS.sourceBatchSize - activeSources.length;
    for (const status of ["ready", "collecting"] as const) {
      if (capacity <= 0) break;
      const sources = await ctx.db
        .query("operatorGoogleWorkspaceScanSources")
        .withIndex("status_due", (q) =>
          q
            .eq("authorizationRevision", config.authorizationRevision)
            .eq("status", status)
            .lte("nextAttemptAt", now),
        )
        .take(capacity);
      for (const source of sources) {
        if (source.active && (source.leaseUntil ?? 0) > now) continue;
        await ctx.db.patch(source._id, {
          active: true,
          leaseToken: undefined,
          leaseUntil: now + LIMITS.leaseMs,
          nextAttemptAt: now + LIMITS.leaseMs,
        });
        await ctx.scheduler.runAfter(
          0,
          status === "collecting" ? sourceRef : reconcileRef,
          { sourceId: source._id },
        );
        capacity--;
      }
    }
    if (
      run.completedMailboxes + run.failedMailboxes ===
        run.discoveredMailboxes &&
      run.pendingSources === 0
    ) {
      await ctx.db.patch(run._id, {
        phase:
          run.failedSources || run.failedMailboxes ? "partial" : "completed",
        finishedAt: now,
      });
      await ctx.db.patch(config._id, {
        lastSuccessAt:
          run.failedSources || run.failedMailboxes ? config.lastSuccessAt : now,
        nextRunAt: now + config.intervalMinutes * 60_000,
      });
    } else if (run.completedMailboxes === run.discoveredMailboxes) {
      await ctx.db.patch(run._id, { phase: "reconciliation" });
    }
    return null;
  },
});

async function liveRun(
  ctx: QueryCtx | MutationCtx,
  runId: Id<"operatorGoogleWorkspaceScanRuns">,
  leaseToken?: string,
) {
  const live = await requireLiveScan(ctx);
  const run = await ctx.db.get(runId);
  if (
    !run ||
    live.config.currentRunId !== runId ||
    run.authorizationRevision !== live.config.authorizationRevision ||
    terminalPhases.has(run.phase)
  )
    throw new Error("Workspace scan run is no longer current.");
  if (
    leaseToken &&
    (run.leaseToken !== leaseToken ||
      (run.leaseUntil ?? 0) <= dayjs().valueOf())
  )
    throw new Error("Workspace discovery lease is no longer current.");
  return { ...live, run };
}
async function liveMailbox(
  ctx: QueryCtx | MutationCtx,
  mailboxId: Id<"operatorGoogleWorkspaceScanMailboxes">,
  leaseToken: string,
) {
  const mailbox = await ctx.db.get(mailboxId);
  if (!mailbox) throw new Error("Workspace mailbox is unavailable.");
  const live = await liveRun(ctx, mailbox.runId);
  if (
    mailbox.authorizationRevision !== live.config.authorizationRevision ||
    mailbox.leaseToken !== leaseToken ||
    (mailbox.leaseUntil ?? 0) <= dayjs().valueOf()
  )
    throw new Error("Workspace mailbox lease is no longer current.");
  return { ...live, mailbox };
}
export const assertMailboxLeaseInternal = internalQuery({
  args: {
    mailboxId: v.id("operatorGoogleWorkspaceScanMailboxes"),
    leaseToken: v.string(),
  },
  handler: async (ctx, args) => {
    await liveMailbox(ctx, args.mailboxId, args.leaseToken);
    return null;
  },
});
export const claimDiscoveryInternal = internalMutation({
  args: { runId: v.id("operatorGoogleWorkspaceScanRuns") },
  handler: async (ctx, args) => {
    const live = await liveRun(ctx, args.runId);
    const now = dayjs().valueOf();
    if (
      live.run.directoryComplete ||
      live.run.nextAttemptAt > now ||
      (live.run.leaseUntil ?? 0) > now
    )
      return null;
    const leaseToken = crypto.randomUUID();
    await ctx.db.patch(live.run._id, {
      leaseToken,
      leaseUntil: now + LIMITS.leaseMs,
      nextAttemptAt: now + LIMITS.leaseMs,
    });
    return { ...live, leaseToken };
  },
});
export const saveDirectoryPageInternal = internalMutation({
  args: {
    runId: v.id("operatorGoogleWorkspaceScanRuns"),
    leaseToken: v.string(),
    mailboxes: v.array(v.string()),
    nextPageToken: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const { run, config } = await liveRun(ctx, args.runId, args.leaseToken);
    if (args.mailboxes.length > LIMITS.directoryPageSize)
      throw new Error("Directory page exceeds the collection boundary.");
    let added = 0;
    for (const mailbox of new Set(args.mailboxes)) {
      const previous = await ctx.db
        .query("operatorGoogleWorkspaceScanMailboxes")
        .withIndex("mailbox", (q) => q.eq("mailbox", mailbox))
        .unique();
      if (previous?.runId === run._id) continue;
      const incremental =
        previous?.authorizationRevision === config.authorizationRevision &&
        previous.phase === "completed" &&
        previous.historyCheckpoint;
      const resume =
        previous?.authorizationRevision === config.authorizationRevision &&
        previous.phase !== "completed";
      const fields = {
        mailbox,
        runId: run._id,
        authorizationRevision: config.authorizationRevision,
        phase: incremental
          ? ("history" as const)
          : resume
            ? previous.phase
            : ("checkpoint" as const),
        status: "pending" as const,
        windowStartAt: previous?.windowStartAt ?? run.windowStartAt,
        historyCheckpoint:
          incremental || resume ? previous.historyCheckpoint : undefined,
        pageToken: resume ? previous.pageToken : undefined,
        collectedMessages: 0,
        attempts: 0,
        error: undefined,
        leaseToken: undefined,
        leaseUntil: undefined,
        nextAttemptAt: dayjs().valueOf(),
      };
      if (previous) await ctx.db.patch(previous._id, fields);
      else await ctx.db.insert("operatorGoogleWorkspaceScanMailboxes", fields);
      added++;
    }
    await ctx.db.patch(run._id, {
      discoveredMailboxes: run.discoveredMailboxes + added,
      directoryPageToken: args.nextPageToken ?? undefined,
      directoryComplete: !args.nextPageToken,
      phase: args.nextPageToken ? "discovery" : "collection",
      leaseToken: undefined,
      leaseUntil: undefined,
      nextAttemptAt: dayjs().valueOf(),
      attempts: 0,
      error: undefined,
    });
    await ctx.scheduler.runAfter(0, dispatchRef, {});
    return null;
  },
});
export const claimMailboxInternal = internalMutation({
  args: { mailboxId: v.id("operatorGoogleWorkspaceScanMailboxes") },
  handler: async (ctx, args) => {
    const mailbox = await ctx.db.get(args.mailboxId);
    if (!mailbox) return null;
    const live = await liveRun(ctx, mailbox.runId);
    const now = dayjs().valueOf();
    if (
      !live.run.directoryComplete ||
      mailbox.status === "completed" ||
      mailbox.nextAttemptAt > now ||
      (mailbox.leaseUntil ?? 0) > now
    )
      return null;
    const running = await ctx.db
      .query("operatorGoogleWorkspaceScanMailboxes")
      .withIndex("run_leases", (q) =>
        q
          .eq("runId", mailbox.runId)
          .eq("status", "running")
          .gt("leaseUntil", now),
      )
      .take(LIMITS.activeMailboxes);
    if (
      running.filter((row) => (row.leaseUntil ?? 0) > now).length >=
      LIMITS.activeMailboxes
    )
      return null;
    const leaseToken = crypto.randomUUID();
    await ctx.db.patch(mailbox._id, {
      status: "running",
      leaseToken,
      leaseUntil: now + LIMITS.leaseMs,
      nextAttemptAt: now + LIMITS.leaseMs,
    });
    if (mailbox.status === "failed")
      await ctx.db.patch(live.run._id, {
        failedMailboxes: Math.max(0, live.run.failedMailboxes - 1),
      });
    return { ...live, mailbox, leaseToken };
  },
});
export const enqueueMessagesInternal = internalMutation({
  args: {
    mailboxId: v.id("operatorGoogleWorkspaceScanMailboxes"),
    leaseToken: v.string(),
    messages: v.array(v.object({ id: v.string(), threadId: v.string() })),
  },
  handler: async (ctx, args) => {
    const { mailbox, run, config } = await liveMailbox(
      ctx,
      args.mailboxId,
      args.leaseToken,
    );
    if (args.messages.length > LIMITS.messagePageSize)
      throw new Error("Message page exceeds the collection boundary.");
    let added = 0;
    let retriedFailures = 0;
    for (const message of args.messages) {
      const existing = await ctx.db
        .query("operatorGoogleWorkspaceScanSources")
        .withIndex("message", (q) =>
          q.eq("mailbox", mailbox.mailbox).eq("messageId", message.id),
        )
        .unique();
      if (
        existing &&
        (["completed", "needs_attention"].includes(existing.status) ||
          (existing.runId === run._id &&
            !["failed", "excluded"].includes(existing.status)))
      )
        continue;
      const fields = {
        mailbox: mailbox.mailbox,
        mailboxId: mailbox._id,
        messageId: message.id,
        threadId: message.threadId,
        runId: run._id,
        authorizationRevision: config.authorizationRevision,
        status: "collecting" as const,
        active: false,
        hasError: false,
        leaseToken: undefined,
        leaseUntil: undefined,
        nextAttemptAt: dayjs().valueOf(),
        attempts: 0,
        error: undefined,
      };
      if (existing) {
        if (existing.runId === run._id && existing.status === "failed")
          retriedFailures++;
        await ctx.db.patch(existing._id, fields);
      } else await ctx.db.insert("operatorGoogleWorkspaceScanSources", fields);
      added++;
    }
    await ctx.db.patch(run._id, {
      pendingSources: run.pendingSources + added,
      collectedMessages: run.collectedMessages + added,
      failedSources: Math.max(0, run.failedSources - retriedFailures),
    });
    await ctx.db.patch(mailbox._id, {
      collectedMessages: mailbox.collectedMessages + added,
      leaseUntil: dayjs().valueOf() + LIMITS.leaseMs,
    });
    return null;
  },
});
export const saveMailboxProgressInternal = internalMutation({
  args: {
    mailboxId: v.id("operatorGoogleWorkspaceScanMailboxes"),
    leaseToken: v.string(),
    phase: v.union(
      v.literal("checkpoint"),
      v.literal("baseline"),
      v.literal("history"),
      v.literal("completed"),
    ),
    historyCheckpoint: v.optional(v.string()),
    pageToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { mailbox, run } = await liveMailbox(
      ctx,
      args.mailboxId,
      args.leaseToken,
    );
    const now = dayjs().valueOf();
    await ctx.db.patch(mailbox._id, {
      phase: args.phase,
      status: args.phase === "completed" ? "completed" : "pending",
      pageToken: args.pageToken,
      historyCheckpoint: args.historyCheckpoint ?? mailbox.historyCheckpoint,
      leaseToken: undefined,
      leaseUntil: undefined,
      nextAttemptAt: now,
      attempts: 0,
      error: undefined,
      lastSuccessAt: args.phase === "completed" ? now : mailbox.lastSuccessAt,
    });
    if (args.phase === "completed")
      await ctx.db.patch(run._id, {
        completedMailboxes: run.completedMailboxes + 1,
      });
    await ctx.scheduler.runAfter(0, dispatchRef, {});
    return null;
  },
});
export const failCollectionWorkInternal = internalMutation({
  args: {
    runId: v.optional(v.id("operatorGoogleWorkspaceScanRuns")),
    mailboxId: v.optional(v.id("operatorGoogleWorkspaceScanMailboxes")),
    sourceId: v.optional(v.id("operatorGoogleWorkspaceScanSources")),
    leaseToken: v.string(),
    error: v.string(),
    resetPage: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    if (args.sourceId) {
      const { source } = await assertGoogleWorkspaceScanSourceLease(ctx, {
        sourceId: args.sourceId,
        leaseToken: args.leaseToken,
      });
      const exhausted = source.attempts >= 2;
      await ctx.db.patch(source._id, {
        active: false,
        hasError: true,
        leaseToken: undefined,
        leaseUntil: undefined,
        attempts: source.attempts + 1,
        error: args.error,
        nextAttemptAt: exhausted ? now : now + scanBackoff(source.attempts),
        ...(exhausted
          ? {
              status: "ready" as const,
              evidence: {
                ...(source.evidence ?? {
                  mailbox: source.mailbox,
                  messageId: source.messageId,
                  threadId: source.threadId,
                  internetMessageId: null,
                  internalDate: null,
                  sentAt: null,
                  from: null,
                  to: [],
                  cc: [],
                  subject: null,
                  inReplyTo: null,
                  references: null,
                  contentFingerprint: `unavailable:${source.mailbox}:${source.messageId}`,
                  bodyFingerprint: "unavailable",
                  attachments: [],
                  bodyPartCount: 0,
                }),
                bodyComplete: false,
              },
            }
          : {}),
      });
      if (exhausted) await ctx.scheduler.runAfter(0, dispatchRef, {});
    } else if (args.mailboxId) {
      const { mailbox, run } = await liveMailbox(
        ctx,
        args.mailboxId,
        args.leaseToken,
      );
      await ctx.db.patch(mailbox._id, {
        status: "failed",
        leaseToken: undefined,
        leaseUntil: undefined,
        attempts: mailbox.attempts + 1,
        error: args.error,
        nextAttemptAt: now + scanBackoff(mailbox.attempts),
        ...(args.resetPage
          ? { phase: "checkpoint" as const, pageToken: undefined }
          : {}),
      });
      await ctx.db.patch(run._id, { failedMailboxes: run.failedMailboxes + 1 });
    } else if (args.runId) {
      const { run } = await liveRun(ctx, args.runId, args.leaseToken);
      await ctx.db.patch(run._id, {
        leaseToken: undefined,
        leaseUntil: undefined,
        attempts: run.attempts + 1,
        error: args.error,
        nextAttemptAt: now + scanBackoff(run.attempts),
        ...(args.resetPage ? { directoryPageToken: undefined } : {}),
      });
    }
    return null;
  },
});
export function scanBackoff(attempts: number) {
  return Math.min(LIMITS.maxBackoffMs, 30_000 * 2 ** Math.min(attempts, 12));
}

export const storeSourcePartsInternal = internalMutation({
  args: {
    sourceId: v.id("operatorGoogleWorkspaceScanSources"),
    leaseToken: v.string(),
    parts: v.array(v.object({ ordinal: v.number(), text: v.string() })),
  },
  handler: async (ctx, args) => {
    const { source } = await assertGoogleWorkspaceScanSourceLease(ctx, args);
    if (source.status !== "collecting" || args.parts.length > 8)
      throw new Error("Invalid collection body page.");
    let stagedPartCount = source.stagedPartCount ?? 0;
    for (const part of args.parts) {
      if (part.ordinal > stagedPartCount)
        throw new Error("Source body pages must be stored in order.");
      if (
        !Number.isInteger(part.ordinal) ||
        part.ordinal < 0 ||
        part.text.length > LIMITS.bodyPartChars
      )
        throw new Error("Invalid collection body part.");
      const existing = await ctx.db
        .query("operatorGoogleWorkspaceScanSourceParts")
        .withIndex("source_ordinal", (q) =>
          q.eq("sourceId", source._id).eq("ordinal", part.ordinal),
        )
        .unique();
      if (existing) await ctx.db.patch(existing._id, { text: part.text });
      else
        await ctx.db.insert("operatorGoogleWorkspaceScanSourceParts", {
          sourceId: source._id,
          ...part,
        });
      stagedPartCount = Math.max(stagedPartCount, part.ordinal + 1);
    }
    await ctx.db.patch(source._id, {
      stagedPartCount,
      leaseUntil: dayjs().valueOf() + LIMITS.leaseMs,
    });
    return null;
  },
});
export const finishCollectionInternal = internalMutation({
  args: {
    sourceId: v.id("operatorGoogleWorkspaceScanSources"),
    leaseToken: v.string(),
    evidence: v.optional(scanEvidenceValidator),
    excluded: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { source } = await assertGoogleWorkspaceScanSourceLease(ctx, args);
    if (source.status !== "collecting")
      throw new Error("Source collection is no longer current.");
    if (
      !args.excluded &&
      (!args.evidence ||
        args.evidence.messageId !== source.messageId ||
        args.evidence.mailbox !== source.mailbox ||
        args.evidence.threadId !== source.threadId)
    )
      throw new Error("Collected source identity does not match.");
    if (
      args.evidence &&
      args.evidence.bodyPartCount !== (source.stagedPartCount ?? 0)
    )
      throw new Error("Source body collection is incomplete.");
    await ctx.db.patch(source._id, {
      hasError: !!args.evidence && !args.evidence.bodyComplete,
      status: args.excluded ? "excluded" : "ready",
      evidence: args.excluded ? source.evidence : args.evidence,
      originalContentFingerprint:
        source.originalContentFingerprint ??
        (args.evidence?.bodyComplete
          ? args.evidence.contentFingerprint
          : undefined),
      collectedAt: dayjs().valueOf(),
      active: false,
      leaseToken: undefined,
      leaseUntil: undefined,
      nextAttemptAt: dayjs().valueOf(),
      error:
        args.evidence && !args.evidence.bodyComplete
          ? "Some source content could not be retrieved. Automatic changes require complete evidence."
          : undefined,
    });
    if (args.excluded) {
      if (!source.evidence)
        await ctx.scheduler.runAfter(
          0,
          makeFunctionReference<
            "mutation",
            { sourceId: Id<"operatorGoogleWorkspaceScanSources"> },
            null
          >("operatorGoogleWorkspaceScan:pruneSourcePartsInternal"),
          { sourceId: source._id },
        );
      const run = await ctx.db.get(source.runId);
      if (run)
        await ctx.db.patch(run._id, {
          pendingSources: Math.max(0, run.pendingSources - 1),
        });
    }
    await ctx.scheduler.runAfter(0, dispatchRef, {});
    return null;
  },
});
export const pruneSourcePartsInternal = internalMutation({
  args: { sourceId: v.id("operatorGoogleWorkspaceScanSources") },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (source?.status !== "completed" && source?.status !== "excluded")
      return null;
    const parts = await ctx.db
      .query("operatorGoogleWorkspaceScanSourceParts")
      .withIndex("source_ordinal", (q) => q.eq("sourceId", args.sourceId))
      .take(8);
    for (const part of parts) await ctx.db.delete(part._id);
    if (parts.length < 8)
      await ctx.db.patch(source._id, { stagedPartCount: 0 });
    if (parts.length === 8)
      await ctx.scheduler.runAfter(
        0,
        makeFunctionReference<
          "mutation",
          { sourceId: Id<"operatorGoogleWorkspaceScanSources"> },
          null
        >("operatorGoogleWorkspaceScan:pruneSourcePartsInternal"),
        args,
      );
    return null;
  },
});
