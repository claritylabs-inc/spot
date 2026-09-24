import {
  presentationReadBudget,
  schedulePresentation,
  visiblePresentation,
  type PresentationReadBudget,
} from "./chatPresentations";
import dayjs from "dayjs";
import { v } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  requireCurrentOrgAccess as requireOrgAccess,
  getCurrentOrgAccess as getOrgAccess,
  assertCanUseTenantAgent,
} from "./lib/access";
import { agentStepsValidator } from "./lib/agentSteps";
import { buildImessageGroupMemberTitle } from "./lib/imessageGroupResolution";
import {
  getActiveOperatorImpersonation,
  writeOperatorAudit,
} from "./lib/operatorIdentity";
import { canAccessThread } from "./lib/threadAccess";
import {
  agentAddressAliases,
  canonicalAgentAddress,
  canonicalAgentDomain,
  DEFAULT_AGENT_DOMAIN,
} from "./lib/agentEmailDomains";
import {
  emailContentValidator,
  pendingEmailAttachmentKindValidator,
  threadMessageKindValidator,
} from "./lib/threadMessageValidators";

const EMAIL_MODE_VALIDATOR = v.union(
  v.literal("direct"),
  v.literal("cc"),
  v.literal("forward"),
  v.literal("unknown"),
);
const IMESSAGE_GROUP_TITLE_PREFIX = "iMessage group - ";
const IMESSAGE_DIRECT_TITLE_PREFIX = "iMessage - ";
type ImessageAttachmentDeliveryFailure = {
  filename: string;
  error?: string;
};

async function findThreadMessageByDedupeKey(
  ctx: MutationCtx,
  threadId: Id<"threads">,
  dedupeKey: string | undefined,
) {
  if (!dedupeKey) return null;
  return ctx.db
    .query("threadMessages")
    .withIndex("thread_dedupe", (query) =>
      query.eq("threadId", threadId).eq("dedupeKey", dedupeKey),
    )
    .unique();
}

type OperatorInitiatedMessage = {
  operatorUserId: Id<"users">;
  operatorEmail?: string;
  operatorName?: string;
  impersonationSessionId: Id<"operatorImpersonationSessions">;
  targetOrgId: Id<"organizations">;
  targetOrgName: string;
  targetRole: "admin" | "member";
  displayLabel: string;
  initiatedAt: number;
};

function orgName(org: Doc<"organizations">): string {
  return org.name?.trim() || String(org._id);
}

async function buildOperatorInitiatedMessage(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
): Promise<OperatorInitiatedMessage | undefined> {
  const impersonation = await getActiveOperatorImpersonation(ctx);
  if (!impersonation || impersonation.session.targetOrgId !== orgId)
    return undefined;
  const operatorName = impersonation.operator.user.name?.trim();
  return {
    operatorUserId: impersonation.operator.userId,
    ...(impersonation.operator.user.email
      ? { operatorEmail: impersonation.operator.user.email }
      : {}),
    ...(operatorName ? { operatorName } : {}),
    impersonationSessionId: impersonation.session._id,
    targetOrgId: impersonation.session.targetOrgId,
    targetOrgName: orgName(impersonation.targetOrg),
    targetRole: impersonation.session.targetRole,
    displayLabel: `Clarity Labs on behalf of ${orgName(impersonation.targetOrg)}`,
    initiatedAt: dayjs().valueOf(),
  };
}

/** Generate a short alphanumeric ID for thread email addresses */
function shortId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function createThreadEmail(
  agentHandle: string | undefined,
  domain = DEFAULT_AGENT_DOMAIN,
) {
  return agentHandle ? `${agentHandle}+${shortId()}@${domain}` : undefined;
}

function formatImessageThreadTitle(args: {
  isGroup: boolean;
  displayName: string;
}): string {
  return args.isGroup
    ? `${IMESSAGE_GROUP_TITLE_PREFIX}${args.displayName}`
    : `${IMESSAGE_DIRECT_TITLE_PREFIX}${args.displayName}`;
}

function isDirectUserImessageThread(thread: Doc<"threads">): boolean {
  return thread.originChannel === "imessage" && !thread.imessageIsGroup;
}

function findPrivateDirectUserThread(
  threads: Array<Doc<"threads">>,
  userId: Id<"users">,
) {
  return threads.find(
    (thread) =>
      isDirectUserImessageThread(thread) &&
      thread.createdBy === userId &&
      thread.visibility === "user_private",
  );
}

function findMigratableDirectUserThread(
  threads: Array<Doc<"threads">>,
  userId: Id<"users">,
) {
  return threads.find(
    (thread) =>
      isDirectUserImessageThread(thread) &&
      thread.createdBy === userId &&
      thread.visibility !== "user_private",
  );
}

async function deriveImessageGroupDisplayTitle(
  ctx: QueryCtx,
  thread: Doc<"threads">,
): Promise<string | undefined> {
  if (!thread.imessageIsGroup || !thread.imessageChatGuid) return undefined;
  if (!thread.title.startsWith(IMESSAGE_GROUP_TITLE_PREFIX)) return undefined;

  const participants = await ctx.db
    .query("imessageParticipants")
    .withIndex("chat", (q) => q.eq("chatGuid", thread.imessageChatGuid!))
    .collect();
  if (participants.length === 0) return undefined;

  const users = await Promise.all(
    participants.map((participant) =>
      participant.userId
        ? ctx.db.get(participant.userId)
        : Promise.resolve(null),
    ),
  );
  const memberTitle = buildImessageGroupMemberTitle(
    participants.map((participant, index) => ({
      address: participant.address,
      displayName: participant.displayName,
      userName: users[index]?.name,
    })),
  );

  return memberTitle
    ? `${IMESSAGE_GROUP_TITLE_PREFIX}${memberTitle}`
    : undefined;
}

async function withThreadDisplayFields(
  ctx: QueryCtx,
  thread: Doc<"threads">,
): Promise<Doc<"threads">> {
  const title = await deriveImessageGroupDisplayTitle(ctx, thread);
  return {
    ...thread,
    ...(title ? { title } : {}),
    ...(thread.threadEmail
      ? { threadEmail: canonicalAgentAddress(thread.threadEmail) }
      : {}),
  };
}

async function withThreadDisplayFieldsForList(
  ctx: QueryCtx,
  threads: Array<Doc<"threads">>,
): Promise<Array<Doc<"threads">>> {
  return Promise.all(
    threads.map((thread) => withThreadDisplayFields(ctx, thread)),
  );
}

function canCurrentOrgUserAccessThread(args: {
  userId: Id<"users">;
  orgId: Id<"organizations">;
  thread: Doc<"threads">;
}) {
  return canAccessThread({
    userId: args.userId,
    userOrgId: args.orgId,
    thread: args.thread,
    clientOrg: null,
  });
}

