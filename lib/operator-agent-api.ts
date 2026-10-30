import type { OperatorExecutionPlan } from "@/convex/lib/operatorRunPlan";
import { makeFunctionReference } from "convex/server";
import type { Infer } from "convex/values";
import type { operatorEmailContentValidator } from "@/convex/lib/threadMessageValidators";
import type { MessageActivity } from "@/convex/lib/messageActivity";
import type { OperatorToolIntegration } from "@/convex/lib/operatorAgentToolRegistry";
import type { RouterJobFailure } from "@/convex/lib/routerJobFailure";

import type { Id } from "@/convex/_generated/dataModel";
import type { PageContext } from "@/hooks/use-page-context";

export type OperatorPerson = {
  userId: string;
  name: string;
  avatarUrl: string | null;
};

type BackendThread = {
  _id: string;
  channel: "chat" | "slack" | "imessage" | "email" | "mcp";
  title: string;
  initialContext?: PageContext;
  pageContext?: PageContext | null;
  createdAt: number;
  lastMessageAt: number;
  archivedAt?: number;
  /** Present on list results; detail results carry it beside the thread. */
  creator?: OperatorPerson;
};

type BackendMessage = {
  _id: string;
  role: "user" | "agent" | "system";
  channel: "chat" | "slack" | "imessage" | "email" | "mcp";
  content: string;
  presentation?: unknown;
  nextMessageSuggestion?: string;
  usedTools?: string[];
  activity?: MessageActivity;
  executionPlan?: OperatorExecutionPlan;
  failure?: RouterJobFailure;
  error?: string;
  routerRequestId?: string;
  emailContent?: Infer<typeof operatorEmailContentValidator>;
  status?: "processing" | "error" | "cancelled";
  createdAt: number;
  userId?: string;
  userName?: string;
  pageContext?: PageContext;
  rerun?: { runId: string; withErrorContext: boolean };
  replyToMessageId?: string;
  dedupeKey?: string;
  toolCalls?: OperatorAgentToolCall[];
  /** External system each tool reaches (operator registry), by tool name. */
  toolIntegrations?: Record<string, OperatorToolIntegration>;
  attachments?: BackendAttachment[];
};

type OperatorAgentAttachment = {
  fileId: Id<"_storage">;
  filename: string;
  contentType: string;
  size: number;
  uploadIntentId?: Id<"operatorAgentUploadIntents">;
};

type BackendAttachment = OperatorAgentAttachment;

type BackendRun = {
  status:
    | "queued"
    | "running"
    | "waiting_confirmation"
    | "completed"
    | "failed"
    | "cancelled";
};

type BackendConfirmation = {
  approvalMode?: "automatic";
  _id: string;
  promptMessageId: string;
  summary: string;
  toolName: string;
  effect:
    | "read"
    | "reversible_write"
    | "external_send"
    | "access_change"
    | "global_change"
    | "destructive";
  state:
    | "pending"
    | "approved"
    | "cancelled"
    | "expired"
    | "superseded"
    | "unavailable";
  actionable: boolean;
  expiresAt?: number;
  emailDraftId?: string;
};

type ListThreadsArgs = {
  limit?: number;
  view?: "recent" | "mcp" | "archived";
};
type GetThreadArgs = { threadId: string };
type SetThreadArchiveArgs = { threadId: string };
/** Brand of a record a tool call acted on, keyed `kind:id`. */
export type OperatorActivityEntity = {
  name: string;
  website?: string;
  iconUrl?: string;
};
type GetThreadResult = {
  thread: BackendThread;
  entities: Record<string, OperatorActivityEntity>;
  viewerUserId: string;
  creator: OperatorPerson;
  people: OperatorPerson[];
  messages: BackendMessage[];
  activeRun: BackendRun | null;
  confirmations: BackendConfirmation[];
};
type CreateThreadArgs = { initialContext?: PageContext };
type ListIntentsArgs = { pageContext?: PageContext };
type StartIntentArgs = {
  intentId: string;
  suggestionKey?: string;
  pageContext?: PageContext;
  emptyThreadId?: string;
};
type SendMessageArgs = {
  threadId: string;
  content: string;
  pageContext?: PageContext;
  attachments?: BackendAttachment[];
  planMode?: boolean;
};
type OperatorUploadTarget = {
  uploadUrl: string;
  uploadIntentId: Id<"operatorAgentUploadIntents">;
};
type GetAttachmentUrlArgs = { threadId: string; fileId: Id<"_storage"> };
type CancelRunArgs = { threadId: string };
type ConfirmActionArgs = {
  threadId: string;
  confirmationId: string;
  decision: "approve" | "reject";
};
type ConfirmActionResult =
  | { status: "needs_refresh"; runId: string }
  | {
      status: "queued";
      runId: string;
      result: unknown;
      content: string;
    }
  | { status: "expired" | "rejected"; runId: string; content: string }
  | {
      status: "completed" | "failed";
      runId: string;
      result: unknown;
      content: string;
    };

