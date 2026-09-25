import { getAuthUserId } from "@convex-dev/auth/server";
import dayjs from "dayjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { clRouterDecide } from "../lib/clRouterClient";
import { recheckOwnRequirement } from "./complianceReview";

vi.mock("@convex-dev/auth/server", () => ({ getAuthUserId: vi.fn() }));
vi.mock("../lib/clRouterClient", () => ({ clRouterDecide: vi.fn() }));

const decide = vi.mocked(clRouterDecide);
const orgId = "org" as Id<"organizations">;
const requirementId = "requirement" as Id<"insuranceRequirements">;
const userId = "user" as Id<"users">;
const policyId = "policy" as Id<"policies">;
const handler = (
  recheckOwnRequirement as typeof recheckOwnRequirement & {
    _handler: (
      ctx: ActionCtx,
      args: {
        orgId: Id<"organizations">;
        requirementId: Id<"insuranceRequirements">;
      },
    ) => Promise<{
      status: string;
      matchedPolicyIds: Id<"policies">[];
      expiresAt?: string;
      daysUntilExpiration?: number;
      notes: string;
    }>;
  }
)._handler;

function context(
  policies = [
    { _id: policyId, policyNumber: "H-01", expirationDate: "2026-12-31" },
  ],
) {
  const runMutation = vi.fn();
  return {
    runMutation,
    ctx: {
      runMutation,
      runQuery: vi.fn().mockResolvedValue({
        org: { _id: orgId, name: "Harbor" },
        requirement: {
          title: "General liability",
          requirementText: "General liability of $1 million",
        },
        policies,
      }),
    } as unknown as ActionCtx,
  };
}

