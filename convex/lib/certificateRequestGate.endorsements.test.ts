import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import { clRouterDecide } from "./clRouterClient";
import {
  decideCertificateEndorsements,
  inferCertificateEndorsements,
  type CertificateEndorsementKind,
} from "./certificateRequestGate";

vi.mock("./clRouterClient", () => ({ clRouterDecide: vi.fn() }));

const orgId = "org" as Id<"organizations">;
const ctx = { runMutation: vi.fn(async () => null) };

function respond(kinds: Partial<Record<CertificateEndorsementKind, number>>) {
  vi.mocked(clRouterDecide).mockResolvedValueOnce({
    contractVersion: 1,
    requestId: "decision",
    model: "jev-1.13.0",
    answers: Object.fromEntries(
      Object.entries(kinds).map(([kind, noul]) => [
        kind,
        { type: "noul", noul },
      ]),
    ) as never,
    usage: { inputTokens: 1, outputTokens: 1 },
    cost: { status: "unpriced", costNanoUsd: null },
    durationMs: 1,
  });
}

beforeEach(() => {
  vi.mocked(clRouterDecide).mockReset();
});

describe("inferCertificateEndorsements", () => {
  it("unions Jev-detected kinds with the regex and requested kinds", () => {
    expect(
      inferCertificateEndorsements({
        requestText: "COI for Acme with waiver of subrogation",
        requestedEndorsements: ["PNC"],
        detectedEndorsements: ["additional_insured"],
      }).sort(),
    ).toEqual([
      "additional_insured",
      "primary_non_contributory",
      "waiver_of_subrogation",
    ]);
  });
});

describe("decideCertificateEndorsements", () => {
  it("detects paraphrases the regex misses", async () => {
    const requestText =
      "Please make sure the landlord is covered under our policy too, and that our carrier won't come after them if there's a claim.";
    expect(inferCertificateEndorsements({ requestText })).toEqual([]);
    respond({
      additional_insured: 0.92,
      waiver_of_subrogation: 0.81,
      primary_non_contributory: 0.2,
      policy_change: 0.1,
    });
    expect(
      (await decideCertificateEndorsements(ctx, { orgId, requestText })).sort(),
    ).toEqual(["additional_insured", "waiver_of_subrogation"]);
    expect(vi.mocked(clRouterDecide).mock.calls[0][0]).toMatchObject({
      task: "certificate_endorsement_detection",
      state: { requestText },
    });
  });

  it("is never less strict than the regex", async () => {
    const requestText = "Add Acme as additional insured on the certificate.";
    respond({ additional_insured: 0.05 });
    expect(
      await decideCertificateEndorsements(ctx, { orgId, requestText }),
    ).toEqual(["additional_insured"]);
  });

  it("falls back to the regex when the router fails", async () => {
    vi.mocked(clRouterDecide).mockRejectedValueOnce(new Error("router down"));
    expect(
      await decideCertificateEndorsements(ctx, {
        orgId,
        requestText: "Certificate naming Acme as loss payee",
      }),
    ).toEqual(["loss_payee"]);
  });

  it("ignores answers below the threshold and skips empty requests", async () => {
    respond({ mortgagee: 0.69 });
    expect(
      await decideCertificateEndorsements(ctx, {
        orgId,
        requestText: "Certificate for our bank",
      }),
    ).toEqual([]);
    expect(await decideCertificateEndorsements(ctx, { orgId })).toEqual([]);
    expect(clRouterDecide).toHaveBeenCalledTimes(1);
  });
});