export type OperatorAgentThread = {
  id: string;
  channel: "chat" | "slack" | "imessage" | "email" | "mcp";
  title: string;
  initialContext?: PageContext;
  pageContext?: PageContext | null;
  createdAt: number;
  lastMessageAt: number;
  archivedAt?: number;
  creator?: OperatorPerson;
};

export type OperatorAgentIntent = { id: string; label: string };

export type OperatorAgentConfirmation = {
  approvalMode?: "automatic";
  id: string;
  promptMessageId: string;
  toolName: string;
  title: string;
  destructive: boolean;
  state: BackendConfirmation["state"];
  actionable: boolean;
  /** The agent email draft a `send_email_draft` approval would send. */
  emailDraftId?: string;
};

export type OperatorAgentMessage = {
  id: string;
  role: "user" | "assistant";
  channel: "chat" | "slack" | "imessage" | "email" | "mcp";
  content: string;
  presentation?: unknown;
  nextMessageSuggestion?: string;
  usedTools?: string[];
  activity?: MessageActivity;
  executionPlan?: OperatorExecutionPlan;
  failure?: RouterJobFailure;
  errorCode?: string;
  routerRequestId?: string;
  emailContent?: BackendMessage["emailContent"];
  status?: "processing" | "error" | "cancelled";
  createdAt: number;
  userName?: string;
  /** The operator who wrote a user message, when known. */
  sender?: OperatorPerson;
  pageContext?: PageContext;
  rerun?: { runId: string; withErrorContext: boolean };
  replyToMessageId?: string;
  isDirectToolRequest?: boolean;
  toolCalls?: OperatorAgentToolCall[];
  /** External system each tool reaches (operator registry), by tool name. */
  toolIntegrations?: Record<string, OperatorToolIntegration>;
  attachments?: BackendAttachment[];
};

type OperatorAgentToolCall = {
  name: string;
  toolCallId?: string;
  effect?: BackendConfirmation["effect"];
  input?: string;
  output?: string;
};

export type OperatorAgentThreadDetail = {
  thread: OperatorAgentThread | null;
  entities: Record<string, OperatorActivityEntity>;
  viewerUserId: string | null;
  messages: OperatorAgentMessage[];
  activeRun: boolean;
  confirmations: OperatorAgentConfirmation[];
};

export type OperatorToolPreviewItem = {
  title: string;
  subtitle?: string;
  date?: string;
  website?: string;
};

export const operatorAgentApi = {
  getToolPreview: makeFunctionReference<
    "query",
    { messageId: string; toolCallId: string },
    OperatorToolPreviewItem[] | null
  >("operatorAgent:getToolPreview"),
  listThreads: makeFunctionReference<"query", ListThreadsArgs, BackendThread[]>(
    "operatorAgent:listThreads",
  ),
  getThread: makeFunctionReference<"query", GetThreadArgs, GetThreadResult>(
    "operatorAgent:getThread",
  ),
  createThread: makeFunctionReference<"mutation", CreateThreadArgs, string>(
    "operatorAgent:createThread",
  ),
  listIntents: makeFunctionReference<
    "query",
    ListIntentsArgs,
    OperatorAgentIntent[]
  >("operatorAgent:listIntents"),
  startIntent: makeFunctionReference<
    "mutation",
    StartIntentArgs,
    { threadId: string; messageId: string; runId: string; duplicate: boolean }
  >("operatorAgent:startIntent"),
  archiveThread: makeFunctionReference<
    "mutation",
    SetThreadArchiveArgs,
    { archivedAt: number }
  >("operatorAgent:archiveThread"),
  unarchiveThread: makeFunctionReference<
    "mutation",
    SetThreadArchiveArgs,
    { restored: true }
  >("operatorAgent:unarchiveThread"),
  clearThreadContext: makeFunctionReference<
    "mutation",
    { threadId: string },
    { cleared: true }
  >("operatorAgent:clearThreadContext"),
  generateUploadUrl: makeFunctionReference<
    "mutation",
    Record<string, never>,
    OperatorUploadTarget
  >("operatorAgent:generateUploadUrl"),
  registerUpload: makeFunctionReference<
    "mutation",
    {
      uploadIntentId: Id<"operatorAgentUploadIntents">;
      fileId: Id<"_storage">;
    },
    { registered: true }
  >("operatorAgent:registerUpload"),
  discardUploads: makeFunctionReference<
    "mutation",
    {
      uploads: Array<{
        uploadIntentId: Id<"operatorAgentUploadIntents">;
        fileId?: Id<"_storage">;
      }>;
    },
    { discarded: number }
  >("operatorAgent:discardUploads"),
  getAttachmentUrl: makeFunctionReference<
    "query",
    GetAttachmentUrlArgs,
    string | null
  >("operatorAgent:getAttachmentUrl"),
  sendMessage: makeFunctionReference<
    "mutation",
    SendMessageArgs,
    { threadId: string; messageId: string; runId: string; duplicate: boolean }
  >("operatorAgent:sendMessage"),
  rerunTurn: makeFunctionReference<
    "mutation",
    { runId: string; includeErrorContext: boolean },
    { threadId: string; messageId: string; runId: string; duplicate: boolean }
  >("operatorAgent:rerunTurn"),
  cancelRun: makeFunctionReference<
    "mutation",
    CancelRunArgs,
    { cancelled: boolean }
  >("operatorAgent:cancelRun"),
  confirmAction: makeFunctionReference<
    "mutation",
    ConfirmActionArgs,
    ConfirmActionResult
  >("operatorAgent:confirmAction"),
} as const;