async function clientVisibleMessage(
  ctx: QueryCtx,
  message: Doc<"threadMessages">,
  orgId: Id<"organizations">,
  budget: PresentationReadBudget,
) {
  const {
    reasoning: _reasoning,
    presentation: _presentation,
    agentSteps,
    ...visible
  } = message;
  const presentation = await visiblePresentation(
    ctx,
    message,
    { audience: "client", orgId },
    budget,
  );
  const toolSteps = agentSteps?.filter((step) => step.type === "tool");
  return {
    ...visible,
    ...(presentation ? { presentation } : {}),
    ...(toolSteps?.length ? { agentSteps: toolSteps } : {}),
  };
}

async function requireCurrentOrgThread(
  ctx: QueryCtx | MutationCtx,
  threadId: Id<"threads">,
) {
  const access = await requireOrgAccess(ctx);
  assertCanUseTenantAgent(access);
  const { userId, orgId } = access;
  const thread = await ctx.db.get(threadId);
  if (!thread || !canCurrentOrgUserAccessThread({ userId, orgId, thread })) {
    throw new Error("Not found");
  }
  return { userId, orgId, thread };
}

async function requireCurrentOrgThreadMessage(
  ctx: MutationCtx,
  messageId: Id<"threadMessages">,
) {
  const message = await ctx.db.get(messageId);
  if (!message) throw new Error("Not found");
  const access = await requireCurrentOrgThread(ctx, message.threadId);
  if (message.orgId !== access.orgId) throw new Error("Not found");
  return { ...access, message };
}

// ── Public queries/mutations ──

export const list = query({
  args: { archived: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx);
    if (!access) return [];
    assertCanUseTenantAgent(access);
    const { userId, orgId } = access;
    const all = await ctx.db
      .query("threads")
      .withIndex("organization_activity", (q) => q.eq("orgId", orgId))
      .order("desc")
      .collect();
    const visible = all.filter((thread) =>
      canCurrentOrgUserAccessThread({ userId, orgId, thread }),
    );
    if (args.archived) {
      return withThreadDisplayFieldsForList(
        ctx,
        visible.filter((t) => !!t.archivedAt),
      );
    }
    return withThreadDisplayFieldsForList(
      ctx,
      visible.filter((t) => !t.archivedAt),
    );
  },
});

export const get = query({
  args: { id: v.id("threads") },
  handler: async (ctx, args) => {
    const access = await requireOrgAccess(ctx);
    assertCanUseTenantAgent(access);
    const { userId, orgId } = access;
    const thread = await ctx.db.get(args.id);
    if (!thread || !canCurrentOrgUserAccessThread({ userId, orgId, thread }))
      return null;
    return withThreadDisplayFields(ctx, thread);
  },
});

export const messages = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    const access = await requireOrgAccess(ctx);
    assertCanUseTenantAgent(access);
    const { userId, orgId } = access;
    const thread = await ctx.db.get(args.threadId);
    if (!thread || !canCurrentOrgUserAccessThread({ userId, orgId, thread }))
      return [];
    const messages = await ctx.db
      .query("threadMessages")
      .withIndex("thread", (q) => q.eq("threadId", args.threadId))
      .collect();
    const budget = presentationReadBudget();
    return (
      await Promise.all(
        messages.reverse().map((message) =>
          clientVisibleMessage(ctx, message, orgId, budget),
        ),
      )
    ).reverse();
  },
});

export const create = mutation({
  args: {
    title: v.optional(v.string()),
    initialContext: v.optional(
      v.object({
        pageType: v.string(),
        entityId: v.optional(v.string()),
        summary: v.optional(v.string()),
      }),
    ),
    agentDomain: v.optional(v.string()),
    clientMutationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireOrgAccess(ctx);
    assertCanUseTenantAgent(access);
    const { userId, orgId } = access;
    if (args.clientMutationId) {
      const existing = await ctx.db
        .query("threads")
        .withIndex("organization_mutation", (q) =>
          q.eq("orgId", orgId).eq("clientMutationId", args.clientMutationId),
        )
        .first();
      if (
        existing &&
        canCurrentOrgUserAccessThread({ userId, orgId, thread: existing })
      ) {
        return existing._id;
      }
    }
    const now = dayjs().valueOf();
    const domain = canonicalAgentDomain(args.agentDomain);

    // Look up the org's agent handle to build the thread-specific email
    const org = await ctx.db.get(orgId);
    const threadEmail = createThreadEmail(org?.agentHandle, domain);

    return ctx.db.insert("threads", {
      orgId,
      title: args.title ?? "New chat",
      createdBy: userId,
      clientMutationId: args.clientMutationId,
      lastMessageAt: now,
      initialContext: args.initialContext,
      threadEmail,
      originChannel: "chat",
    });
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const access = await requireOrgAccess(ctx);
    assertCanUseTenantAgent(access);
    return ctx.storage.generateUploadUrl();
  },
});

export const getAttachmentUrl = query({
  args: { threadId: v.id("threads"), fileId: v.id("_storage") },
  handler: async (ctx, args) => {
    const access = await requireOrgAccess(ctx);
    assertCanUseTenantAgent(access);
    const { userId, orgId } = access;
    const thread = await ctx.db.get(args.threadId);
    if (!thread || !canCurrentOrgUserAccessThread({ userId, orgId, thread }))
      return null;
    const messages = await ctx.db
      .query("threadMessages")
      .withIndex("thread", (q) => q.eq("threadId", args.threadId))
      .collect();
    const isThreadAttachment = messages.some(
      (message) =>
        message.orgId === orgId &&
        (message.attachments ?? []).some(
          (attachment) => attachment.fileId === args.fileId,
        ),
    );
    if (!isThreadAttachment) return null;
    return ctx.storage.getUrl(args.fileId);
  },
});

export const getAttachmentUrls = query({
  args: { threadId: v.id("threads"), fileIds: v.array(v.id("_storage")) },
  handler: async (ctx, args) => {
    const access = await requireOrgAccess(ctx);
    assertCanUseTenantAgent(access);
    const { userId, orgId } = access;
    const thread = await ctx.db.get(args.threadId);
    if (!thread || !canCurrentOrgUserAccessThread({ userId, orgId, thread }))
      return [];
    const requested = new Set(args.fileIds);
    const messages = await ctx.db
      .query("threadMessages")
      .withIndex("thread", (q) => q.eq("threadId", args.threadId))
      .collect();
    const allowed = new Set<string>();
    for (const message of messages) {
      if (message.orgId !== orgId) continue;
      for (const attachment of message.attachments ?? []) {
        if (attachment.fileId && requested.has(attachment.fileId)) {
          allowed.add(attachment.fileId);
        }
      }
    }
    const entries = await Promise.all(
      args.fileIds.map(async (fileId) => {
        if (!allowed.has(fileId)) return null;
        const url = await ctx.storage.getUrl(fileId);
        return url ? { fileId, url } : null;
      }),
    );
    return entries.filter((entry) => entry !== null);
  },
});

