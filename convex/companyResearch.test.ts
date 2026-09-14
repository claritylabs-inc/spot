/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import dayjs from "dayjs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { saveMarkdownDocument } from "./markdownDocuments";
import { manualWikiDocument } from "./lib/orgWikiDocument";
import { readOrgWiki } from "./orgWiki";
import { readMarkdownHeading } from "./lib/markdownDocument";
import { scheduleCompanyResearch } from "./companyResearch";
import { runWebRetrieval } from "./lib/webRetrieval";
import { generateObjectForOrg } from "./lib/models";

vi.mock("./lib/webRetrieval", () => ({ runWebRetrieval: vi.fn() }));
vi.mock("./lib/models", () => ({ generateObjectForOrg: vi.fn() }));
const modules = import.meta.glob("./**/*.ts");
const run = makeFunctionReference<"action">("actions/companyResearch:run");
const claim = makeFunctionReference<"mutation">("companyResearch:claim");
const complete = makeFunctionReference<"mutation">("companyResearch:complete");
const fail = makeFunctionReference<"mutation">("companyResearch:fail");
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

async function fixture() {
  const t = convexTest(schema, modules);
  const orgId = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Cove",
      type: "client",
      relatedLegalEntities: [
        {
          legalName: "Cove Software Inc.",
          relationship: "current",
          taxId: "PRIVATE-TAX-ID",
        },
      ],
    });
    await scheduleCompanyResearch(ctx, orgId);
    return orgId;
  });
  return { t, orgId };
}

test("intake searches public identity and adds cited facts without replacing manual prose", async () => {
  const { t, orgId } = await fixture();
  const original =
    "A human introduction.\n\n| Product | Region |\n| --- | --- |\n| Cove | US |";
  await t.run(async (ctx) => {
    await saveMarkdownDocument(ctx, {
      orgId,
      kind: "company_wiki",
      filename: "company-wiki.md",
      markdown: manualWikiDocument(`## Operations\n\n${original}`),
      expectedRevision: 0,
    });
  });
  vi.mocked(runWebRetrieval).mockResolvedValue({
    provider: "model_default",
    attempts: [],
    text: "Cove Software Inc. operates Cove at cove.example, creating business software.",
    sources: [{ url: "https://cove.example/" }],
  });
  vi.mocked(generateObjectForOrg)
    .mockResolvedValueOnce({
      output: {
        officialWebsite: "https://cove.example/",
        identityConfirmed: true,
        sourceUrl: "https://cove.example/",
        reason: "",
      },
    } as never)
    .mockResolvedValueOnce({
      output: {
        identityConfirmed: true,
        industry: null,
        industryVertical: null,
        facts: [
          {
            key: "operations",
            content: "Cove creates business software.",
            sourceRef: "https://cove.example/",
          },
          {
            key: "operations",
            content: "Cove has unsupported revenue.",
            sourceRef: "https://invented.example/",
          },
        ],
        reason: "",
      },
    } as never);
  await t.action(run, { orgId });
  expect(runWebRetrieval).toHaveBeenCalledTimes(2);
  const searchInput = vi.mocked(runWebRetrieval).mock.calls[0][2];
  expect(searchInput.query).toContain("Cove Software Inc.");
  expect(JSON.stringify(searchInput)).not.toContain("PRIVATE-TAX-ID");
  await t.run(async (ctx) => {
    const org = await ctx.db.get(orgId);
    expect(org?.website).toBe("https://cove.example/");
    expect(org?.companyResearch).toMatchObject({
      status: "partial",
      unresolvedFields: ["industry", "industryVertical"],
    });
    const wiki = await readOrgWiki(ctx, orgId);
    expect(readMarkdownHeading(wiki.body, "Operations")).toBe(original);
    const proposal = wiki.proposals.find(
      (proposal) => proposal.heading === "Operations",
    );
    expect(proposal?.body).toContain(original);
    expect(proposal?.body).toContain("[Source](https://cove.example/)");
    expect(proposal?.body).not.toContain("unsupported revenue");
    expect(await scheduleCompanyResearch(ctx, orgId)).toBe(false);
  });
  await t.action(run, { orgId });
  expect(runWebRetrieval).toHaveBeenCalledTimes(2);
});

