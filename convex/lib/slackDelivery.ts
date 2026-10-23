import type { SlackSendResult } from "./slackWebApi";

export function assertSlackAttachmentsDelivered(result: SlackSendResult): void {
  if (result.attachmentFailures.length) {
    throw new Error(result.attachmentFailures
      .map(({ filename, error }) => `${filename}: ${error}`).join("; "));
  }
}

export function requireSlackMessageId(
  result: Pick<SlackSendResult, "messageId"> & Partial<Pick<SlackSendResult, "attachmentFailures">>,
): string {
  if (result.attachmentFailures) assertSlackAttachmentsDelivered({ ...result, attachmentFailures: result.attachmentFailures });
  if (!result.messageId) throw new Error("Slack did not return a message timestamp");
  return result.messageId;
}