export const sendMessage = mutation({
  args: {
    threadId: v.id("threads"),
    content: v.string(),
    attachments: v.optional(
      v.array(
        v.object({
          filename: v.string(),
          contentType: v.string(),
          size: v.number(),
          fileId: v.id("_storage"),
          kind: v.optional(pendingEmailAttachmentKindValidator),
        }),
      ),
    ),
    referencedPolicyIds: v.optional(v.array(v.id("policies"))),
    referencedRequirementIds: v.optional(
      v.array(v.id("insuranceRequirements")),
    ),
    referencedMailboxIds: v.optional(v.array(v.id("connectedEmailAccounts"))),
    skipAgentResponse: v.optional(v.boolean()),
    clientMutationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, orgId, thread } = await requireCurrentOrgThread(
      ctx,
      args.threadId,
    );
    if (thread.originChannel === "slack") {
      throw new Error("Continue this conversation in Slack");
    }

    if (args.clientMutationId) {
      const existing = await ctx.db
        .query("threadMessages")
        .withIndex("organization_mutation", (q) =>
          q.eq("orgId", orgId).eq("clientMutationId", args.clientMutationId),
        )
        .first();
      if (
        existing &&
        existing.threadId === args.threadId &&
        existing.role === "user"
      ) {
        return existing._id;
      }
    }

    const user = await ctx.db.get(userId);
    const userName = user?.name ?? user?.email ?? "User";
    const operatorInitiated = await buildOperatorInitiatedMessage(ctx, orgId);
    const messages = await ctx.db
      .query("threadMessages")
      .withIndex("thread", (q) => q.eq("threadId", args.threadId))
      .collect();
    for (const message of messages) {
      if (
        message.orgId !== orgId ||
        message.role !== "agent" ||
        message.status !== "processing"
      ) {
        continue;
      }
      await ctx.db.patch(message._id, {
        content: "Response cancelled.",
        reasoning: undefined,
        status: "cancelled",
      });
    }

    const messageId = await ctx.db.insert("threadMessages", {
      threadId: args.threadId,
      orgId,
      clientMutationId: args.clientMutationId,
      channel: "chat",
      role: "user",
      messageKind: "conversation",
      userId,
      userName,
      operatorInitiated,
      content: args.content,
      attachments: args.attachments,
      referencedPolicyIds: args.referencedPolicyIds,
      referencedRequirementIds: args.referencedRequirementIds,
      referencedMailboxIds: args.referencedMailboxIds,
    });

    await ctx.db.patch(args.threadId, { lastMessageAt: dayjs().valueOf() });

    const agentMessageId = args.skipAgentResponse
      ? undefined
      : await ctx.db.insert("threadMessages", {
          threadId: args.threadId,
          orgId,
          channel: "chat",
          role: "agent",
          messageKind: "conversation",
          content: "",
          status: "processing",
          replyToMessageId: messageId,
        });

    if (
      thread.originChannel === "imessage" &&
      (thread.imessageChatGuid || thread.threadPhone)
    ) {
      await ctx.scheduler.runAfter(
        0,
        internal.actions.mirrorWebChatToImessage.run,
        {
          threadId: args.threadId,
          messageId,
        },
      );
    }

    // Schedule agent response (skip when streaming API route handles it)
    if (!args.skipAgentResponse) {
      await ctx.scheduler.runAfter(0, internal.actions.processThreadChat.run, {
        threadId: args.threadId,
        orgId,
        userId,
        userMessageId: messageId,
        agentMessageId,
      });
    }

    if (operatorInitiated) {
      await writeOperatorAudit(ctx, {
        operatorUserId: operatorInitiated.operatorUserId,
        type: "impersonation_chat_message",
        targetOrgId: orgId,
        summary: `Started chat as ${operatorInitiated.displayLabel}`,
        metadata: {
          threadId: args.threadId,
          messageId,
          impersonationSessionId: operatorInitiated.impersonationSessionId,
          targetRole: operatorInitiated.targetRole,
        },
      });
    }

    // Auto-generate a title from the first user message — runs independently
    // of the agent response so streaming failures don't prevent renaming.
    if (thread.title === "New chat") {
      await ctx.scheduler.runAfter(0, internal.actions.threadTitle.generate, {
        threadId: args.threadId,
        userMessageId: messageId,
      });
    }

    return messageId;
  },
});

export const archive = mutation({
  args: { id: v.id("threads") },
  handler: async (ctx, args) => {
    await requireCurrentOrgThread(ctx, args.id);
    await ctx.db.patch(args.id, { archivedAt: dayjs().valueOf() });
  },
});

export const unarchive = mutation({
  args: { id: v.id("threads") },
  handler: async (ctx, args) => {
    await requireCurrentOrgThread(ctx, args.id);
    await ctx.db.patch(args.id, { archivedAt: undefined });
  },
});

export const updateTitle = mutation({
  args: { id: v.id("threads"), title: v.string() },
  handler: async (ctx, args) => {
    await requireCurrentOrgThread(ctx, args.id);
    await ctx.db.patch(args.id, { title: args.title });
  },
});

export const cancelProcessing = mutation({
  args: { messageId: v.id("threadMessages") },
  handler: async (ctx, args) => {
    const { message: msg } = await requireCurrentOrgThreadMessage(
      ctx,
      args.messageId,
    );
    if (msg.role !== "agent") throw new Error("Not found");
    if (msg.status !== "processing") return; // already finished
    await ctx.db.patch(args.messageId, {
      content: "Response cancelled.",
      presentation: undefined,
      presentationRevision: (msg.presentationRevision ?? 0) + 1,
      reasoning: undefined,
      status: "cancelled",
    });
  },
});

export const retryAgentResponse = mutation({
  args: { messageId: v.id("threadMessages") },
  handler: async (ctx, args) => {
    const {
      userId,
      orgId,
      message: msg,
    } = await requireCurrentOrgThreadMessage(ctx, args.messageId);
    if (msg.role !== "agent") throw new Error("Not found");

    // Find the user message that triggered this agent response
    // (the most recent user message before this agent message)
    const threadMessages = await ctx.db
      .query("threadMessages")
      .withIndex("thread", (q) => q.eq("threadId", msg.threadId))
      .order("asc")
      .collect();
    const msgIndex = threadMessages.findIndex((m) => m._id === args.messageId);
    let userMessageId: typeof msg._id | undefined;
    for (let i = msgIndex - 1; i >= 0; i--) {
      if (threadMessages[i].role === "user") {
        userMessageId = threadMessages[i]._id;
        break;
      }
    }
    if (!userMessageId) throw new Error("No user message found to retry");

    // Delete the failed agent message
    await ctx.db.delete(args.messageId);

    // Re-schedule processThreadChat
    await ctx.scheduler.runAfter(0, internal.actions.processThreadChat.run, {
      threadId: msg.threadId,
      orgId,
      userId,
      userMessageId,
    });
  },
});

// ── Internal (for actions) ──

export const getInternal = internalQuery({
  args: { id: v.id("threads") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.id);
  },
});

export const getMessageInternal = internalQuery({
  args: { id: v.id("threadMessages") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.id);
  },
});

export const messagesInternal = internalQuery({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("threadMessages")
      .withIndex("thread", (q) => q.eq("threadId", args.threadId))
      .collect();
  },
});