test("research accepts root and www variants across discovery, retrieval and completion", async () => {
  const { t, orgId } = await fixture();
  vi.mocked(runWebRetrieval)
    .mockResolvedValueOnce({
      provider: "model_default",
      attempts: [],
      text: "Cove Software Inc. operates Cove.",
      sources: [{ url: "https://www.cove.example/about" }],
    })
    .mockResolvedValueOnce({
      provider: "model_default",
      attempts: [],
      text: "Cove creates business software.",
      sources: [{ url: "https://www.cove.example/about" }],
    });
  vi.mocked(generateObjectForOrg)
    .mockResolvedValueOnce({
      output: {
        officialWebsite: "https://cove.example/",
        identityConfirmed: true,
        sourceUrl: "https://cove.example/about",
        reason: "",
      },
    } as never)
    .mockResolvedValueOnce({
      output: {
        identityConfirmed: true,
        industry: null,
        industryVertical: null,
        facts: [
          {
            key: "operations",
            content: "Cove creates business software.",
            sourceRef: "https://cove.example/about",
          },
        ],
        reason: "",
      },
    } as never);

  await t.action(run, { orgId });

  expect(vi.mocked(runWebRetrieval).mock.calls[1][2]).toMatchObject({
    url: "https://cove.example/",
    allowedDomains: ["cove.example", "www.cove.example"],
  });
  await t.run(async (ctx) => {
    const org = await ctx.db.get(orgId);
    expect(org?.website).toBe("https://cove.example/");
    expect(org?.companyResearch).toMatchObject({
      status: "partial",
      sourceUrls: ["https://www.cove.example/about"],
      facts: [
        {
          content: "Cove creates business software.",
          sourceRef: "https://www.cove.example/about",
        },
      ],
      unresolvedFields: ["industry", "industryVertical"],
    });
  });
});

test("research rejects non-www subdomains as different sites", async () => {
  const { t, orgId } = await fixture();
  vi.mocked(runWebRetrieval).mockResolvedValueOnce({
    provider: "model_default",
    attempts: [],
    text: "A blog mentions Cove Software Inc.",
    sources: [{ url: "https://blog.cove.example/company" }],
  });
  vi.mocked(generateObjectForOrg).mockResolvedValueOnce({
    output: {
      officialWebsite: "https://cove.example/",
      identityConfirmed: true,
      sourceUrl: "https://blog.cove.example/company",
      reason: "Exact company match",
    },
  } as never);

  await t.action(run, { orgId });

  expect(runWebRetrieval).toHaveBeenCalledTimes(1);
  await t.run(async (ctx) => {
    const org = await ctx.db.get(orgId);
    expect(org?.website).toBeUndefined();
    expect(org?.companyResearch).toMatchObject({
      status: "partial",
      sourceUrls: [],
      facts: [],
      unresolvedFields: [
        "website",
        "industry",
        "industryVertical",
        "publicIdentity",
        "companyFacts",
      ],
    });
  });
});

test("stale research cannot overwrite a concurrent manual website or update the wiki", async () => {
  const { t, orgId } = await fixture();
  const lease = await t.mutation(claim, { orgId });
  await t.run(async (ctx) => {
    await ctx.db.patch(orgId, { website: "https://manual.example/" });
  });
  expect(
    await t.mutation(complete, {
      orgId,
      leaseId: lease.leaseId,
      fingerprint: lease.fingerprint,
      website: "https://old.example/",
      sourceUrls: ["https://old.example/"],
      facts: [
        {
          key: "operations",
          content: "Outdated identity fact.",
          sourceRef: "https://old.example/",
        },
      ],
    }),
  ).toBe(false);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(orgId))?.website).toBe("https://manual.example/");
    expect((await ctx.db.get(orgId))?.companyResearch?.status).toBe("pending");
    expect((await readOrgWiki(ctx, orgId)).body).toBe("");
  });
});

