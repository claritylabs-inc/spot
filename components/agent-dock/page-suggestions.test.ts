import { expect, test } from "vitest";
import { pageSuggestions } from "./page-suggestions";

test("new chats suggest prompts for the page they start from", () => {
  expect(pageSuggestions({ pageType: "policy", entityId: "p1" })[0]?.label).toBe(
    "Summarize this policy",
  );
  expect(pageSuggestions({ pageType: "certificates" }).length).toBeGreaterThan(0);
  expect(pageSuggestions({ pageType: "unknown" })).toEqual([]);
  expect(pageSuggestions(null)).toEqual([]);
});

test("operator pages get their own suggestions", () => {
  expect(
    pageSuggestions({ pageType: "procurement_request", entityId: "r1" }, "operator")[0]?.label,
  ).toBe("Summarize this request");
  expect(pageSuggestions({ pageType: "procurement_request" })).toEqual([]);
});
