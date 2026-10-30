// Failure modes: a provider page prefetching nothing or another record, and
// provider hints missing Do Not Contact or misreporting saved application forms.
import { expect, test } from "vitest";
import { operatorPageContextEntry } from ".";
import { brokerProfileHints } from "./operator";

test("provider pages read the attached provider and list its submission facts", () => {
  for (const pageType of ["operator_broker", "operator_brokers"]) {
    const [[read]] = operatorPageContextEntry(pageType)!.prefetch;
    expect(read.toolName).toBe("get_broker_network_profile");
    expect(read.input({ focus: { entityId: "b1" }, results: new Map() })).toEqual(
      { brokerOrgId: "b1" },
    );
    // The provider list has no entity to read.
    expect(read.input({ focus: {}, results: new Map() })).toBeUndefined();
  }

  expect(
    brokerProfileHints({
      profile: { networkStatus: "blacklisted", isTest: true },
      submissionDefaults: {
        defaults: [
          { coverageCode: "CGL", forms: [{}, {}] },
          { coverageCode: "WORK", forms: [{}] },
          { coverageCode: "AUTO", forms: [] },
        ],
        bounded: true,
      },
    }),
  ).toEqual([
    "Network status: Do Not Contact.",
    "Marked as a test provider.",
    "Submission defaults saved for: CGL (2 application forms), WORK (1 application form), AUTO (0 application forms), and more.",
  ]);
  expect(
    brokerProfileHints({
      profile: { networkStatus: "active" },
      submissionDefaults: { defaults: [], bounded: false },
    }),
  ).toEqual(["No submission defaults saved."]);
  expect(brokerProfileHints(undefined)).toEqual([]);
});
