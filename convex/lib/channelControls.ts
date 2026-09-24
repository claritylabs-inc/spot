"use node";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { pendingEmailDraftFingerprint } from "./actionConfirmationFingerprint";
import type { AgentScope } from "./agentScope";
import { clRouterDecide } from "./clRouterClient";
import { parseStandaloneEmailAddress } from "./emailAddress";
import type { EmailCommand } from "./emailWorkflow";
import { jevProceeds } from "./jevThreshold";

// ---------------------------------------------------------------------------
// Slash commands (shared by iMessage and web chat)
// ---------------------------------------------------------------------------

export type TextChannelCommandName =
  | "help"
  | "cancel"
  | "reset"
  | "status"
  | "drafts"
  | "send"
  | "discard"
  | "leave"
  | "whoami";

export type TextChannelCommandTarget = "all" | number;

export type ParsedTextChannelCommand =
  | {
      kind: "known";
      name: TextChannelCommandName;
      rawName: string;
      args: string[];
      target?: TextChannelCommandTarget;
    }
  | {
      kind: "unknown";
      rawName: string;
      args: string[];
    };

const COMMAND_ALIASES: Record<string, TextChannelCommandName> = {
  "/cancel": "cancel",
  "/commands": "help",
  "/discard": "discard",
  "/drafts": "drafts",
  "/help": "help",
  "/leave": "leave",
  "/new": "reset",
  "/reset": "reset",
  "/send": "send",
  "/status": "status",
  "/whoami": "whoami",
};

export const TEXT_CHANNEL_COMMAND_HELP = [
  "Commands:",
  "/help, /commands",
  "/status",
  "/drafts",
  "/send 1, /send all",
  "/discard 1, /discard all",
  "/cancel, /reset, /new",
  "/leave, /whoami",
  "",
  "Try /drafts then /send 1.",
].join("\n");

function parseTarget(args: string[]): TextChannelCommandTarget | undefined {
  const first = args[0]?.trim().toLowerCase();
  if (!first) return undefined;
  if (first === "all") return "all";
  if (!/^\d+$/.test(first)) return undefined;
  const value = Number(first);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function parseTextChannelCommand(
  text: string,
): ParsedTextChannelCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;

  const [rawName = "/", ...args] = trimmed.split(/\s+/);
  const name = COMMAND_ALIASES[rawName.toLowerCase()];
  if (!name) {
    return { kind: "unknown", rawName, args };
  }
  return { kind: "known", name, rawName, args, target: parseTarget(args) };
}

export type TaskControlIntent = "cancel_task" | "reset_task";

/** `/cancel`, `/reset`, and `/new` clear the current task on every channel. */
export function parseTaskControlCommand(text: string): TaskControlIntent | null {
  const command = parseTextChannelCommand(text);
  if (command?.kind !== "known" || command.args.length > 0) return null;
  if (command.name === "cancel") return "cancel_task";
  if (command.name === "reset") return "reset_task";
  return null;
}

export function taskControlResponse(intent: TaskControlIntent): string {
  return intent === "reset_task"
    ? "Done - I cleared that task. What would you like to do next?"
    : "Done - I cleared that task.";
}

// ---------------------------------------------------------------------------
// Exact-phrase email controls (zero-latency fast path)
// ---------------------------------------------------------------------------

const CANCEL_REQUESTS = new Set([
  "cancel",
  "cancel it",
  "cancel the email",
  "cancel the draft",
  "do not send",
  "don't send",
]);

const CANCEL_CONFIRMATIONS = new Set([
  "yes",
  "yep",
  "yeah",
  "confirm",
  "confirmed",
  "yes cancel",
  "yes cancel it",
  "please cancel",
  "confirm cancel",
  "cancel it",
  "cancel the email",
  "cancel the draft",
  "do it",
]);