export const wasPolicyCardRecentlyPresentedInternal = internalQuery({
  args: {
    threadId: v.id("threads"),
    policyId: v.id("policies"),
  },
  handler: async (ctx, args) => {
    const recentMessages = await ctx.db
      .query("threadMessages")
      .withIndex("thread", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(24);
    return recentMessages.some(
      (message) =>
        message.role === "agent" &&
        message.status !== "error" &&
        message.status !== "cancelled" &&
        message.usedTools?.includes("present_policy_card") === true &&
        message.referencedPolicyIds?.some(
          (policyId) => String(policyId) === String(args.policyId),
        ) === true,
    );
  },
});

export const insertAgentMessage = internalMutation({
  args: {
    threadId: v.id("threads"),
    orgId: v.id("organizations"),
    channel: v.optional(
      v.union(
        v.literal("chat"),
        v.literal("email"),
        v.literal("imessage"),
        v.literal("slack"),
      ),
    ),
    replyToMessageId: v.optional(v.id("threadMessages")),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("threadMessages", {
      threadId: args.threadId,
      orgId: args.orgId,
      channel: args.channel ?? "chat",
      role: "agent",
      messageKind: "conversation",
      content: "",
      status: "processing",
      replyToMessageId: args.replyToMessageId,
    });
  },
});

export const claimAgentResponse = internalMutation({
  args: {
    threadId: v.id("threads"),
    orgId: v.id("organizations"),
    userMessageId: v.id("threadMessages"),
    agentMessageId: v.optional(v.id("threadMessages")),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    if (args.agentMessageId) {
      const agentMessage = await ctx.db.get(args.agentMessageId);
      if (
        !agentMessage ||
        agentMessage.threadId !== args.threadId ||
        agentMessage.orgId !== args.orgId ||
        agentMessage.role !== "agent" ||
        agentMessage.replyToMessageId !== args.userMessageId
      ) {
        return { messageId: args.agentMessageId, claimed: false };
      }
      if (agentMessage.agentRunStartedAt) {
        return { messageId: agentMessage._id, claimed: false };
      }
      await ctx.db.patch(agentMessage._id, { agentRunStartedAt: now });
      return { messageId: agentMessage._id, claimed: true };
    }

    const existing = await ctx.db
      .query("threadMessages")
      .withIndex("reply", (q) => q.eq("replyToMessageId", args.userMessageId))
      .first();
    if (existing) {
      if (existing.agentRunStartedAt) {
        return { messageId: existing._id, claimed: false };
      }
      await ctx.db.patch(existing._id, { agentRunStartedAt: now });
      return { messageId: existing._id, claimed: true };
    }

    const messageId = await ctx.db.insert("threadMessages", {
      threadId: args.threadId,
      orgId: args.orgId,
      channel: "chat",
      role: "agent",
      messageKind: "conversation",
      content: "",
      status: "processing",
      replyToMessageId: args.userMessageId,
      agentRunStartedAt: now,
    });
    return { messageId, claimed: true };
  },
});

export const updateAgentMessage = internalMutation({
  args: {
    id: v.id("threadMessages"),
    content: v.string(),
    presentationTools: v.optional(
      v.array(v.object({ name: v.string(), outputJson: v.string() })),
    ),
    routerRequestId: v.optional(v.string()),
    referencedPolicyIds: v.optional(v.array(v.id("policies"))),
    citedSections: v.optional(v.array(v.string())),
    citedCoverageNames: v.optional(v.array(v.string())),
    citedSourceSpanIds: v.optional(v.array(v.string())),
    usedTools: v.optional(v.array(v.string())),
    toolCalls: v.optional(
      v.array(
        v.object({
          name: v.string(),
          input: v.optional(v.string()),
          output: v.optional(v.string()),
        }),
      ),
    ),
    agentSteps: v.optional(agentStepsValidator),
    toolArtifacts: v.optional(
      v.array(
        v.object({
          type: v.string(),
          data: v.any(),
        }),
      ),
    ),
    attachments: v.optional(
      v.array(
        v.object({
          filename: v.string(),
          contentType: v.string(),
          size: v.number(),
          fileId: v.optional(v.id("_storage")),
          kind: v.optional(pendingEmailAttachmentKindValidator),
        }),
      ),
    ),
    pendingEmailId: v.optional(v.id("pendingEmails")),
    status: v.optional(
      v.union(
        v.literal("pending_send"),
        v.literal("processing"),
        v.literal("error"),
        v.literal("draft_email"),
        v.literal("cancelled"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (!existing || existing.status === "cancelled") return;
    await ctx.db.patch(args.id, {
      content: args.content,
      presentation: undefined,
      presentationRevision: (existing.presentationRevision ?? 0) + 1,
      routerRequestId: args.routerRequestId,
      status: args.status ?? undefined,
      referencedPolicyIds: args.referencedPolicyIds,
      citedSections: args.citedSections,
      citedCoverageNames: args.citedCoverageNames,
      citedSourceSpanIds: args.citedSourceSpanIds,
      usedTools: args.usedTools,
      toolCalls: args.toolCalls,
      agentSteps: args.agentSteps,
      toolArtifacts: args.toolArtifacts,
      attachments: args.attachments,
      pendingEmailId: args.pendingEmailId,
    });
    if (args.presentationTools) {
      const source = existing.replyToMessageId
        ? await ctx.db.get(existing.replyToMessageId)
        : null;
      const message = await ctx.db.get(args.id);
      if (
        message &&
        source?.userId &&
        source.threadId === message.threadId &&
        source.orgId === message.orgId
      ) {
        await schedulePresentation(ctx, message, {
          userId: source.userId,
          tools: args.presentationTools,
        });
      }
    }
  },
});

export const attachPendingEmailToAgentMessage = internalMutation({
  args: {
    id: v.id("threadMessages"),
    pendingEmailId: v.id("pendingEmails"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      pendingEmailId: args.pendingEmailId,
    });
  },
});

export const insertAttachmentMessageInternal = internalMutation({
  args: {
    threadId: v.id("threads"),
    orgId: v.id("organizations"),
    content: v.string(),
    attachments: v.array(
      v.object({
        filename: v.string(),
        contentType: v.string(),
        size: v.number(),
        fileId: v.id("_storage"),
        kind: v.optional(pendingEmailAttachmentKindValidator),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.orgId !== args.orgId) {
      throw new Error("Thread not found");
    }
    const messageId = await ctx.db.insert("threadMessages", {
      threadId: args.threadId,
      orgId: args.orgId,
      channel: "chat",
      role: "agent",
      messageKind: "conversation",
      content: args.content,
      attachments: args.attachments,
    });
    await ctx.db.patch(args.threadId, { lastMessageAt: dayjs().valueOf() });
    return messageId;
  },
});

export const insertWorkflowStatusMessage = internalMutation({
  args: {
    threadId: v.id("threads"),
    orgId: v.id("organizations"),
    channel: v.optional(
      v.union(
        v.literal("chat"),
        v.literal("email"),
        v.literal("imessage"),
        v.literal("slack"),
      ),
    ),
    content: v.string(),
    pendingEmailId: v.optional(v.id("pendingEmails")),
    sourceThreadMessageId: v.optional(v.id("threadMessages")),
    dedupeKey: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await findThreadMessageByDedupeKey(
      ctx,
      args.threadId,
      args.dedupeKey,
    );
    if (existing) return existing._id;
    const messageId = await ctx.db.insert("threadMessages", {
      threadId: args.threadId,
      orgId: args.orgId,
      channel: args.channel ?? "chat",
      role: "agent",
      messageKind: "workflow_status",
      sourceThreadMessageId: args.sourceThreadMessageId,
      dedupeKey: args.dedupeKey,
      content: args.content,
      pendingEmailId: args.pendingEmailId,
    });
    await ctx.db.patch(args.threadId, { lastMessageAt: dayjs().valueOf() });
    return messageId;
  },
});

export const listThreadAttachmentsInternal = internalQuery({
  args: {
    threadId: v.id("threads"),
    orgId: v.id("organizations"),
    excludeEmailArtifacts: v.optional(v.boolean()),
    excludeAgentCoiAttachments: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("threadMessages")
      .withIndex("thread", (q) => q.eq("threadId", args.threadId))
      .collect();
    return messages
      .filter(
        (message) =>
          message.orgId === args.orgId &&
          !(args.excludeEmailArtifacts && message.channel === "email"),
      )
      .flatMap((message) =>
        (message.attachments ?? []).flatMap((attachment) => {
          if (
            !attachment.fileId ||
            (args.excludeAgentCoiAttachments &&
              message.role === "agent" &&
              attachment.kind === "coi")
          ) {
            return [];
          }
          return [{ ...attachment, fileId: attachment.fileId }];
        }),
      );
  },
});

export const deleteMessageInternal = internalMutation({
  args: { id: v.id("threadMessages") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

export const streamAgentProgress = internalMutation({
  args: {
    id: v.id("threadMessages"),
    content: v.optional(v.string()),
    usedTools: v.optional(v.array(v.string())),
    toolCalls: v.optional(
      v.array(
        v.object({
          name: v.string(),
          input: v.optional(v.string()),
          output: v.optional(v.string()),
        }),
      ),
    ),
    toolArtifacts: v.optional(
      v.array(
        v.object({
          type: v.string(),
          data: v.any(),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (existing?.status !== "processing") return;
    const patch: Record<string, unknown> = {};
    if (args.content !== undefined) patch.content = args.content;
    if (args.usedTools !== undefined) patch.usedTools = args.usedTools;
    if (args.toolCalls !== undefined) patch.toolCalls = args.toolCalls;
    if (args.toolArtifacts !== undefined)
      patch.toolArtifacts = args.toolArtifacts;
    await ctx.db.patch(args.id, patch);
  },
});

export const updateAgentError = internalMutation({
  args: {
    id: v.id("threadMessages"),
    error: v.string(),
    content: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.id);
    if (existing?.status === "cancelled") return;
    await ctx.db.patch(args.id, {
      status: "error",
      presentation: undefined,
      presentationRevision: (existing?.presentationRevision ?? 0) + 1,
      error: args.error,
      ...(args.content !== undefined ? { content: args.content } : {}),
    });
  },
});

export const touchThread = internalMutation({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.threadId, { lastMessageAt: dayjs().valueOf() });
  },
});

export const updateTitleInternal = internalMutation({
  args: {
    threadId: v.id("threads"),
    title: v.string(),
    expectedTitle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.expectedTitle !== undefined) {
      const thread = await ctx.db.get(args.threadId);
      if (!thread || thread.title !== args.expectedTitle) return false;
    }
    await ctx.db.patch(args.threadId, { title: args.title });
    return true;
  },
});

export const listByOrg = internalQuery({
  args: {
    orgId: v.id("organizations"),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const threads = await ctx.db
      .query("threads")
      .withIndex("organization_activity", (q) => q.eq("orgId", args.orgId))
      .order("desc")
      .take(50);
    const visible = args.userId
      ? threads.filter((thread) =>
          canCurrentOrgUserAccessThread({
            userId: args.userId!,
            orgId: args.orgId,
            thread,
          }),
        )
      : threads;
    return withThreadDisplayFieldsForList(ctx, visible);
  },
});

export const createInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("threads", {
      orgId: args.orgId,
      title: args.title ?? "New chat",
      createdBy: args.userId,
      lastMessageAt: dayjs().valueOf(),
      originChannel: "chat",
    });
  },
});

export const createProactiveInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    visibility: v.optional(v.literal("user_private")),
    title: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const org = await ctx.db.get(args.orgId);
    const threadEmail = createThreadEmail(org?.agentHandle);
    const threadId = await ctx.db.insert("threads", {
      orgId: args.orgId,
      title: args.title,
      createdBy: args.userId,
      lastMessageAt: now,
      threadEmail,
      originChannel: "chat",
      visibility: args.visibility,
    });
    const messageId = await ctx.db.insert("threadMessages", {
      threadId,
      orgId: args.orgId,
      channel: "chat",
      role: "agent",
      content: args.content,
    });
    return { threadId, messageId, threadEmail };
  },
});

export const recordNotificationImessageInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    userName: v.optional(v.string()),
    phone: v.string(),
    content: v.string(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const privacyState = await ctx.db
      .query("imessagePrivacyStates")
      .withIndex("user", (q) => q.eq("userId", args.userId))
      .unique();
    const historyGeneration = privacyState?.historyGeneration ?? 0;
    const existingMessage = await ctx.db
      .query("threadMessages")
      .withIndex("message", (q) => q.eq("messageId", args.idempotencyKey))
      .first();
    if (existingMessage) {
      const existingThread = await ctx.db.get(existingMessage.threadId);
      if (
        existingThread &&
        existingThread.createdBy === args.userId &&
        existingThread.visibility !== "user_private" &&
        isDirectUserImessageThread(existingThread)
      ) {
        await ctx.db.patch(existingThread._id, { visibility: "user_private" });
      } else if (
        existingThread?.visibility !== "user_private" ||
        existingThread.createdBy !== args.userId
      ) {
        throw new Error(
          "Notification iMessage idempotency key belongs to another thread",
        );
      }
      return {
        threadId: existingMessage.threadId,
        messageId: existingMessage._id,
        duplicate: true,
      };
    }

    const phoneThreads = await ctx.db
      .query("threads")
      .withIndex("organization_phone", (q) =>
        q.eq("orgId", args.orgId).eq("threadPhone", args.phone),
      )
      .collect();
    const currentGenerationThreads = phoneThreads.filter(
      (candidate) =>
        (candidate.imessageHistoryGeneration ?? 0) === historyGeneration,
    );
    let thread = findPrivateDirectUserThread(
      currentGenerationThreads,
      args.userId,
    );
    const now = dayjs().valueOf();
    if (!thread) {
      const migratable = findMigratableDirectUserThread(
        currentGenerationThreads,
        args.userId,
      );
      if (migratable) {
        await ctx.db.patch(migratable._id, {
          lastMessageAt: now,
          visibility: "user_private",
          imessageHistoryGeneration: historyGeneration,
        });
        thread = {
          ...migratable,
          lastMessageAt: now,
          visibility: "user_private",
        };
      }
    }
    if (!thread) {
      const threadId = await ctx.db.insert("threads", {
        orgId: args.orgId,
        title: `iMessage - ${args.userName ?? args.phone}`,
        createdBy: args.userId,
        lastMessageAt: now,
        threadPhone: args.phone,
        originChannel: "imessage",
        visibility: "user_private",
        imessageHistoryGeneration: historyGeneration,
      });
      const created = await ctx.db.get(threadId);
      if (!created) throw new Error("Could not create iMessage thread");
      thread = created;
    }

    const messageId = await ctx.db.insert("threadMessages", {
      threadId: thread._id,
      orgId: args.orgId,
      channel: "imessage",
      role: "agent",
      userId: args.userId,
      userName: args.userName,
      content: args.content,
      messageId: args.idempotencyKey,
    });
    await ctx.db.patch(thread._id, { lastMessageAt: now });
    return { threadId: thread._id, messageId, duplicate: false };
  },
});

