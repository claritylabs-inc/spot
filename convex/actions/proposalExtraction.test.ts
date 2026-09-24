/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import dayjs from "dayjs";
import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { seedRequestIntake } from "../lib/procurementNarrative";
import type { DeclarationsSectionOutput } from "../lib/sectionExtraction/schemas";

const { executeDurableRouterRequest, slicePdfPages } = vi.hoisted(() => ({
  executeDurableRouterRequest: vi.fn(),
  slicePdfPages: vi.fn(),
}));
vi.mock("../lib/routerJobClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/routerJobClient")>()),
  executeDurableRouterRequest,
}));
vi.mock("../lib/policySectioning", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/policySectioning")>()),
  slicePdfPages,
}));
// P1 owns the resolver; this fake matches quotes against spans on the page.
vi.mock("../lib/citationResolver", () => ({
  resolveCitation: (
    citation: { page: number; quote: string },
    spans: Array<{ id: string; pageStart: number; sourceUnit?: string; text: string }>,
  ) => {
    const match = spans.find(
      (span) => span.pageStart === citation.page && span.text.includes(citation.quote),
    );
    return match
      ? { ...citation, sourceSpanIds: [match.id], bbox: [], match: "exact" }
      : { ...citation, sourceSpanIds: [], bbox: [], match: "unresolved" };
  },
}));

const modules = import.meta.glob("/convex/**/*.ts");

afterEach(() => {
  executeDurableRouterRequest.mockReset();
  slicePdfPages.mockReset();
});

function routerResponse(output: unknown) {
  return {
    requestId: "req-1",
    model: { provider: "openai", model: "gpt-5.6-terra" },
    routing: {
      decision: "routed",
      route: { provider: "openai", model: "gpt-5.6-terra" },
      attemptCount: 1,
      source: "jev",
    },
    usage: { inputTokens: 100, outputTokens: 50, cachedInputTokens: 0, cacheWriteTokens: 0 },
    costUsd: 0.01,
    costStatus: "priced",
    output,
    finishReason: "stop",
  };
}

const declarations: DeclarationsSectionOutput = {
  policyNumber: { value: "Q-100", citations: [{ page: 1, quote: "Quote Number: Q-100" }] },
  namedInsured: { value: "Acme Corp", citations: [{ page: 1, quote: "Acme Corp" }] },
  insurer: { value: "Example Insurance Company", citations: [{ page: 1, quote: "Example Insurance Company" }] },
  broker: null,
  effectiveDate: { value: "01/01/2026", citations: [{ page: 1, quote: "01/01/2026" }] },
  expirationDate: { value: "01/01/2027", citations: [{ page: 1, quote: "01/01/2027" }] },
  retroactiveDate: null,
  programName: null,
  operationsDescription: null,
  premium: { value: "$12,400", citations: [{ page: 1, quote: "$12,400" }] },
  totalCost: null,
  premiumBreakdown: [],
  taxesAndFees: [],
  linesOfBusiness: ["GL"],
  parties: [],
  insuredDetails: [],
  coverages: [
    {
      name: "General Liability",
      lineOfBusiness: "GL",
      coverageCode: null,
      limit: "$1,000,000",
      deductible: null,
      premium: null,
      retroactiveDate: null,
      formNumber: null,
      limits: [],
      citations: [{ page: 1, quote: "General Liability" }],
    },
  ],
  forms: [],
};

const quoteTerms = {
  quoteExpirationDate: "2026-09-20",
  quoteExpirationEvidence: {
    description: "Quote valid until 2026-09-20",
    category: null,
    sourceNodeIds: [],
    sourceSpanIds: ["span-1"],
    pageStart: 1,
    pageEnd: 1,
  },
  subjectivities: [],
  conditions: [],
};

