/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, test } from "vitest";
import schema from "./schema";
import {
  readPacketDocuments,
  readPacketProjection,
} from "./lib/packetDocuments";
import { updatePacketDocumentByOperator } from "./procurementPacket";
import { stringifyMarkdownDocument } from "./lib/markdownDocument";
const modules = import.meta.glob("./**/*.ts");
const migrate = makeFunctionReference<"mutation">(
  "procurementMarkdownMigration:migratePage",
);
const audit = makeFunctionReference<"query">(
  "procurementMarkdownMigration:auditPage",
);

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const user = await ctx.db.insert("users", {
      accountKind: "operator",
      email: "operator@example.test",
    });
    await ctx.db.insert("operatorProfiles", {
      userId: user,
      email: "operator@example.test",
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
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
      narrative: "Original intake",
      status: "draft",
      inboxToken: "test",
      packetRevision: 2,
      ...stamps,
    });
    await ctx.db.insert("procurementPacketSections", {
      requestId: request,
      clientOrgId: org,
      key: "intake_narrative",
      heading: "Request",
      body: "Original intake",
      audience: "client",
      order: 0,
      source: "manual",
      ...stamps,
    });
    await ctx.db.insert("procurementPacketSections", {
      requestId: request,
      clientOrgId: org,
      key: "summary",
      heading: "Coverage",
      body: "Published coverage",
      proposedBody: "Unpublished private proposal",
      audience: "broker",
      order: 1,
      source: "manual",
      ...stamps,
    });
    await ctx.db.insert("markdownDocuments", {
      orgId: org,
      requestId: request,
      kind: "packet",
      filename: "public.md",
      markdown: stringifyMarkdownDocument(
        { visibility: "private" },
        "Private despite old filename",
      ),
      revision: 4,
      updatedAt: 1,
    });
    await ctx.db.insert("markdownDocuments", {
      orgId: org,
      requestId: request,
      kind: "packet",
      filename: "old-shared.md",
      markdown: stringifyMarkdownDocument(
        { visibility: "shared", proposals: ["Internal proposal metadata"] },
        "Old shared file",
      ),
      revision: 1,
      updatedAt: 1,
    });
    for (const brokerName of ["First Broker", "Second Broker"]) {
      const outreachId = await ctx.db.insert("procurementBrokerOutreaches", {
        requestId: request,
        clientOrgId: org,
        brokerName,
        status: "cannot_handle",
        ...stamps,
      });
      await ctx.db.insert("markdownDocuments", {
        orgId: org,
        outreachId,
        kind: "outreach_log",
        filename: "market-log.md",
        markdown: stringifyMarkdownDocument(
          { visibility: "private" },
          "Declined",
        ),
        revision: 1,
        updatedAt: 1,
      });
    }
    const fileItemId = await ctx.db.insert("procurementFileItems", {
      requestId: request,
      clientOrgId: org,
      purpose: "requested_document",
      label: "Loss runs",
      status: "requested",
      notes: "Private internal file note",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("markdownDocuments", {
      orgId: org,
      fileItemId,
      kind: "procurement_file_notes",
      filename: "file-notes.md",
      markdown: stringifyMarkdownDocument(
        { visibility: "shared" },
        "Shared file note",
      ),
      revision: 1,
      updatedAt: 1,
    });
    const link = await ctx.db.insert("procurementPacketLinks", {
      requestId: request,
      clientOrgId: org,
      tokenHash: "historical",
      recipientLabel: "Broker",
      packetRevisionAtIssue: 2,
      sectionSnapshot: [
        {
          key: "issued",
          heading: "Issued",
          body: "Exact issued text",
          order: 0,
        },
      ],
      artifactSnapshot: [],
      viewCount: 0,
      createdByUserId: user,
      createdAt: 1,
      updatedAt: 1,
    });
    return { user, org, request, link };
  });
  return { t, ...ids };
}

