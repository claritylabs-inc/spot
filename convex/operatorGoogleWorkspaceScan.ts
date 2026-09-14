import dayjs from "dayjs";
import { paginationOptsValidator, makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { googleWorkspaceCredentialEnvelope } from "./lib/googleWorkspaceCredentials";
import { GOOGLE_WORKSPACE_SCAN_LIMITS as LIMITS, type GoogleWorkspaceScanStatus } from "./lib/googleWorkspaceScan";
import { scanIntervalValidator } from "./lib/googleWorkspaceScanSchema";
import { assertGoogleWorkspaceScanSourceLease, requireLiveScan, scanConfig } from "./lib/googleWorkspaceScanState";
import { getActiveOperatorImpersonation, requireOperator, requireOperatorForUser, writeOperatorAudit } from "./lib/operatorIdentity";

export { assertGoogleWorkspaceScanSourceLease } from "./lib/googleWorkspaceScanState";
const dispatchRef = makeFunctionReference<"mutation", Record<string, never>, null>("operatorGoogleWorkspaceScan:dispatchInternal");
const discoveryRef = makeFunctionReference<"action", {runId: Id<"operatorGoogleWorkspaceScanRuns">}, null>("actions/operatorGoogleWorkspaceScan:discover");
const mailboxRef = makeFunctionReference<"action", {mailboxId: Id<"operatorGoogleWorkspaceScanMailboxes">}, null>("actions/operatorGoogleWorkspaceScan:collectMailbox");
const sourceRef = makeFunctionReference<"action", {sourceId: Id<"operatorGoogleWorkspaceScanSources">}, null>("actions/operatorGoogleWorkspaceScan:collectSource");
const reconcileRef = makeFunctionReference<"action", {sourceId: Id<"operatorGoogleWorkspaceScanSources">}, null>("actions/operatorGoogleWorkspaceReconciliation:reconcileSource");
const terminalPhases = new Set(["completed", "partial", "paused"]);

async function requireWriter(ctx: MutationCtx) {
  const operator = await requireOperator(ctx);
  if (await getActiveOperatorImpersonation(ctx)) throw new Error("Operator impersonation is read-only.");
  return operator;
}
async function beginRun(ctx: MutationCtx, config: Doc<"operatorGoogleWorkspaceScanConfig">) {
  const existing = config.currentRunId ? await ctx.db.get(config.currentRunId) : null;
  if (existing && !terminalPhases.has(existing.phase)) return {runId: existing._id, alreadyRunning: true};
  const now = dayjs().valueOf();
  const runId = await ctx.db.insert("operatorGoogleWorkspaceScanRuns", {
    authorizationRevision: config.authorizationRevision, phase: "discovery", startedAt: now,
    windowStartAt: config.windowStartAt, directoryComplete: false, discoveredMailboxes: 0,
    completedMailboxes: 0, failedMailboxes: 0, collectedMessages: 0, pendingSources: 0, reconciledSources: 0,
    nextAttemptAt: now, attempts: 0,
  });
  await ctx.db.patch(config._id, { currentRunId: runId, nextRunAt: now + config.intervalMinutes * 60_000 });
  await ctx.scheduler.runAfter(0, dispatchRef, {});
  return {runId, alreadyRunning: false};
}

export const getStatus = query({args: {}, handler: async (ctx): Promise<GoogleWorkspaceScanStatus> => {
  await requireOperator(ctx);
  const config = await scanConfig(ctx);
  const run = config?.currentRunId ? await ctx.db.get(config.currentRunId) : null;
  return {
    config: {enabled: config?.enabled ?? false, intervalMinutes: config?.intervalMinutes ?? 60,
      authorizationRevision: config?.authorizationRevision ?? 0, authorizingOperatorId: config?.authorizingOperatorId ?? null,
      pausedReason: config?.pausedReason ?? null},
    nextRunAt: config?.enabled ? config.nextRunAt : null, lastSuccessAt: config?.lastSuccessAt ?? null,
    latestRun: run ? {id: run._id, phase: run.phase, startedAt: run.startedAt, finishedAt: run.finishedAt ?? null,
      error: run.error ?? null, coverage: {windowStartAt: run.windowStartAt, discoveredMailboxes: run.discoveredMailboxes,
        completedMailboxes: run.completedMailboxes, failedMailboxes: run.failedMailboxes, collectedMessages: run.collectedMessages,
        pendingSources: run.pendingSources, reconciledSources: run.reconciledSources, directoryComplete: run.directoryComplete}} : null,
  };
}});
export const updateSettings = mutation({args: {enabled: v.boolean(), intervalMinutes: scanIntervalValidator, authorizingOperatorId: v.optional(v.id("users"))}, handler: async (ctx, args) => {
  const operator = await requireWriter(ctx);
  const existing = await scanConfig(ctx);
  const sponsor = args.authorizingOperatorId ?? existing?.authorizingOperatorId ?? operator.userId;
  if (args.enabled) await requireOperatorForUser(ctx, sponsor);
  const connector = await ctx.db.query("operatorGoogleWorkspaceConfig").withIndex("key", q => q.eq("key", "default")).unique();
  const credential = await googleWorkspaceCredentialEnvelope();
  if (args.enabled && (!connector?.enabled || connector.mailboxMode !== "directory" || !connector.directoryAdminEmail || !credential.credentials)) throw new Error("Enable Directory access with valid Workspace credentials before enabling scanning.");
  const now = dayjs().valueOf();
  const changed = !existing || existing.enabled !== args.enabled || existing.authorizingOperatorId !== sponsor || existing.connectorRevision !== connector?.updatedAt || existing.credentialRevision !== credential.revision;
  const value = {enabled: args.enabled, intervalMinutes: args.intervalMinutes, authorizingOperatorId: sponsor,
    authorizationRevision: (existing?.authorizationRevision ?? 0) + (changed ? 1 : 0),
    connectorRevision: connector?.updatedAt ?? 0, credentialRevision: credential.revision ?? "", pausedReason: undefined,
    windowStartAt: existing?.windowStartAt ?? dayjs(now).subtract(LIMITS.initialLookbackDays, "day").valueOf(),
    nextRunAt: changed ? now : now + args.intervalMinutes * 60_000, updatedAt: now};
  const id = existing?._id ?? await ctx.db.insert("operatorGoogleWorkspaceScanConfig", {key: "default", ...value});
  if (existing) await ctx.db.patch(id, value);
  if (changed && existing?.currentRunId) {
    const run = await ctx.db.get(existing.currentRunId);
    if (run && !terminalPhases.has(run.phase)) await ctx.db.patch(run._id, {phase: "paused", finishedAt: now});
  }
  await writeOperatorAudit(ctx, {operatorUserId: operator.userId, type: "setup_write", summary: args.enabled ? "Authorized scheduled Workspace reconciliation" : "Paused scheduled Workspace reconciliation", metadata: {enabled: args.enabled, intervalMinutes: args.intervalMinutes, authorizingOperatorId: sponsor, authorizationRevision: value.authorizationRevision}});
  if (args.enabled && changed) await beginRun(ctx, (await ctx.db.get(id))!);
  return null;
}});
export const startScan = mutation({args: {}, handler: async (ctx) => {
  await requireWriter(ctx);
  const {config} = await requireLiveScan(ctx);
  return beginRun(ctx, config);
}});
export const listMailboxes = query({args: {paginationOpts: paginationOptsValidator}, handler: async (ctx, args) => {
  await requireOperator(ctx);
  const config = await scanConfig(ctx);
  if (!config?.currentRunId) return {page: [], isDone: true, continueCursor: ""};
  const result = await ctx.db.query("operatorGoogleWorkspaceScanMailboxes").withIndex("run_status", q => q.eq("runId", config.currentRunId!)).paginate({...args.paginationOpts, numItems: Math.min(100, args.paginationOpts.numItems)});
  return {...result, page: result.page.map(row => ({id: row._id, mailbox: row.mailbox, phase: row.phase, status: row.status, collectedMessages: row.collectedMessages, error: row.error ?? null, lastSuccessAt: row.lastSuccessAt ?? null}))};
}});

export const claimSourceInternal = internalMutation({args: {sourceId: v.id("operatorGoogleWorkspaceScanSources")}, handler: async (ctx, args) => {
  const {config} = await requireLiveScan(ctx);
  const source = await ctx.db.get(args.sourceId);
  const now = dayjs().valueOf();
  if (!source || source.authorizationRevision !== config.authorizationRevision || source.status !== "ready" || source.nextAttemptAt > now || (source.leaseUntil ?? 0) > now || !source.evidence?.bodyComplete) return null;
  const mailbox = await ctx.db.get(source.mailboxId);
  if (mailbox?.runId !== config.currentRunId) return null;
  const leaseToken = crypto.randomUUID();
  await ctx.db.patch(source._id, {status: "running", leaseToken, leaseUntil: now + LIMITS.leaseMs, nextAttemptAt: now + LIMITS.leaseMs});
  return {source: {...source, status: "running" as const}, leaseToken, authorizationRevision: config.authorizationRevision, authorizingOperatorId: config.authorizingOperatorId};
}});
export const getSourcePartsInternal = internalQuery({args: {sourceId: v.id("operatorGoogleWorkspaceScanSources"), leaseToken: v.string(), cursor: v.union(v.string(), v.null())}, handler: async (ctx, args) => {
  await assertGoogleWorkspaceScanSourceLease(ctx, args);
  return ctx.db.query("operatorGoogleWorkspaceScanSourceParts").withIndex("source_ordinal", q => q.eq("sourceId", args.sourceId)).paginate({cursor: args.cursor, numItems: 8});
}});
export const finishSourceInternal = internalMutation({args: {sourceId: v.id("operatorGoogleWorkspaceScanSources"), leaseToken: v.string(), status: v.union(v.literal("completed"), v.literal("failed"), v.literal("needs_attention")), error: v.optional(v.string())}, handler: async (ctx, args) => {
  const {source} = await assertGoogleWorkspaceScanSourceLease(ctx, args);
  await ctx.db.patch(source._id, {status: args.status, error: args.error, leaseToken: undefined, leaseUntil: undefined, reconciledAt: dayjs().valueOf()});
  const run = await ctx.db.get(source.runId);
  if (run) await ctx.db.patch(run._id, {pendingSources: Math.max(0, run.pendingSources - 1), reconciledSources: run.reconciledSources + 1});
  await ctx.scheduler.runAfter(0, dispatchRef, {});
  return null;
}});

export const dispatchInternal = internalMutation({args: {}, handler: async (ctx) => {
  const saved = await scanConfig(ctx);
  if (!saved?.enabled) return null;
  let config;
  try { config = (await requireLiveScan(ctx)).config; }
  catch {
    await ctx.db.patch(saved._id, {enabled: false, authorizationRevision: saved.authorizationRevision + 1, pausedReason: "Workspace access or the authorizing operator changed. Review settings and re-enable scanning."});
    if (saved.currentRunId) {
      const oldRun = await ctx.db.get(saved.currentRunId);
      if (oldRun && !terminalPhases.has(oldRun.phase)) await ctx.db.patch(oldRun._id, {phase: "paused", finishedAt: dayjs().valueOf()});
    }
    return null;
  }
  const now = dayjs().valueOf();
  const run = config.currentRunId ? await ctx.db.get(config.currentRunId) : null;
  if (!run || terminalPhases.has(run.phase)) {
    if (config.nextRunAt <= now) await beginRun(ctx, config);
    return null;
  }
  if (!run.directoryComplete) {
    if (run.nextAttemptAt <= now && (run.leaseUntil ?? 0) <= now) await ctx.scheduler.runAfter(0, discoveryRef, {runId: run._id});
    return null;
  }
  let active = 0;
  for (const status of ["running", "pending", "failed"] as const) {
    const rows = await ctx.db.query("operatorGoogleWorkspaceScanMailboxes").withIndex("run_status", q => q.eq("runId", run._id).eq("status", status)).take(LIMITS.activeMailboxes);
    for (const row of rows) {
      if (status === "running" && (row.leaseUntil ?? 0) > now) {active++; continue;}
      if (active >= LIMITS.activeMailboxes || row.nextAttemptAt > now) continue;
      await ctx.scheduler.runAfter(0, mailboxRef, {mailboxId: row._id}); active++;
    }
  }
  for (const status of ["collecting", "ready", "running"] as const) {
    const sources = await ctx.db.query("operatorGoogleWorkspaceScanSources").withIndex("status_due", q => q.eq("status", status).lte("nextAttemptAt", now)).take(LIMITS.sourceBatchSize);
    for (const source of sources) {
      if (source.authorizationRevision !== config.authorizationRevision) continue;
      if (status === "running") await ctx.db.patch(source._id, {status: "ready", leaseToken: undefined, leaseUntil: undefined});
      await ctx.scheduler.runAfter(0, status === "collecting" ? sourceRef : reconcileRef, {sourceId: source._id});
    }
  }
  if (run.completedMailboxes === run.discoveredMailboxes && run.pendingSources === 0) {
    await ctx.db.patch(run._id, {phase: "completed", finishedAt: now});
    await ctx.db.patch(config._id, {lastSuccessAt: now, nextRunAt: now + config.intervalMinutes * 60_000});
  } else if (run.completedMailboxes === run.discoveredMailboxes) {
    await ctx.db.patch(run._id, {phase: "reconciliation"});
  }
  return null;
}});
