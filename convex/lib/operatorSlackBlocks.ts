import { operatorBatchApprovalDetails } from "../../lib/operator-batch-approval";
import type { Id } from "../_generated/dataModel";
import { slackBlockId as blockId, truncateSlackText as truncate, escapeSlackMrkdwn as escapeMrkdwn, type SlackBlock } from "./slackMessage";

function batchSummarySections(summary: string): SlackBlock[] | null {
  const batch = operatorBatchApprovalDetails(summary);
  if (!batch) return null;
  const chunks: string[] = [];
  for (const line of [batch.header, ...batch.items.map((item) => `- ${item}`)]) {
    let remaining = escapeMrkdwn(line);
    const last = chunks.length - 1;
    if (last >= 0 && chunks[last].length + remaining.length + 1 <= 2_800) {
      chunks[last] += `\n${remaining}`;
      continue;
    }
    while (remaining.length > 2_800) {
      chunks.push(remaining.slice(0, 2_800));
      remaining = remaining.slice(2_800);
    }
    if (remaining) chunks.push(remaining);
  }
  return chunks.map((text) => ({ type: "section", text: { type: "mrkdwn", text } }));
}

export function buildOperatorSlackConfirmationBlocks(args: {
  confirmationId: Id<"operatorAgentConfirmations">;
  summary: string;
  destructive: boolean;
}): SlackBlock[] {
  const summary = truncate(escapeMrkdwn(args.summary.trim()), 2_800);
  const accessibleSummary = truncate(args.summary.trim(), 60);
  const batchSections = batchSummarySections(args.summary);
  return [
    {
      type: "section",
      block_id: blockId("spot-operator-confirmation", args.confirmationId),
      text: {
        type: "mrkdwn",
        text: batchSections ? "*Confirmation required*" : `*Confirmation required*\n${summary}`,
      },
    },
    ...(batchSections ?? []),
    {
      type: "actions",
      block_id: blockId(
        "spot-operator-confirmation-actions",
        args.confirmationId,
      ),
      elements: [
        {
          type: "button",
          action_id: "spot_operator_confirmation_reject",
          value: args.confirmationId,
          text: { type: "plain_text", text: "Cancel" },
          accessibility_label: `Cancel ${accessibleSummary}`,
        },
        {
          type: "button",
          action_id: "spot_operator_confirmation_approve",
          value: args.confirmationId,
          text: { type: "plain_text", text: "Confirm" },
          accessibility_label: `Confirm ${accessibleSummary}`,
          style: args.destructive ? "danger" : "primary",
        },
      ],
    },
  ];
}

export const OPERATOR_SLACK_CONFIRMATION_LABELS = {
  approve: "Confirmed",
  reject: "Cancelled",
  expired: "Confirmation expired",
  inactive: "Confirmation no longer active",
  failed: "Action failed",
  error: "Could not process confirmation",
  superseded: "Confirmation replaced",
  cancelled: "Task cancelled",
} as const;

export type OperatorSlackConfirmationResolution = {
  decision: keyof typeof OPERATOR_SLACK_CONFIRMATION_LABELS;
  error?: string;
};

export function operatorSlackConfirmationText(args: {
  summary: string;
} & OperatorSlackConfirmationResolution): string {
  const guidance = {
    approve: "",
    reject: "",
    expired: "This approval was previously expired. Ask Spot to review the task before requesting a fresh confirmation.",
    superseded: "A newer request replaced this approval. Ask Spot for the current task status in this thread.",
    cancelled: "This task was cancelled. Ask Spot to continue if you still want to proceed.",
    failed: "Ask Spot to review the error and continue the task. Any changed action requires a new confirmation.",
    inactive: "This confirmation is unavailable. Ask Spot to check the current task status in this thread.",
    error: "The outcome could not be determined. Ask Spot to check the current task status before trying again.",
  }[args.decision];
  return [
    `*${OPERATOR_SLACK_CONFIRMATION_LABELS[args.decision]}*`,
    operatorBatchApprovalDetails(args.summary)
      ? escapeMrkdwn(args.summary.trim())
      : truncate(escapeMrkdwn(args.summary.trim()), 1_700),
    args.error?.trim()
      ? `Details: ${truncate(escapeMrkdwn(args.error.trim()), 800)}`
      : "",
    guidance,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildOperatorSlackConfirmationResolvedBlocks(args: {
  summary: string;
} & OperatorSlackConfirmationResolution): SlackBlock[] {
  const batchSections = batchSummarySections(args.summary);
  if (batchSections) {
    return [
      ...batchSections,
      { type: "section", block_id: blockId("spot-operator-confirmation-resolved", args.decision), text: {
        type: "mrkdwn", text: operatorSlackConfirmationText({ ...args, summary: "" }),
      } },
    ];
  }
  return [
    {
      type: "section",
      block_id: blockId("spot-operator-confirmation-resolved", args.decision),
      text: {
        type: "mrkdwn",
        text: operatorSlackConfirmationText(args),
      },
    },
  ];
}
