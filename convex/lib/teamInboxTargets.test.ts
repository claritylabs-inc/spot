// Failure modes: a same-subject reply missed because of a Re:/Fwd: prefix or
// punctuation, body-only mentions read as targets, Jev asked when the subject
// already decides, and an uncertain or failed decision marking targets.
import { expect, test } from "vitest";
import {
  flagTeamInboxTargets,
  subjectMatch,
  subjectMatchKey,
  type TeamInboxCandidate,
} from "./teamInboxTargets";

const named =
  "Celsius Home Services Inc submission: General liability and tools";
const row = (
  id: string,
  subject: string,
  matchedIn: "subject" | "body" = "subject",
): TeamInboxCandidate => ({
  teamEmailThreadId: id,
  subject,
  subjectMatch: subjectMatch(named, subject),
  matchedIn,
  client: { name: "Celsius Home Services" },
  participants: [],
});

test("subjects match after prefixes, case and punctuation are removed", () => {
  expect(subjectMatchKey("RE: Fwd:  Celsius — Home, Services!")).toBe(
    "celsius home services",
  );
  expect(subjectMatch(named, `Re: FW: ${named.toUpperCase()}`)).toBe("exact");
  expect(subjectMatch(named, "Celsius Home Services Inc submission")).toBe(
    "partial",
  );
  // A query that drops function words still matches the subject exactly.
  expect(
    subjectMatch(
      "Celsius Home Services Inc submission General liability tools",
      "Celsius Home Services Inc submission: General liability and tools",
    ),
  ).toBe("exact");
  expect(subjectMatch(named, "Celsius renewal question")).toBe("none");
  // One shared word is not a partial match.
  expect(subjectMatch("Celsius", "Celsius renewal question")).toBe("none");
});

test("exact subjects are targets without Jev; otherwise Jev decides with fallback", async () => {
  let calls = 0;
  const neverCalled = async () => {
    calls += 1;
    return { answers: {}, requestId: "unused" };
  };
  const exact = await flagTeamInboxTargets(
    named,
    [row("body", "Other", "body"), row("a", `Re: ${named}`), row("b", named)],
    neverCalled,
    0.7,
  );
  expect(calls).toBe(0);
  expect(exact.decision.status).toBe("not_needed");
  expect(exact.rows.map((r) => [r.teamEmailThreadId, r.likelyTarget])).toEqual([
    ["a", true],
    ["b", true],
    ["body", false],
  ]);

  const candidates = [
    row("partial", "Celsius Home Services Inc submission"),
    row("body", "Quote request", "body"),
    row("unsure", "Celsius GL tools", "body"),
  ];
  const decided = await flagTeamInboxTargets(
    named,
    candidates,
    async (request) => {
      expect(Object.keys(request.questions)).toHaveLength(6);
      return {
        requestId: "req_1",
        answers: {
          t1_named: { type: "noul", noul: 0.2 },
          t1_submission: { type: "noul", noul: 0.92 },
          t2_named: { type: "noul", noul: 0.05 },
          t2_submission: { type: "noul", noul: 0.1 },
          t3_named: { type: "noul", noul: 0.55 },
          t3_submission: { type: "noul", noul: 0.4 },
        },
      };
    },
    0.7,
  );
  expect(decided.decision).toMatchObject({
    status: "decided",
    requestId: "req_1",
  });
  expect(
    decided.rows.map((r) => [
      r.teamEmailThreadId,
      r.likelyTarget,
      r.targetProbability,
    ]),
  ).toEqual([
    ["partial", true, 0.92],
    ["body", false, 0.1],
    ["unsure", false, 0.55],
  ]);

  const failed = await flagTeamInboxTargets(
    named,
    candidates,
    async () => {
      throw new Error("router down");
    },
    0.7,
  );
  expect(failed.decision.status).toBe("unavailable");
  expect(failed.rows.every((r) => !r.likelyTarget)).toBe(true);

  // A short topic search is not a named target and never asks Jev.
  await flagTeamInboxTargets(
    "renewal",
    [row("x", "Renewal notes")],
    neverCalled,
    0.7,
  );
  expect(calls).toBe(0);
});
