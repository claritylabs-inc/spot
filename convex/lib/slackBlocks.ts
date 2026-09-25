import type { Doc, Id } from "../_generated/dataModel";
import { getClientPortalUrl } from "./domains";
import { lobLabel, policyLobCodes } from "./linesOfBusiness";
import { resolvePolicyCarrierDisplay } from "./policyPartyContext";
import { renderSlackMrkdwn } from "./transportRenderers";

export type SlackBlock = Record<string, unknown>;
export type SlackEmailDraftCard = {
  recipientEmail: string;
  subject: string;
  attachmentCount: number;
  reviewUrl: string;
};
type SlackAgentStep = NonNullable<Doc<"threadMessages">["agentSteps"]>[number];
type SlackToolStep = Extract<SlackAgentStep, { type: "tool" }>;

export const SLACK_DEFAULT_PROCESSING_REACTION = "eyes";
export const SLACK_PROCESSING_REACTIONS = [
  SLACK_DEFAULT_PROCESSING_REACTION,
  "mag",
  "thinking_face",
  "page_facing_up",
  "memo",
  "shield",
  "umbrella",
  "email",
  "speech_balloon",
  "wrench",
  "bar_chart",
  "sparkles",
] as const;
export type SlackProcessingReaction =
  (typeof SLACK_PROCESSING_REACTIONS)[number];

const TOOL_LABELS: Record<string, string> = {
  lookup_address: "Validated the address",
  lookup_policy: "Found the policy record",
  lookup_company_context: "Reviewed company context",
  lookup_policy_section: "Reviewed policy sources",
  present_policy_card: "Shared the policy record",
  attach_policy_document: "Attached the policy PDF",
  compare_coverages: "Compared coverages",
  lookup_compliance_requirements: "Checked insurance requirements",
  lookup_connected_vendors: "Checked connected vendors",
  lookup_vendor_policies: "Reviewed vendor policies",
  lookup_vendor_compliance: "Checked vendor compliance",
  send_email: "Prepared the email",
  draft_email: "Prepared the email draft",
  update_email_draft: "Updated the email draft",
  attach_policy_pdf_to_draft: "Attached the policy PDF to the draft",
  attach_file_to_draft: "Attached the file to the draft",
  attach_coi_to_draft: "Attached the certificate to the draft",
  list_email_drafts: "Reviewed email drafts",
  send_email_draft: "Checked email delivery",
  cancel_email_draft: "Cancelled the email draft",
  expand_tools: "Loaded more tools",
  save_note: "Saved the note",
  confirm_policy_fact: "Confirmed policy facts",
  generate_coi: "Generated the certificate",
  request_human_service: "Requested human service",
  coordinate_mailbox_task: "Coordinated the mailbox task",
  web_research: "Researched the web",
  render_email_preview: "Rendered the email preview",
};

function blockId(...parts: Array<string | number>): string {
  return parts
    .join("-")
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .slice(0, 255);
}

function truncate(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
}

