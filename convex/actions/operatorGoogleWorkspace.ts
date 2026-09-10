"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action, internalAction, type ActionCtx } from "../_generated/server";
import {
  GOOGLE_WORKSPACE_DIRECTORY_USER_READONLY_SCOPE,
  GOOGLE_WORKSPACE_GMAIL_READONLY_SCOPE,
  type OperatorGoogleWorkspaceToolChannel,
  type OperatorGoogleWorkspaceToolName,
  type OperatorGoogleWorkspaceVerificationResult,
} from "../lib/googleWorkspace";
import { googleWorkspaceCredentialEnvelope } from "../lib/googleWorkspaceCredentials";
import { createGoogleWorkspaceProvider } from "../lib/googleWorkspaceProvider";
import { readStoredAgentFile } from "../lib/storedAgentFile";
import { runGoogleWorkspaceTool } from "../lib/googleWorkspaceTools";
import {
  failedGoogleWorkspaceVerification,
  verifyGoogleWorkspaceConnection,
} from "../lib/googleWorkspaceVerification";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "../lib/userFacingErrors";

const operatorChannelValidator = v.union(
  v.literal("chat"),
  v.literal("slack"),
  v.literal("imessage"),
  v.literal("mcp"),
);

const toolNames = new Set<OperatorGoogleWorkspaceToolName>([
  "list_company_mailboxes",
  "search_company_email",
  "read_company_email_thread",
  "get_company_email_attachment",
]);

function toolName(value: string): OperatorGoogleWorkspaceToolName {
  if (!toolNames.has(value as OperatorGoogleWorkspaceToolName)) {
    throw new Error(`Unsupported Google Workspace tool: ${value}`);
  }
  return value as OperatorGoogleWorkspaceToolName;
}

function providerFor(
  credentials: NonNullable<
    Awaited<ReturnType<typeof googleWorkspaceCredentialEnvelope>>["credentials"]
  >,
) {
  return createGoogleWorkspaceProvider(credentials, {
    gmail: [GOOGLE_WORKSPACE_GMAIL_READONLY_SCOPE],
    directory: [GOOGLE_WORKSPACE_DIRECTORY_USER_READONLY_SCOPE],
  });
}

async function saveVerification(
  ctx: ActionCtx,
  operatorUserId: Id<"users">,
  credentialRevision: string | null,
  result: OperatorGoogleWorkspaceVerificationResult,
) {
  if (!credentialRevision || !result.configUpdatedAt) return;
  await ctx.runMutation(
    internal.operatorGoogleWorkspace.saveVerificationInternal,
    {
      operatorUserId,
      credentialRevision,
      result,
    },
  );
}

export const verifyConnection = action({
  args: {},
  handler: async (ctx): Promise<OperatorGoogleWorkspaceVerificationResult> => {
    const operatorUserId = await getAuthUserId(ctx);
    if (!operatorUserId) throwUserFacingError(userFacingErrorCodes.authRequired);
    const context = await ctx.runQuery(
      internal.operatorGoogleWorkspace.getActionContextInternal,
      { operatorUserId },
    );
    const credential = await googleWorkspaceCredentialEnvelope();
    if (!context.config) {
      return failedGoogleWorkspaceVerification(
        null,
        "Google Workspace settings are not configured.",
      );
    }
    if (!context.config.enabled) {
      const result = failedGoogleWorkspaceVerification(
        context.config,
        "Google Workspace access is disabled.",
      );
      await saveVerification(
        ctx,
        operatorUserId,
        credential.revision,
        result,
      );
      return result;
    }
    if (!credential.credentials) {
      const result = failedGoogleWorkspaceVerification(
        context.config,
        credential.error ?? "Google Workspace credentials are unavailable.",
      );
      await saveVerification(
        ctx,
        operatorUserId,
        credential.revision,
        result,
      );
      return result;
    }
    const result = await verifyGoogleWorkspaceConnection(
      providerFor(credential.credentials),
      context.config,
    );
    await saveVerification(
      ctx,
      operatorUserId,
      credential.revision,
      result,
    );
    return result;
  },
});

export const runToolInternal = internalAction({
  args: {
    operatorUserId: v.id("users"),
    threadId: v.id("operatorAgentThreads"),
    toolName: v.string(),
    input: v.any(),
    channel: operatorChannelValidator,
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    result: unknown;
    attachments?: Array<{
      fileId: Id<"_storage">;
      filename: string;
      contentType: string;
      size: number;
    }>;
  }> => {
    const context = await ctx.runQuery(
      internal.operatorGoogleWorkspace.getActionContextInternal,
      {
        operatorUserId: args.operatorUserId,
        threadId: args.threadId,
        channel: args.channel satisfies OperatorGoogleWorkspaceToolChannel,
      },
    );
    if (!context.config?.enabled) {
      throw new Error("Company Google Workspace access is disabled.");
    }
    const credential = await googleWorkspaceCredentialEnvelope();
    if (!credential.credentials) {
      throw new Error(
        credential.error ?? "Google Workspace credentials are unavailable.",
      );
    }
    return await runGoogleWorkspaceTool(
      {
        config: context.config,
        provider: providerFor(credential.credentials),
        cursorSecret: credential.revision!,
        attachmentStorage: {
          store: (blob) => ctx.storage.store(blob),
          delete: (fileId) => ctx.storage.delete(fileId),
          read: (file) => readStoredAgentFile(ctx, file),
        },
      },
      toolName(args.toolName),
      args.input,
    );
  },
});
