"use node";

import type { StepFailure, InboxRecord } from "./providerOutreachValidators";
import {
  OUTREACH_INBOX_LABEL_NAMES,
  addThreadLabels,
  ensureOutreachInboxLabels,
  isCapturedResourceId,
  isResendInboxError,
} from "./mailboxTransport";

/**
 * Failure text that is safe to store and show: operation, outcome, status and
 * Resend error name only. Provider response bodies and exception messages never
 * leave the outreach and inbox-event modules.
 */
export function sanitizedFailure(error: unknown): StepFailure {
  if (isResendInboxError(error)) {
    return {
      kind: error.outcome,
      ...((error.code === "mailbox_throttled" || error.code === "mailbox_paused") ? {code: error.code} : {}),
      message: `Resend ${error.operation} ${error.outcome}${
        error.status
          ? ` (${error.status}${error.code ? ` ${error.code}` : ""})`
          : error.code
            ? ` (${error.code})`
            : ""
      }`,
      ...(error.retryAfterMs !== undefined
        ? { retryAfterMs: error.retryAfterMs }
        : {}),
    };
  }
  // Unexpected local failure after the lease: the outcome is unknown, so only a
  // same-key retry is allowed.
  return { kind: "unknown", message: "Unexpected delivery error" };
}

export function warn(message: string, error: unknown) {
  console.warn(`[provider-outreach] ${message}`, {
    error: isResendInboxError(error)
      ? `${error.operation}:${error.outcome}:${error.status ?? error.code ?? ""}`
      : error instanceof Error
        ? error.name
        : "error",
  });
}

export type LabelKind = keyof typeof OUTREACH_INBOX_LABEL_NAMES;

/**
 * Best-effort thread label. A failure here is logged and swallowed: labels must
 * never change delivery state, schedule a retry or fail a sent step.
 */
export async function labelThread(
  target: { inboxId: string; labelIds?: InboxRecord["labelIds"] },
  threadId: string,
  kind: LabelKind,
) {
  try {
    if (isCapturedResourceId(target.inboxId) || isCapturedResourceId(threadId))
      return;
    let labelId = target.labelIds?.[kind];
    if (!labelId || isCapturedResourceId(labelId)) {
      const ensured = await ensureOutreachInboxLabels(target.inboxId);
      if (ensured.status !== "ok") return;
      labelId = ensured.data[kind];
    }
    await addThreadLabels(target.inboxId, threadId, [labelId]);
  } catch (error) {
    warn(`could not label thread (${kind})`, error);
  }
}
