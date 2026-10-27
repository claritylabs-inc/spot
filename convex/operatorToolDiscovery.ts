import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { googleWorkspaceCredentialEnvelope } from "./lib/googleWorkspaceCredentials";
import { requireOperatorForUser } from "./lib/operatorIdentity";
import { availableOperatorAgentToolNames } from "./lib/operatorAgentToolRegistry";

/** Match the runner's live integration checks without creating a conversation/run. */
export const availableToolNames = internalQuery({
  args: { operatorUserId: v.id("users") },
  handler: async (ctx, args) => {
    const operator = await requireOperatorForUser(ctx, args.operatorUserId);
    const [impersonation, workspace, credential, servers] = await Promise.all([
      ctx.db
        .query("operatorImpersonationSessions")
        .withIndex("operator_status", (q) =>
          q.eq("operatorUserId", args.operatorUserId).eq("status", "active"),
        )
        .first(),
      ctx.db
        .query("operatorGoogleWorkspaceConfig")
        .withIndex("key", (q) => q.eq("key", "default"))
        .unique(),
      googleWorkspaceCredentialEnvelope(),
      ctx.db.query("operatorMcpServers").take(16),
    ]);
    return availableOperatorAgentToolNames({
      role: operator.profile.role,
      impersonating: Boolean(impersonation),
      integrations: {
        google_workspace: Boolean(
          workspace?.enabled &&
          credential.credentials &&
          (workspace.mailboxMode === "directory"
            ? workspace.directoryAdminEmail
            : workspace.mailboxes.length),
        ),
        slack: Boolean(process.env.SLACK_CLARITY_TEAM_ID?.trim()),
        mapbox: Boolean(
          process.env.MAPBOX_ACCESS_TOKEN?.trim() ||
          process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim(),
        ),
        mcp: servers.some(
          (server) =>
            server.enabled &&
            (server.authType !== "oauth" || Boolean(server.encryptedOAuth)),
        ),
      },
    });
  },
});
