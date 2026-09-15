import type { Doc } from "../_generated/dataModel";

export type SlackBlockActionPayload = {
  type: "block_actions";
  /** Workspace whose installation received the action. */
  teamId: string;
  /** Native workspace of the member who clicked, important in Slack Connect. */
  actorTeamId: string;
  userId: string;
  channelId: string;
  messageTs?: string;
  threadTs?: string;
  actionId: string;
  value: string;
  actionTs?: string;
  triggerId?: string;
};

export type SlackViewSubmissionPayload = {
  type: "view_submission";
  teamId: string;
  actorTeamId: string;
  userId: string;
  callbackId: string;
  privateMetadata: string;
  comment?: string;
};

export type SlackInteractionPayload =
  | SlackBlockActionPayload
  | SlackViewSubmissionPayload;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeInteractionId(value: string): string {
  return value.startsWith("glass_") ? `spot_${value.slice("glass_".length)}` : value;
}

export function isSlackOperatorClassification(
  classification: Doc<"slackActors">["classification"],
): boolean {
  return classification === "spot_operator";
}

export function parseSlackInteraction(rawBody: string): SlackInteractionPayload | null {
  const encoded = new URLSearchParams(rawBody).get("payload");
  if (!encoded) return null;
  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    return null;
  }
  const payload = record(value);
  if (!payload) return null;
  const team = record(payload.team);
  const user = record(payload.user);
  const teamId = text(team?.id) ?? text(user?.team_id);
  const userId = text(user?.id);
  const actorTeamId = text(user?.team_id) ?? teamId;
  if (!teamId || !actorTeamId || !userId) return null;

  if (payload?.type === "view_submission") {
    const view = record(payload.view);
    const state = record(view?.state);
    const values = record(state?.values);
    const callbackIdValue = text(view?.callback_id);
    const privateMetadata = text(view?.private_metadata);
    if (!callbackIdValue || !privateMetadata) return null;
    const callbackId = normalizeInteractionId(callbackIdValue);
    let comment: string | undefined;
    for (const blockValue of Object.values(values ?? {})) {
      const block = record(blockValue);
      if (!block) continue;
      for (const elementValue of Object.values(block)) {
        const element = record(elementValue);
        if (!element) continue;
        const commentActionId = text(element.action_id);
        if (
          !commentActionId ||
          normalizeInteractionId(commentActionId) !== "spot_feedback_comment"
        ) {
          continue;
        }
        comment = text(element.value);
      }
    }
    return {
      type: "view_submission",
      teamId,
      actorTeamId,
      userId,
      callbackId,
      privateMetadata,
      comment,
    };
  }

  if (payload?.type !== "block_actions") return null;
  const channel = record(payload.channel);
  const message = record(payload.message);
  const action = Array.isArray(payload.actions) ? record(payload.actions[0]) : null;
  const channelId = text(channel?.id);
  const messageTs = text(message?.ts);
  const threadTs = text(message?.thread_ts);
  const actionIdValue = text(action?.action_id);
  const valueText = text(action?.value);
  if (!teamId || !actorTeamId || !userId || !channelId || !actionIdValue || !valueText) {
    return null;
  }
  const actionId = normalizeInteractionId(actionIdValue);
  return {
    type: "block_actions",
    teamId,
    actorTeamId,
    userId,
    channelId,
    messageTs,
    threadTs,
    actionId,
    value: valueText,
    actionTs: text(action?.action_ts),
    triggerId: text(payload.trigger_id),
  };
}

export function operatorSlackConfirmationDecision(
  actionId: string,
): "approve" | "reject" | undefined {
  const normalized = normalizeInteractionId(actionId);
  if (normalized === "spot_operator_confirmation_approve") return "approve";
  if (normalized === "spot_operator_confirmation_reject") return "reject";
  return undefined;
}

export function slackActionToken(actionId: string, value: string): {
  token: string;
  value?: string;
} | null {
  if (normalizeInteractionId(actionId).startsWith("spot_response_feedback")) {
    const [rating, token] = value.split(":", 2);
    if ((rating !== "positive" && rating !== "negative") || !token) return null;
    return { token, value: rating };
  }
  return value ? { token: value } : null;
}
