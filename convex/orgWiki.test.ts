/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import {
  appendOrgWikiFacts,
  readOrgWiki,
  reconcileExtractedCompanyFacts,
  upsertOrgWikiDocumentByOperator,
} from "./orgWiki";
import { parseMarkdownDocument } from "./lib/markdownDocument";

const modules = import.meta.glob("./**/*.ts");

test("MCP section edits require a direct admin and the current wiki revision", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Cove",
      type: "client",
    });
    const adminId = await ctx.db.insert("users", {
      email: "admin@cove.example",
    });
    const memberId = await ctx.db.insert("users", {
      email: "member@cove.example",
    });
    await ctx.db.insert("orgMemberships", {
      orgId,
      userId: adminId,
      role: "admin",
    });
    await ctx.db.insert("orgMemberships", {
      orgId,
      userId: memberId,
      role: "member",
    });
    return { orgId, adminId, memberId };
  });
  await t
    .withIdentity({ subject: `${ids.adminId}|session` })
    .mutation(api.orgWiki.save, {
      orgId: ids.orgId,
      markdown: "## Operations\n\nCove builds software.",
      expectedRevision: 0,
    });
  const input = {
    orgId: ids.orgId,
    key: "operations" as const,
    body: "Cove builds software for insurers.",
    expectedRevision: 1,
  };
  await expect(
    t.mutation(internal.orgWiki.saveSectionForMcp, {
      ...input,
      userId: ids.memberId,
    }),
  ).rejects.toThrow(/admin/i);
  await expect(
    t.mutation(internal.orgWiki.saveSectionForMcp, {
      ...input,
      userId: ids.adminId,
      expectedRevision: 0,
    }),
  ).rejects.toThrow(/revision changed/i);
  const saved = await t.mutation(internal.orgWiki.saveSectionForMcp, {
    ...input,
    userId: ids.adminId,
  });
  expect(saved).toMatchObject({ revision: 2 });
  expect(saved.body).toContain("Cove builds software for insurers.");
});

test("supplier company documents are operator-only even when a broker member administers the team", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Example Risk",
      type: "broker",
    });
    const userId = await ctx.db.insert("users", {
      email: "operator@claritylabs.inc",
      accountKind: "operator",
    });
    await ctx.db.insert("operatorProfiles", {
      userId,
      email: "operator@claritylabs.inc",
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    const brokerUserId = await ctx.db.insert("users", {
      email: "broker@example.com",
    });
    await ctx.db.insert("orgMemberships", {
      orgId,
      userId: brokerUserId,
      role: "admin",
    });
    await upsertOrgWikiDocumentByOperator(ctx, {
      orgId,
      operatorUserId: userId,
      markdown: "Supplier company knowledge",
      expectedRevision: 0,
    });
    return { orgId, userId, brokerUserId };
  });
  const broker = t.withIdentity({ subject: `${ids.brokerUserId}|session` });
  await expect(
    broker.query(api.orgWiki.get, { orgId: ids.orgId }),
  ).rejects.toThrow(/Client organization/);
  await expect(
    broker.mutation(api.orgWiki.save, {
      orgId: ids.orgId,
      markdown: "New text",
      expectedRevision: 1,
    }),
  ).rejects.toThrow(/Client organization/);
  await expect(
    t.query(internal.orgWiki.getForMcp, {
      orgId: ids.orgId,
      userId: ids.brokerUserId,
    }),
  ).rejects.toThrow(/Client organization/);
  expect(
    await t
      .withIdentity({ subject: `${ids.userId}|session` })
      .query(api.orgWiki.getForOperator, { orgId: ids.orgId }),
  ).toMatchObject({ body: "Supplier company knowledge" });
});

test("agent Markdown edits keep the content boundary and cannot forge source ownership metadata", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Cove",
      type: "client",
    });
    const userId = await ctx.db.insert("users", {
      email: "terry@claritylabs.inc",
      accountKind: "operator",
    });
    await ctx.db.insert("operatorProfiles", {
      userId,
      email: "terry@claritylabs.inc",
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    await upsertOrgWikiDocumentByOperator(ctx, {
      orgId,
      operatorUserId: userId,
      markdown: "## Operations\n\nCove builds insurance policy tools.",
      expectedRevision: 0,
    });
    return { orgId, userId };
  });
  for (const markdown of [
    "## Notes\n\nPolicy number ABC-123.",
    "---\nnotes: Draft email awaits user approval\n---\n## Company\n\nCove builds software.",
  ]) {
    await expect(
      t.run((ctx) =>
        upsertOrgWikiDocumentByOperator(ctx, {
          orgId: ids.orgId,
          operatorUserId: ids.userId,
          source: "operator",
          markdown,
          expectedRevision: 1,
        }),
      ),
    ).rejects.toThrow(/company information/);
  }
  const saved = await t.run((ctx) =>
    upsertOrgWikiDocumentByOperator(ctx, {
      orgId: ids.orgId,
      operatorUserId: ids.userId,
      source: "operator",
      expectedRevision: 1,
      markdown:
        "---\nreviewed: 2026-09-14\n_spot:\n  manual: false\n  proposals: {}\n---\n## Operations\n\nCove builds insurance policy tools.\n\n## Custom heading\n\nCove develops software for business customers.",
    }),
  );
  expect(saved.body).toContain("## Custom heading");
  expect(parseMarkdownDocument(saved.markdown).frontmatter._spot).toEqual({
    manual: true,
  });
  expect(saved.revision).toBe(2);
});