const RESTORE_REQUESTS = new Set([
  "restore",
  "restore it",
  "restore the email",
  "restore the draft",
  "restore draft",
  "uncancel",
  "uncancel it",
  "uncancel email",
  "uncancel the email",
  "un cancel",
  "un cancel it",
  "un cancel email",
  "un cancel the email",
  "undo cancellation",
  "undo cancel",
  "undo the cancellation",
  "undo the cancel",
  "bring it back",
]);

const SHOW_MORE_EMAIL_DRAFT_REQUESTS = new Set([
  "more",
  "show more",
  "show all",
  "list drafts",
  "show drafts",
  "show email drafts",
  "show all drafts",
  "list email drafts",
]);

const CONTEXTUAL_CONFIRMATIONS = new Set(["yes", "confirm", "send", "send it"]);

export function normalizePendingEmailIntentText(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[,;:]+/g, "")
    .replace(/[.!?]+$/, "")
    .split(/\s+/)
    .join(" ");
}

export function isPendingEmailCancelIntent(text: string) {
  return CANCEL_REQUESTS.has(normalizePendingEmailIntentText(text));
}

export function isPendingEmailCancelConfirmation(text: string) {
  return CANCEL_CONFIRMATIONS.has(normalizePendingEmailIntentText(text));
}

export function isPendingEmailRestoreIntent(text: string) {
  return RESTORE_REQUESTS.has(normalizePendingEmailIntentText(text));
}

export function isShowMoreEmailDraftIntent(text: string) {
  return SHOW_MORE_EMAIL_DRAFT_REQUESTS.has(text.trim().toLowerCase());
}

export function isContextualConfirmation(text: string) {
  const normalized = text.trim().toLowerCase().replace(/[.!?]+$/, "").trim();
  return CONTEXTUAL_CONFIRMATIONS.has(normalized);
}

export function pendingEmailCancelConfirmationMessage(
  kind: "draft" | "pending",
  count = 1,
) {
  const target =
    kind === "draft"
      ? count === 1
        ? "the draft email"
        : `${count} draft emails`
      : count === 1
        ? "the pending email"
        : `${count} pending emails`;
  return `Confirm cancellation of ${target} by replying “yes cancel”.`;
}

export type TextChannelEmailControlArgs<EmailId> = {
  messageText: string;
  isCancelConfirmationContext: boolean;
  latestCancelledEmailId?: EmailId;
  draftEmailIds: EmailId[];
  draftApprovalEmailIds?: EmailId[];
  pendingEmailIds: EmailId[];
  allowDraftApproval?: boolean;
  allowDraftList?: boolean;
  maxControlTextLength?: number;
};

