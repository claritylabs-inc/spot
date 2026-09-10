/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { afterEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  getOperatorAgentToolSpec,
  parseOperatorAgentToolInput,
} from "./lib/operatorAgentToolRegistry";
import {
  PROCUREMENT_CAPABILITIES,
  PROCUREMENT_CAPABILITY_EXCEPTIONS,
  PROCUREMENT_CAPABILITY_MANIFEST_VERSION,
} from "./lib/procurementCapabilities";
import { upsertPacketSectionByOperator } from "./procurementPacket";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function fixture() {
  const t = convexTest(schema, modules);
  const now = dayjs().valueOf();
  const ids = await t.run(async (ctx) => {
    const operatorUserId = await ctx.db.insert("users", {
      name: "Operator",
      email: "operator@example.com",
      accountKind: "operator",
    });
    const clientUserId = await ctx.db.insert("users", {
      name: "Client",
      email: "client@example.com",
      accountKind: "customer",
    });
    const brokerUserId = await ctx.db.insert("users", {
      name: "Broker",
      email: "broker@example.com",
      accountKind: "customer",
    });
    const clientOrgId = await ctx.db.insert("organizations", {
      name: "Client",
      type: "client",
    });
    const brokerOrgId = await ctx.db.insert("organizations", {
      name: "Broker",
      type: "broker",
    });
    await ctx.db.insert("operatorProfiles", {
      userId: operatorUserId,
      email: "operator@example.com",
      role: "operator",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("orgMemberships", {
      orgId: clientOrgId,
      userId: clientUserId,
      role: "admin",
    });
    await ctx.db.insert("orgMemberships", {
      orgId: brokerOrgId,
      userId: brokerUserId,
      role: "member",
    });
    return {
      operatorUserId,
      clientUserId,
      brokerUserId,
      clientOrgId,
      brokerOrgId,
    };
  });
  return {
    t,
    ...ids,
    operator: t.withIdentity({ subject: `${ids.operatorUserId}|session` }),
    client: t.withIdentity({ subject: `${ids.clientUserId}|session` }),
    broker: t.withIdentity({ subject: `${ids.brokerUserId}|session` }),
  };
}

async function seedProposalFile(
  f: Awaited<ReturnType<typeof fixture>>,
  name = "quote.pdf",
) {
  return await f.t.run(async (ctx) => {
    const now = dayjs().valueOf();
    const bytes = new TextEncoder().encode(`proposal:${name}`);
    const fileId = await ctx.storage.store(
      new Blob([bytes], { type: "application/pdf" }),
    );
    const clientFileId = await ctx.db.insert("clientFiles", {
      orgId: f.clientOrgId,
      fileId,
      name,
      originalName: name,
      contentType: "application/pdf",
      size: bytes.byteLength,
      clientVisible: false,
      uploadedByUserId: f.operatorUserId,
      uploadedBySide: "operator",
      nameSource: "original",
      nameStatus: "ready",
      createdAt: now,
      updatedAt: now,
    });
    return clientFileId;
  });
}

async function registerProposalUpload(
  f: Awaited<ReturnType<typeof fixture>>,
  requestId: Id<"procurementRequests">,
  fileId: Id<"_storage">,
) {
  const target = await f.operator.mutation(
    api.procurementProposals.generateUploadUrl,
    { requestId },
  );
  await f.operator.mutation(api.procurementProposals.registerUpload, {
    requestId,
    uploadIntentId: target.uploadIntentId,
    fileId,
  });
  return target.uploadIntentId;
}

async function createRequest(
  f: Awaited<ReturnType<typeof fixture>>,
  title: string,
) {
  return await f.operator.mutation(api.procurementRequests.create, {
    clientOrgId: f.clientOrgId,
    title,
    narrative: `Client asked for ${title}`,
  });
}

describe("procurement domain boundaries", () => {
  test("saves packet edits together and rejects stale or unauthorized edits", async () => {
    const f = await fixture();
    const { requestId } = await createRequest(f, "Packet editing");
    const initial = await f.operator.query(api.procurementPacket.get, {
      requestId,
    });
    const edits = {
      requestId,
      expectedPacketRevision: initial.packetRevision,
      sections: [
        { key: "intake_narrative", body: "Updated narrative" },
        { key: "summary", body: "Updated summary" },
      ],
    };
    await expect(
      f.client.mutation(api.procurementPacket.updateSections, edits),
    ).rejects.toThrow();
    await expect(
      f.broker.mutation(api.procurementPacket.updateSections, edits),
    ).rejects.toThrow();
    await f.operator.mutation(api.procurementPacket.updateSections, edits);
    const saved = await f.operator.query(api.procurementPacket.get, {
      requestId,
    });
    expect(saved.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "intake_narrative",
          body: "Updated narrative",
          source: "manual",
        }),
        expect.objectContaining({
          key: "summary",
          body: "Updated summary",
          source: "manual",
        }),
      ]),
    );
    await expect(
      f.operator.mutation(api.procurementPacket.updateSections, {
        ...edits,
        sections: edits.sections.map((section) => ({
          ...section,
          body: "Stale draft",
        })),
      }),
    ).rejects.toThrow("packet changed");
    expect(
      await f.operator.query(api.procurementPacket.get, { requestId }),
    ).toEqual(saved);
  });

  test("rejects oversized outreach logs without losing existing content", async () => {
    const f = await fixture();
    const { requestId } = await createRequest(f, "Long outreach log");
    const { outreachId } = await f.operator.mutation(
      api.procurementRequests.createOutreach,
      {
        requestId,
        brokerOrgId: f.brokerOrgId,
        log: "Keep this log",
      },
    );
    await f.t.run((ctx) =>
      ctx.db.patch(outreachId, { quoteSummary: "Keep legacy context" }),
    );
    const before = await f.t.run((ctx) => ctx.db.get(outreachId));
    await expect(
      f.operator.mutation(api.procurementRequests.updateOutreach, {
        outreachId,
        log: "x".repeat(20_001),
      }),
    ).rejects.toThrow("Log must be");
    expect(await f.t.run((ctx) => ctx.db.get(outreachId))).toEqual(before);
  });

  test("automatically creates one shared packet link for every new request", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const operatorRequest = await createRequest(f, "Operator placement");
    const clientRequest = await f.client.mutation(
      api.clientProcurementRequests.create,
      { title: "Client placement", narrative: "Please place coverage" },
    );

    await f.t.finishAllScheduledFunctions(vi.runAllTimers);

    for (const requestId of [
      operatorRequest.requestId,
      clientRequest.requestId,
    ]) {
      const links = await f.operator.query(api.procurementPacket.listLinks, {
        requestId,
      });
      expect(links).toEqual([
        expect.objectContaining({
          outreachId: null,
          state: "active",
        }),
      ]);
    }
  });

  test("exposes one outreach Markdown log and retires legacy workflow fields on edit", async () => {
    const f = await fixture();
    const request = await createRequest(f, "Broker log");
    const outreach = await f.operator.mutation(
      api.procurementRequests.createOutreach,
      {
        requestId: request.requestId,
        brokerOrgId: f.brokerOrgId,
        log: "Initial contact sent.",
      },
    );
    await f.t.run((ctx) =>
      ctx.db.patch(outreach.outreachId, {
        applicationUrl: "https://example.com/application",
        applicationQuestions: ["Who are the drivers?"],
        quoteSummary: "Legacy quote summary",
      }),
    );

    const before = await f.operator.query(api.procurementRequests.get, {
      requestId: request.requestId,
    });
    expect(before.outreaches[0]).toMatchObject({
      log: expect.stringContaining("https://example.com/application"),
    });
    expect(before.outreaches[0]).not.toHaveProperty("applicationUrl");
    expect(before.outreaches[0]).not.toHaveProperty("quoteSummary");

    await f.operator.mutation(api.procurementRequests.updateOutreach, {
      outreachId: outreach.outreachId,
      log: "- Followed up with underwriting.",
    });
    const stored = await f.t.run((ctx) => ctx.db.get(outreach.outreachId));
    expect(stored).toMatchObject({
      applicationQuestions: [],
      notes: "- Followed up with underwriting.",
    });
    expect(stored).not.toHaveProperty("applicationUrl");
    expect(stored).not.toHaveProperty("quoteSummary");
  });

  test("stores client request uploads as canonical artifacts without activity rows", async () => {
    const f = await fixture();
    const request = await f.client.mutation(
      api.clientProcurementRequests.create,
      { title: "Client upload", narrative: "Review the attached schedule" },
    );
    const storageId = await f.t.run((ctx) =>
      ctx.storage.store(new Blob(["schedule"], { type: "application/pdf" })),
    );
    const attached = await f.client.mutation(
      api.clientProcurementRequests.attachFile,
      {
        requestId: request.requestId,
        storageId,
        fileName: "Schedule.pdf",
        contentType: "application/pdf",
        size: 8,
      },
    );
    const details = await f.client.query(api.clientProcurementRequests.get, {
      requestId: request.requestId,
    });
    expect(details.files).toEqual([
      expect.objectContaining({
        _id: attached.fileItemId,
        clientFileId: attached.clientFileId,
        name: "Schedule.pdf",
        uploadedBySide: "client",
      }),
    ]);
    expect(details).not.toHaveProperty("activity");
    const legacy = await f.t.run(async (ctx) => ({
      activities: await ctx.db.query("procurementRequestActivities").collect(),
      documents: await ctx.db.query("procurementRequestDocuments").collect(),
      clientFile: await ctx.db.get(attached.clientFileId),
      fileItem: await ctx.db.get(attached.fileItemId),
    }));
    expect(legacy.activities).toEqual([]);
    expect(legacy.documents).toEqual([]);
    expect(legacy.clientFile).toMatchObject({
      fileId: storageId,
      clientVisible: true,
      uploadedBySide: "client",
    });
    expect(legacy.fileItem).toMatchObject({
      clientFileId: attached.clientFileId,
      clientVisible: true,
    });
  });

  test("files one active proposal per outreach and converges on replay", async () => {
    const f = await fixture();
    const secondBrokerOrgId = await f.t.run((ctx) =>
      ctx.db.insert("organizations", { name: "Second Broker", type: "broker" }),
    );
    const request = await f.operator.mutation(api.procurementRequests.create, {
      clientOrgId: f.clientOrgId,
      title: "Two-market placement",
      narrative: "Compare two property quotes",
    });
    const [firstOutreach, secondOutreach] = await Promise.all([
      f.operator.mutation(api.procurementRequests.createOutreach, {
        requestId: request.requestId,
        brokerOrgId: f.brokerOrgId,
      }),
      f.operator.mutation(api.procurementRequests.createOutreach, {
        requestId: request.requestId,
        brokerOrgId: secondBrokerOrgId,
      }),
    ]);
    const [firstFileId, secondFileId] = await Promise.all([
      seedProposalFile(f, "first-quote.pdf"),
      seedProposalFile(f, "second-quote.pdf"),
    ]);
    const first = await f.operator.mutation(api.procurementProposals.file, {
      requestId: request.requestId,
      outreachId: firstOutreach.outreachId,
      sources: [{ kind: "client_file", clientFileId: firstFileId }],
    });
    const replay = await f.operator.mutation(api.procurementProposals.file, {
      requestId: request.requestId,
      outreachId: firstOutreach.outreachId,
      sources: [{ kind: "client_file", clientFileId: firstFileId }],
    });
    await expect(
      f.operator.mutation(api.procurementProposals.file, {
        requestId: request.requestId,
        outreachId: secondOutreach.outreachId,
        supersedesProposalId: first.proposalId,
        sources: [{ kind: "client_file", clientFileId: secondFileId }],
      }),
    ).rejects.toThrow("Superseded proposal must belong to this outreach");
    const second = await f.operator.mutation(api.procurementProposals.file, {
      requestId: request.requestId,
      outreachId: secondOutreach.outreachId,
      sources: [{ kind: "client_file", clientFileId: secondFileId }],
    });

    expect(replay).toMatchObject({
      proposalId: first.proposalId,
      status: "already_filed",
      extraction: { jobId: first.extraction.jobId, reused: true },
    });
    expect(second.proposalId).not.toBe(first.proposalId);
    const state = await f.t.run(async (ctx) => ({
      proposals: await ctx.db
        .query("procurementProposals")
        .withIndex("request", (query) =>
          query.eq("requestId", request.requestId),
        )
        .collect(),
      documents: await ctx.db.query("procurementProposalDocuments").collect(),
      jobs: await ctx.db.query("procurementProposalExtractionJobs").collect(),
      fileItems: await ctx.db
        .query("procurementFileItems")
        .withIndex("request", (query) =>
          query.eq("requestId", request.requestId),
        )
        .collect(),
    }));
    expect(state.proposals).toHaveLength(2);
    expect(state.documents).toHaveLength(2);
    expect(state.jobs).toHaveLength(2);
    expect(state.fileItems).toHaveLength(2);
    expect(state.documents.map((document) => document.clientFileId)).toEqual(
      expect.arrayContaining([firstFileId, secondFileId]),
    );
  });

  test("deduplicates replayed proposal uploads by content hash", async () => {
    const f = await fixture();
    const request = await f.operator.mutation(api.procurementRequests.create, {
      clientOrgId: f.clientOrgId,
      title: "Hash replay",
      narrative: "File one quote once",
    });
    const outreach = await f.operator.mutation(
      api.procurementRequests.createOutreach,
      { requestId: request.requestId, brokerOrgId: f.brokerOrgId },
    );
    const { firstStorageId, replayStorageId } = await f.t.run(async (ctx) => ({
      firstStorageId: await ctx.storage.store(
        new Blob(["identical quote"], { type: "application/pdf" }),
      ),
      replayStorageId: await ctx.storage.store(
        new Blob(["identical quote"], { type: "application/pdf" }),
      ),
    }));
    await expect(
      f.operator.mutation(api.procurementProposals.file, {
        requestId: request.requestId,
        outreachId: outreach.outreachId,
        sources: [
          {
            kind: "upload",
            fileId: firstStorageId,
            fileName: "quote.pdf",
            contentType: "application/pdf",
          },
        ],
      }),
    ).rejects.toThrow("Browser proposal uploads require an upload intent");
    const [firstUploadIntentId, replayUploadIntentId] = await Promise.all([
      registerProposalUpload(f, request.requestId, firstStorageId),
      registerProposalUpload(f, request.requestId, replayStorageId),
    ]);
    const first = await f.operator.mutation(api.procurementProposals.file, {
      requestId: request.requestId,
      outreachId: outreach.outreachId,
      sources: [
        {
          kind: "upload",
          fileId: firstStorageId,
          fileName: "quote.pdf",
          contentType: "application/pdf",
          uploadIntentId: firstUploadIntentId,
        },
      ],
    });
    const replay = await f.operator.mutation(api.procurementProposals.file, {
      requestId: request.requestId,
      outreachId: outreach.outreachId,
      sources: [
        {
          kind: "upload",
          fileId: replayStorageId,
          fileName: "quote-copy.pdf",
          contentType: "application/pdf",
          uploadIntentId: replayUploadIntentId,
        },
      ],
    });
    expect(replay).toMatchObject({
      proposalId: first.proposalId,
      status: "already_filed",
    });
    const state = await f.t.run(async (ctx) => ({
      files: await ctx.db
        .query("clientFiles")
        .withIndex("organization", (query) => query.eq("orgId", f.clientOrgId))
        .collect(),
      replayBlob: await ctx.storage.get(replayStorageId),
      documents: await ctx.db.query("procurementProposalDocuments").collect(),
      uploadIntents: await ctx.db.query("clientFileUploadIntents").collect(),
    }));
    expect(state.files).toHaveLength(1);
    expect(state.documents).toHaveLength(1);
    expect(state.uploadIntents).toEqual([]);
    expect(state.replayBlob).toBeNull();
  });

  test("reports expired proposal leases through the shared extraction tool", async () => {
    const f = await fixture();
    const request = await f.operator.mutation(api.procurementRequests.create, {
      clientOrgId: f.clientOrgId,
      title: "Lease diagnostics",
      narrative: "Inspect proposal extraction",
    });
    const outreach = await f.operator.mutation(
      api.procurementRequests.createOutreach,
      { requestId: request.requestId, brokerOrgId: f.brokerOrgId },
    );
    const clientFileId = await seedProposalFile(f, "stuck-quote.pdf");
    const filed = await f.operator.mutation(api.procurementProposals.file, {
      requestId: request.requestId,
      outreachId: outreach.outreachId,
      sources: [{ kind: "client_file", clientFileId }],
    });
    await f.t.run((ctx) =>
      ctx.db.patch(filed.extraction.jobId, {
        status: "running",
        leaseId: "expired-lease",
        leaseExpiresAt: dayjs().subtract(1, "minute").valueOf(),
        attempts: 1,
      }),
    );
    const threadId = await f.operator.mutation(
      api.operatorAgent.createThread,
      {},
    );
    const diagnostics = await f.t.action(
      internal.operatorAgent.invokeRegisteredToolInternal,
      {
        operatorUserId: f.operatorUserId,
        threadId,
        channel: "mcp",
        toolName: "list_extraction_issues",
        input: { domain: "proposal", status: "stuck" },
        idempotencyKey: "list-stuck-proposal-extractions",
      },
    );
    expect(diagnostics.outcome).toMatchObject({
      status: "succeeded",
      result: {
        checkedDomains: ["proposal"],
        issues: [
          expect.objectContaining({
            domain: "proposal",
            proposalId: filed.proposalId,
            status: "stuck",
            recovery: "retry_procurement_proposal_extraction",
          }),
        ],
      },
    });
  });

  test("drops retried, cancelled, and archived proposals from extraction diagnostics", async () => {
    const f = await fixture();
    const request = await f.operator.mutation(api.procurementRequests.create, {
      clientOrgId: f.clientOrgId,
      title: "Stale diagnostics",
      narrative: "Only live proposals are extraction issues",
    });
    const [retried, cancelled, archived] = await Promise.all(
      ["Retried", "Cancelled", "Archived"].map(async (label) => {
        const brokerOrgId = await f.t.run((ctx) =>
          ctx.db.insert("organizations", {
            name: `${label} broker`,
            type: "broker" as const,
          }),
        );
        const outreach = await f.operator.mutation(
          api.procurementRequests.createOutreach,
          { requestId: request.requestId, brokerOrgId },
        );
        const clientFileId = await seedProposalFile(
          f,
          `${label.toLowerCase()}-quote.pdf`,
        );
        return await f.operator.mutation(api.procurementProposals.file, {
          requestId: request.requestId,
          outreachId: outreach.outreachId,
          sources: [{ kind: "client_file", clientFileId }],
        });
      }),
    );

    // The retried and archived proposals start from a failed extraction job;
    // the cancelled one keeps the live job an operator can still stop.
    await f.t.run(async (ctx) => {
      for (const filed of [retried, archived])
        await ctx.db.patch(filed.extraction.jobId, {
          status: "failed",
          lastError: "Worker crashed",
          attempts: 1,
        });
      await ctx.db.patch(retried.proposalId, { status: "draft" });
    });

    const threadId = await f.operator.mutation(
      api.operatorAgent.createThread,
      {},
    );
    const diagnose = async (idempotencyKey: string) =>
      await f.t.action(internal.operatorAgent.invokeRegisteredToolInternal, {
        operatorUserId: f.operatorUserId,
        threadId,
        channel: "mcp" as const,
        toolName: "list_extraction_issues",
        input: { domain: "proposal", status: "error" },
        idempotencyKey,
      });

    const before = await diagnose("list-failed-proposal-extractions");
    expect(before.outcome.status).toBe("succeeded");
    expect(
      (
        before.outcome as { result: { issues: Array<{ proposalId: string }> } }
      ).result.issues
        .map((issue) => String(issue.proposalId))
        .sort(),
    ).toEqual([retried.proposalId, archived.proposalId].map(String).sort());

    const requeued = await f.operator.mutation(
      api.procurementProposals.retryExtraction,
      { proposalId: retried.proposalId },
    );
    await f.t.run(async (ctx) => {
      await ctx.db.patch(requeued.jobId, { status: "complete" });
      await ctx.db.patch(retried.proposalId, { status: "review_ready" });
    });
    await f.operator.mutation(api.procurementProposals.cancelExtraction, {
      proposalId: cancelled.proposalId,
    });
    await f.operator.mutation(api.procurementProposals.archive, {
      proposalId: archived.proposalId,
    });

    const after = await diagnose("list-failed-proposal-extractions-after");
    expect(after.outcome).toMatchObject({
      status: "succeeded",
      result: { issues: [] },
    });
  });

  test("lets clients collaborate through an allowlisted request DTO without exposing private proposals", async () => {
    const f = await fixture();
    const created = await f.client.mutation(
      api.clientProcurementRequests.create,
      { title: "Property renewal", narrative: "We need property coverage" },
    );
    const outreach = await f.operator.mutation(
      api.procurementRequests.createOutreach,
      { requestId: created.requestId, brokerOrgId: f.brokerOrgId },
    );
    const clientFileId = await seedProposalFile(f);
    await f.operator.mutation(api.procurementProposals.file, {
      requestId: created.requestId,
      outreachId: outreach.outreachId,
      sources: [{ kind: "client_file", clientFileId }],
    });
    const dto = await f.client.query(api.clientProcurementRequests.get, {
      requestId: created.requestId,
    });
    expect(dto).toMatchObject({
      title: "Property renewal",
      status: "submitted",
      narrative: "We need property coverage",
    });
    expect(dto).not.toHaveProperty("proposals");
    expect(dto).not.toHaveProperty("outreaches");
    expect(dto).not.toHaveProperty("emailThreads");
    expect(dto.packet).not.toHaveProperty("sections");
    await expect(
      f.client.query(api.procurementProposals.list, {
        requestId: created.requestId,
      }),
    ).rejects.toThrow("OPERATOR_REQUIRED");
    await expect(
      f.broker.query(api.clientProcurementRequests.get, {
        requestId: created.requestId,
      }),
    ).rejects.toThrow("Client membership required");
  });

  test("keeps an operator-created request private until it is shared", async () => {
    const f = await fixture();
    const created = await f.operator.mutation(api.procurementRequests.create, {
      clientOrgId: f.clientOrgId,
      title: "Private placement",
      narrative: "Prepare options before involving the client",
    });

    await expect(
      f.client.query(api.clientProcurementRequests.get, {
        requestId: created.requestId,
      }),
    ).rejects.toThrow("Request not found");
    await expect(
      f.client.query(api.clientProcurementRequests.list, {}),
    ).resolves.toEqual([]);
  });

  test("requires proposal outreach consistency and invalidates a confirmed review when the broker-visible packet changes", async () => {
    const f = await fixture();
    const request = await f.operator.mutation(api.procurementRequests.create, {
      clientOrgId: f.clientOrgId,
      title: "Placement",
      narrative: "Place coverage",
      clientVisible: true,
    });
    const outreach = await f.operator.mutation(
      api.procurementRequests.createOutreach,
      { requestId: request.requestId, brokerOrgId: f.brokerOrgId },
    );
    const otherRequest = await f.operator.mutation(
      api.procurementRequests.create,
      {
        clientOrgId: f.clientOrgId,
        title: "Other placement",
        narrative: "Place other coverage",
      },
    );
    const otherOutreach = await f.operator.mutation(
      api.procurementRequests.createOutreach,
      { requestId: otherRequest.requestId, brokerOrgId: f.brokerOrgId },
    );
    const clientFileId = await seedProposalFile(f, "placement-quote.pdf");
    await expect(
      f.operator.mutation(api.procurementProposals.file, {
        requestId: request.requestId,
        outreachId: otherOutreach.outreachId,
        sources: [{ kind: "client_file", clientFileId }],
      }),
    ).rejects.toThrow("Outreach does not belong to this request");
    const proposal = await f.operator.mutation(api.procurementProposals.file, {
      requestId: request.requestId,
      outreachId: outreach.outreachId,
      sources: [{ kind: "client_file", clientFileId }],
    });
    // The broker answered this packet section, so the review binds to it.
    await f.t.run((ctx) =>
      upsertPacketSectionByOperator(ctx, {
        operatorUserId: f.operatorUserId,
        requestId: request.requestId,
        key: "coverage_requested",
        body: "General liability, $1m each occurrence.",
      }),
    );
    await f.t.run(async (ctx) => {
      await ctx.db.patch(proposal.proposalId, {
        status: "review_ready",
        extractionFingerprint: "fp-1",
        extractedOffer: { premiumAmount: 1000 },
      });
    });
    const packetRevision = await f.t.run(async (ctx) => {
      const row = await ctx.db.get(request.requestId);
      return row?.packetRevision ?? 0;
    });
    const review = await f.t.mutation(
      internal.procurementProposals.saveGeneratedReviewInternal,
      {
        operatorUserId: f.operatorUserId,
        proposalId: proposal.proposalId,
        extractionFingerprint: "fp-1",
        packetRevision,
        findings: [],
        conclusion: "has_gaps",
      },
    );
    await f.operator.mutation(api.procurementProposals.confirmReview, {
      reviewId: review.reviewId,
      conclusion: "has_gaps",
    });
    // Editing the packet the broker was sent must invalidate the review.
    await f.t.run((ctx) =>
      upsertPacketSectionByOperator(ctx, {
        operatorUserId: f.operatorUserId,
        requestId: request.requestId,
        key: "coverage_requested",
        body: "General liability, $2m each occurrence.",
      }),
    );
    await expect(
      f.operator.mutation(api.procurementProposals.select, {
        proposalId: proposal.proposalId,
      }),
    ).rejects.toThrow("current staff-confirmed review");
  });

  test("supports broker profiles without users and keeps member edits read-only", async () => {
    const f = await fixture();
    const standalone = await f.operator.mutation(
      api.brokerProfiles.createStandalone,
      {
        name: "No Portal Broker",
        networkStatus: "prospect",
        writingStates: ["ca"],
        lineOfBusinessCodes: ["cgl"],
      },
    );
    const rows = await f.operator.query(api.brokerProfiles.list, {
      writingState: "CA",
      lineOfBusinessCode: "CGL",
    });
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          broker: expect.objectContaining({ _id: standalone.brokerOrgId }),
          contacts: [],
        }),
      ]),
    );
    await f.operator.mutation(api.brokerProfiles.upsert, {
      brokerOrgId: standalone.brokerOrgId,
      networkStatus: "blacklisted",
      writingStates: ["CA"],
      lineOfBusinessCodes: ["CGL"],
    });
    const blacklisted = await f.operator.query(api.brokerProfiles.list, {
      status: "blacklisted",
    });
    expect(blacklisted).toEqual([
      expect.objectContaining({
        broker: expect.objectContaining({ _id: standalone.brokerOrgId }),
        profile: expect.objectContaining({ networkStatus: "blacklisted" }),
      }),
    ]);
    const request = await f.operator.mutation(api.procurementRequests.create, {
      clientOrgId: f.clientOrgId,
      title: "Network profile privacy",
      narrative: "Place coverage",
    });
    const outreach = await f.operator.mutation(
      api.procurementRequests.createOutreach,
      { requestId: request.requestId, brokerOrgId: f.brokerOrgId },
    );
    const clientFileId = await seedProposalFile(f, "network-quote.pdf");
    await f.operator.mutation(api.procurementProposals.file, {
      requestId: request.requestId,
      outreachId: outreach.outreachId,
      sources: [{ kind: "client_file", clientFileId }],
    });
    const brokerProfile = await f.broker.query(api.brokerProfiles.get, {
      brokerOrgId: f.brokerOrgId,
    });
    expect(brokerProfile).not.toHaveProperty("proposalCount");
    expect(brokerProfile).not.toHaveProperty("lastOutreachAt");
    await expect(
      f.broker.mutation(api.brokerProfiles.upsert, {
        brokerOrgId: f.brokerOrgId,
        networkStatus: "active",
        writingStates: ["CA"],
        lineOfBusinessCodes: ["CGL"],
      }),
    ).rejects.toThrow("Broker admin required");
  });

  test("broker edits preserve unrelated profile fields and cannot change operator status", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      const membership = await ctx.db
        .query("orgMemberships")
        .withIndex("organization", (q) => q.eq("orgId", f.brokerOrgId))
        .unique();
      await ctx.db.patch(membership!._id, { role: "admin" });
    });
    await f.operator.mutation(api.brokerProfiles.upsert, {
      brokerOrgId: f.brokerOrgId,
      networkStatus: "blacklisted",
      officeAddress: {
        street1: "123 Example St",
        street2: "Suite 2",
        city: "Boston",
        country: "US",
      },
      writingStates: ["MA"],
      lineOfBusinessCodes: ["CGL"],
    });
    await f.broker.mutation(api.brokerProfiles.upsert, {
      brokerOrgId: f.brokerOrgId,
      website: "https://example.com",
    });
    await f.broker.mutation(api.brokerProfiles.upsert, {
      brokerOrgId: f.brokerOrgId,
      officeAddress: { city: "Cambridge", street2: "" },
    });
    const result = await f.operator.query(api.brokerProfiles.get, {
      brokerOrgId: f.brokerOrgId,
    });
    expect(result).toMatchObject({
      broker: { website: "https://example.com" },
      profile: {
        networkStatus: "blacklisted",
        writingStates: ["MA"],
        lineOfBusinessCodes: ["CGL"],
        officeAddress: {
          street1: "123 Example St",
          street2: "",
          city: "Cambridge",
          country: "US",
        },
      },
    });
    await expect(
      f.broker.mutation(api.brokerProfiles.upsert, {
        brokerOrgId: f.brokerOrgId,
        networkStatus: "active",
        website: "https://changed.example.com",
      }),
    ).rejects.toThrow("Only operators can change broker network status");
    expect(
      (
        await f.operator.query(api.brokerProfiles.get, {
          brokerOrgId: f.brokerOrgId,
        })
      )?.broker.website,
    ).toBe("https://example.com");
  });

  test("service accounts cannot replace the last human admin or become the primary contact", async () => {
    const f = await fixture();
    const { serviceUserId, membershipId } = await f.t.run(async (ctx) => {
      const serviceUserId = await ctx.db.insert("users", {
        name: "Slack service",
        serviceAccountKind: "slack",
        accountKind: "customer",
      });
      await ctx.db.insert("orgMemberships", {
        orgId: f.clientOrgId,
        userId: serviceUserId,
        role: "admin",
      });
      const membership = await ctx.db
        .query("orgMemberships")
        .withIndex("organization_user", (q) =>
          q.eq("orgId", f.clientOrgId).eq("userId", f.clientUserId),
        )
        .unique();
      return { serviceUserId, membershipId: membership!._id };
    });
    expect(
      await f.client.mutation(api.orgs.ensurePrimaryInsuranceContact, {}),
    ).toMatchObject({ userId: f.clientUserId, updated: true });
    await expect(
      f.client.mutation(api.orgs.updateMemberRole, {
        membershipId,
        role: "member",
      }),
    ).rejects.toThrow("Cannot demote the last admin");
    await expect(
      f.client.mutation(api.orgs.removeMember, { membershipId }),
    ).rejects.toThrow("Cannot remove the last admin");
    await expect(
      f.client.mutation(api.orgs.setPrimaryInsuranceContact, {
        userId: serviceUserId,
      }),
    ).rejects.toThrow("Primary contact must be a person");
    const extraMembershipId = await f.t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        name: "Second person",
        accountKind: "customer",
      });
      return await ctx.db.insert("orgMemberships", {
        orgId: f.clientOrgId,
        userId,
        role: "member",
      });
    });
    await f.t.run((ctx) =>
      ctx.db.patch(f.clientOrgId, { primaryInsuranceContactId: undefined }),
    );
    expect(
      await f.client.mutation(api.orgs.removeMember, {
        membershipId: extraMembershipId,
      }),
    ).toMatchObject({ primaryInsuranceContactId: f.clientUserId });
  });

  test("issues immutable broker snapshots and revokes packet and file access", async () => {
    const f = await fixture();
    const brokerOrgId = await f.t.run((ctx) =>
      ctx.db.insert("organizations", {
        name: "Montgomery Risk",
        type: "broker",
      }),
    );
    const request = await f.operator.mutation(api.procurementRequests.create, {
      clientOrgId: f.clientOrgId,
      title: "Property placement",
      narrative: "Insure the Carroll Avenue property",
    });
    await f.operator.mutation(api.procurementRequests.createOutreach, {
      requestId: request.requestId,
      brokerOrgId,
      contactName: "Dana Reyes",
      contactEmail: "dana@example.com",
    });
    const otherOutreach = await f.operator.mutation(
      api.procurementRequests.createOutreach,
      {
        requestId: request.requestId,
        brokerOrgId,
        contactName: "Alex Morgan",
        contactEmail: "alex@example.com",
      },
    );
    await expect(
      f.operator.mutation(api.procurementPacket.mintLink, {
        requestId: request.requestId,
        expiresAt: dayjs().subtract(1, "minute").valueOf(),
      }),
    ).rejects.toThrow("Packet link expiry must be in the future");
    await expect(
      f.operator.mutation(api.procurementPacket.mintLink, {
        requestId: request.requestId,
        expiresAt: dayjs().add(91, "day").valueOf(),
      }),
    ).rejects.toThrow("Packet links may expire at most 90 days after issue");
    // A browser clock a few seconds ahead must not lose the maximum lifetime,
    // so callers name days and the server dates them.
    await expect(
      f.operator.mutation(api.procurementPacket.mintLink, {
        requestId: request.requestId,
        expiresAt: dayjs().add(90, "day").add(5, "second").valueOf(),
      }),
    ).rejects.toThrow("Packet links may expire at most 90 days after issue");
    const maximumLifetime = await f.operator.mutation(
      api.procurementPacket.mintLink,
      {
        requestId: request.requestId,
        expiresInDays: 90,
      },
    );
    expect(maximumLifetime.expiresAt).toBeGreaterThan(
      dayjs().add(89, "day").valueOf(),
    );
    const replacementLink = await f.operator.mutation(
      api.procurementPacket.mintLink,
      {
        requestId: request.requestId,
        expiresInDays: 7,
      },
    );
    await expect(
      f.t.query(api.procurementPacket.getByToken, {
        token: maximumLifetime.token,
      }),
    ).resolves.toBeNull();
    await expect(
      f.operator.mutation(api.procurementPacket.mintLink, {
        requestId: request.requestId,
        expiresInDays: 91,
      }),
    ).rejects.toThrow("Packet link lifetime must be between 1 and 90 days");
    await f.operator.mutation(api.procurementPacket.revokeLink, {
      linkId: replacementLink.id,
    });
    await f.t.run((ctx) =>
      upsertPacketSectionByOperator(ctx, {
        operatorUserId: f.operatorUserId,
        requestId: request.requestId,
        key: "summary",
        body: "Original broker submission.",
        audience: "broker",
      }),
    );
    const clientFileId = await f.t.run(async (ctx) => {
      const now = dayjs().valueOf();
      const fileId = await ctx.storage.store(
        new Blob(["application"], { type: "application/pdf" }),
      );
      return await ctx.db.insert("clientFiles", {
        orgId: f.clientOrgId,
        fileId,
        name: "Application.pdf",
        originalName: "Application.pdf",
        contentType: "application/pdf",
        size: 11,
        clientVisible: false,
        uploadedByUserId: f.operatorUserId,
        uploadedBySide: "operator",
        nameSource: "original",
        nameStatus: "ready",
        createdAt: now,
        updatedAt: now,
      });
    });
    const fileItem = await f.operator.mutation(
      api.procurementRequests.createFileItem,
      {
        requestId: request.requestId,
        clientFileId,
        purpose: "application",
        label: "Broker application",
        status: "available",
      },
    );
    await f.operator.mutation(api.procurementRequests.updateFileItem, {
      fileItemId: fileItem.fileItemId,
      brokerRelease: "attached",
    });
    const otherFileItemId = await f.t.run(async (ctx) => {
      const now = dayjs().valueOf();
      const fileId = await ctx.storage.store(
        new Blob(["other broker"], { type: "application/pdf" }),
      );
      const clientFileId = await ctx.db.insert("clientFiles", {
        orgId: f.clientOrgId,
        fileId,
        name: "Other-broker-only.pdf",
        originalName: "Other-broker-only.pdf",
        contentType: "application/pdf",
        size: 12,
        clientVisible: false,
        uploadedByUserId: f.operatorUserId,
        uploadedBySide: "operator",
        nameSource: "original",
        nameStatus: "ready",
        createdAt: now,
        updatedAt: now,
      });
      return await ctx.db.insert("procurementFileItems", {
        requestId: request.requestId,
        clientOrgId: f.clientOrgId,
        outreachId: otherOutreach.outreachId,
        clientFileId,
        purpose: "application",
        label: "Other broker only",
        status: "available",
        brokerRelease: "attached",
        clientVisible: false,
        createdByUserId: f.operatorUserId,
        updatedByUserId: f.operatorUserId,
        createdAt: now,
        updatedAt: now,
      });
    });
    const brokerPreview = await f.operator.query(
      api.procurementPacket.preview,
      {
        requestId: request.requestId,
      },
    );
    expect(brokerPreview.files.map((file) => file.name)).toEqual([
      "Broker application",
    ]);
    const issued = await f.operator.mutation(api.procurementPacket.mintLink, {
      requestId: request.requestId,
    });
    const { originalFileId, replacementClientFileId } = await f.t.run(
      async (ctx) => {
        const original = await ctx.db.get(clientFileId);
        if (!original) throw new Error("Expected original client file");
        const now = dayjs().valueOf();
        const replacementFileId = await ctx.storage.store(
          new Blob(["replacement"], { type: "application/pdf" }),
        );
        const replacementClientFileId = await ctx.db.insert("clientFiles", {
          orgId: f.clientOrgId,
          fileId: replacementFileId,
          name: "Replacement.pdf",
          originalName: "Replacement.pdf",
          contentType: "application/pdf",
          size: 11,
          clientVisible: false,
          uploadedByUserId: f.operatorUserId,
          uploadedBySide: "operator",
          nameSource: "original",
          nameStatus: "ready",
          createdAt: now,
          updatedAt: now,
        });
        return { originalFileId: original.fileId, replacementClientFileId };
      },
    );

    await f.t.run((ctx) =>
      upsertPacketSectionByOperator(ctx, {
        operatorUserId: f.operatorUserId,
        requestId: request.requestId,
        key: "summary",
        body: "Updated after issue.",
        audience: "broker",
      }),
    );
    await f.operator.mutation(api.procurementRequests.updateFileItem, {
      fileItemId: fileItem.fileItemId,
      clientFileId: replacementClientFileId,
      label: "Replacement application",
    });
    const publicView = await f.t.query(api.procurementPacket.getByToken, {
      token: issued.token,
    });
    expect(publicView).toMatchObject({
      recipientLabel: "All brokers",
      files: [
        expect.objectContaining({
          _id: fileItem.fileItemId,
          name: "Broker application",
          brokerRelease: "attached",
        }),
      ],
    });
    expect(publicView?.markdown).toContain("Original broker submission");
    expect(publicView?.markdown).not.toContain("Updated after issue");
    expect(publicView?.files).toHaveLength(1);
    expect(publicView?.files[0]?.downloadUrl).toContain("packet-file");
    await expect(
      f.t.query(internal.procurementPacket.getFileByTokenInternal, {
        token: issued.token,
        item: otherFileItemId,
      }),
    ).resolves.toBeNull();
    await expect(
      f.t.query(internal.procurementPacket.getFileByTokenInternal, {
        token: issued.token,
        item: fileItem.fileItemId,
      }),
    ).resolves.toMatchObject({
      fileId: originalFileId,
      name: "Broker application",
    });

    await f.operator.mutation(api.procurementRequests.updateFileItem, {
      fileItemId: fileItem.fileItemId,
      brokerRelease: "listed",
    });
    const narrowedView = await f.t.query(api.procurementPacket.getByToken, {
      token: issued.token,
    });
    expect(narrowedView?.files[0]).toMatchObject({
      name: "Broker application",
      brokerRelease: "listed",
      downloadUrl: null,
    });
    await expect(
      f.t.query(internal.procurementPacket.getFileByTokenInternal, {
        token: issued.token,
        item: fileItem.fileItemId,
      }),
    ).resolves.toBeNull();
    await expect(
      f.t.mutation(api.procurementPacket.recordView, {
        token: "wrong-token",
      }),
    ).resolves.toEqual({ ok: false });
    await expect(
      f.t.mutation(api.procurementPacket.recordView, {
        token: issued.token,
        userAgent: "packet-test",
      }),
    ).resolves.toEqual({ ok: true });

    await f.operator.mutation(api.procurementPacket.revokeLink, {
      linkId: issued.id,
    });
    await expect(
      f.t.query(api.procurementPacket.getByToken, { token: issued.token }),
    ).resolves.toBeNull();
    const links = await f.operator.query(api.procurementPacket.listLinks, {
      requestId: request.requestId,
    });
    expect(links[0]).toMatchObject({
      linkId: issued.id,
      state: "revoked",
      stale: true,
      sectionCount: expect.any(Number),
      fileCount: 1,
      viewCount: 1,
    });
  });

  test("reuses one canonical client file for identical forwarded attachments", async () => {
    const f = await fixture();
    const request = await createRequest(f, "Forwarded quote");
    const { firstStorageId, replayStorageId } = await f.t.run(async (ctx) => ({
      firstStorageId: await ctx.storage.store(
        new Blob(["same forwarded quote"], { type: "application/pdf" }),
      ),
      replayStorageId: await ctx.storage.store(
        new Blob(["same forwarded quote"], { type: "application/pdf" }),
      ),
    }));
    const ingest = (input: {
      resendEmailId: string;
      messageId: string;
      fileId: Id<"_storage">;
      receivedAt: number;
    }) =>
      f.t.mutation(internal.procurementRequests.ingestEmailInternal, {
        addressedRequestId: request.requestId,
        resendEmailId: input.resendEmailId,
        messageId: input.messageId,
        references: [],
        subject: "Property quote",
        fromEmail: "broker@example.com",
        toAddresses: [],
        ccAddresses: [],
        bccAddresses: [],
        currentText: "Attached quote",
        participantEmails: ["broker@example.com"],
        attachments: [
          {
            fileId: input.fileId,
            filename: "quote.pdf",
            contentType: "application/pdf",
            size: 20,
          },
        ],
        receivedAt: input.receivedAt,
      });

    const first = await ingest({
      resendEmailId: "forwarded-quote-1",
      messageId: "<forwarded-quote-1@example.com>",
      fileId: firstStorageId,
      receivedAt: 1,
    });
    const replay = await ingest({
      resendEmailId: "forwarded-quote-2",
      messageId: "<forwarded-quote-2@example.com>",
      fileId: replayStorageId,
      receivedAt: 2,
    });

    expect(first.duplicate).toBe(false);
    expect(replay.duplicate).toBe(false);
    if (first.duplicate || replay.duplicate) {
      throw new Error("Expected distinct messages to be ingested");
    }
    expect(replay.clientFileIds).toEqual(first.clientFileIds);
    const state = await f.t.run(async (ctx) => ({
      clientFiles: await ctx.db
        .query("clientFiles")
        .withIndex("organization", (query) => query.eq("orgId", f.clientOrgId))
        .collect(),
      messages: await ctx.db.query("procurementEmailMessages").collect(),
      fileItems: await ctx.db.query("procurementFileItems").collect(),
      replayBlob: await ctx.storage.get(replayStorageId),
    }));
    expect(state.clientFiles).toHaveLength(1);
    expect(state.messages).toHaveLength(2);
    expect(state.fileItems).toHaveLength(2);
    expect(state.fileItems.map((item) => item.clientFileId)).toEqual([
      first.clientFileIds[0],
      first.clientFileIds[0],
    ]);
    expect(state.replayBlob).toBeNull();
  });

  test("files a chosen attachment subset and stops offering archived threads", async () => {
    const f = await fixture();
    const request = await createRequest(f, "Subset quote filing");
    const outreach = await f.operator.mutation(
      api.procurementRequests.createOutreach,
      {
        requestId: request.requestId,
        brokerOrgId: f.brokerOrgId,
        contactEmail: "broker@example.com",
      },
    );
    const attachments = await Promise.all(
      [
        { filename: "broker-quote.pdf", contentType: "application/pdf" },
        { filename: "signature.png", contentType: "image/png" },
      ].map(async (attachment) => {
        const bytes = new TextEncoder().encode(attachment.filename);
        const fileId = await f.t.run((ctx) =>
          ctx.storage.store(
            new Blob([bytes], { type: attachment.contentType }),
          ),
        );
        return { ...attachment, fileId, size: bytes.byteLength };
      }),
    );
    const imported = await f.t.mutation(
      internal.procurementRequests.ingestEmailInternal,
      {
        addressedRequestId: request.requestId,
        resendEmailId: "subset-quote-1",
        messageId: "<subset-quote-1@example.com>",
        references: [],
        subject: "Quote and signature",
        fromEmail: "broker@example.com",
        toAddresses: [],
        ccAddresses: [],
        bccAddresses: [],
        currentText: "Quote attached",
        participantEmails: ["broker@example.com"],
        attachments,
        receivedAt: 1,
      },
    );
    if (imported.duplicate) throw new Error("Expected email import");
    const emailThreadId = imported.threadId as Id<"procurementEmailThreads">;
    const [quoteFileId, signatureFileId] = imported.clientFileIds;

    const preview = await f.operator.query(
      api.procurementRequests.previewEmailReconciliation,
      { emailThreadId },
    );
    expect(preview.filable).toBe(true);
    expect(preview.unfiledFiles).toHaveLength(2);
    expect(preview.outreaches).toMatchObject([
      { outreachId: outreach.outreachId },
    ]);

    const unrelatedClientFileId = await f.t.run(async (ctx) => {
      const bytes = new TextEncoder().encode("unrelated");
      const fileId = await ctx.storage.store(
        new Blob([bytes], { type: "application/pdf" }),
      );
      return await ctx.db.insert("clientFiles", {
        orgId: f.clientOrgId,
        fileId,
        name: "unrelated.pdf",
        originalName: "unrelated.pdf",
        contentType: "application/pdf",
        size: bytes.byteLength,
        clientVisible: false,
        uploadedByUserId: f.operatorUserId,
        uploadedBySide: "operator" as const,
        nameSource: "original" as const,
        nameStatus: "ready" as const,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    await expect(
      f.operator.mutation(api.procurementProposals.fileEmailQuote, {
        emailThreadId,
        outreachId: outreach.outreachId,
        clientFileIds: [unrelatedClientFileId],
      }),
    ).rejects.toThrow(/not an active file on this email thread/);

    const filed = await f.operator.mutation(
      api.procurementProposals.fileEmailQuote,
      {
        emailThreadId,
        outreachId: outreach.outreachId,
        clientFileIds: [quoteFileId],
      },
    );
    const documents = await f.t.run((ctx) =>
      ctx.db
        .query("procurementProposalDocuments")
        .withIndex("proposal", (index) =>
          index.eq("proposalId", filed.proposalId),
        )
        .collect(),
    );
    expect(documents).toMatchObject([{ fileName: "broker-quote.pdf" }]);

    const afterFiling = await f.operator.query(
      api.procurementRequests.previewEmailReconciliation,
      { emailThreadId },
    );
    expect(afterFiling.unfiledFiles).toMatchObject([
      { clientFileId: signatureFileId },
    ]);

    // Threads archived before that control was retired still exist, and the
    // preview must stop offering to file from them.
    await f.t.run((ctx) =>
      ctx.db.patch(emailThreadId, { archivedAt: dayjs().valueOf() }),
    );
    const archivedPreview = await f.operator.query(
      api.procurementRequests.previewEmailReconciliation,
      { emailThreadId },
    );
    expect(archivedPreview.filable).toBe(false);
    expect(archivedPreview.nextActions).toEqual([]);
    await expect(
      f.operator.mutation(api.procurementProposals.fileEmailQuote, {
        emailThreadId,
        outreachId: outreach.outreachId,
      }),
    ).rejects.toThrow(/not found/);
  });

  test("reconciles and atomically files forwarded quote attachments", async () => {
    const f = await fixture();
    const request = await createRequest(f, "Forwarded broker quote");
    const outreach = await f.operator.mutation(
      api.procurementRequests.createOutreach,
      {
        requestId: request.requestId,
        brokerOrgId: f.brokerOrgId,
        contactEmail: "broker@example.com",
      },
    );
    const otherOutreach = await f.operator.mutation(
      api.procurementRequests.createOutreach,
      {
        requestId: request.requestId,
        brokerOrgId: f.brokerOrgId,
        contactEmail: "other-broker@example.com",
      },
    );
    const bytes = new TextEncoder().encode("source-backed quote");
    const storageId = await f.t.run((ctx) =>
      ctx.storage.store(new Blob([bytes], { type: "application/pdf" })),
    );
    const imported = await f.t.mutation(
      internal.procurementRequests.ingestEmailInternal,
      {
        addressedRequestId: request.requestId,
        resendEmailId: "reconcile-quote-1",
        messageId: "<reconcile-quote-1@example.com>",
        references: [],
        subject: "Quote attached",
        fromEmail: "broker@example.com",
        toAddresses: [],
        ccAddresses: [],
        bccAddresses: [],
        currentText: "Please review our quote",
        participantEmails: ["broker@example.com"],
        attachments: [
          {
            fileId: storageId,
            filename: "broker-quote.pdf",
            contentType: "application/pdf",
            size: bytes.byteLength,
          },
        ],
        receivedAt: 1,
      },
    );
    if (imported.duplicate) throw new Error("Expected email import");
    const emailThreadId = imported.threadId as Id<"procurementEmailThreads">;

    const threadId = await f.operator.mutation(
      api.operatorAgent.createThread,
      {},
    );
    const agentPreview = await f.t.action(
      internal.operatorAgent.invokeRegisteredToolInternal,
      {
        operatorUserId: f.operatorUserId,
        threadId,
        channel: "mcp",
        toolName: "preview_procurement_email_reconciliation",
        input: { procurementEmailThreadId: emailThreadId },
        idempotencyKey: "preview-forwarded-broker-quote",
      },
    );
    expect(agentPreview.outcome).toMatchObject({
      status: "succeeded",
      result: {
        requestId: request.requestId,
        unfiledFiles: [{ name: "broker-quote.pdf" }],
        outreachInference: {
          status: "exact",
          candidates: [{ outreachId: outreach.outreachId }],
        },
        nextActions: [
          {
            tool: "file_procurement_email_quote",
            input: { procurementOutreachId: outreach.outreachId },
          },
        ],
      },
    });

    const requested = await f.t.action(
      internal.operatorAgent.invokeRegisteredToolInternal,
      {
        operatorUserId: f.operatorUserId,
        threadId,
        channel: "mcp",
        toolName: "file_procurement_email_quote",
        input: {
          procurementEmailThreadId: emailThreadId,
          procurementOutreachId: outreach.outreachId,
        },
        idempotencyKey: "file-forwarded-broker-quote",
      },
    );
    if (
      requested.outcome.status !== "confirmation_required" ||
      !requested.outcome.confirmationId
    )
      throw new Error("Expected exact proposal-filing confirmation");
    await expect(
      f.t.mutation(internal.operatorAgent.confirmActionInternal, {
        operatorUserId: f.operatorUserId,
        threadId,
        confirmationId: requested.outcome.confirmationId,
        decision: "approve",
        channel: "mcp",
      }),
    ).resolves.toMatchObject({ status: "completed" });
    const state = await f.t.run(async (ctx) => {
      const proposals = await ctx.db
        .query("procurementProposals")
        .withIndex("request", (query) =>
          query.eq("requestId", request.requestId),
        )
        .collect();
      const documents = await ctx.db
        .query("procurementProposalDocuments")
        .collect();
      const jobs = await ctx.db
        .query("procurementProposalExtractionJobs")
        .collect();
      return { proposals, documents, jobs };
    });
    expect(state.proposals).toHaveLength(1);
    expect(state.documents).toMatchObject([
      {
        proposalId: state.proposals[0]._id,
        clientFileId: imported.clientFileIds[0],
        fileName: "broker-quote.pdf",
      },
    ]);
    expect(state.jobs).toHaveLength(1);

    const replay = await f.operator.mutation(
      api.procurementProposals.fileEmailQuote,
      { emailThreadId, outreachId: outreach.outreachId },
    );
    expect(replay).toMatchObject({
      proposalId: state.proposals[0]._id,
      status: "already_filed",
      extraction: { jobId: state.jobs[0]._id, reused: true },
    });

    const [after, otherOutreachPreview, details] = await Promise.all([
      f.operator.query(api.procurementRequests.previewEmailReconciliation, {
        emailThreadId,
      }),
      f.operator.query(api.procurementRequests.previewEmailReconciliation, {
        emailThreadId,
        outreachId: otherOutreach.outreachId,
      }),
      f.operator.query(api.procurementRequests.get, {
        requestId: request.requestId,
      }),
    ]);
    expect(after.unfiledFiles).toEqual([]);
    expect(after.nextActions).toEqual([]);
    expect(otherOutreachPreview.unfiledFiles).toMatchObject([
      { clientFileId: imported.clientFileIds[0], name: "broker-quote.pdf" },
    ]);
    expect(otherOutreachPreview.nextActions).toEqual([]);
    expect(details.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          summary: "Filed proposal from Broker for Forwarded broker quote",
        }),
      ]),
    );
  });

  test("approves a month-old standalone client proposal through the exact-confirmed shared registry", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const threadId = await f.t.mutation(
      internal.operatorAgent.createOrGetChannelThreadInternal,
      {
        operatorUserId: f.operatorUserId,
        channel: "mcp",
        conversationKey: "mcp:create-procurement-client",
      },
    );
    const invoke = () =>
      f.t.action(internal.operatorAgent.invokeRegisteredToolInternal, {
        operatorUserId: f.operatorUserId,
        threadId,
        channel: "mcp",
        toolName: "create_client_organization",
        input: { name: "Agent-created client" },
        idempotencyKey: "create-agent-client-once",
      });
    const requested = await invoke();
    if (
      requested.outcome.status !== "confirmation_required" ||
      !requested.outcome.confirmationId
    )
      throw new Error("Expected exact client-creation confirmation");
    vi.setSystemTime(dayjs().add(30, "day").valueOf());
    await expect(
      f.t.mutation(internal.operatorAgent.confirmActionInternal, {
        operatorUserId: f.operatorUserId,
        threadId,
        confirmationId: requested.outcome.confirmationId,
        decision: "approve",
        channel: "mcp",
      }),
    ).resolves.toMatchObject({ status: "queued" });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);

    const clients = await f.t.run((ctx) =>
      ctx.db
        .query("organizations")
        .withIndex("type", (query) => query.eq("type", "client"))
        .collect(),
    );
    expect(clients).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Agent-created client",
          operatorStatus: "onboarding",
          allowedEmails: [],
        }),
      ]),
    );
    expect(await invoke()).toMatchObject({
      outcome: { status: "succeeded", idempotent: true },
    });
    await expect(
      f.t.action(internal.operatorAgent.invokeRegisteredToolInternal, {
        operatorUserId: f.operatorUserId,
        threadId,
        channel: "mcp",
        toolName: "create_client_organization",
        input: { name: "Agent-created client" },
        idempotencyKey: "create-agent-client-duplicate",
      }),
    ).resolves.toMatchObject({ outcome: { status: "failed" } });
  });

  test("returns concurrent confirmation contention without leaving the blocked invocation active", async () => {
    const f = await fixture();
    const threadId = await f.t.mutation(
      internal.operatorAgent.createOrGetChannelThreadInternal,
      {
        operatorUserId: f.operatorUserId,
        channel: "mcp",
        conversationKey: "mcp:confirmation-contention",
      },
    );
    const invoke = (name: string, idempotencyKey: string) =>
      f.t.action(internal.operatorAgent.invokeRegisteredToolInternal, {
        operatorUserId: f.operatorUserId,
        threadId,
        channel: "mcp",
        toolName: "create_client_organization",
        input: { name },
        idempotencyKey,
      });

    const results = await Promise.all([
      invoke("First pending client", "first-pending-client"),
      invoke("Second pending client", "second-pending-client"),
    ]);
    const first = results.find(
      (result) => result.outcome.status === "confirmation_required",
    );
    const blocked = results.find(
      (result) => result.outcome.status === "blocked_by_confirmation",
    );
    if (
      !first ||
      first.outcome.status !== "confirmation_required" ||
      !first.outcome.confirmationId ||
      !blocked ||
      blocked.outcome.status !== "blocked_by_confirmation"
    ) {
      throw new Error("Expected one confirmation and one blocked invocation");
    }

    expect(blocked.outcome).toMatchObject({
      status: "blocked_by_confirmation",
      confirmationId: first.outcome.confirmationId,
      runId: first.runId,
      summary: first.outcome.summary,
    });
    const state = await f.t.run(async (ctx) => ({
      runs: await ctx.db
        .query("operatorAgentRuns")
        .withIndex("thread_status", (query) => query.eq("threadId", threadId))
        .collect(),
      confirmations: await ctx.db
        .query("operatorAgentConfirmations")
        .withIndex("thread_status", (query) => query.eq("threadId", threadId))
        .collect(),
      clients: await ctx.db
        .query("organizations")
        .withIndex("type", (query) => query.eq("type", "client"))
        .collect(),
    }));
    expect(state.runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: first.runId,
          status: "waiting_confirmation",
        }),
        expect.objectContaining({ _id: blocked.runId, status: "completed" }),
      ]),
    );
    expect(state.runs.filter((run) => run.status === "running")).toEqual([]);
    expect(state.confirmations).toEqual([
      expect.objectContaining({
        _id: first.outcome.confirmationId,
        status: "pending",
      }),
    ]);
    expect(
      state.clients.filter(
        (client) =>
          client.name === "First pending client" ||
          client.name === "Second pending client",
      ),
    ).toEqual([]);
  });

  test("keeps delayed approvals pending, revalidates changed records, and lets cancellation unblock the thread", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const threadId = await f.t.mutation(
      internal.operatorAgent.createOrGetChannelThreadInternal,
      {
        operatorUserId: f.operatorUserId,
        channel: "mcp",
        conversationKey: "mcp:delayed-confirmation",
      },
    );
    const invoke = (name: string, idempotencyKey: string) =>
      f.t.action(internal.operatorAgent.invokeRegisteredToolInternal, {
        operatorUserId: f.operatorUserId,
        threadId,
        channel: "mcp",
        toolName: "create_client_organization",
        input: { name },
        idempotencyKey,
      });
    const requested = await invoke("Delayed client", "delayed-client");
    if (
      requested.outcome.status !== "confirmation_required" ||
      !requested.outcome.confirmationId
    ) {
      throw new Error("Expected client creation confirmation");
    }
    const confirmationId = requested.outcome.confirmationId;
    // A legacy timer must also leave an approval pending across the rollout.
    await f.t.run((ctx) =>
      ctx.db.patch(confirmationId, {
        expiresAt: dayjs().add(10, "minute").valueOf(),
      }),
    );
    vi.setSystemTime(dayjs().add(30, "day").valueOf());
    await f.t.mutation(internal.operatorAgent.expireConfirmationInternal, {
      confirmationId,
      channel: "mcp",
    });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(
      await f.t.query(internal.operatorAgent.getPendingConfirmationInternal, {
        operatorUserId: f.operatorUserId,
        threadId,
      }),
    ).toMatchObject({ _id: confirmationId });
    expect(
      await f.operator.query(api.operatorAgent.getThread, { threadId }),
    ).toMatchObject({
      confirmations: [
        expect.objectContaining({
          _id: confirmationId,
          actionable: true,
          state: "pending",
        }),
      ],
    });
    expect(
      (await invoke("Other client", "blocked-client")).outcome,
    ).toMatchObject({
      status: "blocked_by_confirmation",
      confirmationId,
    });

    await f.t.run((ctx) =>
      ctx.db.insert("organizations", {
        name: "Delayed client",
        type: "client",
      }),
    );
    await expect(
      f.t.mutation(internal.operatorAgent.confirmActionInternal, {
        operatorUserId: f.operatorUserId,
        threadId,
        confirmationId,
        decision: "approve",
        channel: "mcp",
      }),
    ).rejects.toThrow(/already/i);
    expect(await f.t.run((ctx) => ctx.db.get(confirmationId))).toMatchObject({
      status: "pending",
    });
    expect(
      await f.t.mutation(internal.operatorAgent.confirmActionInternal, {
        operatorUserId: f.operatorUserId,
        threadId,
        confirmationId,
        decision: "reject",
        channel: "mcp",
      }),
    ).toMatchObject({ status: "rejected" });
    expect(
      (await invoke("Other client", "unblocked-client")).outcome,
    ).toMatchObject({
      status: "confirmation_required",
    });
  });
});

