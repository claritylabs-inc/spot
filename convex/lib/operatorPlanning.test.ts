// Failure modes: a confident read paying for a full plan, a costly change
// running without one, and an uncertain answer silently getting nothing.
import { expect, test } from "vitest";
import {
  planningLevelFromAnswers,
  type PlanningAnswers,
} from "./operatorPlanning";

const T = 0.7;
const no = 0.05;
const yes = 0.95;
const answers = (
  overrides: Partial<PlanningAnswers["probabilities"]> = {},
  targetCount: PlanningAnswers["targetCount"] = { score: 0.1, confidence: 0.9 },
): PlanningAnswers => ({
  probabilities: {
    changesRecords: no,
    changesMultipleRecords: no,
    dependentChange: no,
    sendsExternally: no,
    targetNeedsSearch: no,
    ...overrides,
  },
  targetCount,
});
const level = (input: PlanningAnswers) =>
  planningLevelFromAnswers(input, T).level;

test("planning level composes risk answers into none, checklist, or full", () => {
  expect(level(answers())).toBe("none");
  expect(level(answers({ targetNeedsSearch: yes }))).toBe("none");
  expect(level(answers({ changesRecords: yes }))).toBe("none");
  expect(level(answers({ sendsExternally: yes }))).toBe("none");

  expect(level(answers({}, { score: 1, confidence: 0.9 }))).toBe("checklist");
  expect(level(answers({ changesRecords: yes, targetNeedsSearch: yes }))).toBe(
    "checklist",
  );
  expect(level(answers({ sendsExternally: 0.5 }))).toBe("checklist");
  expect(level(answers({ changesRecords: null }))).toBe("checklist");
  expect(level(answers({}, { score: 0.1, confidence: 0.4 }))).toBe("checklist");
  expect(level(answers({}, null))).toBe("checklist");

  expect(level(answers({ changesMultipleRecords: yes }))).toBe("full");
  expect(level(answers({ dependentChange: yes }))).toBe("full");
  expect(level(answers({}, { score: 1.8, confidence: 0.9 }))).toBe("full");
  expect(level(answers({ sendsExternally: yes, changesRecords: yes }))).toBe(
    "full",
  );
  // A confident full trigger wins over an unrelated uncertain answer.
  expect(
    planningLevelFromAnswers(
      answers({ dependentChange: yes, targetNeedsSearch: 0.5 }),
      T,
    ),
  ).toEqual({ level: "full", conclusive: false });
});
