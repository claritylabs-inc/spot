import { beforeEach, expect, test, vi } from "vitest";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { clRouterDecide } from "./clRouterClient";
import { runProfileWebRetrieval } from "./webRetrieval";
import {
  gatherProfileEvidence,
  gatherProfileEvidenceWithTrace,
  selectBrokerAppetiteWithTrace,
} from "./profileResearchOrchestrator";

vi.mock("./clRouterClient", () => ({ clRouterDecide: vi.fn() }));
vi.mock("./webRetrieval", () => ({ runProfileWebRetrieval: vi.fn() }));
const ctx = {} as ActionCtx;
const orgId = "broker" as Id<"organizations">;
const identity = {
  orgId,
  name: "Example Brokerage",
  website: "https://broker.example",
  type: "broker" as const,
};
beforeEach(() => vi.resetAllMocks());

test("Jev selects parallel research, reassesses gaps, and retains successful evidence when another search fails", async () => {
  let active = 0;
  let peak = 0;
  vi.mocked(clRouterDecide).mockImplementation(async (request) => {
    const state = JSON.parse(request.state as string);
    return {
      answers: Object.fromEntries(
        Object.keys(request.questions).map((key) => [
          key,
          {
            type: "noul",
            noul: state.evidence.some(
              (item: { topic: string }) => item.topic === key,
            )
              ? 0.95
              : 0.2,
          },
        ]),
      ),
    } as never;
  });
  vi.mocked(runProfileWebRetrieval).mockImplementation(
    async (_ctx, _org, input) => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      if (input.goal?.includes("dated headcount"))
        throw new Error("Temporary retrieval failure");
      return {
        provider: "parallel",
        attempts: [],
        text: "Verified official evidence",
        sources: [
          { url: "https://broker.example/about" },
          { url: "https://namesake.example/" },
        ],
      };
    },
  );
  const trace = { traceId: "research-lease", channel: "company_research" };
  const result = await gatherProfileEvidenceWithTrace(ctx, identity, trace);
  for (const [request] of vi.mocked(clRouterDecide).mock.calls)
    expect(request.trace).toEqual(trace);
  for (const [, , input] of vi.mocked(runProfileWebRetrieval).mock.calls)
    expect(input.trace).toEqual(trace);
  expect(peak).toBeGreaterThan(1);
  expect(result.unresolvedFields).toEqual(["scale"]);
  expect(result.sourceUrls).toEqual(["https://broker.example/about"]);
  expect(result.evidence.map((item) => item.topic)).toEqual(
    expect.arrayContaining([
      "writingStates",
      "lineOfBusinessCodes",
      "operations",
    ]),
  );
  expect(
    vi.mocked(runProfileWebRetrieval).mock.calls.length,
  ).toBeLessThanOrEqual(12);
});

test("independent state and line probabilities proceed at 0.70", async () => {
  const offered: string[] = [];
  vi.mocked(clRouterDecide).mockImplementation(async (request) => {
    offered.push(...Object.keys(request.questions));
    expect(Object.keys(request.questions).length).toBeLessThanOrEqual(128);
    return {
      answers: Object.fromEntries(
        Object.keys(request.questions).map((key) => [
          key,
          {
            type: "noul",
            noul:
              (
                {
                  state_CA: 0.9,
                  state_NV: 0.71,
                  state_OR: 0.7,
                  state_WY: 0.69,
                  line_CGL: 0.91,
                  line_PROP: 0.8,
                } as Record<string, number>
              )[key] ?? 0.1,
          },
        ]),
      ),
    } as never;
  });
  const trace = { traceId: "research-lease", channel: "company_research" };
  const result = await selectBrokerAppetiteWithTrace(
    ctx,
    orgId,
    identity,
    [
      {
        topic: "appetite",
        text: "Cited insurance evidence",
        urls: ["https://broker.example/products"],
      },
    ],
    trace,
  );
  for (const [request] of vi.mocked(clRouterDecide).mock.calls)
    expect(request.trace).toEqual(trace);
  expect(result.writingStates.map((item) => item.code)).toEqual([
    "CA",
    "NV",
    "OR",
  ]);
  expect(result.lineOfBusinessCodes.map((item) => item.code)).toEqual(
    expect.arrayContaining(["CGL", "PROP"]),
  );
  expect(result.lineOfBusinessCodes).toHaveLength(2);
  expect(offered).toContain("state_WY");
});

test("broader research admits sources Jev verifies at 0.70 and excludes 0.69", async () => {
  vi.mocked(clRouterDecide).mockImplementation(async (request) => {
    if (request.task === "profile_research_sources")
      return {
        answers: {
          source_0: { type: "noul", noul: 0.95 },
          source_1: { type: "noul", noul: 0.69 },
        },
      } as never;
    const state = JSON.parse(request.state as string);
    return {
      answers: Object.fromEntries(
        Object.keys(request.questions).map((key) => [
          key,
          {
            type: "noul",
            noul: key === "scale" && state.evidence.length === 0 ? 0.1 : 0.95,
          },
        ]),
      ),
    } as never;
  });
  vi.mocked(runProfileWebRetrieval).mockImplementation(
    async (_ctx, _org, input) => {
      if (input.allowedDomains) throw new Error("Official website unavailable");
      return {
        provider: "exa",
        attempts: [],
        text: "Registry confirms this company; an unrelated directory describes a namesake.",
        sources: [
          { url: "https://registry.example/company" },
          { url: "https://namesake.example/about" },
        ],
      };
    },
  );
  const result = await gatherProfileEvidence(ctx, identity);
  expect(result.sourceUrls).toEqual(["https://registry.example/company"]);
  expect(result.unresolvedFields).toEqual([]);
});
