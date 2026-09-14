/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { seedRequestIntake } from "./lib/procurementNarrative";
import {
  claimExternalJobInternal,
  completeExternalJobInternal,
  heartbeatExternalJobInternal,
} from "./proposalExtraction";
import { listByProposalInternal as listSpansByProposalInternal } from "./proposalSourceSpans";
import { listByProposalInternal as listNodesByProposalInternal } from "./proposalSourceNodes";

const modules = import.meta.glob("./**/*.ts");
const claimFn = claimExternalJobInternal as any;
const completeFn = completeExternalJobInternal as any;
const heartbeatFn = heartbeatExternalJobInternal as any;
const listSpansFn = listSpansByProposalInternal as any;
const listNodesFn = listNodesByProposalInternal as any;

async function fixture(fingerprint = "proposal-fingerprint") {
  const t = convexTest(schema, modules);
  const now = dayjs().valueOf();
  const ids = await t.run(async (ctx) => {
    const operatorUserId = await ctx.db.insert("users", {
      name: "Operator",
      email: "operator@spot.insure",
      accountKind: "operator",
    });
    const clientOrgId = await ctx.db.insert("organizations", {
      name: "Client",
      type: "client",
    });
    const brokerOrgId = await ctx.db.insert("organizations", {
      name: "Broker",
      type: "broker",
    });
    const requestId = await ctx.db.insert("procurementRequests", {
      clientOrgId,
      title: "Property placement",
      status: "marketing",
      inboxToken: "proposal-test",
      createdByUserId: operatorUserId,
      updatedByUserId: operatorUserId,
      createdAt: now,
      updatedAt: now,
    });
    await seedRequestIntake(ctx, { requestId: requestId, clientOrgId: clientOrgId, userId: operatorUserId, narrative: "Place property coverage", source: "manual" });
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
    const fileId = await ctx.storage.store(new Blob(["proposal"]));
    const proposalDocumentId = await ctx.db.insert(
      "procurementProposalDocuments",
      {
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
      },
    );
    const jobId = await ctx.db.insert("procurementProposalExtractionJobs", {
      proposalId,
      requestId,
      clientOrgId,
      extractionFingerprint: fingerprint,
      requestedByUserId: operatorUserId,
      status: "pending",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
    return { proposalId, proposalDocumentId, jobId };
  });
  return { t, ...ids };
}

describe("proposal extraction leases", () => {
  test("claims an isolated proposal job and extends only its exact lease", async () => {
    const seeded = await fixture();
    const claimed = await seeded.t.mutation(claimFn, {
      leaseId: "lease-one",
      leaseExpiresAt: dayjs().add(5, "minute").valueOf(),
      workerId: "worker-one",
    });
    expect(claimed?.job._id).toBe(seeded.jobId);
    expect(claimed?.documents.map((document: any) => document._id)).toEqual([
      seeded.proposalDocumentId,
    ]);
    await expect(
      seeded.t.mutation(heartbeatFn, {
        jobId: seeded.jobId,
        leaseId: "wrong-lease",
        leaseExpiresAt: dayjs().add(10, "minute").valueOf(),
      }),
    ).resolves.toBe(false);
    await expect(
      seeded.t.mutation(heartbeatFn, {
        jobId: seeded.jobId,
        leaseId: "lease-one",
        leaseExpiresAt: dayjs().add(10, "minute").valueOf(),
      }),
    ).resolves.toBe(true);
  });

  test("rejects stale completion without changing the proposal offer", async () => {
    const seeded = await fixture();
    await seeded.t.mutation(claimFn, {
      leaseId: "lease-one",
      leaseExpiresAt: dayjs().add(5, "minute").valueOf(),
      workerId: "worker-one",
    });
    await seeded.t.run((ctx) =>
      ctx.db.patch(seeded.proposalId, {
        extractionFingerprint: "new-fingerprint",
      }),
    );
    const payloadId = await seeded.t.run((ctx) =>
      ctx.storage.store(new Blob(["{}"], { type: "application/json" })),
    );
    await expect(
      seeded.t.mutation(completeFn, {
        jobId: seeded.jobId,
        proposalId: seeded.proposalId,
        leaseId: "lease-one",
        extractionFingerprint: "proposal-fingerprint",
        completionPayloadStorageId: payloadId,
        extractedOffer: { carrier: "Wrong" },
      }),
    ).resolves.toBe(false);
    const proposal = await seeded.t.run((ctx) => ctx.db.get(seeded.proposalId));
    expect(proposal?.extractedOffer).toBeUndefined();
    expect(proposal?.status).toBe("extracting");
  });

  test("never exposes source rows from a stale extraction fingerprint", async () => {
    const seeded = await fixture("accepted-fingerprint");
    await seeded.t.run(async (ctx) => {
      await ctx.db.patch(seeded.proposalId, {
        status: "review_ready",
        extractedOffer: { carrier: "Accepted" },
      });
      for (const extractionFingerprint of [
        "stale-fingerprint",
        "accepted-fingerprint",
      ]) {
        await ctx.db.insert("proposalSourceSpans", {
          orgId: (await ctx.db.get(seeded.proposalId))!.clientOrgId,
          proposalId: seeded.proposalId,
          proposalDocumentId: seeded.proposalDocumentId,
          extractionFingerprint,
          documentId: String(seeded.proposalDocumentId),
          spanId: `${extractionFingerprint}-span`,
          text: extractionFingerprint,
          textHash: extractionFingerprint,
          createdAt: dayjs().valueOf(),
        });
        await ctx.db.insert("proposalSourceNodes", {
          orgId: (await ctx.db.get(seeded.proposalId))!.clientOrgId,
          proposalId: seeded.proposalId,
          proposalDocumentId: seeded.proposalDocumentId,
          extractionFingerprint,
          documentId: String(seeded.proposalDocumentId),
          nodeId: `${extractionFingerprint}-node`,
          kind: "text",
          title: extractionFingerprint,
          sourceSpanIds: [`${extractionFingerprint}-span`],
          order: 0,
          path: "1",
          createdAt: dayjs().valueOf(),
        });
      }
    });
    const spans = await seeded.t.query(listSpansFn, {
      proposalId: seeded.proposalId,
    });
    const nodes = await seeded.t.query(listNodesFn, {
      proposalId: seeded.proposalId,
    });
    expect(spans.map((row: any) => row.extractionFingerprint)).toEqual([
      "accepted-fingerprint",
    ]);
    expect(nodes.map((row: any) => row.extractionFingerprint)).toEqual([
      "accepted-fingerprint",
    ]);
  });
});
