// Failure modes: an uncertain-but-needed family left unloaded (a wasted
// expand_tools step), the budget ignored, a retired family name dropped from a
// stored checkpoint or old request, and expand_tools spending a step on tools
// that were already loaded.
import { expect, test } from "vitest";
import {
  composeAgentToolFamilies,
  expandToolsResult,
  withholdExpandToolsOnFirstStep,
} from "./agentToolSelection";
import {
  expandOperatorToolsSpec,
  normalizeOperatorToolFamilies,
  OPERATOR_TOOL_FAMILY_CATALOG,
  type OperatorToolFamily,
} from "./operatorAgentToolRegistry";

test("family selection loads confident families, then uncertain ones within budget", () => {
  const cost: Record<string, number> = { a: 10, b: 50, c: 30, d: 5, e: 5 };
  const probabilities = { a: 0.9, b: 0.65, c: 0.6, d: 0.55, e: 0.4 };
  const select = (budgetTokens: number) =>
    composeAgentToolFamilies(
      ["a", "b", "c", "d", "e"],
      probabilities,
      ["r"],
      0.7,
      {
        loadThreshold: 0.5,
        budgetTokens,
        cost: (families) =>
          families.reduce((sum, f) => sum + (cost[f] ?? 0), 0),
      },
    );
  expect(select(1_000)).toEqual(["r", "a", "b", "c", "d"]);
  // b does not fit; smaller, less likely families still do.
  expect(select(50)).toEqual(["r", "a", "c", "d"]);
  // Confident and required families ignore the budget.
  expect(select(0)).toEqual(["r", "a"]);
  expect(composeAgentToolFamilies(["a", "b"], probabilities, [], 0.7)).toEqual([
    "a",
  ]);
});

test("retired family names map forward and loaded families answer without a step", () => {
  expect(
    normalizeOperatorToolFamilies(["threads", "procurement", "gone", 3]),
  ).toEqual(["operator_conversations", "procurement"]);
  const families = Object.keys(
    OPERATOR_TOOL_FAMILY_CATALOG,
  ) as OperatorToolFamily[];
  const parse = expandOperatorToolsSpec(families).inputSchema;
  expect(parse.parse({ families: ["threads"] }).families).toEqual([
    "operator_conversations",
  ]);
  expect(parse.parse({ tools: "get_team_inbox_thread" })).toEqual({
    families: ["team_inbox"],
    tools: ["get_team_inbox_thread"],
  });

  const toolsFor = (requested: readonly string[]) =>
    requested.flatMap((family) =>
      family === "procurement"
        ? ["get_procurement_request"]
        : ["get_team_inbox_thread"],
    );
  const callable = new Set(["get_procurement_request"]);
  expect(
    expandToolsResult(
      { families: ["procurement"], tools: [] },
      ["procurement"],
      callable,
      toolsFor,
    ),
  ).toMatchObject({
    status: "already_available",
    families: [],
    alreadyLoaded: ["procurement"],
    callableNow: ["get_procurement_request"],
  });
  expect(
    expandToolsResult(
      { families: ["procurement", "team_inbox"], tools: [] },
      ["procurement"],
      callable,
      toolsFor,
    ),
  ).toMatchObject({
    status: "available_next_step",
    families: ["team_inbox"],
    alreadyLoaded: ["procurement"],
    nextStepTools: ["get_team_inbox_thread"],
  });
});

test("a replayed first step never offers fewer tools than its submission", () => {
  for (const submittedFamilies of [[], ["procurement"]]) {
    const submitted = withholdExpandToolsOnFirstStep({
      iteration: 0,
      loadedFamilyCount: submittedFamilies.length,
      replayFallback: false,
    });
    expect(submitted).toBe(submittedFamilies.length > 0);
    // The submission's families are stored when it waits on the router, but
    // an interrupted action can lose them; the replay then loads every family.
    for (const familiesStored of [true, false]) {
      const replayFallback = !(familiesStored && submittedFamilies.length);
      const replayed = withholdExpandToolsOnFirstStep({
        iteration: 0,
        loadedFamilyCount: replayFallback ? 15 : submittedFamilies.length,
        replayFallback,
      });
      if (replayed) expect(submitted).toBe(true);
    }
  }
  expect(
    withholdExpandToolsOnFirstStep({
      iteration: 1,
      loadedFamilyCount: 3,
      replayFallback: false,
    }),
  ).toBe(false);
});
