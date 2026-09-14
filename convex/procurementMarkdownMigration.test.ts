/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, test, vi } from "vitest";
import schema from "./schema";
import { getMarkdownDocument } from "./markdownDocuments";
import { parseMarkdownDocument } from "./lib/markdownDocument";
import { readPacketProjection } from "./lib/packetDocuments";

const modules = import.meta.glob("./**/*.ts");
const migrate = makeFunctionReference<"mutation">(
  "procurementMarkdownMigration:migratePage",
);
const audit = makeFunctionReference<"query">(
  "procurementMarkdownMigration:auditPage",
);

test("Markdown migration preserves intake, private notes, source mappings, and issued packet snapshots", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const user = await ctx.db.insert("users", { name: "Operator" });
      const org = await ctx.db.insert("organizations", {
        name: "Client",
        type: "client",
      });
      const stamps = {
        createdByUserId: user,
        updatedByUserId: user,
        createdAt: 1,
        updatedAt: 1,
      };
      const request = await ctx.db.insert("procurementRequests", {
        clientOrgId: org,
        title: "Renewal",
        narrative: "Original intake\n\n| Limit |\n| --- |\n| 1m |",
        status: "draft",
        inboxToken: "test",
        packetRevision: 2,
        ...stamps,
      });
      const shared = await ctx.db.insert("procurementPacketSections", {
        requestId: request,
        clientOrgId: org,
        key: "summary",
        heading: "Summary",
        body: "Shared risk description",
        order: 0,
        audience: "broker",
        source: "manual",
        ...stamps,
      });
      const privateSection = await ctx.db.insert("procurementPacketSections", {
        requestId: request,
        clientOrgId: org,
        key: "market_strategy",
        heading: "Market strategy",
        body: "Private negotiation target",
        proposedBody: "Private proposed strategy",
        order: 1,
        audience: "operator",
        source: "manual",
        ...stamps,
      });
      const outreach = await ctx.db.insert("procurementBrokerOutreaches", {
        requestId: request,
        clientOrgId: org,
        brokerName: "Broker",
        status: "observed",
        notes: "First contact",
        applicationQuestions: ["Provide loss runs"],
        quoteSummary: "Legacy quote",
        ...stamps,
      });
      const file = await ctx.db.insert("procurementFileItems", {
        requestId: request,
        clientOrgId: org,
        purpose: "requested_document",
        label: "Loss runs",
        status: "requested",
        notes: "Awaiting three years",
        createdAt: 1,
        updatedAt: 1,
      });
      const link = await ctx.db.insert("procurementPacketLinks", {
        requestId: request,
        clientOrgId: org,
        tokenHash: "issued-token",
        recipientLabel: "Broker",
        packetRevisionAtIssue: 2,
        sectionSnapshot: [
          {
            key: "summary",
            heading: "Summary",
            body: "The exact issued content",
            order: 0,
          },
        ],
        artifactSnapshot: [],
        viewCount: 0,
        createdByUserId: user,
        createdAt: 1,
        updatedAt: 1,
      });
      return { request, org, shared, privateSection, outreach, file, link };
    });
    const originalLink = await t.run((ctx) => ctx.db.get(ids.link));
    for (const table of [
      "procurementRequests",
      "procurementBrokerOutreaches",
      "procurementFileItems",
      "procurementPacketSections",
    ]) {
      let cursor = null;
      for (;;) {
        const result = await t.mutation(migrate, { table, cursor });
        if (result.isDone) break;
        cursor = result.cursor;
      }
      expect(await t.query(audit, { table, cursor: null })).toMatchObject({
        remaining: 0,
      });
    }
    await t.run(async (ctx) => {
      const request = (await ctx.db.get(ids.request))!;
      const shared = await readPacketProjection(ctx, request, "client");
      expect(shared.markdown).toContain("Shared risk description");
      expect(shared.markdown).not.toContain("Private negotiation target");
      const operator = await readPacketProjection(ctx, request, "operator");
      expect(operator.markdown).toContain("Private negotiation target");
      const privateDoc = await getMarkdownDocument(ctx, {
        orgId: ids.org,
        requestId: ids.request,
        kind: "packet",
        filename: "operator-packet.md",
      });
      expect(privateDoc?.markdown).toContain("Private proposed strategy");
      expect(privateDoc?.markdown).toContain(ids.privateSection);
      const intake = await getMarkdownDocument(ctx, {
        orgId: ids.org,
        requestId: ids.request,
        kind: "request_intake",
      });
      expect(parseMarkdownDocument(intake!.markdown).body).toContain("| 1m |");
      const log = await getMarkdownDocument(ctx, {
        orgId: ids.org,
        outreachId: ids.outreach,
        kind: "outreach_log",
      });
      expect(log?.markdown).toContain("First contact");
      expect(log?.markdown).toContain("Provide loss runs");
      expect(log?.markdown).toContain("Legacy quote");
      const notes = await getMarkdownDocument(ctx, {
        orgId: ids.org,
        fileItemId: ids.file,
        kind: "procurement_file_notes",
      });
      expect(notes?.markdown).toContain("Awaiting three years");
      expect(await ctx.db.get(ids.link)).toEqual(originalLink);
      expect(
        await ctx.db.query("procurementPacketSections").collect(),
      ).toHaveLength(0);
    });
  } finally {
    vi.useRealTimers();
  }
});

test("legacy packet rows cannot be removed before their Markdown source mapping exists", async () => {
  const t = convexTest(schema, modules);
  const rowId = await t.run(async (ctx) => {
    const user = await ctx.db.insert("users", { name: "Operator" });
    const org = await ctx.db.insert("organizations", { name: "Client" });
    const stamps = {
      createdByUserId: user,
      updatedByUserId: user,
      createdAt: 1,
      updatedAt: 1,
    };
    const request = await ctx.db.insert("procurementRequests", {
      clientOrgId: org,
      title: "Request",
      narrative: "Intake",
      status: "draft",
      inboxToken: "token",
      ...stamps,
    });
    return ctx.db.insert("procurementPacketSections", {
      requestId: request,
      clientOrgId: org,
      key: "summary",
      heading: "Summary",
      body: "Do not lose",
      order: 0,
      audience: "broker",
      source: "manual",
      ...stamps,
    });
  });
  await expect(
    t.mutation(migrate, { table: "procurementPacketSections", cursor: null }),
  ).rejects.toThrow("Migrate and verify");
  expect((await t.run((ctx) => ctx.db.get(rowId)))?.body).toBe("Do not lose");
});
