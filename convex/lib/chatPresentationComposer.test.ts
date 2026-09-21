import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ActionCtx } from "../_generated/server";
import { composeChatPresentation } from "./chatPresentationComposer";
import { clRouterDecide } from "./clRouterClient";
import {
  parseChatPresentation,
  type PresentationEvidence,
} from "../../lib/chat-presentation";

vi.mock("./clRouterClient", () => ({ clRouterDecide: vi.fn() }));
const decide = vi.mocked(clRouterDecide);
const ctx = { runMutation: vi.fn() } as unknown as ActionCtx;
const evidence: PresentationEvidence = {
  audience: "client",
  prompt: "Compare policies and compliance",
  response: "UNTRUSTED ASSISTANT FACT",
  tools: [
    {
      name: "lookup_policy",
      output: [
        {
          id: "policy1",
          number: "CGL-1",
          carrier: "Carrier",
          expiration: "2027-01-01",
          dataStage: "final",
          internalToken: "SECRET TOKEN",
        },
      ],
    },
    {
      name: "lookup_vendor_compliance",
      output: [
        {
          name: "Vendor",
          checks: [
            { requirementId: "req1", title: "Liability", status: "unverified" },
          ],
        },
      ],
    },
  ],
};
function choose(
  request: Parameters<typeof clRouterDecide>[0],
  selection: "include" | "abstain" | "invalid" = "include",
) {
  return {
    requestId: "decision_1",
    answers: Object.fromEntries(
      Object.entries(request.questions).map(([key, question]) => {
        if (question.type !== "choice")
          throw new Error("Only discrete choice allowed");
        const options = Object.keys(question.criteria);
        const choice =
          selection === "invalid"
            ? "invented"
            : key === "root"
              ? selection === "abstain"
                ? "unavailable"
                : "layout"
              : (options.find((option) => option.startsWith("use:candidate")) ??
                options[0]);
        return [
          key,
          {
            type: "choice",
            choice,
            probabilities: Object.fromEntries(
              options.map((option) => [option, option === choice ? 1 : 0]),
            ),
          },
        ];
      }),
    ),
  } as Awaited<ReturnType<typeof clRouterDecide>>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("bounded router composition", () => {
  test("uses native batched selection and ordering with at most two telemetry-bound decisions", async () => {
    decide.mockImplementation(async (request) => choose(request));
    const result = await composeChatPresentation(ctx, {
      evidence,
      sourceRevision: "rev1",
    });
    expect(result).not.toBeNull();
    expect(parseChatPresentation(result)).toEqual(result);
    expect(result?.sourceRevision).toBe("rev1");
    expect(result?.decisionRequestId).toBe("decision_1");
    expect(decide).toHaveBeenCalledTimes(2);
    expect(
      decide.mock.calls.every(([, options]) => options?.telemetry === ctx),
    ).toBe(true);
    const sent = JSON.stringify(decide.mock.calls);
    expect(sent).not.toMatch(/SECRET TOKEN|UNTRUSTED ASSISTANT FACT/);
    expect(Object.keys(result!.spec.elements).length).toBeLessThanOrEqual(19);
    expect(JSON.stringify(result)).toContain("CGL-1");
  });

  test("abstention and unsupported evidence keep text fallback without business reads", async () => {
    decide.mockImplementation(async (request) => choose(request, "abstain"));
    expect(
      await composeChatPresentation(ctx, { evidence, sourceRevision: "rev1" }),
    ).toBeNull();
    expect(decide).toHaveBeenCalledTimes(1);
    decide.mockClear();
    expect(
      await composeChatPresentation(ctx, {
        evidence: { ...evidence, tools: [] },
        sourceRevision: "rev2",
      }),
    ).toBeNull();
    expect(decide).not.toHaveBeenCalled();
  });

  test.each(["invalid", "unavailable"])(
    "%s router decisions fail to text without exposing payloads",
    async (mode) => {
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
      decide.mockImplementation(async (request) => {
        if (mode === "unavailable") throw new Error("SECRET provider response");
        return choose(request, "invalid");
      });
      expect(
        await composeChatPresentation(ctx, {
          evidence,
          sourceRevision: "rev1",
        }),
      ).toBeNull();
      expect(decide).toHaveBeenCalledTimes(1);
      expect(warning).toHaveBeenCalled();
      expect(JSON.stringify(warning.mock.calls)).not.toContain("SECRET");
      warning.mockRestore();
    },
  );

  test("ordering failure does not persist a partially composed presentation", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    decide
      .mockImplementationOnce(async (request) => choose(request))
      .mockRejectedValueOnce(new Error("Unavailable"));
    expect(
      await composeChatPresentation(ctx, { evidence, sourceRevision: "rev1" }),
    ).toBeNull();
    expect(decide).toHaveBeenCalledTimes(2);
    warning.mockRestore();
  });
});
