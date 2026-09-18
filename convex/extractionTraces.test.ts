/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
test.each([false, true])(
  "persists Jev selection metadata from direct and legacy trace envelopes (nested=%s)",
  async (nested) => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Fixture",
        type: "client",
      });
      const policyId = await ctx.db.insert("policies", {
        orgId,
        carrier: "Carrier",
        policyNumber: "P-1",
        linesOfBusiness: ["CGL"],
        policyYear: 2026,
        effectiveDate: "2026-01-01",
        expirationDate: "2027-01-01",
        isRenewal: false,
        coverages: [],
        insuredName: "Fixture",
      });
      return { orgId, policyId };
    });
    await t.mutation(internal.extractionTraces.startSession, {
      ...ids,
      traceId: "trace-1",
    });
    const selection = {
      mode: "jev_active" as const,
      selectorVersion: "jev-1.13.0",
      outcome: "accepted" as const,
      reason: "selected",
      durationMs: 20,
      costNanoUsd: 4200,
      requestId: "decision-1",
      estimatedInputTokens: 100,
      estimatedOutputTokens: null,
      expectedFallbackCostNanoUsd: null,
      totalCostNanoUsd: null,
    };
    const routing = {
      decision: "autonomous",
      candidatesConsidered: [
        { provider: "openai" as const, model: "gpt-5-mini" },
      ],
      policyVersion: null,
      cacheStickinessApplied: false,
      attemptCount: 1,
      selection,
    };
    await t.mutation(internal.extractionTraces.recordEvent, {
      traceId: "trace-1",
      kind: "model_call",
      status: "complete",
      ...(nested ? { details: { clRouter: { routing } } } : { routing }),
    });
    const events = await t.run((ctx) =>
      ctx.db.query("policyExtractionTraceEvents").collect(),
    );
    expect(
      events.find((event) => event.kind === "model_call")?.routing?.selection,
    ).toEqual(selection);
  },
);
