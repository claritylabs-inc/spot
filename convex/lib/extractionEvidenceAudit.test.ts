import { beforeEach, expect, test, vi } from "vitest";
import type { ExtractionAuditBinding } from "@claritylabs/cl-sdk/extraction-audit";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import {
  resolveExtractionEvidenceAudit,
  requireResolvedExtractionAudit,
} from "./extractionEvidenceAudit";

const mocks = vi.hoisted(() => ({
  policy: vi.fn(),
  audit: vi.fn(),
  parse: vi.fn(),
  binding: vi.fn(),
  decide: vi.fn(),
}));
vi.mock("@claritylabs/cl-sdk/extraction-audit", () => ({
  auditExtractionEvidence: mocks.audit,
  parseExtractionEvidenceAudit: mocks.parse,
  validateExtractionAuditBinding: mocks.binding,
}));
vi.mock("./decisions", () => ({
  decisionPolicyFromEnvironment: mocks.policy,
  logDecisionEvent: vi.fn(),
}));
vi.mock("./sdkCallbacks", () => ({ makeDecide: () => mocks.decide }));

const policy = {
  mode: "active",
  policyVersion: "reviewed-v1",
  families: {
    "extraction.audit": { threshold: 0.99, evaluationId: "heldout-v1" },
  },
};
const report = {
  status: "verified_text",
  policyVersion: "reviewed-v1",
  evaluationId: "heldout-v1",
  acceptanceThreshold: 0.99,
};
const binding = {
  profile: { coverages: [] },
  document: { type: "policy" },
  sourceSpans: [],
  sourceTree: [],
  originalSourceSpans: [{ id: "original", text: "Policy declarations" }],
} as unknown as ExtractionAuditBinding;
const args = {
  ctx: {} as ActionCtx,
  orgId: "org" as Id<"organizations">,
  binding,
  previous: report,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.policy.mockReturnValue(policy);
  mocks.parse.mockImplementation((value) => value);
  mocks.audit.mockResolvedValue({ ...binding, audit: report });
});

test("an unchanged validated snapshot reuses its audit without another decision request", async () => {
  const result = await resolveExtractionEvidenceAudit(args);
  expect(mocks.binding).toHaveBeenCalledWith(report, binding);
  expect(mocks.audit).not.toHaveBeenCalled();
  expect(result).toEqual({ report, snapshot: binding, required: true });
  expect(() => requireResolvedExtractionAudit(result)).not.toThrow();
});

test("postprocessing changes require a fresh audit of the exact final snapshot", async () => {
  mocks.binding.mockImplementation(() => {
    throw new Error("different snapshot");
  });
  const result = await resolveExtractionEvidenceAudit(args);
  expect(mocks.audit).toHaveBeenCalledOnce();
  expect(mocks.audit.mock.calls[0][0]).toMatchObject({
    ...binding,
    options: { maxRepairRounds: 0 },
  });
  expect(mocks.parse).toHaveBeenLastCalledWith(report, binding);
  expect(result.snapshot).toBe(binding);
});

test("raising the acceptance threshold cannot inherit a previous pass", async () => {
  await resolveExtractionEvidenceAudit({
    ...args,
    previous: { ...report, acceptanceThreshold: 0.95 },
  });
  expect(mocks.audit).toHaveBeenCalledOnce();
});

test("legacy and unqualified active modes preserve the existing completion path", async () => {
  for (const mode of ["legacy", "active"]) {
    mocks.policy.mockReturnValue({ mode });
    const result = await resolveExtractionEvidenceAudit(args);
    expect(result).toEqual({ required: false });
    expect(() => requireResolvedExtractionAudit(result)).not.toThrow();
  }
  expect(mocks.audit).not.toHaveBeenCalled();
});

test("unresolved qualified active evidence blocks promotion while shadow cannot block it", async () => {
  const unresolved = { ...report, status: "unresolved" };
  const active = await resolveExtractionEvidenceAudit({
    ...args,
    previous: unresolved,
  });
  expect(() => requireResolvedExtractionAudit(active)).toThrow(
    "requires review",
  );
  mocks.policy.mockReturnValue({ ...policy, mode: "shadow" });
  mocks.audit.mockResolvedValue({
    ...binding,
    audit: { ...unresolved, status: "shadow" },
  });
  const shadow = await resolveExtractionEvidenceAudit(args);
  expect(shadow.required).toBe(false);
  expect(() => requireResolvedExtractionAudit(shadow)).not.toThrow();
});

test("cancellation prevents a new audit and malformed reports never authorize promotion", async () => {
  await expect(
    resolveExtractionEvidenceAudit({ ...args, shouldCancel: async () => true }),
  ).rejects.toThrow("Cancelled");
  expect(mocks.audit).not.toHaveBeenCalled();
  mocks.parse.mockImplementation(() => {
    throw new Error("invalid audit");
  });
  await expect(resolveExtractionEvidenceAudit(args)).rejects.toThrow(
    "invalid audit",
  );
  expect(() => requireResolvedExtractionAudit({ required: true })).toThrow(
    "requires review",
  );
});

test("a shadow audit failure cannot change completion behavior", async () => {
  mocks.policy.mockReturnValue({ ...policy, mode: "shadow" });
  mocks.audit.mockRejectedValue(new Error("audit unavailable"));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(
      await resolveExtractionEvidenceAudit({ ...args, previous: undefined }),
    ).toEqual({ required: false });
  } finally {
    warn.mockRestore();
  }
});

test("a text pass cannot promote when the original input units are unavailable", async () => {
  const result = await resolveExtractionEvidenceAudit({
    ...args,
    binding: { ...binding, originalSourceSpans: undefined },
  });
  expect(() => requireResolvedExtractionAudit(result)).toThrow(
    "requires review",
  );
});
