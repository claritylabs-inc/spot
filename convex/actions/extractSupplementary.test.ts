import { beforeEach, expect, test, vi } from "vitest";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { makeGenerateObject } from "../lib/sdkCallbacks";
import { extractOne } from "./extractSupplementary";

vi.mock("../lib/sdkCallbacks", () => ({ makeGenerateObject: vi.fn() }));
vi.mock("../lib/pdfText", () => ({
  extractPdfPlainText: vi.fn(async () => "policy text"),
}));
const handler = (
  extractOne as typeof extractOne & {
    _handler: (
      ctx: ActionCtx,
      args: { policyId: Id<"policies"> },
    ) => Promise<unknown>;
  }
)._handler;
const generate = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(makeGenerateObject).mockReturnValue(generate);
});

test.each([false, true])(
  "supplementary extraction traces the policy job and never replays an unknown generation failure=%s",
  async (failed) => {
    const runMutation = vi.fn();
    const ctx = {
      runQuery: vi.fn(async () => ({ orgId: "org", fileId: "file" })),
      runMutation,
      storage: { get: vi.fn(async () => new Blob(["pdf"])) },
    } as unknown as ActionCtx;
    if (failed)
      generate.mockRejectedValueOnce(new Error("router outcome unknown"));
    else generate.mockResolvedValueOnce({ object: { auxiliaryFacts: [] } });
    const promise = handler(ctx, { policyId: "policy" as Id<"policies"> });
    if (failed) await expect(promise).rejects.toThrow("router outcome unknown");
    else await expect(promise).resolves.toMatchObject({ facts: 0 });
    expect(makeGenerateObject).toHaveBeenCalledWith(
      "extraction",
      expect.objectContaining({
        traceId: "supplementary:policy",
        tracePolicyId: "policy",
      }),
    );
    expect(generate).toHaveBeenCalledOnce();
    expect(generate.mock.calls[0][0]).toMatchObject({
      taskKind: "extraction_supplementary",
      trace: { phase: "supplementary" },
    });
    expect(runMutation).not.toHaveBeenCalled();
  },
);
