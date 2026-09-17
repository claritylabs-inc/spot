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
  decisionPolicy: mocks.policy,
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

test("unresolved evidence always blocks promotion", async () => {
  const result = await resolveExtractionEvidenceAudit({
    ...args,
    previous: { ...report, status: "unresolved" },
  });
  expect(result.required).toBe(true);
  expect(() => requireResolvedExtractionAudit(result)).toThrow(
    "requires review",
  );
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

test("audit failure cannot silently bypass verification", async () => {
  mocks.audit.mockRejectedValue(new Error("audit unavailable"));
  await expect(
    resolveExtractionEvidenceAudit({ ...args, previous: undefined }),
  ).rejects.toThrow("audit unavailable");
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
