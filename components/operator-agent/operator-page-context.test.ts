import { expect, test } from "vitest";
import { operatorThreadContextHref } from "./operator-page-context";

test("context links reopen the thread on its context page", () => {
  const href = operatorThreadContextHref("chosen-thread", {
    pageType: "procurement_request",
    href: "/operator/clients/first/procurement/request?tab=proposals",
  });
  const destination = new URL(href!, "https://spot.invalid");
  expect(destination.pathname).toBe("/operator/clients/first/procurement/request");
  expect(destination.searchParams.get("tab")).toBe("proposals");
  expect(destination.searchParams.get("agentThread")).toBe("chosen-thread");
});

test("context links stay within supported operator pages", () => {
  for (const href of ["https://example.com", "//example.com", "/operator/../login", "/operator/threads/other", "/operator/unknown"]) {
    expect(operatorThreadContextHref("thread", { pageType: "operator_client", href })).toBeNull();
  }
  expect(operatorThreadContextHref("thread", null)).toBeNull();
});
