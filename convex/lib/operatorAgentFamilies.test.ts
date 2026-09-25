import { afterEach, describe, expect, test, vi } from "vitest";
import { selectOperatorToolFamilies } from "../operatorAgentRunner";
import {
  OPERATOR_AGENT_INTENTS,
  operatorAgentIntentFamilies,
} from "./operatorAgentIntentRegistry";
import {
  availableOperatorAgentToolNames,
  expandOperatorToolsSpec,
  OPERATOR_AGENT_TOOL_REGISTRY,
  OPERATOR_TOOL_FAMILIES,
  operatorAgentToolNamesForFamilies,
  operatorToolFamiliesOf,
  type OperatorToolFamily,
} from "./operatorAgentToolRegistry";
import { buildOperatorMcpToolCatalog } from "./operatorMcpToolCatalog";

const { decide } = vi.hoisted(() => ({ decide: vi.fn() }));
vi.mock("./clRouterClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./clRouterClient")>()),
  clRouterDecide: decide,
}));

const allTools = availableOperatorAgentToolNames({
  role: "owner",
  impersonating: false,
  integrations: { google_workspace: true, slack: true, mcp: true, mapbox: true },
});
const allFamilies = Object.keys(OPERATOR_TOOL_FAMILIES) as OperatorToolFamily[];

afterEach(() => {
  decide.mockReset();
  vi.restoreAllMocks();
});

describe("operator capability families", () => {
  test("every non-core tool is tagged and every write belongs to a family", () => {
    const core = [
      "search_organizations",
      "get_organization",
      "get_operator_overview",
    ];
    expect(
      allTools.filter((name) => !OPERATOR_AGENT_TOOL_REGISTRY[name].family),
    ).toEqual(core);
    for (const name of allTools) {
      const spec = OPERATOR_AGENT_TOOL_REGISTRY[name];
      if (core.includes(name)) expect(spec.effect).toBe("read");
      else expect(allFamilies).toContain(spec.family);
    }
    expect(operatorToolFamiliesOf(allTools)).toEqual(allFamilies);
    expect(operatorAgentToolNamesForFamilies(allTools, [])).toEqual(core);
  });

  test("every starter has a direct family mapping and unknown starters use free-form selection", async () => {
    for (const intent of OPERATOR_AGENT_INTENTS) {
      const families = operatorAgentIntentFamilies(intent.id);
      expect(families?.length).toBeGreaterThan(0);
      expect(families?.every((family) => allFamilies.includes(family))).toBe(true);
      const result = await selectOperatorToolFamilies({
        toolNames: allTools,
        required: [],
        intentFamilies: families,
        request: intent.objective,
      });
      expect(result.source).toBe("intent");
      expect(new Set(result.families)).toEqual(new Set(families));
    }
    expect(decide).not.toHaveBeenCalled();
    expect(operatorAgentIntentFamilies("missing")).toBeUndefined();
    expect(operatorAgentIntentFamilies("search_company_email")).toEqual([
      "company_email",
    ]);
    expect(operatorAgentIntentFamilies("prepare_certificate")).toEqual([
      "compliance", "policies",
    ]);
    expect(operatorAgentIntentFamilies("update_client")).toEqual([
      "organizations", "wiki", "web",
    ]);
  });

  test("uses independent Noul probabilities at the inclusive threshold and keeps used families", async () => {
    decide.mockImplementationOnce(async (request) => ({
      answers: Object.fromEntries(
        Object.keys(request.questions).map((family) => [
          family,
          { type: "noul", noul: family === "company_email" ? 0.7 : 0.699 },
        ]),
      ),
    }));
    const result = await selectOperatorToolFamilies({
      toolNames: allTools,
      required: ["policies"],
      request: "Find the broker's latest reply about this policy",
      recentToolActivity: "Tool lookup_policy; output=Acme policy renewal pending",
    });
    expect(result).toEqual({
      families: ["policies", "company_email"],
      source: "jev",
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "operator_agent_families",
        state: expect.objectContaining({
          request: "Find the broker's latest reply about this policy",
          recentToolActivity:
            "Tool lookup_policy; output=Acme policy renewal pending",
        }),
      }),
      expect.anything(),
    );
    const request = decide.mock.calls.at(-1)![0];
    expect(
      Object.values(request.questions).every(
        (question) => (question as { type: string }).type === "noul",
      ),
    ).toBe(true);
    const offered = operatorAgentToolNamesForFamilies(allTools, result.families);
    expect(offered).toContain("import_policy_files");
    expect(offered).not.toContain("create_procurement_request");
  });

  test("decision failure includes every authorized family without bypassing access or integration gates", async () => {
    decide.mockRejectedValueOnce(new Error("mock router unavailable"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const permitted = availableOperatorAgentToolNames({
      role: "operator",
      impersonating: true,
      integrations: {
        google_workspace: false, slack: false, mcp: false, mapbox: false,
      },
    });
    const result = await selectOperatorToolFamilies({
      toolNames: permitted,
      required: ["company_email", "mcp"],
      request: "Investigate",
    });
    expect(result).toEqual({
      families: operatorToolFamiliesOf(permitted),
      source: "fallback",
    });
    const offered = operatorAgentToolNamesForFamilies(permitted, result.families);
    expect(offered).toEqual(permitted);
    expect(offered).not.toContain("search_company_email");
    expect(offered).not.toContain("clear_all_agent_memory");
    expect(offered).not.toContain("call_mcp_tool");
    expect(
      offered.every((name) => OPERATOR_AGENT_TOOL_REGISTRY[name].effect === "read"),
    ).toBe(true);
  });

  test("expansion accepts only authorized family names and never changes the full MCP catalog", () => {
    const spec = expandOperatorToolsSpec(["policies", "wiki"]);
    expect(spec.inputSchema.parse({ families: ["wiki"] })).toEqual({
      families: ["wiki"],
    });
    expect(() => spec.inputSchema.parse({ families: [] })).toThrow();
    expect(() => spec.inputSchema.parse({ families: ["mcp"] })).toThrow();
    expect(() => spec.inputSchema.parse({ families: ["invented"] })).toThrow();
    const catalog = buildOperatorMcpToolCatalog({
      canWrite: true,
      operatorRole: "owner",
    });
    const names = catalog.map(({ name }) => name);
    expect(allTools.every((name) => names.includes(name))).toBe(true);
    expect(names).not.toContain("expand_tools");
  });
});
