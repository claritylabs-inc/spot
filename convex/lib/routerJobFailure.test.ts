import { expect, test } from "vitest";
import { parseRouterJobError } from "./routerJobFailure";

test("keeps cl-router's typed failure and its message", () => {
  expect(
    parseRouterJobError({
      code: "router_unavailable",
      message: "The router job could not complete.",
      retryable: true,
      executionStarted: true,
    }),
  ).toEqual({
    error: "The router job could not complete. (router_unavailable)",
    failure: { code: "router_unavailable", retryable: true, executionStarted: true },
  });
});

test("accepts legacy string errors and rejects malformed ones", () => {
  expect(parseRouterJobError("Router unavailable")).toEqual({
    error: "Router unavailable",
  });
  expect(parseRouterJobError({ code: "router_internal" })).toEqual({
    error: "Router job failed",
  });
  expect(parseRouterJobError(undefined)).toEqual({ error: "Router job failed" });
});