function escapeMrkdwn(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatSlackAnswerText(value: string): string {
  return renderSlackMrkdwn(value);
}

export function buildOperatorSlackConfirmationBlocks(args: {
  confirmationId: Id<"operatorAgentConfirmations">;
  summary: string;
  destructive: boolean;
}): SlackBlock[] {
  const summary = truncate(escapeMrkdwn(args.summary.trim()), 2_800);
  const accessibleSummary = truncate(args.summary.trim(), 60);
  return [
    {
      type: "section",
      block_id: blockId("spot-operator-confirmation", args.confirmationId),
      text: {
        type: "mrkdwn",
        text: `*Confirmation required*\n${summary}`,
      },
    },
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
    truncate(escapeMrkdwn(args.summary.trim()), 1_700),
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

function displayDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  return `${match[2]}/${match[3]}/${match[1]}`;
}

function policyTitle(policy: Doc<"policies">): string {
  if (policy.policyNumber?.trim()) return `Policy ${policy.policyNumber.trim()}`;
  const names = policyLobCodes(policy)
    .filter((code) => code !== "UN")
    .slice(0, 2)
    .map(lobLabel);
  return names.join(" · ") || policy.fileName || "Policy details";
}

function policyBody(policy: Doc<"policies">): string {
  const carrier = resolvePolicyCarrierDisplay(policy).carrierDisplayName;
  const lines = policyLobCodes(policy)
    .filter((code) => code !== "UN")
    .slice(0, 2)
    .map(lobLabel)
    .join(", ");
  const term = [displayDate(policy.effectiveDate), displayDate(policy.expirationDate)]
    .filter(Boolean)
    .join(" – ");
  return truncate(
    [policy.insuredName, carrier, lines, term].filter(Boolean).join(" · "),
    200,
  );
}

export function slackPolicyUrl(policyId: Id<"policies">): string {
  return `${getClientPortalUrl()}/policies/${policyId}`;
}

function slackCertificateUrl(
  policyId: Id<"policies"> | undefined,
): string {
  return policyId
    ? `${slackPolicyUrl(policyId)}?tab=certificates`
    : `${getClientPortalUrl()}/certificates`;
}

function certificateAttachments(
  message: Pick<Doc<"threadMessages">, "attachments">,
) {
  return (message.attachments ?? []).filter(
    (attachment) => attachment.kind === "coi",
  );
}

/**
 * Final Slack reply. Uses only long-established Block Kit primitives
 * (section, context, actions) so one shape is accepted for every current
 * case; callers fall back to plaintext when Slack rejects the message.
 */
export function buildSlackFinalBlocks(args: {
  message: Pick<
    Doc<"threadMessages">,
    "_id" | "content" | "agentSteps" | "status" | "attachments"
  >;
  policies: Doc<"policies">[];
  emailDraft?: SlackEmailDraftCard;
  actionToken: string;
  revision: number;
  showHandoff: boolean;
}): SlackBlock[] {
  const completedTools = (args.message.agentSteps ?? [])
    .filter(
      (step): step is SlackToolStep =>
        step.type === "tool" && step.completed === true,
    )
    .slice(-4);
  const blocks: SlackBlock[] = [
    {
      type: "section",
      block_id: blockId("spot-answer", args.message._id, args.revision),
      text: {
        type: "mrkdwn",
        text: truncate(
          formatSlackAnswerText(args.message.content.trim()) ||
            "I couldn't complete that request.",
          3000,
        ),
      },
    },
  ];

  if (completedTools.length) {
    blocks.push({
      type: "context",
      block_id: blockId("spot-trace", args.message._id, args.revision),
      elements: [
        {
          type: "mrkdwn",
          text: truncate(
            `*Work completed:* ${completedTools
              .map((step) => TOOL_LABELS[step.name] ?? "Completed a task")
              .join(" · ")}`,
            2000,
          ),
        },
      ],
    });
  }

  if (args.emailDraft) {
    const attachmentLabel =
      args.emailDraft.attachmentCount > 0
        ? `\n${args.emailDraft.attachmentCount} attachment${args.emailDraft.attachmentCount === 1 ? "" : "s"}`
        : "";
    blocks.push(
      {
        type: "section",
        block_id: blockId("spot-email-draft", args.message._id, args.revision),
        text: {
          type: "mrkdwn",
          text: `*Email draft*\nTo ${escapeMrkdwn(args.emailDraft.recipientEmail)}\n${escapeMrkdwn(args.emailDraft.subject)}${attachmentLabel}`,
        },
      },
      {
        type: "actions",
        block_id: blockId(
          "spot-email-action",
          args.message._id,
          args.revision,
        ),
        elements: [
          {
            type: "button",
            action_id: "spot_open_email_draft",
            value: args.actionToken,
            url: args.emailDraft.reviewUrl,
            text: { type: "plain_text", text: "Review draft" },
            accessibility_label: `Review email draft to ${args.emailDraft.recipientEmail}`,
          },
        ],
      },
    );
  }

  for (const [index, policy] of args.policies.slice(0, 3).entries()) {
    blocks.push(
      {
        type: "section",
        block_id: blockId("spot-policy", policy._id, args.revision, index),
        text: {
          type: "mrkdwn",
          text: `*${escapeMrkdwn(policyTitle(policy))}*\n${escapeMrkdwn(policyBody(policy) || "Open this policy in Spot.")}`,
        },
      },
      {
        type: "actions",
        block_id: blockId("spot-policy-action", policy._id, args.revision, index),
        elements: [
          {
            type: "button",
            action_id: "spot_open_policy",
            value: args.actionToken,
            url: slackPolicyUrl(policy._id),
            text: { type: "plain_text", text: "Open policy" },
            accessibility_label: `Open ${policyTitle(policy)} in Spot`,
          },
        ],
      },
    );
  }

  for (const [index, attachment] of certificateAttachments(args.message)
    .slice(0, 2)
    .entries()) {
    blocks.push({
      type: "section",
      block_id: blockId("spot-certificate", args.message._id, args.revision, index),
      text: {
        type: "mrkdwn",
        text: `*Certificate ready*\n${escapeMrkdwn(truncate(attachment.filename, 200))}\nAttached in this Slack conversation.`,
      },
      accessory: {
        type: "button",
        action_id: "spot_open_certificate",
        value: args.actionToken,
        url: slackCertificateUrl(args.policies[0]?._id),
        text: { type: "plain_text", text: "View certificates" },
        accessibility_label: "Open certificates in Spot",
      },
    });
  }

  const actionElements: SlackBlock[] = [];
  if (args.showHandoff) {
    actionElements.push({
      type: "button",
      action_id: "spot_request_human",
      value: args.actionToken,
      text: { type: "plain_text", text: "Ask a human" },
      accessibility_label: "Request help from a Spot service team member",
    });
  }
  if (actionElements.length) {
    blocks.push({
      type: "actions",
      block_id: blockId("spot-actions", args.message._id, args.revision),
      elements: actionElements,
    });
  }

  return blocks.slice(0, 50);
}