test("an identity change retracts prior research evidence before the next run", async () => {
  const { t, orgId } = await fixture();
  const first = await t.mutation(claim, { orgId });
  const oldFact = {
    key: "operations" as const,
    content: "Cove provides farm planning software.",
    sourceRef: "https://cove.example/",
  };
  await t.mutation(complete, {
    orgId,
    leaseId: first.leaseId,
    fingerprint: first.fingerprint,
    website: "https://cove.example/",
    industry: "agriculture",
    industryVertical: "crop_farming",
    sourceUrls: [oldFact.sourceRef],
    facts: [oldFact],
  });

  await t.run(async (ctx) => {
    await ctx.db.patch(orgId, { name: "Harbor" });
    await scheduleCompanyResearch(ctx, orgId);
    const org = await ctx.db.get(orgId);
    expect(org?.companyResearch).toMatchObject({
      status: "pending",
      facts: [],
      sourceUrls: [],
    });
    expect((await readOrgWiki(ctx, orgId)).body).not.toContain(oldFact.content);
  });

  const second = await t.mutation(claim, { orgId });
  await t.mutation(complete, {
    orgId,
    leaseId: second.leaseId,
    fingerprint: second.fingerprint,
    sourceUrls: [],
    facts: [],
    reason: "No verified public match",
  });
  await t.run(async (ctx) => {
    expect((await ctx.db.get(orgId))?.companyResearch).toMatchObject({
      status: "partial",
      facts: [],
      sourceUrls: [],
    });
    expect((await readOrgWiki(ctx, orgId)).body).not.toContain(oldFact.content);
  });
});

test("a verified refresh replaces retracted facts and sources", async () => {
  const { t, orgId } = await fixture();
  const first = await t.mutation(claim, { orgId });
  const oldFact = {
    key: "operations" as const,
    content: "Cove provides farm planning software.",
    sourceRef: "https://cove.example/old",
  };
  await t.mutation(complete, {
    orgId,
    leaseId: first.leaseId,
    fingerprint: first.fingerprint,
    website: "https://cove.example/",
    industry: "agriculture",
    industryVertical: "crop_farming",
    sourceUrls: [oldFact.sourceRef],
    facts: [oldFact],
  });
  await t.run(async (ctx) => {
    await ctx.db.patch(orgId, { website: "https://www.cove.example/" });
    await scheduleCompanyResearch(ctx, orgId);
    expect((await ctx.db.get(orgId))?.companyResearch).toMatchObject({
      status: "pending",
      facts: [oldFact],
      sourceUrls: [oldFact.sourceRef],
    });
  });
  const second = await t.mutation(claim, { orgId });
  const currentFact = {
    key: "operations" as const,
    content: "Cove provides crop forecasting software.",
    sourceRef: "https://www.cove.example/current",
  };
  await t.mutation(complete, {
    orgId,
    leaseId: second.leaseId,
    fingerprint: second.fingerprint,
    website: "https://www.cove.example/",
    industry: "agriculture",
    industryVertical: "crop_farming",
    sourceUrls: [currentFact.sourceRef],
    facts: [currentFact],
  });

  await t.run(async (ctx) => {
    expect((await ctx.db.get(orgId))?.companyResearch).toMatchObject({
      status: "completed",
      facts: [currentFact],
      sourceUrls: [currentFact.sourceRef],
    });
    const wiki = await readOrgWiki(ctx, orgId);
    expect(wiki.body).toContain(currentFact.content);
    expect(wiki.body).not.toContain(oldFact.content);
    expect(wiki.body).not.toContain(oldFact.sourceRef);
  });
});

