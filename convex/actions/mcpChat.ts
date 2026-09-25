"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { stepCountIs } from "ai";
import {
  AGENT_MAX_OUTPUT_TOKENS,
  runAgentTurn,
} from "../lib/channelAgentRunner";
import {
  formatPolicyFocusHints,
  selectPolicyFocusIds,
  validatePolicyFocusIds,
} from "../lib/agentPolicyFocus";
import {
  buildClientAgentTurnTools,
  decideClientAgentTurn,
  promptModuleArtifact,
} from "../lib/clientAgentPrompt";
import {
  buildRecentAgentConversationContext,
  buildTextModelHistory,
} from "../lib/agentMessageHistory";
import { buildEmailTools, type EmailToolResult } from "../lib/emailTools";
import { resolveEmailAgentIdentity } from "../lib/emailIdentity";
import { canAccessThread } from "../lib/threadAccess";
import { ensureEmailSendAuthorizationDecision } from "../lib/emailSendAuthorization";
import { cleanAgentMarkdownForTransport } from "../lib/transportRenderers";
import {
  loadBoundedAgentHistory,
  scheduleThreadHistoryCompaction,
} from "../lib/agentHistoryLoader";

import {
  filterToolsForWriteAccess,
  MCP_CHAT_WRITE_TOOL_NAMES,
} from "../lib/mcpAgentToolAccess";
import { buildAgentToolExecutors } from "../lib/agentToolExecutors";
import {
  classifyPromptInjection,
  collectAllowedRecipients,
  enforceInputLimits,
} from "../lib/security";
import type { Id } from "../_generated/dataModel";

import { getClientPortalUrl } from "../lib/domains";

/**
 * MCP chat shares the client tool families and durable email drafts. Sends read
 * the current message's stored authorization, as on the other client surfaces.
 * Creates/reuses a thread, generates a response, persists it, and returns.
 */
