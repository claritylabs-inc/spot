import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { clRouterDecide } from "../lib/clRouterClient";
import { selectCarrierIdentityWithJev } from "./enrichCarrierIdentity";

vi.mock("../lib/clRouterClient", () => ({ clRouterDecide: vi.fn() }));

const decide = vi.mocked(clRouterDecide);
const ctx = {} as ActionCtx;
const orgId = "org" as Id<"organizations">;
const site = {
  website: "https://carrier.example/",
  title: "Harbor Insurance | Business insurance",
  siteName: "Harbor Insurance",
  identityEvidence:
    "Harbor Insurance is a trading name of Harbor Underwriting Ltd.",
  colorCandidates: [],
};

function answer(choice: string, confidence = 0.9, probability = confidence) {
  return {
    type: "choice" as const,
    choice,
    confidence,
    probabilities: { [choice]: probability, other: 1 - probability },
  };
}

function respond(
  key: string,
  choice: string,
  confidence = 0.9,
  probability = confidence,
) {
  decide.mockResolvedValueOnce({
    contractVersion: 1,
    requestId: `decision-${key}`,
    model: "jev",
    answers: { [key]: answer(choice, confidence, probability) },
    usage: { inputTokens: 1, outputTokens: 1 },
    cost: { status: "unpriced", costNanoUsd: null },
    durationMs: 1,
  });
}

function select(sites = [site]) {
  return selectCarrierIdentityWithJev(
    ctx,
    orgId,
    "Harbor Underwriting Ltd.",
    sites,
    "First-party search evidence",
    "carrier-trace",
  );
}

beforeEach(() => {
  decide.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("carrier identity Jev selection", () => {
  it("grounds the chosen site and derives its name only from site metadata", async () => {
    respond("site", "site_0", 0.7);
    respond("relationship", "trading_name", 0.7);

    await expect(select()).resolves.toEqual({
      candidateIndex: 0,
      publicName: "Harbor Insurance",
      nameRelationship: "trading_name",
      confidence: "high",
    });
    expect(decide.mock.calls[0]?.[0]).toMatchObject({
      task: "carrier_identity_selection",
      trace: { traceId: "carrier-trace" },
      questions: {
        site: {
          type: "choice",
          criteria: { site_0: expect.anything(), none: expect.anything() },
        },
      },
    });
    expect(decide.mock.calls[1]?.[0]).toMatchObject({
      task: "carrier_identity_relationship",
      state: { publicName: "Harbor Insurance" },
      trace: { traceId: "carrier-trace", parentRequestId: "decision-site" },
    });
  });

  it("uses the visible title when siteName is absent", async () => {
    respond("site", "site_0");
    respond("relationship", "same_legal_entity");
    await expect(
      select([{ ...site, siteName: "", title: "Harbor Underwriting" }]),
    ).resolves.toMatchObject({
      publicName: "Harbor Underwriting",
      nameRelationship: "same_legal_entity",
    });
  });

  it.each([
    ["none", 0.95, 0.95],
    ["site_0", 0.699, 0.699],
    ["site_0", 0.95, 0.699],
    ["site_99", 0.95, 0.95],
  ])(
    "rejects unsupported site %s at %s/%s",
    async (choice, confidence, probability) => {
      respond("site", choice, confidence, probability);
      await expect(select()).rejects.toThrow(
        "Carrier website could not be identified confidently",
      );
      expect(decide).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["none", "unrecognized", "parent_brand"])(
    "omits an ungrounded public-name relationship %s",
    async (relationship) => {
      respond("site", "site_0");
      respond(
        "relationship",
        relationship,
        relationship === "parent_brand" ? 0.69 : 0.9,
      );
      await expect(select()).resolves.toEqual({
        candidateIndex: 0,
        confidence: "high",
      });
    },
  );

  it("honors the configured threshold for both choices", async () => {
    vi.stubEnv("JEV_PROCEED_THRESHOLD", "0.9");
    respond("site", "site_0", 0.89);
    await expect(select()).rejects.toThrow(
      "Carrier website could not be identified confidently",
    );
    respond("site", "site_0", 0.9);
    respond("relationship", "trading_name", 0.89);
    await expect(select()).resolves.toEqual({
      candidateIndex: 0,
      confidence: "high",
    });
  });

  it.each([
    { ...site, website: "https://portal.carrier.example/" },
    { ...site, identityEvidence: "" },
  ])("keeps downstream first-party and portal grounding", async (candidate) => {
    respond("site", "site_0");
    respond("relationship", "trading_name");
    await expect(select([candidate])).rejects.toThrow(
      "Carrier website could not be identified confidently",
    );
  });

  it("fails closed when the router is unavailable", async () => {
    decide.mockRejectedValueOnce(new Error("router unavailable"));
    await expect(select()).rejects.toThrow("router unavailable");
  });
});