export const insertUserMessageInternal = internalMutation({
  args: {
    threadId: v.id("threads"),
    orgId: v.id("organizations"),
    userId: v.id("users"),
    userName: v.optional(v.string()),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const messageId = await ctx.db.insert("threadMessages", {
      threadId: args.threadId,
      orgId: args.orgId,
      channel: "chat",
      role: "user",
      messageKind: "conversation",
      userId: args.userId,
      userName: args.userName,
      content: args.content,
    });
    await ctx.db.patch(args.threadId, { lastMessageAt: dayjs().valueOf() });
    return messageId;
  },
});

export const findByEmail = internalQuery({
  args: { threadEmail: v.string() },
  handler: async (ctx, args) => {
    let match: Doc<"threads"> | null = null;
    for (const address of agentAddressAliases(args.threadEmail)) {
      const threads = await ctx.db
        .query("threads")
        .withIndex("email", (q) => q.eq("threadEmail", address))
        .take(2);
      if (threads.length > 1 || (match && threads.length > 0)) {
        throw new Error("Thread reply address is ambiguous.");
      }
      if (threads.length === 1) match = threads[0];
    }
    return match;
  },
});

// ── Inbound email / iMessage routing helpers ──

export const findOrCreateByImessageChat = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    chatGuid: v.string(),
    isGroup: v.boolean(),
    scope: v.union(v.literal("single_org"), v.literal("multi_org")),
    title: v.optional(v.string()),
    fallbackPhone: v.optional(v.string()),
    userName: v.optional(v.string()),
    historyGeneration: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existingThreads = await ctx.db
      .query("threads")
      .withIndex("organization_chat", (q) =>
        q.eq("orgId", args.orgId).eq("imessageChatGuid", args.chatGuid),
      )
      .collect();
    const matchingChatThreads = existingThreads.filter(
      (thread) =>
        (thread.imessageIsGroup ?? false) === args.isGroup &&
        (args.isGroup ||
          (thread.imessageHistoryGeneration ?? 0) ===
            (args.historyGeneration ?? 0)),
    );
    let existing = args.isGroup
      ? existingThreads.find(
          (thread) => (thread.imessageIsGroup ?? false) === args.isGroup,
        )
      : (findPrivateDirectUserThread(matchingChatThreads, args.userId) ??
        findMigratableDirectUserThread(matchingChatThreads, args.userId));
    const fallbackPhone = args.fallbackPhone;
    if (!args.isGroup && !existing && fallbackPhone) {
      const phoneThreads = await ctx.db
        .query("threads")
        .withIndex("organization_phone", (q) =>
          q.eq("orgId", args.orgId).eq("threadPhone", fallbackPhone),
        )
        .collect();
      const unboundPhoneThreads = phoneThreads.filter(
        (thread) =>
          !thread.imessageChatGuid &&
          (thread.imessageHistoryGeneration ?? 0) ===
            (args.historyGeneration ?? 0),
      );
      existing =
        findPrivateDirectUserThread(unboundPhoneThreads, args.userId) ??
        findMigratableDirectUserThread(unboundPhoneThreads, args.userId);
    }
    if (existing) {
      const displayName =
        args.title ?? args.userName ?? args.fallbackPhone ?? "Group chat";
      const nextTitle = formatImessageThreadTitle({
        isGroup: args.isGroup,
        displayName,
      });
      await ctx.db.patch(existing._id, {
        lastMessageAt: dayjs().valueOf(),
        imessageIsGroup: args.isGroup,
        imessageScope: args.scope,
        imessageChatGuid: existing.imessageChatGuid ?? args.chatGuid,
        threadPhone: existing.threadPhone ?? args.fallbackPhone,
        visibility: args.isGroup ? undefined : "user_private",
        imessageHistoryGeneration: args.isGroup
          ? undefined
          : (args.historyGeneration ?? 0),
        ...(args.isGroup &&
        existing.title.startsWith(IMESSAGE_GROUP_TITLE_PREFIX)
          ? { title: nextTitle }
          : {}),
      });
      return existing._id;
    }

    const displayName =
      args.title ?? args.userName ?? args.fallbackPhone ?? "Group chat";
    return ctx.db.insert("threads", {
      orgId: args.orgId,
      title: formatImessageThreadTitle({ isGroup: args.isGroup, displayName }),
      createdBy: args.userId,
      lastMessageAt: dayjs().valueOf(),
      threadPhone: args.fallbackPhone,
      imessageChatGuid: args.chatGuid,
      imessageIsGroup: args.isGroup,
      imessageScope: args.scope,
      originChannel: "imessage",
      visibility: args.isGroup ? undefined : "user_private",
      imessageHistoryGeneration: args.isGroup
        ? undefined
        : (args.historyGeneration ?? 0),
    });
  },
});

