import type { JSONValue, ModelMessage } from "ai";
import { parseWorkflowOutcome } from "./workflows/types";
import { slackThreadContextText } from "./slackThreadContext";

export type AgentToolSurface = "web" | "email" | "imessage" | "slack" | "mcp";

type AgentHistoryContinuityMode = "thread_long" | "task_scoped";

const AGENT_HISTORY_MAX_USER_TURNS = 24;
const AGENT_HISTORY_MAX_ESTIMATED_TOKENS = 32_000;
export const AGENT_HISTORY_PAGE_SIZE = 64;
export const AGENT_HISTORY_MAX_SCANNED_MESSAGES = 256;
export const THREAD_SUMMARY_MAX_OUTPUT_TOKENS = 1_536;
export const THREAD_SUMMARY_VERSION = 1;

export const AGENT_CHANNEL_HISTORY_POLICY = {
  web: { continuityMode: "thread_long" },
  email: { continuityMode: "thread_long" },
  imessage: { continuityMode: "task_scoped" },
  slack: { continuityMode: "thread_long" },
  mcp: { continuityMode: "thread_long" },
} as const satisfies Record<
  AgentToolSurface,
  {
    continuityMode: AgentHistoryContinuityMode;
  }
>;

type AgentHistoryMessage = {
  _id: string;
  _creationTime: number;
  role: "user" | "agent" | "system";
  messageKind?: "conversation" | "workflow_status" | "channel_sync";
  content: string;
  status?: string;
  userName?: string;
  fromEmail?: string;
  fromName?: string;
  subject?: string;
  responseMessageId?: string;
  attachments?: Array<{ filename: string }>;
  toolArtifacts?: unknown;
  usedTools?: unknown;
};

type PrivateAgentHistoryMetadata = {
  tools: string[];
  workflowOutcomes: JSONValue[];
  attachmentNames: string[];
  attachmentFailures: string[];
};

type SelectedAgentHistory<T extends AgentHistoryMessage> = {
  messages: T[];
  userTurnCount: number;
  estimatedTokenCount: number;
  omittedMessageCount: number;
};

const textEncoder = new TextEncoder();

function estimateAgentHistoryTokens(value: string): number {
  return Math.max(1, Math.ceil(textEncoder.encode(value).byteLength / 3));
}

function isModelHistoryMessage(message: AgentHistoryMessage): boolean {
  if (message.status === "processing" || message.status === "cancelled") {
    return false;
  }
  if (message.role === "system") return false;
  if (
    message.messageKind === "workflow_status" ||
    message.messageKind === "channel_sync" ||
    !message.content.trim()
  ) {
    return false;
  }
  return true;
}

function historyMessageTokenText(message: AgentHistoryMessage): string {
  const attachmentNames = (message.attachments ?? [])
    .map((attachment) => attachment.filename.trim())
    .filter(Boolean)
    .join(", ");
  return [
    message.role,
    message.userName,
    message.fromName,
    message.fromEmail,
    message.subject,
    slackThreadContextText(message.toolArtifacts),
    message.content,
    attachmentNames,
  ]
    .filter(Boolean)
    .join("\n");
}

function messageTokenCost(message: AgentHistoryMessage): number {
  return estimateAgentHistoryTokens(historyMessageTokenText(message)) + 8;
}

/**
 * Select complete user turns from newest to oldest. The active turn is always
 * retained and does not consume the prior-dialogue token budget.
 */
export function selectBoundedAgentHistory<T extends AgentHistoryMessage>(
  input: T[],
  options: {
    currentMessageId?: string;
    taskStartedAt?: number;
    maxUserTurns?: number;
    maxEstimatedTokens?: number;
  } = {},
): SelectedAgentHistory<T> {
  const maxUserTurns = options.maxUserTurns ?? AGENT_HISTORY_MAX_USER_TURNS;
  const maxEstimatedTokens =
    options.maxEstimatedTokens ?? AGENT_HISTORY_MAX_ESTIMATED_TOKENS;
  const filtered = input
    .filter(isModelHistoryMessage)
    .filter(
      (message) =>
        options.taskStartedAt === undefined ||
        message._creationTime >= options.taskStartedAt,
    )
    .sort((left, right) => left._creationTime - right._creationTime);

  const turns: T[][] = [];
  for (const message of filtered) {
    if (message.role === "user") {
      turns.push([message]);
      continue;
    }
    const currentTurn = turns.at(-1);
    if (currentTurn) currentTurn.push(message);
  }

  const currentTurnIndex = options.currentMessageId
    ? turns.findIndex((turn) =>
        turn.some((message) => message._id === options.currentMessageId),
      )
    : -1;
  const selectedIndexes = new Set<number>();
  let estimatedTokenCount = 0;
  let remainingTurns = maxUserTurns;

  if (currentTurnIndex >= 0 && remainingTurns > 0) {
    selectedIndexes.add(currentTurnIndex);
    remainingTurns -= 1;
  }

  for (
    let index = turns.length - 1;
    index >= 0 && remainingTurns > 0;
    index -= 1
  ) {
    if (index === currentTurnIndex) continue;
    const turnCost = turns[index].reduce(
      (total, message) => total + messageTokenCost(message),
      0,
    );
    if (estimatedTokenCount + turnCost > maxEstimatedTokens) break;
    selectedIndexes.add(index);
    estimatedTokenCount += turnCost;
    remainingTurns -= 1;
  }

  const messages = turns.flatMap((turn, index) =>
    selectedIndexes.has(index) ? turn : [],
  );
  return {
    messages,
    userTurnCount: selectedIndexes.size,
    estimatedTokenCount,
    omittedMessageCount: filtered.length - messages.length,
  };
}