async function seedRunningJob(t: TestConvex<typeof schema>) {
  const now = dayjs().valueOf();
  return await t.run(async (ctx) => {
    const operatorUserId = await ctx.db.insert("users", {
      name: "Operator",
      email: "operator@spot.insure",
      accountKind: "operator",
    });
    const clientOrgId = await ctx.db.insert("organizations", { name: "Client", type: "client" });
    const brokerOrgId = await ctx.db.insert("organizations", { name: "Broker", type: "broker" });
    const requestId = await ctx.db.insert("procurementRequests", {
      clientOrgId,
      title: "Property placement",
      status: "marketing",
      inboxToken: "proposal-advance-test",
      createdByUserId: operatorUserId,
      updatedByUserId: operatorUserId,
      createdAt: now,
      updatedAt: now,
    });
    await seedRequestIntake(ctx, {
      requestId,
      clientOrgId,
      userId: operatorUserId,
      narrative: "Place property coverage",
      source: "manual",
    });
    const outreachId = await ctx.db.insert("procurementBrokerOutreaches", {
      requestId,
      clientOrgId,
      brokerOrgId,
      brokerName: "Broker",
      status: "request_sent",
      createdByUserId: operatorUserId,
      updatedByUserId: operatorUserId,
      createdAt: now,
      updatedAt: now,
    });
    const fingerprint = "proposal-fingerprint";
    const proposalId = await ctx.db.insert("procurementProposals", {
      requestId,
      clientOrgId,
      brokerOrgId,
      outreachId,
      status: "extracting",
      extractionFingerprint: fingerprint,
      createdByUserId: operatorUserId,
      updatedByUserId: operatorUserId,
      createdAt: now,
      updatedAt: now,
    });
    const fileId = await ctx.storage.store(new Blob(["fake-pdf-bytes"]));
    const proposalDocumentId = await ctx.db.insert("procurementProposalDocuments", {
      proposalId,
      requestId,
      clientOrgId,
      fileId,
      fileName: "quote.pdf",
      contentType: "application/pdf",
      size: 8,
      sha256: "document-hash",
      createdByUserId: operatorUserId,
      createdAt: now,
    });
    const jobId = await ctx.db.insert("procurementProposalExtractionJobs", {
      proposalId,
      requestId,
      clientOrgId,
      extractionFingerprint: fingerprint,
      requestedByUserId: operatorUserId,
      status: "pending",
      attempts: 0,
      checkpoint: {
        state: {
          traceId: "trace-1",
          documents: [
            {
              proposalDocumentId,
              fileId,
              fileName: "quote.pdf",
              phase: "sections",
              pageCount: 1,
              planHash: "plan-1",
              sections: [
                {
                  sectionId: "declarations-1-1",
                  kind: "declarations",
                  pageStart: 1,
                  pageEnd: 1,
                  confidence: 1,
                },
              ],
              sectionAttempts: {},
            },
          ],
        },
        createdAt: now,
      },
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("procurementProposalExtractionArtifacts", {
      proposalId,
      jobId,
      proposalDocumentId,
      kind: "parsed_source",
      storageId: await ctx.storage.store(
        new Blob([
          JSON.stringify({
            pageCount: 1,
            textLayerMissing: false,
            sourceSpans: [
              {
                id: "span-1",
                documentId: String(proposalDocumentId),
                pageStart: 1,
                pageEnd: 1,
                text: "Quote Number: Q-100 Acme Corp Example Insurance Company 01/01/2026 01/01/2027 $12,400 General Liability",
                textHash: "hash-1",
              },
            ],
          }),
        ], { type: "application/json" }),
      ),
      createdAt: now,
    });
    return { clientOrgId, proposalId, proposalDocumentId, jobId, fingerprint };
  });
}

describe("proposal extraction advance", () => {
  test("extracts sections and quote terms, then aggregates and completes the job", async () => {
    const t = convexTest(schema, modules);
    slicePdfPages.mockResolvedValue(new Uint8Array([1, 2, 3]));
    executeDurableRouterRequest
      .mockResolvedValueOnce(routerResponse(declarations))
      .mockResolvedValueOnce(routerResponse(quoteTerms));

    const ids = await seedRunningJob(t);
    await t.action(internal.actions.proposalExtraction.advance, { jobId: ids.jobId });

    const job = await t.run((ctx) => ctx.db.get(ids.jobId));
    expect(job?.status).toBe("complete");
    expect(job?.leaseId).toBeUndefined();

    const proposal = await t.run((ctx) => ctx.db.get(ids.proposalId));
    expect(proposal?.status).toBe("review_ready");
    const offer = proposal?.extractedOffer as {
      carrier?: string;
      quoteNumber?: string;
      insuredName?: string;
      quoteExpirationDate?: string;
      coverages: Array<{ name: string }>;
    };
    expect(offer.carrier).toBe("Example Insurance Company");
    expect(offer.quoteNumber).toBe("Q-100");
    expect(offer.insuredName).toBe("Acme Corp");
    expect(offer.quoteExpirationDate).toBe("2026-09-20");
    expect(offer.coverages.map((c) => c.name)).toEqual(["General Liability"]);

    const spans = await t.run((ctx) =>
      ctx.db
        .query("proposalSourceSpans")
        .withIndex("proposal", (q) => q.eq("proposalId", ids.proposalId))
        .collect(),
    );
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.every((span) => span.extractionFingerprint === ids.fingerprint)).toBe(true);
  });

  test("fails the job and reverts the proposal to draft when a section exhausts its retries", async () => {
    const t = convexTest(schema, modules);
    slicePdfPages.mockResolvedValue(new Uint8Array([1, 2, 3]));
    executeDurableRouterRequest.mockRejectedValue(new Error("Router job failed"));

    const ids = await seedRunningJob(t);
    // First attempt fails and retries once; second attempt fails and exhausts retries.
    await t.action(internal.actions.proposalExtraction.advance, { jobId: ids.jobId });
    await t.action(internal.actions.proposalExtraction.advance, { jobId: ids.jobId });

    const job = await t.run((ctx) => ctx.db.get(ids.jobId));
    expect(job?.status).toBe("failed");
    expect(job?.lastError).toContain("declarations");

    const proposal = await t.run((ctx) => ctx.db.get(ids.proposalId));
    expect(proposal?.status).toBe("draft");
  });
});
