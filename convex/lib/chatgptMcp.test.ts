import { expect, test } from "vitest";
import { buildRoleScopedSpotToolCatalog } from "./chatgptMcp";

const appTools = [
  "open_spot_workspace",
  "open_spot_record",
  "open_spot_file",
  "read_spot_workspace",
];

const tenantTools = [
  { name: "lookup_policy", annotations: { readOnlyHint: true } },
  { name: "update_company_wiki", annotations: { readOnlyHint: false } },
];

test("broker catalog contains workspace entry tools but no tenant business tools", () => {
  const tools = buildRoleScopedSpotToolCatalog(tenantTools, "broker", true);

  expect(tools.map((tool) => tool.name)).toEqual(appTools);
});

test("read-only client catalog omits write tools while retaining read tools", () => {
  const tools = buildRoleScopedSpotToolCatalog(tenantTools, "client", false);

  expect(tools.map((tool) => tool.name)).toEqual([...appTools, "lookup_policy"]);
});

test("operator catalog keeps its role-specific tools", () => {
  const operatorTools = [
    { name: "get_operator_overview", annotations: { readOnlyHint: true } },
    { name: "update_procurement_packet", annotations: { readOnlyHint: false } },
  ];
  const tools = buildRoleScopedSpotToolCatalog(
    operatorTools,
    "operator",
    true,
  );

  expect(tools.map((tool) => tool.name)).toEqual([
    ...appTools,
    "get_operator_overview",
    "update_procurement_packet",
  ]);
});