test("a verified refresh retracts stale suggestions without changing manual prose", async () => {
  const { t, orgId } = await fixture();
  const manual = "The risk team reviews rollout sequencing.";
  await t.run(async (ctx) => {
    await saveMarkdownDocument(ctx, {
      orgId,
      kind: "company_wiki",
      filename: "company-wiki.md",
      markdown: manualWikiDocument(`## Operations\n\n${manual}`),
      expectedRevision: 0,
    });
  });
  const first = await t.mutation(claim, { orgId });
  const oldFact = {
    key: "operations" as const,
    content: "Cove provides farm planning software.",
    sourceRef: "https://cove.example/old",
  };
  await t.mutation(complete, {
    orgId,
    leaseId: first.leaseId,
    fingerprint: first.fingerprint,
    website: "https://cove.example/",
    industry: "agriculture",
    industryVertical: "crop_farming",
    sourceUrls: [oldFact.sourceRef],
    facts: [oldFact],
  });
  await t.mutation(
    makeFunctionReference<"mutation">("companyResearch:request"),
    { orgId },
  );
  const second = await t.mutation(claim, { orgId });
  const currentFact = {
    key: "operations" as const,
    content: "Cove provides crop forecasting software.",
    sourceRef: "https://cove.example/current",
  };
  await t.mutation(complete, {
    orgId,
    leaseId: second.leaseId,
    fingerprint: second.fingerprint,
    sourceUrls: [currentFact.sourceRef],
    facts: [currentFact],
  });

  await t.run(async (ctx) => {
    const wiki = await readOrgWiki(ctx, orgId);
    expect(readMarkdownHeading(wiki.body, "Operations")).toBe(manual);
    expect(wiki.proposals).toHaveLength(1);
    expect(wiki.proposals[0].body).toContain(currentFact.content);
    expect(wiki.proposals[0].body).not.toContain(oldFact.content);
    expect(wiki.proposals[0].body).not.toContain(oldFact.sourceRef);
  });
});

test("provider failures stop after three attempts and do not claim successful enrichment", async () => {
  const { t, orgId } = await fixture();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const lease = await t.mutation(claim, { orgId });
    expect(lease).not.toBeNull();
    expect(
      await t.mutation(fail, {
        orgId,
        leaseId: lease.leaseId,
        error: "Provider unavailable",
      }),
    ).toBe(true);
  }
  expect(await t.mutation(claim, { orgId })).toBeNull();
  await t.run(async (ctx) => {
    expect((await ctx.db.get(orgId))?.companyResearch).toMatchObject({
      status: "failed",
      attempts: 3,
      unresolvedFields: ["website", "industry", "industryVertical"],
    });
  });
});

test("expired research leases recover and old completions are rejected", async () => {
  const { t, orgId } = await fixture();
  const old = await t.mutation(claim, { orgId });
  await t.run(async (ctx) => {
    const org = await ctx.db.get(orgId);
    await ctx.db.patch(orgId, {
      companyResearch: {
        ...org!.companyResearch!,
        leaseExpiresAt: dayjs().subtract(1, "minute").valueOf(),
      },
    });
  });
  await t.mutation(
    makeFunctionReference<"mutation">("companyResearch:recover"),
    { orgId, leaseId: old.leaseId },
  );
  const next = await t.mutation(claim, { orgId });
  expect(next.leaseId).not.toBe(old.leaseId);
  expect(
    await t.mutation(complete, {
      orgId,
      leaseId: old.leaseId,
      fingerprint: old.fingerprint,
      facts: [],
      sourceUrls: [],
    }),
  ).toBe(false);
});

