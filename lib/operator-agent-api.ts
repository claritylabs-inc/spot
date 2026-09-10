import { makeFunctionReference } from "convex/server";

import type { Id } from "@/convex/_generated/dataModel";
import type { PageContext } from "@/hooks/use-page-context";

type BackendThread = {
  _id: string;
  channel: "chat" | "slack" | "imessage" | "mcp";
  title: string;
  initialContext?: PageContext;
  createdAt: number;
  lastMessageAt: number;
  archivedAt?: number;
};

type BackendMessage = {
  _id: string;
  role: "user" | "agent" | "system";
  channel: "chat" | "slack" | "imessage" | "mcp";
  content: string;
  status?: "processing" | "error" | "cancelled";
  createdAt: number;
  userName?: string;
  attachments?: BackendAttachment[];
};

export type OperatorAgentAttachment = {
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
};

type ListThreadsArgs = { limit?: number; archived?: boolean };
type GetThreadArgs = { threadId: string };
type SetThreadArchiveArgs = { threadId: string };
type GetThreadResult = {
  thread: BackendThread;
  messages: BackendMessage[];
  activeRun: BackendRun | null;
  confirmations: BackendConfirmation[];
};
type CreateThreadArgs = { initialContext?: PageContext };
type ListIntentsArgs = { pageContext?: PageContext };
type StartIntentArgs = {
  intentId: string;
  pageContext?: PageContext;
  emptyThreadId?: string;
};
type SendMessageArgs = {
  threadId: string;
  content: string;
  pageContext?: PageContext;
  attachments?: BackendAttachment[];
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
  channel: "chat" | "slack" | "imessage" | "mcp";
  title: string;
  initialContext?: PageContext;
  createdAt: number;
  lastMessageAt: number;
  archivedAt?: number;
};

export type OperatorAgentIntent = { id: string; label: string };

export type OperatorAgentConfirmation = {
  id: string;
  promptMessageId: string;
  title: string;
  destructive: boolean;
  state: BackendConfirmation["state"];
  actionable: boolean;
};

export type OperatorAgentMessage = {
  id: string;
  role: "user" | "assistant";
  channel: "chat" | "slack" | "imessage" | "mcp";
  content: string;
  status?: "processing" | "error" | "cancelled";
  createdAt: number;
  userName?: string;
  attachments?: BackendAttachment[];
};

export type OperatorAgentThreadDetail = {
  thread: OperatorAgentThread | null;
  messages: OperatorAgentMessage[];
  activeRun: boolean;
  confirmations: OperatorAgentConfirmation[];
};

export const operatorAgentApi = {
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

function normalizeThread(thread: BackendThread): OperatorAgentThread {
  return {
    id: thread._id,
    channel: thread.channel,
    title: thread.title,
    initialContext: thread.initialContext,
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
    title: confirmation.summary,
    destructive: confirmation.effect === "destructive",
    state: confirmation.state,
    actionable: confirmation.actionable,
  };
}

export function normalizeOperatorAgentThreads(
  threads: BackendThread[] | undefined,
): OperatorAgentThread[] {
  return (threads ?? []).map(normalizeThread);
}

export function normalizeOperatorAgentThread(
  value: GetThreadResult | undefined,
): OperatorAgentThreadDetail {
  if (!value) {
    return {
      thread: null,
      messages: [],
      activeRun: false,
      confirmations: [],
    };
  }
  return {
    thread: normalizeThread(value.thread),
    messages: value.messages.map((message) => ({
      id: message._id,
      role: message.role === "user" ? "user" : "assistant",
      channel: message.channel,
      content: message.content,
      status: message.status,
      createdAt: message.createdAt,
      userName: message.userName,
      attachments: message.attachments,
    })),
    activeRun: value.activeRun !== null,
    confirmations: value.confirmations.map(normalizeConfirmation),
  };
}
