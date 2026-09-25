import { beforeEach, expect, test, vi } from "vitest";
import { getFunctionName } from "convex/server";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { generateObjectForOrg } from "../lib/models";
import { importRequirementsInternal } from "./complianceRequirements";

vi.mock("../lib/models", () => ({ generateObjectForOrg: vi.fn() }));
const handler = (
  importRequirementsInternal as typeof importRequirementsInternal & {
    _handler: (
      ctx: ActionCtx,
      args: {
        orgId: Id<"organizations">;
        userId: Id<"users">;
        pastedText: string;
      },
    ) => Promise<unknown>;
  }
)._handler;
const args = {
  orgId: "org" as Id<"organizations">,
  userId: "user" as Id<"users">,
  pastedText: "Carry general liability coverage of $1 million per occurrence.",
};
function context() {
  const runMutation = vi.fn<
    (
      ref: Parameters<typeof getFunctionName>[0],
      args: Record<string, unknown>,
    ) => Promise<unknown>
  >(async (ref) =>
    getFunctionName(ref).endsWith("createRequirementsInternal") ? [] : "source",
  );
  const runQuery = vi.fn(async () => ({
    userId: args.userId,
    existingRequirements: [],
  }));
  return {
    ctx: { runQuery, runMutation } as unknown as ActionCtx,
    runMutation,
  };
}
beforeEach(() => vi.resetAllMocks());

test("links generation to the extraction run and retains run accounting without duplicate router telemetry", async () => {
  vi.mocked(generateObjectForOrg).mockResolvedValueOnce({
    object: { requirements: [], certificateHolders: [] },
    usage: {},
    route: { provider: "openai", model: "fixture" },
  } as never);
  const { ctx, runMutation } = context();
  await handler(ctx, args);
  const calls = runMutation.mock.calls.map(([ref, ...rest]) => ({
    name: getFunctionName(ref),
    args: rest[0],
  }));
  const runId = (
    calls.find((call) => call.name === "requirementExtractionRuns:start")
      ?.args as { runId: string }
  ).runId;
  expect(vi.mocked(generateObjectForOrg).mock.calls[0][4]).toMatchObject({
    taskKind: "requirement_extraction",
    trace: { traceId: runId },
  });
  expect(
    calls.some((call) => call.name === "requirementExtractionRuns:complete"),
  ).toBe(true);
  expect(
    calls.some((call) => call.name.startsWith("modelRoutingEvents:")),
  ).toBe(false);
});

test("router failure fails the import run without creating a source or replaying generation", async () => {
  vi.mocked(generateObjectForOrg).mockRejectedValueOnce(
    new Error("router unavailable"),
  );
  const { ctx, runMutation } = context();
  await expect(handler(ctx, args)).rejects.toThrow("router unavailable");
  const names = runMutation.mock.calls.map(([ref]) => getFunctionName(ref));
  expect(names).toContain("requirementExtractionRuns:fail");
  expect(names).not.toContain(
    "compliance:createRequirementSourceDocumentInternal",
  );
  expect(names).not.toContain("modelRoutingEvents:recordRunInternal");
  expect(generateObjectForOrg).toHaveBeenCalledOnce();
});