export const insertImessageMessage = internalMutation({
  args: {
    threadId: v.id("threads"),
    orgId: v.id("organizations"),
    role: v.union(v.literal("user"), v.literal("agent")),
    messageKind: v.optional(threadMessageKindValidator),
    sourceThreadMessageId: v.optional(v.id("threadMessages")),
    dedupeKey: v.optional(v.string()),
    userId: v.optional(v.id("users")),
    userName: v.optional(v.string()),
    imessageSenderAddress: v.optional(v.string()),
    imessageParticipantLabel: v.optional(v.string()),
    content: v.string(),
    routerRequestId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    responseMessageId: v.optional(v.string()),
    attachments: v.optional(
      v.array(
        v.object({
          filename: v.string(),
          contentType: v.string(),
          size: v.number(),
          fileId: v.optional(v.id("_storage")),
          kind: v.optional(pendingEmailAttachmentKindValidator),
        }),
      ),
    ),
    usedTools: v.optional(v.array(v.string())),
    toolCalls: v.optional(
      v.array(
        v.object({
          name: v.string(),
          input: v.optional(v.string()),
          output: v.optional(v.string()),
        }),
      ),
    ),
    toolArtifacts: v.optional(
      v.array(
        v.object({
          type: v.string(),
          data: v.any(),
        }),
      ),
    ),
    referencedPolicyIds: v.optional(v.array(v.id("policies"))),
    pendingEmailId: v.optional(v.id("pendingEmails")),
    status: v.optional(v.union(v.literal("processing"), v.literal("error"))),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await findThreadMessageByDedupeKey(
      ctx,
      args.threadId,
      args.dedupeKey,
    );
    if (existing) return existing._id;
    const messageId = await ctx.db.insert("threadMessages", {
      threadId: args.threadId,
      orgId: args.orgId,
      channel: "imessage",
      role: args.role,
      messageKind: args.messageKind ?? "conversation",
      sourceThreadMessageId: args.sourceThreadMessageId,
      dedupeKey: args.dedupeKey,
      userId: args.userId,
      userName: args.userName,
      imessageSenderAddress: args.imessageSenderAddress,
      imessageParticipantLabel: args.imessageParticipantLabel,
      content: args.content,
      routerRequestId: args.routerRequestId,
      messageId: args.messageId,
      responseMessageId: args.responseMessageId,
      attachments: args.attachments,
      usedTools: args.usedTools,
      toolCalls: args.toolCalls,
      toolArtifacts: args.toolArtifacts,
      referencedPolicyIds: args.referencedPolicyIds,
      pendingEmailId: args.pendingEmailId,
      status: args.status,
      error: args.error,
    });
    await ctx.db.patch(args.threadId, { lastMessageAt: dayjs().valueOf() });
    return messageId;
  },
});