function respond(
  status = "met",
  confidence = 0.9,
  matches = [0.9],
  probability = confidence,
) {
  decide.mockResolvedValueOnce({
    contractVersion: 1,
    requestId: "decision",
    model: "jev",
    answers: {
      status: {
        type: "choice",
        choice: status,
        confidence,
        probabilities: { [status]: probability, other: 1 - probability },
      },
      ...Object.fromEntries(
        matches.map((noul, index) => [
          `policy_${index}`,
          { type: "noul" as const, noul },
        ]),
      ),
    },
    usage: { inputTokens: 1, outputTokens: 1 },
    cost: { status: "unpriced", costNanoUsd: null },
    durationMs: 1,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(dayjs("2026-09-25T12:00:00Z").valueOf());
  vi.clearAllMocks();
  decide.mockReset();
  vi.mocked(getAuthUserId).mockResolvedValue(userId);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("manual compliance Jev review", () => {
  it("persists only selected known policies and derives the earliest matching expiration", async () => {
    const { ctx, runMutation } = context([
      { _id: policyId, policyNumber: "H-01", expirationDate: "2026-12-31" },
      {
        _id: "second" as Id<"policies">,
        policyNumber: "H-02",
        expirationDate: "2026-11-01",
      },
      {
        _id: "unmatched" as Id<"policies">,
        policyNumber: "H-03",
        expirationDate: "2026-10-01",
      },
    ]);
    respond("met", 0.7, [0.7, 0.9, 0.699]);
    const result = await handler(ctx, { orgId, requirementId });
    expect(result).toMatchObject({
      status: "met",
      matchedPolicyIds: [policyId, "second"],
      expiresAt: "2026-11-01",
      daysUntilExpiration: 37,
    });
    expect(result.notes).toContain("H-01");
    expect(result.notes).toContain("H-02");
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      orgId,
      requirementId,
      userId,
      ...result,
    });
    expect(decide.mock.calls[0]?.[0]).toMatchObject({
      task: "compliance_manual_review",
      trace: { traceId: expect.stringContaining(String(requirementId)) },
      questions: { status: { type: "choice" }, policy_0: { type: "noul" } },
    });
  });

  it.each([
    ["met", 0.699, [0.9], 0.699],
    ["met", 0.9, [0.9], 0.699],
    ["met", 0.9, [0.699], 0.9],
    ["unknown", 0.9, [0.9], 0.9],
    ["unverified", 0.9, [0.9], 0.9],
  ])(
    "holds ambiguous verdict %s at %s",
    async (status, confidence, matches, probability) => {
      respond(status, confidence, matches, probability);
      await expect(
        handler(context().ctx, { orgId, requirementId }),
      ).resolves.toMatchObject({ status: "unverified" });
    },
  );

  it("honors the configured confidence for status and policy matches", async () => {
    vi.stubEnv("JEV_PROCEED_THRESHOLD", "0.9");
    respond("met", 0.89);
    await expect(
      handler(context().ctx, { orgId, requirementId }),
    ).resolves.toMatchObject({ status: "unverified" });
    respond("met", 0.9, [0.89]);
    await expect(
      handler(context().ctx, { orgId, requirementId }),
    ).resolves.toMatchObject({ status: "unverified", matchedPolicyIds: [] });
  });

  it.each([
    ["2026-10-25", "met", "expiring_soon", 30],
    ["2026-09-24", "met", "unverified", -1],
    ["2026-09-24", "expired", "expired", -1],
    ["invalid", "met", "unverified", undefined],
  ])(
    "checks expiration %s against the selected status",
    async (expirationDate, chosen, expected, days) => {
      respond(chosen);
      const result = await handler(
        context([{ _id: policyId, policyNumber: "H-01", expirationDate }]).ctx,
        { orgId, requirementId },
      );
      expect(result.status).toBe(expected);
      expect(result.daysUntilExpiration).toBe(days);
    },
  );

  it("allows a confident unmet verdict without a satisfying policy", async () => {
    respond("not_met", 0.9, [0.1]);
    await expect(
      handler(context().ctx, { orgId, requirementId }),
    ).resolves.toMatchObject({ status: "not_met", matchedPolicyIds: [] });
  });

  it("does not persist a result on router failure", async () => {
    const { ctx, runMutation } = context();
    decide.mockRejectedValueOnce(new Error("router unavailable"));
    await expect(handler(ctx, { orgId, requirementId })).rejects.toThrow(
      "router unavailable",
    );
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("keeps every candidate within the router's question limit", async () => {
    const policies = Array.from({ length: 130 }, (_value, index) => ({
      _id: `policy-${index}` as Id<"policies">,
      policyNumber: `H-${index}`,
      expirationDate: "2026-12-31",
    }));
    respond(
      "met",
      0.9,
      Array.from({ length: 127 }, () => 0.1),
    );
    decide.mockResolvedValueOnce({
      contractVersion: 1,
      requestId: "decision-2",
      model: "jev",
      answers: {
        policy_127: { type: "noul", noul: 0.1 },
        policy_128: { type: "noul", noul: 0.9 },
        policy_129: { type: "noul", noul: 0.1 },
      },
      usage: { inputTokens: 1, outputTokens: 1 },
      cost: { status: "unpriced", costNanoUsd: null },
      durationMs: 1,
    });

    await expect(
      handler(context(policies).ctx, { orgId, requirementId }),
    ).resolves.toMatchObject({
      status: "met",
      matchedPolicyIds: ["policy-128"],
    });
    expect(
      decide.mock.calls.map(
        ([request]) => Object.keys(request.questions).length,
      ),
    ).toEqual([128, 3]);
    expect(decide.mock.calls[1]?.[0]).toMatchObject({
      state: { selectedStatus: "met" },
      trace: { parentRequestId: "decision" },
    });
  });

  it("preserves the user-facing timeout and leaves prior results untouched", async () => {
    const { ctx, runMutation } = context();
    const controller = new AbortController();
    controller.abort();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValueOnce(controller.signal);
    decide.mockRejectedValueOnce(new Error("aborted"));
    await expect(handler(ctx, { orgId, requirementId })).rejects.toThrow(
      "The deeper compliance check took too long. Try again in a moment.",
    );
    expect(runMutation).not.toHaveBeenCalled();
    timeout.mockRestore();
  });

  it("does not decide or persist for an unauthenticated actor", async () => {
    vi.mocked(getAuthUserId).mockResolvedValueOnce(null);
    const { ctx, runMutation } = context();
    await expect(handler(ctx, { orgId, requirementId })).rejects.toThrow();
    expect(decide).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
  });
});
