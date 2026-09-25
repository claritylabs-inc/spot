import { afterEach, describe, expect, test, vi } from "vitest";
import {
  activeAgentToolNames,
  agentToolFamiliesOf,
  agentToolSelectionArtifact,
  assembleFamilyGuidance,
  availableAgentToolFamilies,
  expandToolsSpec,
  selectAgentToolFamilies,
} from "./agentToolSelection";

const { decide } = vi.hoisted(() => ({ decide: vi.fn() }));
vi.mock("./clRouterClient", () => ({ clRouterDecide: decide }));

const catalog = {
  policies: {
    description: "Policy evidence",
    tools: ["lookup"],
    guidance: "Read evidence.",
  },
  email: {
    description: "Email drafts",
    tools: ["draft", "send"],
    availabilityTools: ["draft"],
    guidance: "Confirm sends.",
  },
  context: { description: "Context", tools: [], guidance: "Keep context." },
};
const request = {
  task: "test_families",
  state: { message: "Send policy" },
  executionBudgetMs: 20,
};

// Failures: selection grants unregistered tools; low-confidence decisions act;
// expansion/used families disappear; router failure or timeout strands a turn.
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

describe("shared family selection", () => {
  test("availability and active tools are bounded by registered tools", () => {
    expect(availableAgentToolFamilies(catalog, ["lookup", "send"])).toEqual([
      "policies",
      "context",
    ]);
    expect(
      activeAgentToolNames(catalog, ["core", "lookup", "draft"], ["policies"]),
    ).toEqual(["core", "lookup"]);
    expect(agentToolFamiliesOf(catalog, ["lookup", "missing"])).toEqual([
      "policies",
    ]);
    expect(assembleFamilyGuidance(catalog, ["email"])).toEqual([
      "Confirm sends.",
    ]);
  });

  test("one decision includes candidates and extra questions at the shared inclusive threshold", async () => {
    decide.mockResolvedValue({
      requestId: "decision",
      answers: {
        policies: { type: "noul", noul: 0.7 },
        email: { type: "noul", noul: 0.699 },
        context: { type: "noul", noul: 0.1 },
        depth: { type: "choice", choice: "brief" },
      },
    });
    const result = await selectAgentToolFamilies({
      catalog,
      toolNames: ["lookup", "draft"],
      request,
      extraQuestions: {
        depth: {
          type: "choice",
          instructions: "Depth?",
          criteria: { brief: "Brief" },
        },
      },
    });
    expect(result.families).toEqual(["policies"]);
    expect(decide).toHaveBeenCalledOnce();
    expect(Object.keys(decide.mock.calls[0][0].questions)).toEqual([
      "policies",
      "email",
      "context",
      "depth",
    ]);
    expect(result.answers?.depth).toEqual({ type: "choice", choice: "brief" });
    expect(agentToolSelectionArtifact(result).data).toMatchObject({
      families: ["policies"],
      requestId: "decision",
      source: "jev",
    });
    vi.stubEnv("JEV_PROCEED_THRESHOLD", "0.8");
    expect(
      (
        await selectAgentToolFamilies({
          catalog,
          toolNames: ["lookup", "draft"],
          request,
        })
      ).families,
    ).toEqual([]);
  });

  test("required families survive decisions and shortcuts without granting unavailable families", async () => {
    decide.mockResolvedValue({ answers: {} });
    const result = await selectAgentToolFamilies({
      catalog,
      toolNames: ["lookup"],
      required: ["policies", "email"],
      request,
    });
    expect(result.families).toEqual(["policies"]);
    expect(decide.mock.calls[0][0].questions).not.toHaveProperty("policies");
    expect(
      (
        await selectAgentToolFamilies({
          catalog,
          toolNames: ["lookup"],
          intentFamilies: ["context"],
          required: ["policies"],
          request,
        })
      ).families,
    ).toEqual(["policies", "context"]);
    expect(
      (
        await selectAgentToolFamilies({
          catalog,
          toolNames: ["lookup"],
          resumed: true,
          request,
        })
      ).source,
    ).toBe("resume");
    expect(decide).toHaveBeenCalledOnce();
  });

  test("decision rejection and a stalled router fall back to all available families", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    decide.mockRejectedValueOnce(new Error("router unavailable"));
    expect(
      (
        await selectAgentToolFamilies({
          catalog,
          toolNames: ["lookup"],
          request,
        })
      ).families,
    ).toEqual(["policies", "context"]);
    decide.mockImplementationOnce(() => new Promise(() => {}));
    expect(
      (
        await selectAgentToolFamilies({
          catalog,
          toolNames: ["lookup"],
          request,
        })
      ).source,
    ).toBe("fallback");
  });

  test("expansion accepts only available family names and never empty requests", () => {
    const spec = expandToolsSpec(catalog, ["policies"]);
    expect(spec.inputSchema.parse({ families: ["policies"] })).toEqual({
      families: ["policies"],
    });
    expect(() => spec.inputSchema.parse({ families: ["email"] })).toThrow();
    expect(() => spec.inputSchema.parse({ families: [] })).toThrow();
    expect(() =>
      expandToolsSpec(catalog, []).inputSchema.parse({
        families: ["policies"],
      }),
    ).toThrow();
  });
});
