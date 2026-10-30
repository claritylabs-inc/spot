// Failure modes: a policy page prefetching another record or the client's
// whole library; status-only reads framed as if coverages were loaded; a
// running or failed extraction reported as final.
import { expect, test } from "vitest";
import { operatorPageContextEntry } from ".";
import { clientPolicyListHints, policyStatusHints } from "./policy";

test("policy pages read the attached record and say what is not loaded", () => {
  const [[status]] = operatorPageContextEntry("policy")!.prefetch;
  expect(status.input({ focus: { entityId: "p1" }, results: new Map() })).toEqual(
    { policyId: "p1" },
  );
  const [[list]] = operatorPageContextEntry("operator_client_policies")!.prefetch;
  expect(list.input({ focus: { entityId: "o1" }, results: new Map() })).toEqual({
    orgId: "o1",
    limit: 25,
    sort: "expiration_asc",
  });
  for (const pageType of ["requirement", "requirement_source", "certificate"])
    expect(operatorPageContextEntry(pageType)!.prefetch).toEqual([]);

  expect(
    policyStatusHints({
      policyId: "p1",
      orgId: "o1",
      pipelineStatus: "complete",
      extractionDataStage: "preview",
      archived: true,
    }),
  ).toEqual([
    "Client organization (orgId for policy tools): o1",
    "Extraction still running (stage preview); fields may be partial.",
    "Archived policy.",
    'Loaded: identity and extraction status only. For coverages, limits, premium or terms call lookup_policy with orgId and policyIds ["p1"]; for exact wording call lookup_policy_section.',
  ]);
  expect(
    policyStatusHints({ pipelineStatus: "error", pipelineError: "Timed out" })[0],
  ).toBe("Extraction failed: Timed out");

  expect(
    clientPolicyListHints({
      policies: [
        { policyNumber: "GL-1", pipelineStatus: "complete" },
        { policyId: "p2", pipelineStatus: "error" },
      ],
      bounded: false,
    }),
  ).toEqual([
    "2 active policies loaded, soonest expiration first; this is every active policy.",
    "Extraction failed: p2",
    "Loaded rows carry identity, term and extraction status only; use lookup_policy for coverages and limits.",
  ]);
});
