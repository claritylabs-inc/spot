import dayjs from "dayjs";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { parseStandaloneEmailAddress } from "./lib/emailAddress";
import {
  GOOGLE_WORKSPACE_DIRECTORY_USER_READONLY_SCOPE,
  GOOGLE_WORKSPACE_GMAIL_READONLY_SCOPE,
  GOOGLE_WORKSPACE_LIMITS,
  type OperatorGoogleWorkspaceConfig,
  type OperatorGoogleWorkspaceScope,
  type OperatorGoogleWorkspaceStatus,
  type OperatorGoogleWorkspaceUpdateResult,
} from "./lib/googleWorkspace";
import { googleWorkspaceCredentialEnvelope } from "./lib/googleWorkspaceCredentials";
import {
  operatorGoogleWorkspaceMailboxModeValidator,
  operatorGoogleWorkspaceVerificationResultValidator,
} from "./lib/googleWorkspaceValidators";
import {
  requireOperator,
  requireOperatorForUser,
  getActiveOperatorImpersonation,
  writeOperatorAudit,
} from "./lib/operatorIdentity";
import { throwUserFacingError, userFacingErrorCodes } from "./lib/userFacingErrors";

const operatorChannelValidator = v.union(
  v.literal("chat"),
  v.literal("slack"),
  v.literal("imessage"),
  v.literal("mcp"),
);

function publicConfig(
  config: Doc<"operatorGoogleWorkspaceConfig"> | null,
): OperatorGoogleWorkspaceConfig | null {
  if (!config) return null;
  return {
    enabled: config.enabled,
    mailboxMode: config.mailboxMode,
    mailboxes: config.mailboxes,
    directoryAdminEmail: config.directoryAdminEmail ?? null,
    updatedAt: config.updatedAt,
  };
}

function requiredScopes(
  mode: "manual" | "directory",
): OperatorGoogleWorkspaceScope[] {
  return mode === "directory"
    ? [
        GOOGLE_WORKSPACE_GMAIL_READONLY_SCOPE,
        GOOGLE_WORKSPACE_DIRECTORY_USER_READONLY_SCOPE,
      ]
    : [GOOGLE_WORKSPACE_GMAIL_READONLY_SCOPE];
}

function normalizedMailboxes(values: string[]) {
  if (values.length > GOOGLE_WORKSPACE_LIMITS.maxConfiguredMailboxes) {
    throw new Error(
      `Configure at most ${GOOGLE_WORKSPACE_LIMITS.maxConfiguredMailboxes} company mailboxes.`,
    );
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const mailbox = parseStandaloneEmailAddress(value);
    if (!mailbox) throw new Error(`Invalid company mailbox: ${value}`);
    if (!seen.has(mailbox)) {
      seen.add(mailbox);
      result.push(mailbox);
    }
  }
  return result;
}

function normalizedOptionalEmail(value: string | undefined) {
  if (!value?.trim()) return undefined;
  const email = parseStandaloneEmailAddress(value);
  if (!email) throw new Error("The Workspace directory admin email is invalid.");
  return email;
}

async function configRow(ctx: Parameters<typeof requireOperator>[0]) {
  return await ctx.db
    .query("operatorGoogleWorkspaceConfig")
    .withIndex("key", (index) => index.eq("key", "default"))
    .unique();
}

export const getStatus = query({
  args: {},
  handler: async (ctx): Promise<OperatorGoogleWorkspaceStatus> => {
    await requireOperator(ctx);
    const [config, credential] = await Promise.all([
      configRow(ctx),
      googleWorkspaceCredentialEnvelope(),
    ]);
    const savedVerification =
      config?.lastVerification &&
      credential.revision &&
      config.lastVerification.credentialRevision === credential.revision &&
      config.lastVerification.result.configUpdatedAt === config.updatedAt
        ? config.lastVerification.result
        : null;
    return {
      config: publicConfig(config),
      credentials: credential.status,
      requiredScopes: requiredScopes(config?.mailboxMode ?? "manual"),
      savedVerification,
    };
  },
});

export const updateSettings = mutation({
  args: {
    enabled: v.boolean(),
    mailboxMode: operatorGoogleWorkspaceMailboxModeValidator,
    mailboxes: v.array(v.string()),
    directoryAdminEmail: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<OperatorGoogleWorkspaceUpdateResult> => {
    const operator = await requireOperator(ctx);
    if (await getActiveOperatorImpersonation(ctx)) {
      throwUserFacingError(userFacingErrorCodes.impersonationReadOnly);
    }
    const mailboxes = normalizedMailboxes(args.mailboxes);
    const directoryAdminEmail = normalizedOptionalEmail(
      args.directoryAdminEmail,
    );
    if (args.enabled && args.mailboxMode === "manual" && !mailboxes.length) {
      throw new Error("Add at least one company mailbox before enabling access.");
    }
    if (
      args.enabled &&
      args.mailboxMode === "directory" &&
      !directoryAdminEmail
    ) {
      throw new Error(
        "Choose a Workspace directory admin before enabling directory mode.",
      );
    }

    const existing = await configRow(ctx);
    const now = Math.max(dayjs().valueOf(), (existing?.updatedAt ?? 0) + 1);
    const value = {
      enabled: args.enabled,
      mailboxMode: args.mailboxMode,
      mailboxes,
      directoryAdminEmail,
      lastVerification: undefined,
      updatedBy: operator.userId,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, value);
    } else {
      await ctx.db.insert("operatorGoogleWorkspaceConfig", {
        key: "default",
        ...value,
      });
    }
    await writeOperatorAudit(ctx, {
      operatorUserId: operator.userId,
      type: "setup_write",
      summary: "Updated operator Google Workspace settings",
      metadata: {
        enabled: args.enabled,
        mailboxMode: args.mailboxMode,
        mailboxCount: mailboxes.length,
        directoryAdminEmail: directoryAdminEmail ?? null,
      },
    });
    return {
      enabled: args.enabled,
      mailboxMode: args.mailboxMode,
      mailboxes,
      directoryAdminEmail: directoryAdminEmail ?? null,
      updatedAt: now,
    };
  },
});

export const getActionContextInternal = internalQuery({
  args: {
    operatorUserId: v.id("users"),
    threadId: v.optional(v.id("operatorAgentThreads")),
    channel: v.optional(operatorChannelValidator),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    if (args.threadId) {
      const thread = await ctx.db.get(args.threadId);
      if (
        !thread ||
        (thread.ownerUserId !== args.operatorUserId &&
          thread.visibility !== "shared")
      ) {
        throw new Error("Operator agent thread not found");
      }
    }
    const config = await configRow(ctx);
    return { config: publicConfig(config) };
  },
});

export const saveVerificationInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    credentialRevision: v.string(),
    result: operatorGoogleWorkspaceVerificationResultValidator,
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    const config = await configRow(ctx);
    if (!config || config.updatedAt !== args.result.configUpdatedAt) {
      return false;
    }
    await ctx.db.patch(config._id, {
      lastVerification: {
        result: args.result,
        credentialRevision: args.credentialRevision,
      },
    });
    return true;
  },
});
