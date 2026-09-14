import dayjs from "dayjs";
import { makeFunctionReference } from "convex/server";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { googleWorkspaceCredentialEnvelope } from "./googleWorkspaceCredentials";
import { requireOperatorForUser } from "./operatorIdentity";

export async function scanConfig(ctx: QueryCtx | MutationCtx) {
  return ctx.db
    .query("operatorGoogleWorkspaceScanConfig")
    .withIndex("key", (q) => q.eq("key", "default"))
    .unique();
}
export async function requireLiveScan(ctx: QueryCtx | MutationCtx) {
  const config = await scanConfig(ctx);
  if (!config?.enabled) throw new Error("Workspace scanning is paused.");
  const connector = await ctx.db
    .query("operatorGoogleWorkspaceConfig")
    .withIndex("key", (q) => q.eq("key", "default"))
    .unique();
  if (
    !connector?.enabled ||
    connector.mailboxMode !== "directory" ||
    !connector.directoryAdminEmail ||
    connector.updatedAt !== config.connectorRevision
  ) {
    throw new Error("Workspace access changed. Review and re-enable scanning.");
  }
  const credential = await googleWorkspaceCredentialEnvelope();
  if (
    !credential.credentials ||
    credential.revision !== config.credentialRevision
  )
    throw new Error(
      "Workspace credentials changed. Review and re-enable scanning.",
    );
  await requireOperatorForUser(ctx, config.authorizingOperatorId);
  return { config, connector, operatorUserId: config.authorizingOperatorId };
}
export async function assertGoogleWorkspaceScanSourceLease(
  ctx: QueryCtx | MutationCtx,
  args: {
    sourceId: Id<"operatorGoogleWorkspaceScanSources">;
    leaseToken: string;
  },
) {
  const live = await requireLiveScan(ctx);
  const source = await ctx.db.get(args.sourceId);
  if (
    !source ||
    source.authorizationRevision !== live.config.authorizationRevision ||
    source.leaseToken !== args.leaseToken ||
    (source.leaseUntil ?? 0) <= dayjs().valueOf() ||
    !["running", "collecting"].includes(source.status)
  )
    throw new Error("Workspace source lease is no longer current.");
  const mailbox = await ctx.db.get(source.mailboxId);
  if (
    !mailbox ||
    mailbox.authorizationRevision !== live.config.authorizationRevision ||
    mailbox.runId !== live.config.currentRunId ||
    source.runId !== mailbox.runId
  )
    throw new Error("Workspace mailbox authorization is no longer current.");
  return { ...live, source };
}

/** Called only from operator activity mutations; rebinds preserved work to the verified current roster. */
export async function retryGoogleWorkspaceScanSource(
  ctx: MutationCtx,
  args: { sourceId: Id<"operatorGoogleWorkspaceScanSources"> },
) {
  const { config } = await requireLiveScan(ctx);
  const source = await ctx.db.get(args.sourceId);
  const mailbox = source ? await ctx.db.get(source.mailboxId) : null;
  const run = config.currentRunId
    ? await ctx.db.get(config.currentRunId)
    : null;
  if (
    !source ||
    !mailbox ||
    !run?.directoryComplete ||
    mailbox.runId !== run._id ||
    mailbox.authorizationRevision !== config.authorizationRevision
  )
    throw new Error(
      "Wait for Directory refresh to verify this source mailbox before retrying.",
    );
  if (source.leaseToken && (source.leaseUntil ?? 0) > dayjs().valueOf())
    throw new Error("This source is already being processed.");
  const terminal = [
    "completed",
    "failed",
    "needs_attention",
    "excluded",
  ].includes(source.status);
  const sameRun = source.runId === run._id;
  await ctx.db.patch(source._id, {
    runId: run._id,
    authorizationRevision: config.authorizationRevision,
    status: "collecting",
    active: false,
    hasError: false,
    stagedPartCount: 0,
    leaseToken: undefined,
    leaseUntil: undefined,
    nextAttemptAt: dayjs().valueOf(),
    attempts: 0,
    error: undefined,
  });
  await ctx.db.patch(run._id, {
    phase:
      run.completedMailboxes === run.discoveredMailboxes
        ? "reconciliation"
        : "collection",
    finishedAt: undefined,
    pendingSources: run.pendingSources + (terminal || !sameRun ? 1 : 0),
    failedSources: Math.max(
      0,
      run.failedSources -
        (sameRun &&
        terminal &&
        (source.status === "failed" || !source.evidence?.bodyComplete)
          ? 1
          : 0),
    ),
    reconciledSources: Math.max(
      0,
      run.reconciledSources -
        (sameRun &&
        terminal &&
        ["completed", "needs_attention"].includes(source.status) &&
        source.evidence?.bodyComplete
          ? 1
          : 0),
    ),
  });
  await ctx.scheduler.runAfter(
    0,
    makeFunctionReference<"mutation", Record<string, never>, null>(
      "operatorGoogleWorkspaceScan:dispatchInternal",
    ),
    {},
  );
}
