/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { seedRequestIntake } from "./lib/procurementNarrative";
import {
  acquireLeaseInternal,
  completeJobInternal,
  saveCheckpointForLeaseInternal,
} from "./proposalExtraction";
import { listByProposalInternal as listSpansByProposalInternal } from "./proposalSourceSpans";
import { listByProposalInternal as listNodesByProposalInternal } from "./proposalSourceNodes";

const modules = import.meta.glob("./**/*.ts");
const acquireLeaseFn = acquireLeaseInternal as any;
const completeFn = completeJobInternal as any;
const saveCheckpointFn = saveCheckpointForLeaseInternal as any;
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
  test("acquires an isolated proposal job and rejects a concurrent acquire while the lease is live", async () => {
    const seeded = await fixture();
    const acquired = await seeded.t.mutation(acquireLeaseFn, {
      jobId: seeded.jobId,
      leaseId: "lease-one",
      leaseExpiresAt: dayjs().add(5, "minute").valueOf(),
    });
    expect(acquired?.proposalId).toBe(seeded.proposalId);
    expect(acquired?.checkpoint).toBeUndefined();

    // A second acquire (e.g. a watchdog firing while the normal chain is
    // still alive) must not take over the live lease.
    await expect(
      seeded.t.mutation(acquireLeaseFn, {
        jobId: seeded.jobId,
        leaseId: "lease-two",
        leaseExpiresAt: dayjs().add(5, "minute").valueOf(),
      }),
    ).resolves.toBeNull();

    await expect(
      seeded.t.mutation(saveCheckpointFn, {
        jobId: seeded.jobId,
        leaseId: "wrong-lease",
        state: { traceId: "t", documents: [] },
      }),
    ).resolves.toBe(false);
    await expect(
      seeded.t.mutation(saveCheckpointFn, {
        jobId: seeded.jobId,
        leaseId: "lease-one",
        state: { traceId: "t", documents: [] },
      }),
    ).resolves.toBe(true);

    // The lease was released, so a fresh acquire now succeeds and sees the
    // saved checkpoint.
    const resumed = await seeded.t.mutation(acquireLeaseFn, {
      jobId: seeded.jobId,
      leaseId: "lease-three",
      leaseExpiresAt: dayjs().add(5, "minute").valueOf(),
    });
    expect(resumed?.checkpoint).toMatchObject({
      state: { traceId: "t", documents: [] },
    });
  });

  test("a normal release-then-resume tick chain never spends a retry attempt", async () => {
    const seeded = await fixture();
    for (let tick = 0; tick < 5; tick += 1) {
      const acquired = await seeded.t.mutation(acquireLeaseFn, {
        jobId: seeded.jobId,
        leaseId: `lease-${tick}`,
        leaseExpiresAt: dayjs().add(5, "minute").valueOf(),
      });
      expect(acquired).not.toBeNull();
      await seeded.t.mutation(saveCheckpointFn, {
        jobId: seeded.jobId,
        leaseId: `lease-${tick}`,
        state: { traceId: "t", documents: [] },
      });
    }
    const job = await seeded.t.run((ctx) => ctx.db.get(seeded.jobId));
    expect(job?.attempts).toBe(0);
    expect(job?.status).toBe("running");
    expect(job?.leaseId).toBeUndefined();
  });

  test("rejects stale completion without changing the proposal offer", async () => {
    const seeded = await fixture();
    await seeded.t.mutation(acquireLeaseFn, {
      jobId: seeded.jobId,
      leaseId: "lease-one",
      leaseExpiresAt: dayjs().add(5, "minute").valueOf(),
    });
    await seeded.t.run((ctx) =>
      ctx.db.patch(seeded.proposalId, {
        extractionFingerprint: "new-fingerprint",
      }),
    );
    await expect(
      seeded.t.mutation(completeFn, {
        jobId: seeded.jobId,
        leaseId: "lease-one",
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