test("research requests report existing work honestly and require direct client admin access", async () => {
  const { t, orgId } = await fixture();
  const request = makeFunctionReference<"mutation">("companyResearch:request");
  const requestForUser = makeFunctionReference<"mutation">(
    "companyResearch:requestForUser",
  );
  const { userId, brokerId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { accountKind: "customer" });
    const brokerId = await ctx.db.insert("organizations", {
      name: "Broker",
      type: "broker",
    });
    await ctx.db.insert("orgMemberships", { orgId, userId, role: "admin" });
    await ctx.db.insert("orgMemberships", {
      orgId: brokerId,
      userId,
      role: "admin",
    });
    return { userId, brokerId };
  });
  expect(await t.mutation(requestForUser, { orgId, userId })).toEqual({
    success: true,
    queued: false,
    status: "pending",
  });
  const lease = await t.mutation(claim, { orgId });
  expect(await t.mutation(request, { orgId })).toEqual({
    success: true,
    queued: false,
    status: "running",
  });
  await t.mutation(complete, {
    orgId,
    leaseId: lease.leaseId,
    fingerprint: lease.fingerprint,
    sourceUrls: [],
    facts: [],
    reason: "No verified public match",
  });
  expect(
    (await t.run((ctx) => ctx.db.get(orgId)))?.companyResearch,
  ).toMatchObject({
    status: "partial",
    unresolvedFields: [
      "website",
      "industry",
      "industryVertical",
      "publicIdentity",
      "companyFacts",
    ],
  });
  expect(await t.mutation(request, { orgId })).toEqual({
    success: true,
    queued: true,
    status: "pending",
  });
  await expect(
    t.mutation(requestForUser, { orgId: brokerId, userId }),
  ).rejects.toThrow("Client not found");
});

test("a populated profile without supported company facts is still incomplete research", async () => {
  const { t, orgId } = await fixture();
  await t.run(async (ctx) => {
    await ctx.db.patch(orgId, {
      website: "https://cove.example/",
      industry: "agriculture",
      industryVertical: "crop_farming",
    });
    await scheduleCompanyResearch(ctx, orgId);
  });
  const lease = await t.mutation(claim, { orgId });
  await t.mutation(complete, {
    orgId,
    leaseId: lease.leaseId,
    fingerprint: lease.fingerprint,
    sourceUrls: ["https://cove.example/"],
    facts: [],
  });
  expect(
    (await t.run((ctx) => ctx.db.get(orgId)))?.companyResearch,
  ).toMatchObject({ status: "partial", unresolvedFields: ["companyFacts"] });
});

test("later incomplete research preserves accumulated verified wiki facts", async () => {
  const { t, orgId } = await fixture();
  const first = await t.mutation(claim, { orgId });
  const firstFact = {
    key: "operations",
    content: "Cove provides farm planning software.",
    sourceRef: "https://cove.example/",
  };
  await t.mutation(complete, {
    orgId,
    leaseId: first.leaseId,
    fingerprint: first.fingerprint,
    website: "https://cove.example/",
    industry: "agriculture",
    industryVertical: "crop_farming",
    sourceUrls: [firstFact.sourceRef],
    facts: [firstFact],
  });
  expect(
    (await t.run((ctx) => ctx.db.get(orgId)))?.companyResearch?.status,
  ).toBe("completed");
  await t.mutation(
    makeFunctionReference<"mutation">("companyResearch:request"),
    { orgId },
  );
  const second = await t.mutation(claim, { orgId });
  await t.mutation(complete, {
    orgId,
    leaseId: second.leaseId,
    fingerprint: second.fingerprint,
    sourceUrls: [],
    facts: [],
    reason: "Official website could not be verified on this attempt",
  });
  await t.run(async (ctx) => {
    const org = await ctx.db.get(orgId);
    expect(org?.companyResearch).toMatchObject({
      status: "partial",
      facts: [firstFact],
      sourceUrls: [firstFact.sourceRef],
      unresolvedFields: ["publicIdentity", "companyFacts"],
    });
    const wiki = await readOrgWiki(ctx, orgId);
    expect(wiki.body).toContain(firstFact.content);
    expect(wiki.body).toContain(firstFact.sourceRef);
  });
});
