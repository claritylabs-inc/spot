import { expect, test } from "vitest";
import { filterMcpCatalogForPrincipal } from "./mcpCatalogScope";

const catalog = [
  { name: "lookup_policy", annotations: { readOnlyHint: true } },
  { name: "update_company_wiki", annotations: { readOnlyHint: false } },
  { name: "ambiguous" },
];

test("broker catalog contains no tenant business tools", () => {
  expect(filterMcpCatalogForPrincipal(catalog, "broker", true)).toEqual([]);
});

test("read-only connections omit write and unannotated tools", () => {
  expect(
    filterMcpCatalogForPrincipal(catalog, "client", false).map((t) => t.name),
  ).toEqual(["lookup_policy"]);
});

test("writable connections keep the full catalog", () => {
  expect(filterMcpCatalogForPrincipal(catalog, "operator", true)).toEqual(catalog);
});
