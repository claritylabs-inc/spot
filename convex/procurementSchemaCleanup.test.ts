/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, test } from "vitest";

import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const audit = makeFunctionReference<"query">("procurementSchemaCleanup:auditPage");
const migrate = makeFunctionReference<"mutation">("procurementSchemaCleanup:migratePage");

test("cleanup is resumable and preserves packet evidence and confirmed review decisions", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const user = await ctx.db.insert("users", { name: "Operator" });
    const org = await ctx.db.insert("organizations", { name: "Client" });
    const broker = await ctx.db.insert("organizations", { name: "Broker", type: "broker" });
    const stamps = { createdByUserId: user, updatedByUserId: user, createdAt: 1, updatedAt: 1 };
    const request = await ctx.db.insert("procurementRequests", {
      clientOrgId: org, title: "Renewal", narrative: "Cyber cover", status: "draft",
      inboxToken: "test", packetRevision: 4, requirementRevision: 2, specificationRevision: 3,
      ...stamps,
    });
    const outreach = await ctx.db.insert("procurementBrokerOutreaches", {
      requestId: request, clientOrgId: org, brokerOrgId: broker, brokerName: "Broker",
      contactEmail: "contact@example.com", contactSnapshot: { email: "contact@example.com" },
      status: "request_sent", applicationQuestions: [],
      packetSnapshot: { requirementRevision: 2, specificationRevision: 3, requirementIds: [], specifications: [], fileItemIds: [], capturedAt: 1 },
      ...stamps,
    });
    const proposal = await ctx.db.insert("procurementProposals", {
      requestId: request, clientOrgId: org, brokerOrgId: broker, outreachId: outreach,
      status: "reviewed", extractionFingerprint: "source", ...stamps,
    });
    const review = await ctx.db.insert("procurementProposalReviews", {
      proposalId: proposal, requestId: request, clientOrgId: org,
      extractionFingerprint: "source", packetRevision: 4,
      requirementRevision: 2, specificationRevision: 3,
      modelConclusion: "has_gaps", staffConclusion: "has_gaps", findings: [],
      confirmedByUserId: user, confirmedAt: 2, createdAt: 1, updatedAt: 2,
    });
    const link = await ctx.db.insert("procurementPacketLinks", {
      requestId: request, clientOrgId: org, tokenHash: "token", recipientLabel: "Broker",
      packetRevisionAtIssue: 4, sectionSnapshot: [{ key: "risk", heading: "Risk", body: "Original packet", order: 0 }],
      artifactSnapshot: [], viewCount: 0, createdByUserId: user, createdAt: 1, updatedAt: 1,
    });
    return { request, outreach, proposal, review, link };
  });
  const before = await t.run(async (ctx) => ({ review: await ctx.db.get(ids.review), link: await ctx.db.get(ids.link) }));
  for (const table of ["procurementBrokerOutreaches", "procurementRequests", "procurementProposalReviews"]) {
    expect(await t.query(audit, { table, cursor: null })).toMatchObject({ changed: 1, unboundReviews: 0 });
    expect(await t.mutation(migrate, { table, cursor: null })).toMatchObject({ changed: 1, isDone: true });
    expect(await t.mutation(migrate, { table, cursor: null })).toMatchObject({ changed: 0 });
    expect(await t.query(audit, { table, cursor: null })).toMatchObject({ changed: 0, unboundReviews: 0 });
  }
  await t.run(async (ctx) => {
    expect(await ctx.db.get(ids.link)).toEqual(before.link);
    const { requirementRevision: _requirement, specificationRevision: _specification, ...retained } = before.review!;
    expect(await ctx.db.get(ids.review)).toEqual(retained);
    expect(await ctx.db.get(ids.outreach)).toMatchObject({ contactEmail: "contact@example.com", status: "request_sent" });
    expect(await ctx.db.get(ids.request)).toMatchObject({ packetRevision: 4, narrative: "Cyber cover" });
  });
});

test("cleanup traverses every bounded page", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const user = await ctx.db.insert("users", { name: "Operator" });
    const org = await ctx.db.insert("organizations", { name: "Client" });
    for (let index = 0; index < 101; index += 1) {
      await ctx.db.insert("procurementRequests", {
        clientOrgId: org, title: `Request ${index}`, narrative: "Request", status: "draft",
        inboxToken: `token-${index}`, requirementRevision: 0,
        createdByUserId: user, updatedByUserId: user, createdAt: 1, updatedAt: 1,
      });
    }
  });
  const first = await t.mutation(migrate, { table: "procurementRequests", cursor: null });
  expect(first).toMatchObject({ scanned: 100, changed: 100, isDone: false });
  expect(await t.mutation(migrate, { table: "procurementRequests", cursor: first.cursor })).toMatchObject({ scanned: 1, changed: 1, isDone: true });
});
