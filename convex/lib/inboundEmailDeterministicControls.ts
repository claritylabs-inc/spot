"use node";

import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  resolveChannelEmailControl,
  resolveTextChannelEmailControl,
} from "./channelControls";
import {
  executeEmailCommand,
  type EmailCommandDraft,
} from "./emailCommandExecutor";
import {
  ensureEmailSendAuthorizationDecision,
  type EmailSendAuthorizationSource,
} from "./emailSendAuthorization";

export type InboundEmailDeterministicControlResult = {
  responseBody: string;
};

export type InboundEmailDraftControl = EmailCommandDraft;

/**
 * Email-channel adapter. `orgId` enables the Jev control choice and
 * `sourceMessage` enables the ingest-time send authorization decision; the
 * exact-phrase path works without either.
 */
export async function runInboundEmailDeterministicControls(
  ctx: ActionCtx,
  args: {
    messageText: string;
    draftEmails: InboundEmailDraftControl[];
    maxControlTextLength?: number;
    orgId?: Id<"organizations">;
    sourceMessage?: EmailSendAuthorizationSource;
  },
): Promise<InboundEmailDeterministicControlResult | null> {
  const draftEmails = args.draftEmails;
  const ensureSendDecision = async () =>
    args.sourceMessage
      ? ensureEmailSendAuthorizationDecision(ctx, {
          message: args.sourceMessage,
          pendingDrafts: draftEmails,
        })
      : null;

  if (draftEmails.length === 0) {
    await ensureSendDecision();
    return null;
  }
  const controlArgs = {
    messageText: args.messageText,
    isCancelConfirmationContext: false,
    draftEmailIds: draftEmails.map((draftEmail) => draftEmail._id),
    pendingEmailIds: [],
    allowDraftList: true,
    maxControlTextLength: args.maxControlTextLength ?? 120,
  };
  const command = args.orgId
    ? await resolveChannelEmailControl(ctx, {
        ...controlArgs,
        orgId: args.orgId,
      })
    : resolveTextChannelEmailControl(controlArgs);
  if (
    !command ||
    !["show_draft_emails", "update_single_draft_recipient"].includes(
      command.kind,
    )
  ) {
    await ensureSendDecision();
    return null;
  }

  const result = await executeEmailCommand(ctx, command, {
    draftEmails,
    includeBodyPreview: true,
    continueOnSendFailure: true,
  });
  return { responseBody: result.responseBody };
}