export function buildTextModelHistory(
  messages: AgentHistoryMessage[],
  options?: {
    excludeMessageId?: string;
    formatUser?: (message: AgentHistoryMessage) => string;
  },
): ModelMessage[] {
  return messages.flatMap((message): ModelMessage[] => {
    if (message._id === options?.excludeMessageId) return [];
    if (message.role === "user") {
      const content = options?.formatUser
        ? options.formatUser(message)
        : message.userName
          ? `[${message.userName}]: ${message.content}`
          : message.content;
      const slackThreadContext = slackThreadContextText(message.toolArtifacts);
      return [
        ...(slackThreadContext
          ? [{ role: "user" as const, content: slackThreadContext }]
          : []),
        { role: "user", content },
      ];
    }
    if (message.role !== "agent" || !message.content.trim()) return [];
    const privateHistory = buildPrivateAgentHistoryMetadata({
      toolArtifacts: message.toolArtifacts,
      usedTools: message.usedTools,
      attachments: message.attachments,
    });
    return [
      {
        role: "assistant",
        content: message.content,
        ...(privateHistory
          ? { providerOptions: { spot: { privateHistory } } }
          : {}),
      },
    ];
  });
}

export function buildRecentAgentConversationContext(
  messages: AgentHistoryMessage[],
  excludeMessageId?: string,
): string {
  return messages
    .filter((message) => message._id !== excludeMessageId)
    .slice(-12)
    .map((message) => {
      const speaker =
        message.role === "user" ? (message.userName ?? "User") : "Spot";
      return `${speaker}: ${message.content}`;
    })
    .join("\n");
}

export function buildThreadContinuityPrompt(summary?: string): string {
  if (!summary?.trim()) return "";
  return `\n\nCONVERSATION CONTINUITY (internal summary of older messages):\n<conversation_summary>\n${summary.trim()}\n</conversation_summary>\nUse this only to preserve conversational goals, decisions, and unresolved work. It is not authoritative policy evidence. Refresh policy, compliance, mailbox, or company facts through the appropriate tools before relying on them.`;
}

export function buildThreadHistoryToolInstructions(): string {
  return `\n\nOLDER THREAD HISTORY:\n- Recent exact messages and an internal summary are already supplied when available.\n- Use search_thread_history only when the user explicitly refers to older wording, a prior decision, or context that is not present.\n- Use read_thread_attachment only after an older search result identifies the relevant message or file.\n- Never use older history or attachment content to establish policy focus or replace a current policy evidence lookup.`;
}

export function formatMessagesForThreadSummary(
  messages: AgentHistoryMessage[],
): string {
  return messages
    .filter(isModelHistoryMessage)
    .map((message) => {
      const speaker =
        message.role === "user" ? (message.userName ?? "User") : "Spot";
      const files = (message.attachments ?? [])
        .map((attachment) => attachment.filename.trim())
        .filter(Boolean);
      const slackThreadContext = slackThreadContextText(message.toolArtifacts);
      return `${slackThreadContext ? `${slackThreadContext}\n\n` : ""}${speaker}: ${message.content}${
        files.length > 0 ? `\nFiles mentioned: ${files.join(", ")}` : ""
      }`;
    })
    .join("\n\n");
}

export function buildPrivateAgentHistoryMetadata(args: {
  toolArtifacts?: unknown;
  usedTools?: unknown;
  attachments?: unknown;
}): PrivateAgentHistoryMetadata | undefined {
  const workflowOutcomes = Array.isArray(args.toolArtifacts)
    ? args.toolArtifacts.flatMap((artifact) => {
        const record = objectRecord(artifact);
        if (record?.type !== "workflow_outcome") return [];
        const outcome = parseWorkflowOutcome(record.data);
        return outcome && isJsonValue(outcome) ? [outcome] : [];
      })
    : [];
  const metadata = {
    tools: dedupeStrings(stringArray(args.usedTools)),
    workflowOutcomes,
    attachmentNames: dedupeStrings(attachmentNames(args.attachments)),
    attachmentFailures: collectAttachmentFailureNames(args.toolArtifacts),
  };
  return Object.values(metadata).some((values) => values.length > 0)
    ? metadata
    : undefined;
}

const LEGACY_TOOL_ACTIVITY_TRAILER_PATTERN =
  /(?:\r?\n){2}\[tool activity:[^\r\n]*\][ \t]*(?:\r?\n)*$/i;

export function stripInternalAgentActivity(content: string): string {
  if (!LEGACY_TOOL_ACTIVITY_TRAILER_PATTERN.test(content)) return content;
  return content.replace(LEGACY_TOOL_ACTIVITY_TRAILER_PATTERN, "").trimEnd();
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function attachmentNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((attachment) => {
    const record = objectRecord(attachment);
    const filename = record?.filename;
    return typeof filename === "string" && filename.trim()
      ? [filename.trim()]
      : [];
  });
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isJsonValue(value: unknown): value is JSONValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  const record = objectRecord(value);
  return (
    record !== null &&
    Object.values(record).every(
      (item) => item === undefined || isJsonValue(item),
    )
  );
}

function collectAttachmentFailureNames(artifacts: unknown): string[] {
  if (!Array.isArray(artifacts)) return [];
  const names: string[] = [];
  for (const artifact of artifacts) {
    const artifactRecord = objectRecord(artifact);
    if (artifactRecord?.type !== "imessage_attachment_delivery") continue;
    const data = objectRecord(artifactRecord.data);
    if (!data || data.status !== "failed") continue;
    const failures = Array.isArray(data.failures) ? data.failures : [];
    for (const failure of failures) {
      const record = objectRecord(failure);
      const filename = record?.filename;
      if (typeof filename === "string" && filename.trim()) {
        names.push(filename.trim());
      }
    }
  }
  return dedupeStrings(names);
}
