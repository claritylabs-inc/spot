import { beforeEach, describe, expect, test, vi } from "vitest";
import { experimental_composeSpec } from "@json-render/core";
import type { ActionCtx } from "../_generated/server";
import { composeChatPresentation } from "./chatPresentationComposer";
import { clRouterDecide } from "./clRouterClient";
import {
  parseChatPresentation,
  type PresentationEvidence,
} from "../../lib/chat-presentation";

vi.mock("./clRouterClient", () => ({ clRouterDecide: vi.fn() }));
vi.mock("@json-render/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@json-render/core")>();
  return {
    ...actual,
    experimental_composeSpec: vi.fn(actual.experimental_composeSpec),
  };
});
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

beforeEach(async () => {
  vi.clearAllMocks();
  const actual =
    await vi.importActual<typeof import("@json-render/core")>(
      "@json-render/core",
    );
  vi.mocked(experimental_composeSpec).mockImplementation(
    actual.experimental_composeSpec,
  );
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
  test.each(["limit", "unavailable"] as const)(
    "discards a valid partial spec when composition stops with %s",
    async (stopReason) => {
      const actual =
        await vi.importActual<typeof import("@json-render/core")>(
          "@json-render/core",
        );
      let suppliedPartialSpec = false;
      vi.mocked(experimental_composeSpec).mockImplementation(
        async function* (options) {
          for await (const event of actual.experimental_composeSpec(options)) {
            if (event.type === "complete") {
              suppliedPartialSpec = Boolean(event.spec);
              yield { ...event, stopReason };
            } else yield event;
          }
        },
      );
      decide.mockImplementation(async (request) => choose(request));
      expect(
        await composeChatPresentation(ctx, {
          evidence,
          sourceRevision: "rev1",
        }),
      ).toBeNull();
      expect(suppliedPartialSpec).toBe(true);
    },
  );

  test("retains record-option references when Jev selects a comparison form", async () => {
    decide.mockImplementation(async (request) => {
      const result = choose(request);
      for (const [key, question] of Object.entries(request.questions)) {
        if (key === "root" || question.type !== "choice") continue;
        const choice =
          Object.entries(question.criteria).find(([, description]) =>
            description.startsWith("Choose two policies"),
          )?.[0] ?? "omit";
        result.answers[key] = {
          type: "choice",
          choice,
          probabilities: Object.fromEntries(
            Object.keys(question.criteria).map((option) => [
              option,
              option === choice ? 1 : 0,
            ]),
          ),
        };
      }
      return result;
    });
    const result = await composeChatPresentation(ctx, {
      sourceRevision: "rev-form",
      evidence: {
        ...evidence,
        prompt: "I need to pick two policies to compare",
        tools: [
          {
            name: "lookup_policy",
            output: [
              { id: "policy1", number: "P-1" },
              { id: "policy2", number: "P-2" },
              { id: "policy3", number: "P-3" },
            ],
          },
        ],
      },
    });
    expect(result).not.toBeNull();
    const form = Object.values(result!.spec.elements).find(
      (element) => element.type === "ClarificationForm",
    );
    if (form?.type !== "ClarificationForm") throw new Error("Form missing");
    expect(form.props.fields).toHaveLength(2);
    const referenceIds = new Set(
      result!.references.map((reference) => reference.id),
    );
    expect(
      form.props.fields.every((field) =>
        field.options?.every((option) => referenceIds.has(option.value)),
      ),
    ).toBe(true);
    expect(result!.references.map((reference) => reference.recordId)).toEqual([
      "policy1",
      "policy2",
      "policy3",
    ]);
    expect(decide).toHaveBeenCalledTimes(1);
  });
  test("keeps a known partial-results notice even when Jev selects only one data candidate", async () => {
    decide.mockImplementation(async (request) => choose(request));
    const result = await composeChatPresentation(ctx, {
      evidence: {
        ...evidence,
        tools: [
          {
            name: "lookup_client_requests",
            output: {
              bounded: true,
              requests: [
                {
                  _id: "request1",
                  title: "Renewal",
                  status: "in_progress",
                  files: [],
                },
              ],
            },
          },
        ],
      },
      sourceRevision: "bounded",
    });
    expect(result).not.toBeNull();
    expect(Object.values(result!.spec.elements)).toContainEqual(
      expect.objectContaining({
        type: "Text",
        props: { text: expect.stringContaining("Partial results shown") },
      }),
    );
    expect(parseChatPresentation(result)).not.toBeNull();
  });
});