export const run = internalAction({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    message: v.string(),
    threadId: v.optional(v.id("threads")),
    canWrite: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    threadId: string;
    response: string;
    attachments?: Array<{
      filename: string;
      contentType: string;
      size: number;
      fileId?: Id<"_storage">;
      url?: string | null;
    }>;
  }> => {
    // Load org
    const org = await ctx.runQuery(internal.orgs.getInternal, {
      id: args.orgId,
    });
    if (!org) throw new Error("Organization not found");

    // ── Prompt injection guard ──
    const sanitizedMessage = enforceInputLimits(args.message);
    const injectionCheck = await classifyPromptInjection(
      ctx,
      sanitizedMessage,
      args.orgId,
    );
    if (!injectionCheck.safe) {
      console.warn("[security] Prompt injection blocked in MCP chat", {
        orgId: args.orgId,
        audit: injectionCheck.audit,
      });
      return {
        threadId: (args.threadId as string) ?? "",
        response:
          "I can't process this request. Please rephrase your question about insurance policies or coverage.",
      };
    }

    const scope = await ctx.runQuery(internal.lib.agentScope.resolveForAction, {
      orgId: args.orgId,
      userId: args.userId,
      surface: "mcp",
    });

    // Get or create thread
    let threadId = args.threadId;
    if (threadId) {
      const thread = await ctx.runQuery(internal.threads.getInternal, {
        id: threadId,
      });
      if (
        !thread ||
        !canAccessThread({ userId: args.userId, userOrgId: args.orgId, thread })
      ) {
        throw new Error("Thread not found");
      }
    }
    if (!threadId) {
      threadId = await ctx.runMutation(internal.threads.createInternal, {
        orgId: args.orgId,
        userId: args.userId,
        title: "MCP Chat",
      });
    }

    // Get user info
    const user = await ctx.runQuery(internal.users.getInternal, {
      id: args.userId,
    });
    const userName = user?.name?.split(/\s+/)[0];

    // Insert user message
    const userMessageId = await ctx.runMutation(
      internal.threads.insertUserMessageInternal,
      {
        threadId,
        orgId: args.orgId,
        userId: args.userId,
        userName: user?.name ?? user?.email ?? "User",
        content: args.message,
      },
    );

    const history = await loadBoundedAgentHistory(ctx, {
      threadId,
      currentMessageId: userMessageId,
      surface: "mcp",
    });
    const allMessages = history.messages;
    const policyFocusIds = await validatePolicyFocusIds(
      ctx,
      scope,
      selectPolicyFocusIds(
        allMessages.filter((message) => message._id !== userMessageId),
      ),
    );
    const policyFocusBlock = formatPolicyFocusHints(policyFocusIds);
    const siteUrl = getClientPortalUrl();
    const traceId = `${String(userMessageId)}:mcp-agent`;

    const responseAttachments: Array<{
      filename: string;
      contentType: string;
      size: number;
      fileId?: Id<"_storage">;
    }> = [];
    const mcpToolArtifacts: Array<{ type: string; data: unknown }> = [];
    const emailIdentity = resolveEmailAgentIdentity(org);
    const members = await ctx.runQuery(internal.users.listByOrgInternal, {
      orgId: args.orgId,
    });
    const memberEmails = members.flatMap((member) =>
      member?.email ? [member.email] : [],
    );
    const emailResult: { current: EmailToolResult | null } = { current: null };
    const emailReferencedPolicyIds: Id<"policies">[] = [];
    if (args.canWrite !== false) {
      const pendingDrafts = await ctx.runQuery(
        internal.pendingEmails.listDraftsInternal,
        {
          threadId,
          orgId: args.orgId,
        },
      );
      await ensureEmailSendAuthorizationDecision(ctx, {
        message: {
          _id: userMessageId,
          orgId: args.orgId,
          threadId,
          content: args.message,
        },
        pendingDrafts,
      });
    }
    const registeredTools = filterToolsForWriteAccess(
      {
        ...buildAgentToolExecutors(ctx, {
          surface: "mcp",
          orgId: args.orgId,
          userId: args.userId,
          scope,
          threadId,
          canWrite: args.canWrite,
          writeUnavailableMessage:
            args.canWrite === false
              ? "This MCP token has read-only scope. Reconnect or authorize with write scope to perform that action."
              : undefined,
          imessageGroupChat: true,
          webResearch: true,
          mailbox: {},
          routingParentId: traceId,
          onPolicyReferenced: (policyId) => {
            if (!emailReferencedPolicyIds.includes(policyId))
              emailReferencedPolicyIds.push(policyId);
          },
          onResponseAttachment: (attachment) => {
            responseAttachments.push(attachment);
          },
          onToolArtifact: (artifact) => {
            const existing =
              artifact.type === "mailbox_task"
                ? mcpToolArtifacts.find((item) => item.type === "mailbox_task")
                : undefined;
            if (existing) existing.data = artifact.data;
            else mcpToolArtifacts.push(artifact);
          },
        }),
        ...(emailIdentity.canSend &&
        emailIdentity.agentAddress &&
        emailIdentity.fromHeader
          ? buildEmailTools(ctx, {
              orgId: args.orgId,
              userId: args.userId,
              threadId,
              sourceUserMessageId: userMessageId,
              routingParentId: traceId,
              channel: "mcp",
              scope,
              fromHeader: emailIdentity.fromHeader,
              agentAddress: emailIdentity.agentAddress,
              senderEmail: user?.email,
              defaultTo: user?.email,
              defaultRecipientName: user?.name,
              defaultBcc:
                org.bccRequesterOnAgentEmails !== false && user?.email
                  ? [user.email]
                  : undefined,
              allowedRecipients: collectAllowedRecipients(
                allMessages,
                memberEmails,
              ),
              availableAttachments: allMessages.flatMap((message) =>
                (message.attachments ?? []).flatMap((attachment) =>
                  attachment.fileId &&
                  (message.role !== "agent" || attachment.kind !== "coi")
                    ? [{ ...attachment, fileId: attachment.fileId }]
                    : [],
                ),
              ),
              referencedPolicyIds: emailReferencedPolicyIds,
              emailSendDelay: org.emailSendDelay,
              conversationContext:
                buildRecentAgentConversationContext(allMessages),
              onResult: (result) => {
                emailResult.current = result;
              },
            })
          : {}),
      },
      args.canWrite,
      MCP_CHAT_WRITE_TOOL_NAMES,
    );

    const selection = await decideClientAgentTurn(ctx, {
      orgId: args.orgId,
      surface: "mcp",
      message: sanitizedMessage,
      tools: registeredTools,
      summary: history.summary,
      trace: { traceId, parentRequestId: String(userMessageId) },
    });
    mcpToolArtifacts.push(
      promptModuleArtifact(selection, { traceId, surface: "mcp" }),
    );
    const turnTools = buildClientAgentTurnTools(registeredTools, selection, {
      surface: "mcp",
      org,
      userName,
      siteUrl,
      answerDepth: selection.answerDepth,
      maxToolCalls: 10,
      canSendEmail: args.canWrite !== false && emailIdentity.canSend,
      emailUnavailableReason:
        args.canWrite === false
          ? "the MCP token has read-only scope"
          : emailIdentity.reason,
      policyFocus: policyFocusBlock,
      summary: history.summary,
    });

    const messageHistory = buildTextModelHistory(allMessages);

    const turn = await runAgentTurn(ctx, {
      orgId: args.orgId,
      task: "chat",
      options: {
        maxOutputTokens: AGENT_MAX_OUTPUT_TOKENS,
        ...turnTools,
        messages: messageHistory,
        stopWhen: stepCountIs(10),
      },
      run: {
        taskKind: "query_reason",
        sessionKey: String(threadId),
        trace: {
          traceId,
          parentRequestId: String(userMessageId),
          label: "convex.mcpChat",
          phase: "query_reason",
          channel: "mcp",
        },
      },
    });
    const content = turn.text;
    for (const workflowOutcome of turn.audit.workflowOutcomes) {
      mcpToolArtifacts.push({
        type: "workflow_outcome",
        data: workflowOutcome,
      });
    }

    // Insert agent message
    const agentMsgId = await ctx.runMutation(
      internal.threads.insertAgentMessage,
      {
        threadId,
        orgId: args.orgId,
      },
    );
    await ctx.runMutation(internal.threads.updateAgentMessage, {
      id: agentMsgId,
      content,
      routerRequestId: turn.routerRequestId,
      pendingEmailId: emailResult.current?.pendingEmailId,
      usedTools:
        turn.audit.usedTools.length > 0 ? turn.audit.usedTools : undefined,
      toolCalls:
        turn.audit.toolCalls.length > 0 ? turn.audit.toolCalls : undefined,
      attachments:
        responseAttachments.length > 0 ? responseAttachments : undefined,
      toolArtifacts: mcpToolArtifacts.length > 0 ? mcpToolArtifacts : undefined,
    });
    await ctx.runMutation(internal.threads.touchThread, { threadId });
    await scheduleThreadHistoryCompaction(ctx, threadId);

    // Auto-title if this is a new thread (only 1 user message)
    const userMessages = allMessages.filter(
      (m: { role?: string }) => m.role === "user",
    );
    if (userMessages.length <= 1) {
      await ctx.scheduler.runAfter(0, internal.actions.threadTitle.generate, {
        threadId,
        userMessageId,
        expectedTitle: "MCP Chat",
      });
    }

    const attachments =
      responseAttachments.length > 0
        ? await Promise.all(
            responseAttachments.map(async (attachment) => ({
              ...attachment,
              url: attachment.fileId
                ? await ctx.storage.getUrl(attachment.fileId)
                : null,
            })),
          )
        : undefined;
    return {
      threadId,
      response: cleanAgentMarkdownForTransport(content),
      attachments,
    };
  },
});
