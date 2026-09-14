/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

vi.mock("./lib/agentAttachmentLimits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/agentAttachmentLimits")>()),
  MAX_AGENT_ATTACHMENT_BYTES: 5,
  MAX_AGENT_ATTACHMENT_AGGREGATE_BYTES: 8,
}));

const modules = import.meta.glob("./**/*.ts");

test("resumed Slack downloads enforce actual stored bytes and keep the first download on replay", async () => {
  const t = convexTest(schema, modules);
  const fixture = await t.run(async (ctx) => {
    const firstFileId = await ctx.storage.store(new Blob(["1234"]));
    const secondFileId = await ctx.storage.store(new Blob(["5678"]));
    const thirdFileId = await ctx.storage.store(new Blob(["9"]));
    const eventId = await ctx.db.insert("slackInboundEvents", {
      eventKey: "resumed-files",
      teamId: "T-CLIENT",
      channelId: "C-CLIENT",
      threadTs: "1.1",
      messageTs: "1.1",
      senderUserId: "U-CLIENT",
      content: "files",
      eventType: "message",
      isPrimaryChannel: true,
      status: "processing",
      attemptCount: 2,
      receivedAt: 0,
      scheduledFor: 0,
      updatedAt: 0,
      attachments: [
        {
          providerFileId: "F-1",
          filename: "first.txt",
          contentType: "text/plain",
          fileId: firstFileId,
          size: 0,
        },
        {
          providerFileId: "F-2",
          filename: "second.txt",
          contentType: "text/plain",
        },
        {
          providerFileId: "F-3",
          filename: "third.txt",
          contentType: "text/plain",
          size: 0,
        },
      ],
    });
    return { eventId, firstFileId, secondFileId, thirdFileId };
  });
  await expect(
    t.mutation(internal.slack.attachInboundFile, {
      eventId: fixture.eventId,
      providerFileId: "F-2",
      fileId: fixture.secondFileId,
    }),
  ).resolves.toEqual({ attached: true });
  await expect(
    t.mutation(internal.slack.attachInboundFile, {
      eventId: fixture.eventId,
      providerFileId: "F-2",
      fileId: fixture.thirdFileId,
    }),
  ).resolves.toEqual({ attached: false });
  await expect(
    t.mutation(internal.slack.attachInboundFile, {
      eventId: fixture.eventId,
      providerFileId: "F-3",
      fileId: fixture.thirdFileId,
    }),
  ).rejects.toThrow("aggregate ingestion limit");
  const event = await t.run((ctx) => ctx.db.get(fixture.eventId));
  expect(event?.attachments?.map((file) => file.fileId)).toEqual([
    fixture.firstFileId,
    fixture.secondFileId,
    undefined,
  ]);
  expect(event?.attachments?.[1].size).toBe(4);
});