function compactAttachmentFailureNotice(
  failures: Array<{ filename: string }>,
): string {
  const names = failures
    .map((failure) => failure.filename.trim())
    .filter(Boolean)
    .slice(0, 3);
  const subject =
    names.length > 0
      ? names.map((name) => `"${name.replace(/"/g, "'")}"`).join(", ")
      : "the attachment";
  return `Attachment delivery update: ${subject} did not attach in iMessage. Say "resend" and I'll attach it again.`;
}

function failureKey(args: { stage: string; filename: string }): string {
  return `${args.stage}:${args.filename.trim().toLowerCase()}`;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function collectAttachmentFailureKeys(toolArtifacts: unknown): Set<string> {
  const keys = new Set<string>();
  if (!Array.isArray(toolArtifacts)) return keys;

  for (const artifact of toolArtifacts) {
    const artifactRecord = objectRecord(artifact);
    if (artifactRecord?.type !== "imessage_attachment_delivery") continue;

    const data = objectRecord(artifactRecord.data);
    const stage = typeof data?.stage === "string" ? data.stage : "";
    const failures = Array.isArray(data?.failures) ? data.failures : [];
    for (const failure of failures) {
      const filename = objectRecord(failure)?.filename;
      if (typeof filename === "string") {
        keys.add(failureKey({ stage, filename }));
      }
    }
  }

  return keys;
}

function normalizeAttachmentFailure(
  failure: ImessageAttachmentDeliveryFailure,
): ImessageAttachmentDeliveryFailure | null {
  const filename = failure.filename.trim();
  if (!filename) return null;
  const error = failure.error?.trim();
  return error ? { filename, error } : { filename };
}

export const recordImessageAttachmentDeliveryFailure = internalMutation({
  args: {
    threadMessageId: v.id("threadMessages"),
    stage: v.union(v.literal("url_resolution"), v.literal("worker_delivery")),
    failures: v.array(
      v.object({
        filename: v.string(),
        error: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.threadMessageId);
    if (
      !message ||
      message.channel !== "imessage" ||
      message.role !== "agent"
    ) {
      return;
    }

    const existingArtifacts = Array.isArray(message.toolArtifacts)
      ? message.toolArtifacts
      : [];
    const existingFailures = collectAttachmentFailureKeys(existingArtifacts);
    const stage = args.stage;

    const newFailures = args.failures.flatMap((failure) => {
      const normalized = normalizeAttachmentFailure(failure);
      if (!normalized) return [];
      return !existingFailures.has(
        failureKey({ stage, filename: normalized.filename }),
      )
        ? [normalized]
        : [];
    });
    if (newFailures.length === 0) return;

    const notice = compactAttachmentFailureNotice(newFailures);
    const content = message.content.includes(notice)
      ? message.content
      : `${message.content.trim()}\n\n${notice}`.trim();

    await ctx.db.patch(args.threadMessageId, {
      content,
      toolArtifacts: [
        ...existingArtifacts,
        {
          type: "imessage_attachment_delivery",
          data: {
            status: "failed",
            stage: args.stage,
            failures: newFailures,
          },
        },
      ],
    });
  },
});

export const findOrCreateForEmail = internalMutation({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    subject: v.string(),
    existingThreadId: v.optional(v.id("threads")),
    mode: v.optional(EMAIL_MODE_VALIDATOR),
    agentDomain: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.existingThreadId) {
      const existing = await ctx.db.get(args.existingThreadId);
      if (existing && existing.orgId === args.orgId) {
        await ctx.db.patch(existing._id, {
          lastMessageAt: dayjs().valueOf(),
          emailMode: existing.emailMode ?? args.mode,
          originChannel: existing.originChannel ?? "email",
        });
        return existing._id;
      }
    }

    const domain = canonicalAgentDomain(args.agentDomain);

    // Look up agent handle for thread email
    const org = await ctx.db.get(args.orgId);
    const threadEmail = createThreadEmail(org?.agentHandle, domain);

    // Create a new thread
    const threadId = await ctx.db.insert("threads", {
      orgId: args.orgId,
      title: args.subject,
      createdBy: args.userId,
      lastMessageAt: dayjs().valueOf(),
      threadEmail,
      originChannel: "email",
      emailMode: args.mode,
    });

    return threadId;
  },
});

function normalizeMessageId(id: string): string {
  return id.replace(/^<|>$/g, "").trim();
}

export const checkDuplicateEmail = internalQuery({
  args: {
    resendEmailId: v.optional(v.string()),
    messageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.resendEmailId) {
      const byResend = await ctx.db
        .query("threadMessages")
        .withIndex("resend", (q) => q.eq("resendEmailId", args.resendEmailId))
        .first();
      if (byResend) return true;
    }
    if (args.messageId) {
      const byMessage = await ctx.db
        .query("threadMessages")
        .withIndex("message", (q) => q.eq("messageId", args.messageId))
        .first();
      if (byMessage) return true;
      const normalized = normalizeMessageId(args.messageId);
      if (normalized !== args.messageId) {
        const byNormalized = await ctx.db
          .query("threadMessages")
          .withIndex("message", (q) => q.eq("messageId", normalized))
          .first();
        if (byNormalized) return true;
      }
    }
    return false;
  },
});

export const findThreadByEmailMessageId = internalQuery({
  args: {
    orgId: v.id("organizations"),
    messageId: v.string(),
  },
  handler: async (ctx, args) => {
    const candidates = [args.messageId, normalizeMessageId(args.messageId)];
    for (const candidate of [...new Set(candidates)]) {
      const inbound = await ctx.db
        .query("threadMessages")
        .withIndex("message", (q) => q.eq("messageId", candidate))
        .first();
      if (inbound && inbound.orgId === args.orgId) {
        return ctx.db.get(inbound.threadId);
      }

      const outbound = await ctx.db
        .query("threadMessages")
        .withIndex("response", (q) => q.eq("responseMessageId", candidate))
        .first();
      if (outbound && outbound.orgId === args.orgId) {
        return ctx.db.get(outbound.threadId);
      }
    }
    return null;
  },
});