describe("operator procurement tools", () => {
  test("governs operator Slack messages as exact-confirmed external sends", () => {
    expect(
      getOperatorAgentToolSpec("send_operator_slack_message"),
    ).toMatchObject({
      capability: "operator.channels.write",
      effect: "external_send",
      confirmation: "exact",
      execution: "action",
    });
    expect(
      parseOperatorAgentToolInput("send_operator_slack_message", {
        recipientEmail: "adyan@spot.insure",
        message: "Procurement records are updated.",
      }),
    ).toEqual({
      recipientEmail: "adyan@spot.insure",
      message: "Procurement records are updated.",
    });
  });

  test("preflights an operator Slack recipient before requesting confirmation", async () => {
    vi.stubEnv("SLACK_CLARITY_TEAM_ID", "T-HOST");
    const f = await fixture();
    await f.t.run(async (ctx) => {
      const recipientUserId = await ctx.db.insert("users", {
        name: "Adyan",
        email: "adyan@spot.insure",
        accountKind: "operator",
      });
      await ctx.db.insert("operatorProfiles", {
        userId: recipientUserId,
        email: "adyan@spot.insure",
        role: "operator",
        status: "active",
        slackTeamId: "T-HOST",
        slackUserId: "U-ADYAN",
        createdAt: dayjs().valueOf(),
        updatedAt: dayjs().valueOf(),
      });
    });
    const threadId = await f.t.mutation(
      internal.operatorAgent.createOrGetChannelThreadInternal,
      {
        operatorUserId: f.operatorUserId,
        channel: "mcp",
        conversationKey: "mcp:operator-slack-message",
      },
    );
    const requested = await f.t.action(
      internal.operatorAgent.invokeRegisteredToolInternal,
      {
        operatorUserId: f.operatorUserId,
        threadId,
        channel: "mcp",
        toolName: "send_operator_slack_message",
        input: {
          recipientEmail: "adyan@spot.insure",
          message: "Procurement records are updated.",
        },
        idempotencyKey: "operator-slack-message-confirmation",
      },
    );
    expect(requested.outcome).toMatchObject({
      status: "confirmation_required",
      summary: "Send a Slack direct message to adyan@spot.insure",
    });
  });

  test("keeps every browser procurement capability agent-backed or explicitly excepted", () => {
    expect(PROCUREMENT_CAPABILITY_MANIFEST_VERSION).toBe(1);
    expect(PROCUREMENT_CAPABILITY_EXCEPTIONS).toEqual([
      expect.objectContaining({ id: "packet.resolve_generated_change" }),
    ]);
    for (const capability of PROCUREMENT_CAPABILITIES) {
      if (!("agentTools" in capability)) continue;
      expect(capability.agentTools.length, capability.id).toBeGreaterThan(0);
      for (const toolName of capability.agentTools) {
        expect(getOperatorAgentToolSpec(toolName), capability.id).toBeTruthy();
      }
    }
  });

  test("keeps procurement reads unconfirmed and every write exact-confirmed", () => {
    for (const name of [
      "list_procurement_requests",
      "get_procurement_request",
      "get_procurement_forwarding_address",
      "list_procurement_email_threads",
      "get_procurement_email_thread",
      "preview_procurement_email_reconciliation",
      "lookup_procurement_packet",
      "preview_broker_packet",
      "list_broker_packet_links",
    ]) {
      expect(getOperatorAgentToolSpec(name)).toMatchObject({
        capability: "operator.procurement.read",
        effect: "read",
        confirmation: "none",
        execution: "mutation",
      });
    }

    for (const name of [
      "create_procurement_request",
      "update_procurement_request",
      "create_procurement_broker_outreach",
      "update_procurement_broker_outreach",
      "create_procurement_file_item",
      "update_procurement_file_item",
      "update_procurement_email_thread",
      "update_procurement_packet_section",
      "file_procurement_proposal",
      "file_procurement_email_quote",
      "archive_procurement_proposal",
    ]) {
      expect(getOperatorAgentToolSpec(name)).toMatchObject({
        capability: "operator.procurement.write",
        effect: "reversible_write",
        confirmation: "exact",
        execution: "mutation",
      });
    }

    expect(getOperatorAgentToolSpec("create_broker_packet_link")).toMatchObject(
      { effect: "access_change", confirmation: "exact" },
    );
    expect(
      getOperatorAgentToolSpec("generate_procurement_proposal_review"),
    ).toMatchObject({ confirmation: "exact", execution: "action" });
    expect(
      getOperatorAgentToolSpec("create_client_organization"),
    ).toMatchObject({
      capability: "operator.organizations.write",
      effect: "reversible_write",
      confirmation: "exact",
      execution: "action",
    });
    for (const name of [
      "retry_procurement_proposal_extraction",
      "cancel_procurement_proposal_extraction",
    ] as const) {
      expect(getOperatorAgentToolSpec(name)).toMatchObject({
        capability: "operator.extractions.write",
        effect: "reversible_write",
        confirmation: "exact",
        execution: "mutation",
      });
    }
  });

  test("files proposals as one artifact-backed command", () => {
    const input = parseOperatorAgentToolInput("file_procurement_proposal", {
      procurementRequestId: "request-1",
      procurementOutreachId: "outreach-1",
      clientFileIds: ["client-file-1"],
      procurementFileItemIds: ["file-item-1"],
      attachmentFileIds: ["quote.pdf"],
    });
    expect(input).toMatchObject({
      procurementRequestId: "request-1",
      procurementOutreachId: "outreach-1",
      attachmentFileIds: ["quote.pdf"],
    });
    expect(() =>
      parseOperatorAgentToolInput("file_procurement_proposal", {
        procurementRequestId: "request-1",
        procurementOutreachId: "outreach-1",
      }),
    ).toThrow("At least one proposal artifact");
  });

  test("files an imported email quote only from exact thread and outreach references", () => {
    expect(
      parseOperatorAgentToolInput("file_procurement_email_quote", {
        procurementEmailThreadId: "email-thread-1",
        procurementOutreachId: "outreach-1",
      }),
    ).toEqual({
      procurementEmailThreadId: "email-thread-1",
      procurementOutreachId: "outreach-1",
    });
  });
});