test("consolidation preserves attribution and immutable snapshots, keeps unpublished metadata private, and reruns unchanged", async () => {
  const f = await fixture();
  const link = await f.t.run((ctx) => ctx.db.get(f.link));
  for (const table of [
    "procurementRequests",
    "procurementBrokerOutreaches",
    "procurementFileItems",
    "procurementPacketSections",
  ]) {
    let cursor: string | null = null;
    for (;;) {
      const page: { isDone: boolean; cursor: string } = await f.t.mutation(
        migrate,
        { table, cursor },
      );
      if (page.isDone) break;
      cursor = page.cursor;
    }
    expect(await f.t.query(audit, { table, cursor: null })).toMatchObject({
      remaining: 0,
    });
  }
  const saved = await f.t.run(async (ctx) => {
    const request = (await ctx.db.get(f.request))!;
    const shared = await readPacketProjection(ctx, request, "client");
    expect(shared.documents.map((document) => document.filename)).toEqual([
      "public.md",
    ]);
    for (const text of [
      "Original intake",
      "Published coverage",
      "Old shared file",
      "Shared file note",
    ])
      expect(shared.markdown).toContain(text);
    expect(shared.markdown.match(/Original intake/g)).toHaveLength(1);
    for (const text of [
      "Unpublished private proposal",
      "Internal proposal metadata",
      "Private despite old filename",
      "Private internal file note",
      "Declined",
    ])
      expect(JSON.stringify(shared)).not.toContain(text);
    const docs = await readPacketDocuments(ctx, request);
    const privateFile = docs.find(
      (document) => document.filename === "private.md",
    )!;
    for (const text of [
      "First Broker",
      "Second Broker",
      "Unpublished private proposal",
      "Internal proposal metadata",
      "Private despite old filename",
      "Private internal file note",
    ])
      expect(privateFile.markdown).toContain(text);
    expect(privateFile.markdown.match(/\nDeclined/g)).toHaveLength(2);
    expect(await ctx.db.query("markdownDocuments").collect()).toHaveLength(2);
    expect(await ctx.db.get(f.link)).toEqual(link);
    return docs;
  });
  await f.t.mutation(migrate, { table: "procurementRequests", cursor: null });
  expect(
    await f.t.run(async (ctx) =>
      readPacketDocuments(ctx, (await ctx.db.get(f.request))!),
    ),
  ).toEqual(saved);
});

test("editing both files with the displayed revisions survives first-write consolidation", async () => {
  const f = await fixture();
  const documents = await f.t.run(async (ctx) =>
    readPacketDocuments(ctx, (await ctx.db.get(f.request))!),
  );
  for (const document of documents)
    await f.t.run((ctx) =>
      updatePacketDocumentByOperator(ctx, {
        operatorUserId: f.user,
        requestId: f.request,
        filename: document.filename,
        expectedRevision: document.revision,
        markdown: `${document.markdown}\n\nIntentional ${document.filename} edit`,
      }),
    );
  const saved = await f.t.run(async (ctx) =>
    readPacketDocuments(ctx, (await ctx.db.get(f.request))!),
  );
  expect(saved.map((document) => document.filename)).toEqual([
    "private.md",
    "public.md",
  ]);
  expect(
    saved.every((document) =>
      document.markdown.includes(`Intentional ${document.filename} edit`),
    ),
  ).toBe(true);
  await expect(
    f.t.run((ctx) =>
      updatePacketDocumentByOperator(ctx, {
        operatorUserId: f.user,
        requestId: f.request,
        filename: "other.md",
        expectedRevision: 0,
        markdown: "No",
      }),
    ),
  ).rejects.toThrow("private.md or public.md");
});

test("retired document verification detects notes whose owner was deleted", async () => {
  const f = await fixture();
  await f.t.mutation(migrate, { table: "procurementRequests", cursor: null });
  const verify = makeFunctionReference<"query">(
    "procurementMarkdownMigration:verifyRetiredDocuments",
  );
  expect(await f.t.query(verify, {})).toMatchObject({ complete: true });
  const orphanId = await f.t.run(async (ctx) => {
    const fileItemId = await ctx.db.insert("procurementFileItems", {
      requestId: f.request,
      clientOrgId: f.org,
      purpose: "requested_document",
      label: "Removed file",
      status: "requested",
      createdAt: 1,
      updatedAt: 1,
    });
    const id = await ctx.db.insert("markdownDocuments", {
      orgId: f.org,
      kind: "procurement_file_notes",
      fileItemId,
      filename: "notes.md",
      markdown: "Unmigrated note",
      revision: 1,
      updatedAt: 1,
    });
    await ctx.db.delete(fileItemId);
    return id;
  });
  expect(await f.t.query(verify, {})).toMatchObject({
    complete: false,
    remainingSamples: [{ id: orphanId, kind: "procurement_file_notes" }],
  });
});
