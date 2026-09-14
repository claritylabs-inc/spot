import dayjs from "dayjs";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { googleWorkspaceCredentialEnvelope } from "./googleWorkspaceCredentials";
import { requireOperatorForUser } from "./operatorIdentity";

export async function scanConfig(ctx: QueryCtx | MutationCtx) {
  return ctx.db.query("operatorGoogleWorkspaceScanConfig").withIndex("key", q => q.eq("key", "default")).unique();
}
export async function requireLiveScan(ctx: QueryCtx | MutationCtx) {
  const config = await scanConfig(ctx);
  if (!config?.enabled) throw new Error("Workspace scanning is paused.");
  const connector = await ctx.db.query("operatorGoogleWorkspaceConfig").withIndex("key", q => q.eq("key", "default")).unique();
  if (!connector?.enabled || connector.mailboxMode !== "directory" || !connector.directoryAdminEmail || connector.updatedAt !== config.connectorRevision) {
    throw new Error("Workspace access changed. Review and re-enable scanning.");
  }
  const credential = await googleWorkspaceCredentialEnvelope();
  if (!credential.credentials || credential.revision !== config.credentialRevision) throw new Error("Workspace credentials changed. Review and re-enable scanning.");
  await requireOperatorForUser(ctx, config.authorizingOperatorId);
  return { config, connector, operatorUserId: config.authorizingOperatorId };
}
export async function assertGoogleWorkspaceScanSourceLease(ctx: QueryCtx | MutationCtx, args: {sourceId: Id<"operatorGoogleWorkspaceScanSources">; leaseToken: string}) {
  const live = await requireLiveScan(ctx);
  const source = await ctx.db.get(args.sourceId);
  if (!source || source.authorizationRevision !== live.config.authorizationRevision || source.leaseToken !== args.leaseToken || (source.leaseUntil ?? 0) <= dayjs().valueOf() || !["running", "collecting"].includes(source.status)) throw new Error("Workspace source lease is no longer current.");
  const mailbox = await ctx.db.get(source.mailboxId);
  if (!mailbox || mailbox.authorizationRevision !== live.config.authorizationRevision || mailbox.runId !== live.config.currentRunId) throw new Error("Workspace mailbox authorization is no longer current.");
  return { ...live, source };
}