test("company Markdown preserves human prose while research proposes additions and stale saves fail", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Cove",
      type: "client",
    });
    const userId = await ctx.db.insert("users", {
      email: "admin@cove.example",
    });
    await ctx.db.insert("orgMemberships", { orgId, userId, role: "admin" });
    return { orgId, userId };
  });
  const admin = t.withIdentity({ subject: `${ids.userId}|session` });
  const body =
    "# Our company\n\n## Operations\n\nCove builds products.\n\n| Office | Team |\n| --- | --- |\n| Boston | 12 |\n";
  const saved = await admin.mutation(api.orgWiki.save, {
    orgId: ids.orgId,
    markdown: `---\n_spot:\n  manual: false\n---\n${body}`,
    expectedRevision: 0,
  });
  expect(parseMarkdownDocument(saved.markdown).frontmatter._spot).toEqual({
    manual: true,
  });
  await t.run((ctx) =>
    reconcileExtractedCompanyFacts(ctx, {
      orgId: ids.orgId,
      source: "analysis",
      facts: [
        {
          key: "operations",
          content: "Cove develops commercial software.",
          sourceRef: "https://cove.example",
        },
      ],
    }),
  );
  const research = await t.run((ctx) => readOrgWiki(ctx, ids.orgId));
  expect(research.body).toBe(body);
  expect(research.proposals[0].body).toContain("| Boston | 12 |");
  expect(research.proposals[0].body).toContain(
    "Cove develops commercial software.",
  );
  await expect(
    admin.mutation(api.orgWiki.save, {
      orgId: ids.orgId,
      markdown: "Stale editor",
      expectedRevision: saved.revision,
    }),
  ).rejects.toThrow(/changed/);
  await t.run((ctx) =>
    appendOrgWikiFacts(ctx, {
      orgId: ids.orgId,
      key: "operations",
      source: "chat",
      facts: ["Cove operates in Massachusetts."],
      trusted: true,
    }),
  );
  expect((await t.run((ctx) => readOrgWiki(ctx, ids.orgId))).body).toContain(
    "| Boston | 12 |",
  );
});

test("private client wiki is operator-only across portal, tenant tools and MCP", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Cove",
      type: "client",
    });
    const userId = await ctx.db.insert("users", {
      email: "admin@cove.example",
    });
    await ctx.db.insert("orgMemberships", { orgId, userId, role: "admin" });
    const operatorUserId = await ctx.db.insert("users", {
      email: "operator@claritylabs.inc",
      accountKind: "operator",
    });
    await ctx.db.insert("operatorProfiles", {
      userId: operatorUserId,
      email: "operator@claritylabs.inc",
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    await upsertOrgWikiDocumentByOperator(ctx, {
      orgId,
      operatorUserId,
      markdown: "---\nvisibility: private\n---\nPrivate company research",
      expectedRevision: 0,
    });
    return { orgId, userId, operatorUserId };
  });
  const tenant = t.withIdentity({ subject: `${ids.userId}|session` });
  expect(await tenant.query(api.orgWiki.get, { orgId: ids.orgId })).toBeNull();
  expect(
    await t.query(internal.orgWiki.getForMcp, {
      orgId: ids.orgId,
      userId: ids.userId,
    }),
  ).toBeNull();
  expect(
    await t.query(internal.orgWiki.getInternal, { orgId: ids.orgId }),
  ).toBeNull();
  await expect(
    tenant.mutation(api.orgWiki.save, {
      orgId: ids.orgId,
      markdown: "Overwrite",
      expectedRevision: 1,
    }),
  ).rejects.toThrow(/only to operators/);
  await expect(
    t.mutation(internal.orgWiki.saveForMcp, {
      orgId: ids.orgId,
      userId: ids.userId,
      markdown: "Overwrite",
      expectedRevision: 1,
    }),
  ).rejects.toThrow(/only to operators/);
  expect(
    await t.mutation(internal.orgWiki.appendFacts, {
      orgId: ids.orgId,
      key: "operations",
      facts: ["Cove builds software."],
      source: "chat",
      trusted: true,
    }),
  ).toMatchObject({ accepted: 0 });
  const operator = t.withIdentity({ subject: `${ids.operatorUserId}|session` });
  expect(
    await operator.query(api.orgWiki.getForOperator, { orgId: ids.orgId }),
  ).toMatchObject({ body: "Private company research", revision: 1 });
  const saved = await operator.mutation(api.orgWiki.saveForOperator, {
    orgId: ids.orgId,
    markdown: "Updated private research",
    expectedRevision: 1,
  });
  expect(parseMarkdownDocument(saved.markdown).frontmatter.visibility).toBe(
    "private",
  );
  expect(await tenant.query(api.orgWiki.get, { orgId: ids.orgId })).toBeNull();
  await operator.mutation(api.orgWiki.saveForOperator, {
    orgId: ids.orgId,
    markdown: "---\nvisibility: shared\n---\nShared company overview",
    expectedRevision: 2,
  });
  expect(
    await tenant.query(api.orgWiki.get, { orgId: ids.orgId }),
  ).toMatchObject({ body: "Shared company overview" });
});
