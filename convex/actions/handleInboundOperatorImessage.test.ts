/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "../schema";
import { processInbound } from "./handleInboundOperatorImessage";

const modules = import.meta.glob("../**/*.ts");
const processInboundFn = processInbound as any;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("operator iMessage inbound", () => {
  test("returns shared transcription guidance instead of failing the request", async () => {
    const t = convexTest(schema, modules);
    const now = dayjs().valueOf();
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        name: "Terry",
        email: "terry@example.com",
        phone: "+14155550123",
        accountKind: "operator",
      });
      await ctx.db.insert("operatorProfiles", {
        userId,
        email: "terry@example.com",
        role: "operator",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    });
    vi.stubEnv("OPERATOR_IMESSAGE_TERMINAL_ENABLED", "true");
    vi.stubEnv("CL_ROUTER_URL", "http://localhost:4010");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
    vi.stubEnv("SPOT_ENV", "local");
    const fetchMock = vi.fn(async () =>
      Response.json({ error: "transcription unavailable" }, { status: 503 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await t.action(processInboundFn, {
      fromPhone: "+14155550123",
      messageText: "(attachment)",
      sourceMessageId: "voice-note-1",
      attachments: [
        {
          name: "voice-memo.m4a",
          mimeType: "audio/mp4",
          data: Buffer.from("audio").toString("base64"),
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result).toEqual({
      response:
        "I couldn't transcribe that voice memo. Please try sending it again or send the request as text.",
      sendContactCard: false,
    });
    expect(
      await t.run(async (ctx) =>
        Promise.all([
          ctx.db.query("operatorAgentThreads").collect(),
          ctx.db.query("operatorAgentMessages").collect(),
        ]),
      ),
    ).toEqual([[], []]);
  });
});
