/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "../schema";
import { unknownSenderReply } from "../lib/channelStyle";
import { processInbound } from "./handleInboundImessage";

const modules = import.meta.glob("../**/*.ts");
const processInboundFn = processInbound as any;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("handleInboundImessage unknown senders", () => {
  test("a group with no linked participant gets the fixed signup reply and Spot leaves", async () => {
    vi.stubEnv("IMESSAGE_TERMINAL_ENABLED", "true");
    const t = convexTest(schema, modules);

    const result = await t.action(processInboundFn, {
      fromPhone: "+14155550199",
      messageText: "Hey Spot, what can you do for us?",
      chatGuid: "iMessage;+;chat-unknown-group",
      isGroup: true,
      participants: [{ address: "+14155550199" }, { address: "+14155550198" }],
      sourceMessageId: "unknown-group-1",
    });

    expect(result).toMatchObject({
      response: unknownSenderReply(),
      leaveGroup: true,
    });
    expect(result.response).toContain("/signup");
    const persisted = await t.run(async (ctx) => ({
      threads: await ctx.db.query("threads").collect(),
      chats: await ctx.db.query("imessageChats").collect(),
    }));
    expect(persisted.threads).toHaveLength(0);
    expect(persisted.chats).toMatchObject([{ status: "left" }]);
  });

  test("a direct message from an unlinked phone gets the fixed reply and no thread", async () => {
    vi.stubEnv("IMESSAGE_TERMINAL_ENABLED", "true");
    const t = convexTest(schema, modules);

    const result = await t.action(processInboundFn, {
      fromPhone: "+14155550197",
      messageText: "Can you send me a COI?",
      sourceMessageId: "unknown-direct-1",
    });

    expect(result.response).toBe(unknownSenderReply());
    expect(result.leaveGroup).toBe(false);
    const threads = await t.run((ctx) => ctx.db.query("threads").collect());
    expect(threads).toHaveLength(0);
  });
});
