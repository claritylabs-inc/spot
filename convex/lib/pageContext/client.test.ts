// Failure modes: the open file read whole (the single-ID form ignores
// maxChars) or not at all, and the archived policies view prefetching only
// active policies.
import { expect, test } from "vitest";
import type { OperatorPrefetchPage } from "../operatorAgentIntentRegistry";
import { clientPoliciesInput, openClientFileInput } from "./client";

const page = (href?: string): OperatorPrefetchPage => ({
  pageType: "operator_client_policies",
  entityId: "o1",
  href,
  related: [],
});

test("client page reads follow the open file and the policies view", () => {
  const state = { focus: { entityId: "o1" }, results: new Map() };
  expect(
    openClientFileInput({
      ...state,
      relatedId: (kind) => (kind === "client_file" ? "f1" : undefined),
    }),
  ).toEqual({ clientFileIds: ["f1"], maxChars: 2_000 });
  expect(openClientFileInput({ ...state, relatedId: () => undefined })).toBeUndefined();

  expect(
    clientPoliciesInput({
      ...state,
      page: page("/operator/clients/o1/policies?view=archived&agentThread=t"),
    }),
  ).toEqual({ orgId: "o1", limit: 25, sort: "expiration_asc", includeArchived: true });
  for (const href of ["/operator/clients/o1/policies", undefined, "::"])
    expect(clientPoliciesInput({ ...state, page: page(href) })).toEqual({
      orgId: "o1",
      limit: 25,
      sort: "expiration_asc",
    });
});
