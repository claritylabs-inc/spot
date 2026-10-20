import { expect, test } from "vitest";
import { intakeBooleanPrefill, mergeIntakePrefills } from "./intakePrefills";
import type { IntakeFollowupQuestion } from "../../lib/intake-followups";
const question: IntakeFollowupQuestion = {
  id: "extra_test",
  section: "additional",
  label: "Does the company haul hazardous materials?",
  kind: "yes_no",
  options: [],
};
// Failure modes: low/invalid confidence, Unknown, invented IDs, wrong controls,
// overwritten human answers/skips, and inferred children of inactive parents.
test("only a supported Yes/No with at least 70% joint confidence can prefill", () => {
  expect(
    intakeBooleanPrefill(question, {
      choice: "No",
      confidence: 0.7,
      probabilities: { No: 0.7 },
    })?.answer,
  ).toBe("No");
  for (const decision of [
    { choice: "No", confidence: 0.69, probabilities: { No: 0.9 } },
    { choice: "Yes", confidence: 0.9, probabilities: { Yes: 0.69 } },
    { choice: "Unknown", confidence: 1, probabilities: { Unknown: 1 } },
    { choice: "No", confidence: NaN, probabilities: { No: 1 } },
  ] as {
    choice: string;
    confidence: number;
    probabilities: Record<string, number>;
  }[])
    expect(intakeBooleanPrefill(question, decision)).toBeUndefined();
});
test("prefills preserve human answers and skips and cannot invent definitions", () => {
  const proposal = {
    questionId: question.id,
    answer: "No" as const,
    confidence: 0.8,
  };
  for (const answer of ["Yes", "I'm not sure"]) {
    const rows = [{ ...question, answer }];
    expect(
      mergeIntakePrefills(rows, [question], [proposal], "context"),
    ).toEqual(rows);
  }
  const skipped = [{ ...question, answer: "", skipped: true }];
  expect(
    mergeIntakePrefills(skipped, [question], [proposal], "context"),
  ).toEqual(skipped);
  expect(mergeIntakePrefills([], [], [proposal], "context")).toEqual([]);
  expect(
    mergeIntakePrefills(
      [],
      [{ ...question, kind: "short_text" }],
      [proposal],
      "context",
    ),
  ).toEqual([]);
  expect(
    mergeIntakePrefills(
      [],
      [question],
      [{ ...proposal, confidence: 0.69 }],
      "context",
    ),
  ).toEqual([]);
  expect(
    mergeIntakePrefills([], [question], [proposal], "context")[0],
  ).toMatchObject({
    answer: "No",
    prefilled: { confidence: 0.8, contextHash: "context" },
  });
});
test("inactive conditional questions cannot receive inferred answers", () => {
  const child = {
    ...question,
    id: "child",
    conditions: [{ questionId: question.id, answer: "Yes" }],
  };
  const rows = mergeIntakePrefills(
    [],
    [question, child],
    [
      { questionId: question.id, answer: "No", confidence: 0.9 },
      { questionId: "child", answer: "Yes", confidence: 0.9 },
    ],
    "context",
  );
  expect(rows.map((row) => row.id)).toEqual([question.id]);
});
