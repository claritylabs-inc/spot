import { getFunctionName } from "convex/server";
import { beforeEach, expect, test, vi } from "vitest";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { generateObjectForOrg } from "../lib/models";
import { generateReviewInternal } from "./proposalReview";

vi.mock("../lib/models", () => ({ generateObjectForOrg: vi.fn() }));
const handler = (
  generateReviewInternal as typeof generateReviewInternal & {
    _handler: (
      ctx: ActionCtx,
      args: {
        operatorUserId: Id<"users">;
        proposalId: Id<"procurementProposals">;
      },
    ) => Promise<unknown>;
  }
)._handler;
const proposalId = "proposal" as Id<"procurementProposals">;
const operatorUserId = "operator" as Id<"users">;
const input = {
  proposalId,
  clientOrgId: "client" as Id<"organizations">,
  extractionFingerprint: "fingerprint",
  packetRevision: 3,
  packetMarkdown: "## coverage — Coverage\n\nRequested limit",
  sectionKeys: ["coverage"],
  proposalMarkdown: "Building limit: $1,000,000 [E1]",
  evidenceLegend: {
    E1: {
      proposalDocumentId: "document",
      sourceNodeIds: [],
      sourceSpanIds: ["span"],
      pageStart: 1,
    },
  },
};
beforeEach(() => vi.resetAllMocks());

test.each([
  ["meets", ["E1"], "meets_requirements"],
  ["has_gap", ["E1"], "has_gaps"],
  ["insufficient_evidence", [], "insufficient_evidence"],
  ["meets", ["E99"], "insufficient_evidence"],
] as const)(
  "derives %s from grounded findings and never asks for an overall conclusion",
  async (conclusion, evidenceRefs, expected) => {
    const runQuery = vi.fn(async (ref) =>
      getFunctionName(ref) === "procurementProposals:getReviewInputInternal"
        ? input
        : null,
    );
    const runMutation = vi.fn(async () => ({
      reviewId: "review",
      auditEventId: "audit",
    }));
    vi.mocked(generateObjectForOrg).mockImplementation(
      async (_ctx, _org, _task, options) => {
        const object = {
          findings: [
            {
              sectionKey: "coverage",
              conclusion,
              summary: "Finding",
              evidenceRefs: [...evidenceRefs],
            },
          ],
        };
        expect(options.schema.safeParse(object).success).toBe(true);
        expect(options.system).not.toContain("overall conclusion");
        return { object } as never;
      },
    );
    const result = await handler(
      { runQuery, runMutation } as unknown as ActionCtx,
      { proposalId, operatorUserId },
    );
    expect(result).toMatchObject({ conclusion: expected, findingCount: 1 });
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ conclusion: expected }),
    );
    expect(vi.mocked(generateObjectForOrg).mock.calls[0][4]).toEqual(
      expect.objectContaining({
        taskKind: "proposal_review",
        trace: expect.objectContaining({
          traceId:
            "proposal-review:proposal:44863b03e9909b7100e05b02526909a346fd7455183f6619e0fe6198c89981e0:3",
        }),
      }),
    );
  },
);

test("router failure does not persist a review", async () => {
  const runQuery = vi.fn(async (ref) =>
    getFunctionName(ref) === "procurementProposals:getReviewInputInternal"
      ? input
      : null,
  );
  const runMutation = vi.fn();
  vi.mocked(generateObjectForOrg).mockRejectedValueOnce(
    new Error("router unavailable"),
  );
  await expect(
    handler({ runQuery, runMutation } as unknown as ActionCtx, {
      proposalId,
      operatorUserId,
    }),
  ).rejects.toThrow("router unavailable");
  expect(runMutation).not.toHaveBeenCalled();
});