function normalizeThread(
  thread: BackendThread,
  creator = thread.creator,
): OperatorAgentThread {
  return {
    creator,
    id: thread._id,
    channel: thread.channel,
    title: thread.title,
    initialContext: thread.initialContext,
    pageContext: thread.pageContext ?? null,
    createdAt: thread.createdAt,
    lastMessageAt: thread.lastMessageAt,
    archivedAt: thread.archivedAt,
  };
}

function normalizeConfirmation(
  confirmation: BackendConfirmation,
): OperatorAgentConfirmation {
  return {
    id: confirmation._id,
    promptMessageId: confirmation.promptMessageId,
    toolName: confirmation.toolName,
    title: confirmation.summary,
    approvalMode: confirmation.approvalMode,
    destructive: confirmation.effect === "destructive",
    state: confirmation.state,
    actionable: confirmation.actionable,
    emailDraftId: confirmation.emailDraftId,
  };
}

export function normalizeOperatorAgentThreads(
  threads: BackendThread[] | undefined,
): OperatorAgentThread[] {
  return (threads ?? []).map((thread) => normalizeThread(thread));
}

export function normalizeOperatorAgentThread(
  value: GetThreadResult | undefined,
): OperatorAgentThreadDetail {
  if (!value) {
    return {
      thread: null,
      entities: {},
      viewerUserId: null,
      messages: [],
      activeRun: false,
      confirmations: [],
    };
  }
  const people = new Map(value.people.map((person) => [person.userId, person]));
  return {
    thread: normalizeThread(value.thread, value.creator),
    entities: value.entities,
    viewerUserId: value.viewerUserId,
    messages: value.messages.map((message) => ({
      id: message._id,
      role: message.role === "user" ? "user" : "assistant",
      channel: message.channel,
      content: message.content,
      presentation: message.presentation,
      nextMessageSuggestion: message.nextMessageSuggestion,
      usedTools: message.usedTools,
      activity: message.activity,
      executionPlan: message.executionPlan,
      failure: message.failure,
      errorCode:
        message.failure?.code ??
        message.error?.match(
          /\b(router_(?:rejected|unavailable|candidates_exhausted|payload_too_large|budget_exhausted|internal))\b/,
        )?.[1],
      routerRequestId: message.routerRequestId,
      emailContent: message.emailContent,
      status: message.status,
      createdAt: message.createdAt,
      userName: message.userName,
      sender: message.userId ? people.get(message.userId) : undefined,
      pageContext: message.pageContext,
      rerun: message.rerun,
      replyToMessageId: message.replyToMessageId,
      isDirectToolRequest:
        message.role === "user" &&
        Boolean(message.dedupeKey?.startsWith("operator-tool:")),
      toolCalls: message.toolCalls,
      toolIntegrations: message.toolIntegrations,
      attachments: message.attachments,
    })),
    activeRun: value.activeRun !== null,
    confirmations: value.confirmations.map(normalizeConfirmation),
  };
}