export function resolveTextChannelEmailControl<EmailId>(
  args: TextChannelEmailControlArgs<EmailId>,
): EmailCommand<EmailId> | null {
  const text = args.messageText.trim();
  if (text.length >= (args.maxControlTextLength ?? 100)) return null;

  if (args.latestCancelledEmailId && isPendingEmailRestoreIntent(text)) {
    return {
      kind: "restore_cancelled_email",
      emailId: args.latestCancelledEmailId,
    };
  }

  if (args.draftEmailIds.length > 0) {
    const correctedRecipient = parseStandaloneEmailAddress(text);
    if (correctedRecipient && args.draftEmailIds.length === 1) {
      return {
        kind: "update_single_draft_recipient",
        emailId: args.draftEmailIds[0],
        recipientEmail: correctedRecipient,
      };
    }
    if (
      args.isCancelConfirmationContext &&
      isPendingEmailCancelConfirmation(text)
    ) {
      return { kind: "cancel_draft_emails", emailIds: args.draftEmailIds };
    }
    if (isPendingEmailCancelIntent(text)) {
      return {
        kind: "request_draft_cancel_confirmation",
        count: args.draftEmailIds.length,
      };
    }
    if (args.allowDraftList && isShowMoreEmailDraftIntent(text)) {
      return { kind: "show_draft_emails" };
    }
    const draftApprovalEmailIds =
      args.draftApprovalEmailIds ?? args.draftEmailIds;
    if (
      args.allowDraftApproval &&
      draftApprovalEmailIds.length > 0 &&
      isContextualConfirmation(text)
    ) {
      return { kind: "send_draft_emails", emailIds: draftApprovalEmailIds };
    }
  }

  if (args.pendingEmailIds.length > 0) {
    if (
      args.isCancelConfirmationContext &&
      isPendingEmailCancelConfirmation(text)
    ) {
      return { kind: "cancel_pending_emails", emailIds: args.pendingEmailIds };
    }
    if (isPendingEmailCancelIntent(text)) {
      return {
        kind: "request_pending_cancel_confirmation",
        count: args.pendingEmailIds.length,
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Jev email controls (paraphrases the exact sets miss)
// ---------------------------------------------------------------------------

export const TEXT_CHANNEL_EMAIL_CONTROL_TASK = "text_channel_email_control";
const MAX_JEV_CONTROL_TEXT_LENGTH = 200;

export type TextChannelEmailControlChoice =
  | "send"
  | "cancel"
  | "restore"
  | "show_drafts"
  | "none";

export async function decideTextChannelEmailControl(
  ctx: Pick<ActionCtx, "runMutation"> | undefined,
  args: {
    orgId: Id<"organizations">;
    messageText: string;
    draftCount: number;
    pendingCount: number;
    hasCancelledEmail: boolean;
  },
): Promise<TextChannelEmailControlChoice> {
  try {
    const result = await clRouterDecide(
      {
        orgId: String(args.orgId),
        task: TEXT_CHANNEL_EMAIL_CONTROL_TASK,
        state: {
          messageText: args.messageText,
          draftCount: args.draftCount,
          pendingCount: args.pendingCount,
          hasCancelledEmail: args.hasCancelledEmail,
        },
        questions: {
          control: {
            type: "choice",
            instructions:
              "The user has email drafts or pending emails in this conversation. Classify the short message as one of the email controls only when it is clearly a standalone instruction about those emails. Anything else, including questions, edits, new requests, and mixed instructions, is none.",
            criteria: {
              send: "Instructs Spot to send the current draft(s) now",
              cancel:
                "Instructs Spot to cancel, discard, or stop the current draft or pending email",
              restore:
                "Instructs Spot to restore or undo cancelling the most recently cancelled email",
              show_drafts:
                "Asks Spot to show or list the current email drafts",
              none: "Anything else",
            },
          },
        },
      },
      ctx ? { telemetry: ctx } : {},
    );
    const answer = result.answers.control;
    if (
      answer?.type !== "choice" ||
      !jevProceeds(answer.probabilities[answer.choice])
    ) {
      return "none";
    }
    return answer.choice === "send" ||
      answer.choice === "cancel" ||
      answer.choice === "restore" ||
      answer.choice === "show_drafts"
      ? answer.choice
      : "none";
  } catch (error) {
    console.warn("[channelControls] email control decision failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return "none";
  }
}

/**
 * Exact phrases first; otherwise a Jev choice when drafts, pending emails, or
 * a restorable cancelled email exist and the text is short. A Jev `send`
 * still requires the ingest-time send authorization decision.
 */
export async function resolveChannelEmailControl<EmailId>(
  ctx: Pick<ActionCtx, "runMutation"> | undefined,
  args: TextChannelEmailControlArgs<EmailId> & {
    orgId: Id<"organizations">;
    authorizeSend?: () => Promise<boolean>;
  },
): Promise<EmailCommand<EmailId> | null> {
  const exact = resolveTextChannelEmailControl(args);
  if (exact) return exact;

  const text = args.messageText.trim();
  const draftCount = args.draftEmailIds.length;
  const pendingCount = args.pendingEmailIds.length;
  if (
    !text ||
    text.length > MAX_JEV_CONTROL_TEXT_LENGTH ||
    (draftCount === 0 && pendingCount === 0 && !args.latestCancelledEmailId)
  ) {
    return null;
  }

  const choice = await decideTextChannelEmailControl(ctx, {
    orgId: args.orgId,
    messageText: text,
    draftCount,
    pendingCount,
    hasCancelledEmail: Boolean(args.latestCancelledEmailId),
  });
  switch (choice) {
    case "cancel":
      if (draftCount > 0) {
        return { kind: "request_draft_cancel_confirmation", count: draftCount };
      }
      if (pendingCount > 0) {
        return {
          kind: "request_pending_cancel_confirmation",
          count: pendingCount,
        };
      }
      return null;
    case "restore":
      return args.latestCancelledEmailId
        ? { kind: "restore_cancelled_email", emailId: args.latestCancelledEmailId }
        : null;
    case "show_drafts":
      return args.allowDraftList && draftCount > 0
        ? { kind: "show_draft_emails" }
        : null;
    case "send": {
      const draftApprovalEmailIds =
        args.draftApprovalEmailIds ?? args.draftEmailIds;
      if (
        !args.allowDraftApproval ||
        draftApprovalEmailIds.length === 0 ||
        !(await args.authorizeSend?.())
      ) {
        return null;
      }
      return { kind: "send_draft_emails", emailIds: draftApprovalEmailIds };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Pending action confirmations (shared by web chat and iMessage)
// ---------------------------------------------------------------------------

type ConfirmationPayload = Doc<"threadActionConfirmations">["payload"];

export type PendingActionConfirmationResolution =
  | { kind: "none" }
  | { kind: "stale"; outcome: "expired" | "needs_refresh" }
  | { kind: "coi_batch_delivery"; pendingEmailId: Id<"pendingEmails"> }
  | {
      kind: "requirement_import";
      payload: Extract<ConfirmationPayload, { kind: "requirement_import" }>;
    }
  | {
      kind: "email_send";
      command: Extract<EmailCommand, { kind: "send_draft_emails" }>;
      sendConfirmationId: Id<"threadActionConfirmations">;
    }
  | {
      kind: "email_cancel";
      command: Extract<
        EmailCommand,
        { kind: "cancel_draft_emails" | "cancel_pending_emails" }
      >;
    };

export function isConfirmationRequested(
  messageText: string,
  confirmation: Doc<"threadActionConfirmations"> | null,
) {
  return confirmation?.payload.kind === "email_cancel"
    ? isPendingEmailCancelConfirmation(messageText)
    : isContextualConfirmation(messageText);
}

/**
 * Consumes the latest pending confirmation when the message is an exact
 * confirmation phrase from the same user. Confirmations are never inferred.
 */
export async function resolvePendingActionConfirmation(
  ctx: ActionCtx,
  args: {
    messageText: string;
    orgId: Id<"organizations">;
    threadId: Id<"threads">;
    userId: Id<"users">;
    currentMessageId: Id<"threadMessages">;
    draftEmailIds: Id<"pendingEmails">[];
  },
): Promise<{
  confirmation: Doc<"threadActionConfirmations"> | null;
  resolution: PendingActionConfirmationResolution;
}> {
  const confirmation = await ctx.runQuery(
    internal.threadActionConfirmations.latestPendingInternal,
    { threadId: args.threadId },
  );
  if (
    !confirmation ||
    !isConfirmationRequested(args.messageText, confirmation) ||
    confirmation.orgId !== args.orgId ||
    confirmation.actor.kind !== "user" ||
    confirmation.actor.userId !== args.userId ||
    confirmation.payload.kind === "draft_snapshot"
  ) {
    return { confirmation, resolution: { kind: "none" } };
  }

  const outcome = await ctx.runMutation(
    internal.threadActionConfirmations.consumeInternal,
    {
      id: confirmation._id,
      actor: { kind: "user", userId: args.userId },
      currentMessageId: args.currentMessageId,
      requireAdjacentPrompt: true,
    },
  );
  if (outcome !== "completed") {
    return {
      confirmation,
      resolution: {
        kind: "stale",
        outcome: outcome === "expired" ? "expired" : "needs_refresh",
      },
    };
  }

  const payload = confirmation.payload;
  switch (payload.kind) {
    case "coi_batch_delivery":
      return {
        confirmation,
        resolution: {
          kind: "coi_batch_delivery",
          pendingEmailId: payload.pendingEmailId,
        },
      };
    case "requirement_import":
      return {
        confirmation,
        resolution: { kind: "requirement_import", payload },
      };
    case "email_send":
      return {
        confirmation,
        resolution: {
          kind: "email_send",
          command: {
            kind: "send_draft_emails",
            emailIds: payload.pendingEmailIds,
          },
          sendConfirmationId: confirmation._id,
        },
      };
    case "email_cancel": {
      const draftIds = new Set(args.draftEmailIds);
      const emailIds = payload.pendingEmailIds;
      return {
        confirmation,
        resolution: {
          kind: "email_cancel",
          command: emailIds.every((id) => draftIds.has(id))
            ? { kind: "cancel_draft_emails", emailIds }
            : { kind: "cancel_pending_emails", emailIds },
        },
      };
    }
  }
}

export async function emailCancelConfirmationPayload(
  targets: Array<
    Pick<Doc<"pendingEmails">, "_id"> &
      Parameters<typeof pendingEmailDraftFingerprint>[0]
  >,
): Promise<Extract<ConfirmationPayload, { kind: "email_cancel" }>> {
  return {
    kind: "email_cancel",
    pendingEmailIds: targets.map((target) => target._id),
    draftFingerprints: await Promise.all(
      targets.map((target) => pendingEmailDraftFingerprint(target)),
    ),
  };
}

// ---------------------------------------------------------------------------
// iMessage slash commands
// ---------------------------------------------------------------------------

type PendingEmailForCommand = Pick<
  Doc<"pendingEmails">,
  | "_id"
  | "recipientEmail"
  | "subject"
  | "sendBlockedReason"
  | "ccAddresses"
  | "bccAddresses"
  | "emailBody"
  | "attachments"
  | "referencedPolicyIds"
>;

type ImessageCommandHistoryMessage = {
  toolArtifacts?: Array<{ type: string; data: unknown }>;
};

export type ImessageSlashCommandResult = {
  response: string;
  leaveGroup?: boolean;
  draftSnapshot?: {
    pendingEmailIds: Id<"pendingEmails">[];
    draftFingerprints: string[];
  };
};

type KnownTextChannelCommand = Extract<
  ParsedTextChannelCommand,
  { kind: "known" }
>;

export const IMESSAGE_LINKED_SENDER_REQUIRED =
  "Only a linked Spot user in this chat can do that.";

function truncate(text: string | undefined, max: number) {
  const value = (text ?? "").replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}

function plural(count: number, singular: string, pluralText = `${singular}s`) {
  return count === 1 ? `1 ${singular}` : `${count} ${pluralText}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function formatDrafts(
  drafts: PendingEmailForCommand[],
  options?: { showAll?: boolean },
) {
  if (drafts.length === 0) {
    return "No email drafts in this thread.";
  }

  const sample = options?.showAll ? drafts.slice(0, 10) : drafts.slice(0, 3);
  const lines = [
    drafts.length === 1 ? "1 email draft:" : `${drafts.length} email drafts:`,
  ];
  for (const [index, draft] of sample.entries()) {
    lines.push(
      `${index + 1}. ${draft.recipientEmail} - ${truncate(draft.subject, 64) || "(no subject)"}`,
    );
    if (draft.sendBlockedReason) {
      lines.push(
        `   Needs confirmation: ${truncate(draft.sendBlockedReason, 96)}`,
      );
    }
  }
  if (drafts.length > sample.length) {
    lines.push(`${drafts.length - sample.length} more. Use /drafts all.`);
  }
  lines.push("Use /send 1 or /discard 1.");
  return lines.join("\n");
}

function selectedByTarget<T>(
  rows: T[],
  target: TextChannelCommandTarget | undefined,
) {
  if (target === "all") return rows;
  if (typeof target === "number") {
    return rows[target - 1] ? [rows[target - 1]] : [];
  }
  return rows.length === 1 ? rows : [];
}

function targetHelp(command: "/send" | "/discard", count: number) {
  if (count === 0) {
    return command === "/send"
      ? "No email drafts to send."
      : "No draft or pending emails to discard.";
  }
  return count === 1
    ? `Use ${command} 1.`
    : `Use ${command} 1 or ${command} all.`;
}

async function sendDrafts(
  ctx: ActionCtx,
  drafts: PendingEmailForCommand[],
  target: TextChannelCommandTarget | undefined,
  confirmationId: Id<"threadActionConfirmations">,
) {
  const selected = selectedByTarget(drafts, target);
  if (selected.length === 0) return targetHelp("/send", drafts.length);

  let sentCount = 0;
  const failures: string[] = [];
  for (const draft of selected) {
    try {
      await ctx.runAction(internal.actions.sendPendingEmail.sendDraftInternal, {
        id: draft._id,
        authorization: { kind: "confirmation", confirmationId },
      });
      sentCount += 1;
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (failures.length > 0 && sentCount === 0) {
    return `I couldn't send the draft: ${truncate(failures[0], 120)}`;
  }
  if (failures.length > 0) {
    return `Sent ${sentCount}. ${failures.length} failed.`;
  }
  return sentCount === 1
    ? "Sent the draft email."
    : `Sent ${sentCount} draft emails.`;
}

async function discardEmails(
  ctx: ActionCtx,
  emails: PendingEmailForCommand[],
  target: TextChannelCommandTarget | undefined,
) {
  const selected = selectedByTarget(emails, target);
  if (selected.length === 0) return targetHelp("/discard", emails.length);

  let cancelledCount = 0;
  for (const email of selected) {
    const ok = await ctx.runMutation(internal.pendingEmails.cancelInternal, {
      id: email._id,
    });
    if (ok) cancelledCount += 1;
  }

  return cancelledCount === 1
    ? "Discarded 1 email."
    : `Discarded ${cancelledCount} emails.`;
}

function latestWorkflowSummary(history: ImessageCommandHistoryMessage[]) {
  for (const message of [...history].reverse()) {
    for (const artifact of [...(message.toolArtifacts ?? [])].reverse()) {
      if (artifact.type !== "workflow_outcome") continue;
      if (!isRecord(artifact.data)) continue;
      const comms = isRecord(artifact.data.comms)
        ? artifact.data.comms
        : undefined;
      const headline =
        typeof comms?.headline === "string" ? comms.headline : undefined;
      const workflowKind =
        typeof artifact.data.workflowKind === "string"
          ? artifact.data.workflowKind
          : "workflow";
      const status =
        typeof artifact.data.status === "string"
          ? artifact.data.status
          : undefined;
      return (
        headline ?? `${workflowKind.replace(/_/g, " ")} ${status ?? ""}`.trim()
      );
    }
  }
  return null;
}

function statusText(args: {
  drafts: PendingEmailForCommand[];
  pendingEmails: PendingEmailForCommand[];
  history: ImessageCommandHistoryMessage[];
}) {
  const lines: string[] = [];
  if (args.drafts.length > 0) {
    lines.push(`${plural(args.drafts.length, "draft")} ready.`);
  }
  if (args.pendingEmails.length > 0) {
    lines.push(
      `${plural(args.pendingEmails.length, "pending email")} waiting.`,
    );
  }
  const workflow = latestWorkflowSummary(args.history);
  if (workflow) {
    lines.push(`Latest workflow: ${truncate(workflow, 140)}`);
  }
  return lines.length > 0
    ? lines.join("\n")
    : "No active drafts or tracked workflow in this thread.";
}

function whoamiText(args: {
  userName?: string;
  userEmail?: string;
  orgName: string;
  isGroup: boolean;
  scopeMode: AgentScope["mode"];
}) {
  const identity = args.userName || args.userEmail || "your linked Spot user";
  const chatKind = args.isGroup ? "group chat" : "direct chat";
  const scope = "single org";
  return `${identity}. Org: ${args.orgName}. Chat: ${chatKind}. Scope: ${scope}.`;
}

async function consumeDisplayedDraftSnapshot(
  ctx: ActionCtx,
  args: {
    threadId: Id<"threads">;
    currentMessageId: Id<"threadMessages">;
    userId: Id<"users">;
    selectedIds: Id<"pendingEmails">[];
  },
) {
  const confirmation = await ctx.runQuery(
    internal.threadActionConfirmations.latestPendingInternal,
    { threadId: args.threadId },
  );
  const payload = confirmation?.payload;
  if (
    confirmation?.actor.kind !== "user" ||
    confirmation.actor.userId !== args.userId ||
    payload?.kind !== "draft_snapshot" ||
    args.selectedIds.length === 0 ||
    args.selectedIds.some((id) => !payload.pendingEmailIds.includes(id))
  ) {
    return null;
  }
  const outcome = await ctx.runMutation(
    internal.threadActionConfirmations.consumeInternal,
    {
      id: confirmation._id,
      actor: { kind: "user", userId: args.userId },
      currentMessageId: args.currentMessageId,
      requireAdjacentPrompt: true,
    },
  );
  return { confirmationId: confirmation._id, outcome };
}

type ImessageSlashCommandArgs = {
  orgName: string;
  userName?: string;
  userEmail?: string;
  isGroup: boolean;
  scopeMode: AgentScope["mode"];
  draftEmails: PendingEmailForCommand[];
  pendingEmails: PendingEmailForCommand[];
  history: ImessageCommandHistoryMessage[];
  threadId: Id<"threads">;
  currentMessageId: Id<"threadMessages">;
  userId: Id<"users">;
};

async function runKnownCommand(
  ctx: ActionCtx,
  command: KnownTextChannelCommand,
  args: ImessageSlashCommandArgs,
): Promise<ImessageSlashCommandResult> {
  switch (command.name) {
    case "help":
      return { response: TEXT_CHANNEL_COMMAND_HELP };
    case "cancel":
      await ctx.runMutation(internal.agentHistory.resetTask, {
        threadId: args.threadId,
        currentMessageId: args.currentMessageId,
      });
      return { response: taskControlResponse("cancel_task") };
    case "reset":
      await ctx.runMutation(internal.agentHistory.resetTask, {
        threadId: args.threadId,
        currentMessageId: args.currentMessageId,
      });
      return { response: taskControlResponse("reset_task") };
    case "status":
      return {
        response: statusText({
          drafts: args.draftEmails,
          pendingEmails: args.pendingEmails,
          history: args.history,
        }),
      };
    case "drafts":
      return {
        response: formatDrafts(args.draftEmails, {
          showAll: command.args[0]?.toLowerCase() === "all",
        }),
        draftSnapshot:
          args.draftEmails.length > 0
            ? {
                pendingEmailIds: args.draftEmails.map((draft) => draft._id),
                draftFingerprints: await Promise.all(
                  args.draftEmails.map((draft) =>
                    pendingEmailDraftFingerprint(draft),
                  ),
                ),
              }
            : undefined,
      };
    case "send": {
      const selected = selectedByTarget(args.draftEmails, command.target);
      const snapshot = await consumeDisplayedDraftSnapshot(ctx, {
        threadId: args.threadId,
        currentMessageId: args.currentMessageId,
        userId: args.userId,
        selectedIds: selected.map((draft) => draft._id),
      });
      if (!snapshot) {
        return {
          response:
            "Use /drafts immediately before /send so Spot can verify the exact displayed draft snapshot.",
        };
      }
      if (snapshot.outcome !== "completed") {
        return {
          response: `That draft snapshot is ${snapshot.outcome.replace("_", " ")}. Use /drafts and try again.`,
        };
      }
      return {
        response: await sendDrafts(
          ctx,
          args.draftEmails,
          command.target,
          snapshot.confirmationId,
        ),
      };
    }
    case "discard": {
      const selected = selectedByTarget(args.draftEmails, command.target);
      const snapshot = await consumeDisplayedDraftSnapshot(ctx, {
        threadId: args.threadId,
        currentMessageId: args.currentMessageId,
        userId: args.userId,
        selectedIds: selected.map((email) => email._id),
      });
      if (!snapshot) {
        return {
          response:
            "Use /drafts immediately before /discard so Spot can verify the exact displayed draft snapshot.",
        };
      }
      if (snapshot.outcome !== "completed") {
        return {
          response: `That draft snapshot is ${snapshot.outcome.replace("_", " ")}. Use /drafts and try again.`,
        };
      }
      return {
        response: await discardEmails(ctx, args.draftEmails, command.target),
      };
    }
    case "leave":
      return args.isGroup
        ? { response: "Leaving this group chat.", leaveGroup: true }
        : { response: "This is a direct chat, so there is no group to leave." };
    case "whoami":
      return { response: whoamiText(args) };
  }
}

export async function runImessageSlashCommand(
  ctx: ActionCtx,
  args: ImessageSlashCommandArgs & {
    messageText: string;
    currentSenderIsLinked: boolean;
  },
): Promise<ImessageSlashCommandResult | null> {
  const command = parseTextChannelCommand(args.messageText);
  if (!command) return null;

  if (command.kind === "unknown") {
    return {
      response: `Unknown command ${command.rawName}. Send /help for commands.`,
    };
  }

  if (command.name !== "help" && !args.currentSenderIsLinked) {
    return { response: IMESSAGE_LINKED_SENDER_REQUIRED };
  }

  return runKnownCommand(ctx, command, args);
}

// ---------------------------------------------------------------------------
// Slack thread controls (resolve / human handoff)
// ---------------------------------------------------------------------------

export const SLACK_THREAD_CONTROL_TASK = "slack_thread_control";

export type SlackControlIntent = { resolve: boolean; humanRequest: boolean };

/**
 * Jev pair for paraphrased Slack controls. Exact `resolve` / `human` phrases
 * stay on the zero-latency path in `convex/slack.ts`; this only adds coverage
 * for short messages the exact sets miss. Failure means no control.
 */
export async function decideSlackControlIntent(
  ctx: Pick<ActionCtx, "runMutation"> | undefined,
  args: {
    orgId?: Id<"organizations">;
    messageText: string;
    botUserId?: string;
  },
): Promise<SlackControlIntent> {
  const none = { resolve: false, humanRequest: false };
  const text = (
    args.botUserId
      ? args.messageText.replace(new RegExp(`<@${args.botUserId}>`, "gi"), "")
      : args.messageText
  ).trim();
  if (!text || text.length > MAX_JEV_CONTROL_TEXT_LENGTH) return none;
  try {
    const result = await clRouterDecide(
      {
        orgId: args.orgId ? String(args.orgId) : undefined,
        task: SLACK_THREAD_CONTROL_TASK,
        state: { messageText: text },
        questions: {
          resolve: {
            type: "noul",
            instructions:
              "Is this Slack message, on its own, an instruction to mark the current support thread as resolved or closed? Thanks, follow-up questions, and new requests do not qualify.",
            criteria: {
              true: "A standalone instruction to resolve or close the thread",
              false: "Anything else",
            },
          },
          humanRequest: {
            type: "noul",
            instructions:
              "Is this Slack message, on its own, a request to talk to a human, a person, or an operator instead of the assistant?",
            criteria: {
              true: "A standalone request for a human or operator handoff",
              false: "Anything else",
            },
          },
        },
      },
      ctx ? { telemetry: ctx } : {},
    );
    const resolve = result.answers.resolve;
    const humanRequest = result.answers.humanRequest;
    return {
      resolve: resolve?.type === "noul" && jevProceeds(resolve.noul),
      humanRequest:
        humanRequest?.type === "noul" && jevProceeds(humanRequest.noul),
    };
  } catch (error) {
    console.warn("[channelControls] slack control decision failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return none;
  }
}