export const findEmailMessageByMessageId = internalQuery({
  args: {
    orgId: v.id("organizations"),
    messageId: v.string(),
  },
  handler: async (ctx, args) => {
    const candidates = [args.messageId, normalizeMessageId(args.messageId)];
    for (const candidate of [...new Set(candidates)]) {
      const byMessageId = await ctx.db
        .query("threadMessages")
        .withIndex("message", (q) => q.eq("messageId", candidate))
        .first();
      if (byMessageId && byMessageId.orgId === args.orgId) return byMessageId;

      const byResponseMessageId = await ctx.db
        .query("threadMessages")
        .withIndex("response", (q) => q.eq("responseMessageId", candidate))
        .first();
      if (byResponseMessageId && byResponseMessageId.orgId === args.orgId)
        return byResponseMessageId;
    }
    return null;
  },
});

export const findEmailThreadBySubject = internalQuery({
  args: {
    orgId: v.id("organizations"),
    subject: v.string(),
    fromEmail: v.string(),
  },
  handler: async (ctx, args) => {
    const baseSubject = args.subject
      .replace(/^(\s*(re|fwd?)\s*:\s*)+/i, "")
      .trim()
      .toLowerCase();
    if (!baseSubject) return null;

    const threads = await ctx.db
      .query("threads")
      .withIndex("organization_activity", (q) => q.eq("orgId", args.orgId))
      .order("desc")
      .take(100);

    for (const thread of threads) {
      const threadBaseSubject = thread.title
        .replace(/^(\s*(re|fwd?)\s*:\s*)+/i, "")
        .trim()
        .toLowerCase();
      if (threadBaseSubject !== baseSubject) continue;

      const messages = await ctx.db
        .query("threadMessages")
        .withIndex("thread", (q) => q.eq("threadId", thread._id))
        .take(20);
      if (messages.some((message) => message.fromEmail === args.fromEmail)) {
        return thread;
      }
    }

    return null;
  },
});

export const getEmailHistory = internalQuery({
  args: {
    threadId: v.id("threads"),
    excludeMessageId: v.optional(v.id("threadMessages")),
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("threadMessages")
      .withIndex("thread", (q) => q.eq("threadId", args.threadId))
      .collect();
    return messages
      .filter(
        (message) =>
          message.channel === "email" && message._id !== args.excludeMessageId,
      )
      .sort((a, b) => a._creationTime - b._creationTime);
  },
});

export const insertEmailMessage = internalMutation({
  args: {
    threadId: v.id("threads"),
    orgId: v.id("organizations"),
    role: v.union(v.literal("user"), v.literal("agent"), v.literal("system")),
    messageKind: v.optional(threadMessageKindValidator),
    sourceThreadMessageId: v.optional(v.id("threadMessages")),
    dedupeKey: v.optional(v.string()),
    fromEmail: v.optional(v.string()),
    fromName: v.optional(v.string()),
    toAddresses: v.optional(v.array(v.string())),
    ccAddresses: v.optional(v.array(v.string())),
    bccAddresses: v.optional(v.array(v.string())),
    subject: v.optional(v.string()),
    content: v.string(),
    contentHtml: v.optional(v.string()),
    emailContent: v.optional(emailContentValidator),
    messageId: v.optional(v.string()),
    responseMessageId: v.optional(v.string()),
    attachments: v.optional(
      v.array(
        v.object({
          filename: v.string(),
          contentType: v.string(),
          size: v.number(),
          fileId: v.optional(v.id("_storage")),
          kind: v.optional(pendingEmailAttachmentKindValidator),
        }),
      ),
    ),
    toolArtifacts: v.optional(
      v.array(
        v.object({
          type: v.string(),
          data: v.any(),
        }),
      ),
    ),
    referencedPolicyIds: v.optional(v.array(v.id("policies"))),
    resendEmailId: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("processing"),
        v.literal("error"),
        v.literal("pending_send"),
        v.literal("draft_email"),
        v.literal("cancelled"),
      ),
    ),
    error: v.optional(v.string()),
    pendingEmailId: v.optional(v.id("pendingEmails")),
  },
  handler: async (ctx, args) => {
    const existing = await findThreadMessageByDedupeKey(
      ctx,
      args.threadId,
      args.dedupeKey,
    );
    if (existing) return existing._id;
    const messageDocId = await ctx.db.insert("threadMessages", {
      threadId: args.threadId,
      orgId: args.orgId,
      channel: "email",
      role: args.role,
      messageKind: args.messageKind ?? "conversation",
      sourceThreadMessageId: args.sourceThreadMessageId,
      dedupeKey: args.dedupeKey,
      fromEmail: args.fromEmail,
      fromName: args.fromName,
      toAddresses: args.toAddresses,
      ccAddresses: args.ccAddresses,
      bccAddresses: args.bccAddresses,
      subject: args.subject,
      content: args.content,
      contentHtml: args.contentHtml,
      emailContent: args.emailContent,
      messageId: args.messageId,
      responseMessageId: args.responseMessageId,
      resendEmailId: args.resendEmailId,
      attachments: args.attachments,
      toolArtifacts: args.toolArtifacts,
      referencedPolicyIds: args.referencedPolicyIds,
      status: args.status,
      error: args.error,
      pendingEmailId: args.pendingEmailId,
    });

    // Update the thread's lastMessageAt
    await ctx.db.patch(args.threadId, { lastMessageAt: dayjs().valueOf() });

    return messageDocId;
  },
});

export const updateEmailMessage = internalMutation({
  args: {
    id: v.id("threadMessages"),
    content: v.optional(v.string()),
    toAddresses: v.optional(v.array(v.string())),
    ccAddresses: v.optional(v.array(v.string())),
    bccAddresses: v.optional(v.array(v.string())),
    subject: v.optional(v.string()),
    messageId: v.optional(v.string()),
    responseMessageId: v.optional(v.string()),
    resendEmailId: v.optional(v.string()),
    attachments: v.optional(
      v.array(
        v.object({
          filename: v.string(),
          contentType: v.string(),
          size: v.number(),
          fileId: v.optional(v.id("_storage")),
          kind: v.optional(pendingEmailAttachmentKindValidator),
        }),
      ),
    ),
    referencedPolicyIds: v.optional(v.array(v.id("policies"))),
    pendingEmailId: v.optional(v.id("pendingEmails")),
    status: v.optional(
      v.union(v.literal("draft_email"), v.literal("cancelled")),
    ),
    clearStatus: v.optional(v.boolean()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, clearStatus, ...patch } = args;
    await ctx.db.patch(id, patch);
    if (clearStatus) {
      await ctx.db.patch(id, { status: undefined });
    }
  },
});
