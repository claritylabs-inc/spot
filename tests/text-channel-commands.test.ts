import { describe, expect, it } from "vitest";
import {
  IMESSAGE_LINKED_SENDER_REQUIRED,
  runImessageSlashCommand,
  TEXT_CHANNEL_COMMAND_HELP,
} from "../convex/lib/channelControls";
import type { Id } from "../convex/_generated/dataModel";

const commandCtx = {} as Parameters<typeof runImessageSlashCommand>[0];

async function runCommand(messageText: string, currentSenderIsLinked: boolean) {
  const args: Parameters<typeof runImessageSlashCommand>[1] = {
    messageText,
    userId: "user-1" as Id<"users">,
    threadId: "thread-1" as Id<"threads">,
    currentMessageId: "message-1" as Id<"threadMessages">,
    orgName: "Acme Co",
    userName: "Linked User",
    userEmail: "linked@example.com",
    isGroup: true,
    scopeMode: "client",
    currentSenderIsLinked,
    draftEmails: [
      {
        _id: "draft-1" as Id<"pendingEmails">,
        recipientEmail: "broker@example.com",
        subject: "Sensitive renewal",
        emailBody: "Please review the attached renewal.",
      },
    ],
    pendingEmails: [],
    history: [],
  };
  return runImessageSlashCommand(commandCtx, args);
}

describe("text channel slash commands", () => {
  it("does not let anonymous group participants use tenant-scoped slash commands", async () => {
    await expect(runCommand("/help", false)).resolves.toMatchObject({
      response: TEXT_CHANNEL_COMMAND_HELP,
    });
    await expect(runCommand("/drafts", false)).resolves.toMatchObject({
      response: IMESSAGE_LINKED_SENDER_REQUIRED,
    });
    await expect(runCommand("/whoami", false)).resolves.toMatchObject({
      response: IMESSAGE_LINKED_SENDER_REQUIRED,
    });
  });
});
