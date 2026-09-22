import { describe, expect, test } from "vitest";
import { mapSpotCallToClRouterPrimitive } from "./clRouterPrimitive";

describe("mapSpotCallToClRouterPrimitive", () => {
  test("maps chat families to text and keeps tools as a requirement", () => {
    expect(mapSpotCallToClRouterPrimitive({ task: "chat" })).toEqual({
      primitive: "text",
    });
    expect(
      mapSpotCallToClRouterPrimitive({
        task: "email_draft",
        hasTools: true,
      }),
    ).toEqual({ primitive: "text", requirements: { tools: true } });
    expect(
      mapSpotCallToClRouterPrimitive({ taskKind: "inbound_email_reply" }),
    ).toEqual({ primitive: "text" });
  });

  test("maps authenticated agent tool loops to tool_use", () => {
    expect(
      mapSpotCallToClRouterPrimitive({
        task: "chat",
        taskKind: "query_reason",
        hasTools: true,
      }),
    ).toEqual({ primitive: "tool_use" });
    expect(
      mapSpotCallToClRouterPrimitive({
        task: "mailbox_coordinator",
        hasTools: true,
      }),
    ).toEqual({ primitive: "tool_use" });
  });

  test("prefers multimodal when vision and tools are both present", () => {
    expect(
      mapSpotCallToClRouterPrimitive({
        task: "chat",
        taskKind: "query_reason",
        hasTools: true,
        hasVision: true,
      }),
    ).toEqual({ primitive: "multimodal", requirements: { tools: true } });
  });

  test("maps analysis and extraction to reasoning, with structured output and vision extras", () => {
    expect(
      mapSpotCallToClRouterPrimitive({
        task: "analysis",
        hasStructuredOutput: true,
      }),
    ).toEqual({
      primitive: "reasoning",
      requirements: { structuredOutput: true },
    });
    expect(
      mapSpotCallToClRouterPrimitive({
        task: "extraction",
        taskKind: "extraction_focused",
        hasVision: true,
        hasStructuredOutput: true,
      }),
    ).toEqual({
      primitive: "multimodal",
      requirements: { structuredOutput: true },
    });
    expect(
      mapSpotCallToClRouterPrimitive({
        task: "analysis",
        hasVision: true,
        hasStructuredOutput: true,
      }),
    ).toEqual({
      primitive: "reasoning",
      requirements: { vision: true, structuredOutput: true },
    });
  });

  test("maps embeddings and transcription to their dedicated primitives", () => {
    expect(mapSpotCallToClRouterPrimitive({ task: "embeddings" })).toEqual({
      primitive: "embedding",
    });
    expect(
      mapSpotCallToClRouterPrimitive({ task: "voice_transcription" }),
    ).toEqual({ primitive: "transcription" });
  });
});
