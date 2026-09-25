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
import { runProfileWebRetrieval } from "./lib/webRetrieval";
import { clRouterDecide } from "./lib/clRouterClient";
import { generateObjectForOrg } from "./lib/models";

vi.mock("./lib/clRouterClient", () => ({ clRouterDecide: vi.fn() }));
vi.mock("./lib/webRetrieval", () => ({ runProfileWebRetrieval: vi.fn() }));
vi.mock("./lib/models", () => ({ generateObjectForOrg: vi.fn() }));
const modules = import.meta.glob("./**/*.ts");
const run = makeFunctionReference<"action">("actions/companyResearch:run");
const claim = makeFunctionReference<"mutation">("companyResearch:claim");
const complete = makeFunctionReference<"mutation">("companyResearch:complete");
const fail = makeFunctionReference<"mutation">("companyResearch:fail");
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(clRouterDecide).mockImplementation(
    async (request) =>
      ({
        answers: Object.fromEntries(
          Object.entries(request.questions).map(([key, question]) => [
            key,
            question.type === "choice"
              ? {
                  type: "choice",
                  choice: "source_0",
                  probabilities: { source_0: 0.95, none: 0.05 },
                  confidence: 0.95,
                }
              : {
                  type: "noul",
                  noul:
                    request.task === "profile_research_orchestration" &&
                    JSON.parse(request.state as string).evidence.length === 0
                      ? 0
                      : 0.95,
                },
          ]),
        ),
      }) as never,
  );
});
afterEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
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

test("starts identity search deterministically and logs retrieval failure with the lease trace", async () => {
  const { t, orgId } = await fixture();
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(runProfileWebRetrieval).mockRejectedValueOnce(new Error("offline"));
  await t.action(run, { orgId });
  expect(runProfileWebRetrieval).toHaveBeenCalledTimes(1);
  expect(clRouterDecide).not.toHaveBeenCalled();
  expect(warning).toHaveBeenCalledWith(
    "[company-research] failed",
    expect.objectContaining({
      orgId,
      traceId: expect.stringContaining(`company-research:${orgId}:`),
      error: "Public identity search returned no cited evidence",
    }),
  );
  expect(
    (await t.run((ctx) => ctx.db.get(orgId)))?.companyResearch?.status,
  ).toBe("pending");
});

test.each([
  ["source_0", 0.69, undefined],
  ["none", 0.95, undefined],
  ["https://invented.example/", 0.99, undefined],
  ["source_0", 0.79, "0.8"],
])(
  "does not enrich an unverified identity (%s, %s, threshold %s)",
  async (choice, probability, threshold) => {
    if (threshold) vi.stubEnv("JEV_PROCEED_THRESHOLD", threshold);
    const { t, orgId } = await fixture();
    vi.mocked(runProfileWebRetrieval).mockResolvedValueOnce({
      provider: "parallel",
      attempts: [],
      text: "Possible Cove website",
      sources: [{ url: "https://cove.example/" }],
    });
    vi.mocked(clRouterDecide).mockResolvedValueOnce({
      answers: {
        identity: {
          type: "choice",
          choice,
          probabilities: { [choice]: probability },
          confidence: probability,
        },
      },
    } as never);
    await t.action(run, { orgId });
    expect(generateObjectForOrg).not.toHaveBeenCalled();
    expect((await t.run((ctx) => ctx.db.get(orgId)))?.website).toBeUndefined();
  },
);

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
  vi.mocked(runProfileWebRetrieval).mockResolvedValue({
    provider: "model_default",
    attempts: [],
    text: "Cove Software Inc. operates Cove at cove.example, creating business software.",
    sources: [{ url: "https://cove.example/" }],
  });
  vi.mocked(generateObjectForOrg).mockResolvedValueOnce({
    output: {
      identityConfirmed: true,

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
  vi.mocked(clRouterDecide).mockResolvedValueOnce({
    answers: {
      identity: {
        type: "choice",
        choice: "source_0",
        probabilities: { source_0: 0.7, none: 0.3 },
        confidence: 0.7,
      },
    },
  } as never);
  await t.action(run, { orgId });
  expect(runProfileWebRetrieval).toHaveBeenCalledTimes(5);
  expect(generateObjectForOrg).toHaveBeenCalledTimes(1);
  const traceId = vi.mocked(clRouterDecide).mock.calls[0][0].trace?.traceId;
  expect(traceId).toEqual(
    expect.stringContaining(`company-research:${orgId}:`),
  );
  for (const [request] of vi.mocked(clRouterDecide).mock.calls)
    expect(request.trace?.traceId).toBe(traceId);
  for (const [, , input] of vi.mocked(runProfileWebRetrieval).mock.calls)
    expect(input.trace?.traceId).toBe(traceId);
  expect(vi.mocked(generateObjectForOrg).mock.calls[0][4]).toEqual(
    expect.objectContaining({
      taskKind: "profile_research_extraction",
      trace: expect.objectContaining({ traceId }),
    }),
  );

  const searchInput = vi.mocked(runProfileWebRetrieval).mock.calls[0][2];
  expect(searchInput.query).toContain("Cove");
  expect(JSON.stringify(searchInput)).not.toContain("PRIVATE-TAX-ID");
  await t.run(async (ctx) => {
    const org = await ctx.db.get(orgId);
    expect(org?.website).toBe("https://cove.example/");
    expect(org?.companyResearch).toMatchObject({
      status: "completed",
      unresolvedFields: [],
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
  expect(runProfileWebRetrieval).toHaveBeenCalledTimes(5);
});

test("router failure cannot verify identity and records a traced failure", async () => {
  const { t, orgId } = await fixture();
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(runProfileWebRetrieval).mockResolvedValueOnce({
    provider: "parallel",
    attempts: [],
    text: "Cove company evidence",
    sources: [{ url: "https://cove.example/" }],
  });
  vi.mocked(clRouterDecide).mockRejectedValueOnce(
    new Error("router unavailable"),
  );
  await t.action(run, { orgId });
  expect(generateObjectForOrg).not.toHaveBeenCalled();
  expect(warning).toHaveBeenCalledWith(
    "[company-research] failed",
    expect.objectContaining({
      error: "router unavailable",
      traceId: expect.any(String),
    }),
  );
  expect((await t.run((ctx) => ctx.db.get(orgId)))?.website).toBeUndefined();
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
      unresolvedFields: ["website"],
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
    unresolvedFields: ["website", "publicIdentity", "companyFacts"],
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

test("broker enrichment preserves manual fields and retracts only owned values after identity changes", async () => {
  const { t } = await fixture();
  const { orgId, profileId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Operator" });
    const orgId = await ctx.db.insert("organizations", {
      name: "Example Brokerage",
      type: "broker",
      website: "https://broker.example",
    });
    const profileId = await ctx.db.insert("brokerProfiles", {
      brokerOrgId: orgId,
      networkStatus: "prospect",
      writingStates: ["CA"],
      lineOfBusinessCodes: [],
      createdByUserId: userId,
      updatedByUserId: userId,
      createdAt: 1,
      updatedAt: 1,
    });
    await scheduleCompanyResearch(ctx, orgId);
    return { orgId, profileId };
  });
  const lease = await t.mutation(claim, { orgId });
  await t.mutation(complete, {
    orgId,
    leaseId: lease.leaseId,
    fingerprint: lease.fingerprint,
    profileUpdatedAt: lease.profileUpdatedAt,
    sourceUrls: ["https://broker.example/products"],
    facts: [
      {
        key: "operations",
        content: "Offers commercial insurance",
        sourceRef: "https://broker.example/products",
      },
    ],
    brokerFindings: {
      writingStates: [
        {
          code: "NV",
          confidence: 0.95,
        },
      ],
      lineOfBusinessCodes: [
        {
          code: "CGL",
          confidence: 0.95,
        },
        {
          code: "PROP",
          confidence: 0.7,
        },
      ],
    },
  });
  await t.run(async (ctx) => {
    expect(await ctx.db.get(profileId)).toMatchObject({
      writingStates: ["CA"],
      lineOfBusinessCodes: ["CGL"],
    });
    expect(
      (await ctx.db.get(orgId))?.companyResearch?.unresolvedFields,
    ).toContain("officeAddress");
    await ctx.db.patch(orgId, { name: "Different Brokerage" });
    await scheduleCompanyResearch(ctx, orgId);
    expect(await ctx.db.get(profileId)).toMatchObject({
      writingStates: ["CA"],
      lineOfBusinessCodes: [],
    });
  });
});

test("broker research cannot overwrite a profile edited while retrieval was running", async () => {
  const { t } = await fixture();
  const { orgId, profileId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {});
    const orgId = await ctx.db.insert("organizations", {
      name: "Example Brokerage",
      type: "broker",
      website: "https://broker.example",
    });
    const profileId = await ctx.db.insert("brokerProfiles", {
      brokerOrgId: orgId,
      networkStatus: "prospect",
      writingStates: [],
      lineOfBusinessCodes: [],
      createdByUserId: userId,
      updatedByUserId: userId,
      createdAt: 1,
      updatedAt: 1,
    });
    await scheduleCompanyResearch(ctx, orgId);
    return { orgId, profileId };
  });
  const lease = await t.mutation(claim, { orgId });
  await t.run((ctx) =>
    ctx.db.patch(profileId, { writingStates: ["OR"], updatedAt: 2 }),
  );
  await t.mutation(complete, {
    orgId,
    leaseId: lease.leaseId,
    fingerprint: lease.fingerprint,
    profileUpdatedAt: lease.profileUpdatedAt,
    sourceUrls: ["https://broker.example/products"],
    facts: [],
    brokerFindings: {
      writingStates: [
        {
          code: "CA",
          confidence: 0.99,
        },
      ],
      lineOfBusinessCodes: [],
    },
  });
  await t.run(async (ctx) => {
    expect((await ctx.db.get(profileId))?.writingStates).toEqual(["OR"]);
    expect(
      (await ctx.db.get(orgId))?.companyResearch?.unresolvedFields,
    ).toContain("profileChangedDuringResearch");
  });
});

test("partial refresh adds verified facts while a failed verification preserves earlier evidence", async () => {
  const { t, orgId } = await fixture();
  const oldFact = {
    key: "operations" as const,
    content: "Cove builds software.",
    sourceRef: "https://cove.example/about",
  };
  const first = await t.mutation(claim, { orgId });
  await t.mutation(complete, {
    orgId,
    leaseId: first.leaseId,
    fingerprint: first.fingerprint,
    website: "https://cove.example/",
    sourceUrls: [oldFact.sourceRef],
    facts: [oldFact],
  });
  await t.run((ctx) => scheduleCompanyResearch(ctx, orgId, { force: true }));
  const second = await t.mutation(claim, { orgId });
  const newFact = {
    key: "profile" as const,
    content: "Cove is headquartered in California.",
    sourceRef: "https://cove.example/contact",
  };
  await t.mutation(complete, {
    orgId,
    leaseId: second.leaseId,
    fingerprint: second.fingerprint,
    sourceUrls: [newFact.sourceRef],
    facts: [newFact],
    unresolvedFields: ["scale"],
  });
  expect(
    (await t.run((ctx) => ctx.db.get(orgId)))?.companyResearch,
  ).toMatchObject({ status: "partial", facts: [oldFact, newFact] });
  await t.run((ctx) => scheduleCompanyResearch(ctx, orgId, { force: true }));
  const third = await t.mutation(claim, { orgId });
  await t.mutation(complete, {
    orgId,
    leaseId: third.leaseId,
    fingerprint: third.fingerprint,
    sourceUrls: [oldFact.sourceRef],
    facts: [],
  });
  expect(
    (await t.run((ctx) => ctx.db.get(orgId)))?.companyResearch,
  ).toMatchObject({
    status: "partial",
    facts: [oldFact, newFact],
    unresolvedFields: ["companyFacts"],
  });
});

test("a deliberately cleared broker field remains empty after subsequent enrichment", async () => {
  const { t } = await fixture();
  const { orgId, userId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { accountKind: "operator" });
    await ctx.db.insert("operatorProfiles", {
      userId,
      email: "operator@example.com",
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    const orgId = await ctx.db.insert("organizations", {
      name: "Example Brokerage",
      type: "broker",
      website: "https://broker.example",
    });
    await ctx.db.insert("brokerProfiles", {
      brokerOrgId: orgId,
      networkStatus: "prospect",
      writingStates: ["CA"],
      lineOfBusinessCodes: [],
      createdByUserId: userId,
      updatedByUserId: userId,
      createdAt: 1,
      updatedAt: 1,
    });
    await scheduleCompanyResearch(ctx, orgId);
    return { orgId, userId };
  });
  await t
    .withIdentity({ subject: `${userId}|session` })
    .mutation(makeFunctionReference<"mutation">("brokerProfiles:upsert"), {
      brokerOrgId: orgId,
      writingStates: [],
    });
  const lease = await t.mutation(claim, { orgId });
  await t.mutation(complete, {
    orgId,
    leaseId: lease.leaseId,
    fingerprint: lease.fingerprint,
    profileUpdatedAt: lease.profileUpdatedAt,
    sourceUrls: ["https://broker.example/products"],
    facts: [],
    brokerFindings: {
      writingStates: [{ code: "CA", confidence: 0.95 }],
      lineOfBusinessCodes: [],
    },
  });
  const profile = await t.run((ctx) =>
    ctx.db
      .query("brokerProfiles")
      .withIndex("broker", (q) => q.eq("brokerOrgId", orgId))
      .unique(),
  );
  expect(profile).toMatchObject({
    writingStates: [],
    manualFields: ["writingStates"],
  });
});

test("broker refresh improves a resolved dimension without erasing facts or an unverified address", async () => {
  const { t } = await fixture();
  const { orgId, profileId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {});
    const orgId = await ctx.db.insert("organizations", {
      name: "Example Brokerage",
      type: "broker",
      website: "https://broker.example",
    });
    const profileId = await ctx.db.insert("brokerProfiles", {
      brokerOrgId: orgId,
      networkStatus: "prospect",
      writingStates: [],
      lineOfBusinessCodes: [],
      createdByUserId: userId,
      updatedByUserId: userId,
      createdAt: 1,
      updatedAt: 1,
    });
    await scheduleCompanyResearch(ctx, orgId);
    return { orgId, profileId };
  });
  const first = await t.mutation(claim, { orgId });
  const source = "https://broker.example/about";
  const fact = {
    key: "operations" as const,
    content: "Offers commercial insurance.",
    sourceRef: source,
  };
  const officeAddress = {
    street1: "1 Main St",
    city: "Sacramento",
    state: "CA",
  };
  await t.mutation(complete, {
    orgId,
    leaseId: first.leaseId,
    fingerprint: first.fingerprint,
    profileUpdatedAt: first.profileUpdatedAt,
    sourceUrls: [source],
    facts: [fact],
    brokerFindings: {
      writingStates: [{ code: "CA", confidence: 0.95 }],
      lineOfBusinessCodes: [{ code: "CGL", confidence: 0.95 }],
      officeAddress,
      officeSourceRef: source,
    },
  });
  await t.run((ctx) => scheduleCompanyResearch(ctx, orgId, { force: true }));
  const second = await t.mutation(claim, { orgId });
  await t.mutation(complete, {
    orgId,
    leaseId: second.leaseId,
    fingerprint: second.fingerprint,
    profileUpdatedAt: second.profileUpdatedAt,
    sourceUrls: ["https://broker.example/locations"],
    facts: [],
    unresolvedFields: ["scale"],
    brokerFindings: {
      writingStates: [{ code: "NV", confidence: 0.95 }],
      lineOfBusinessCodes: [],
    },
  });
  await t.run(async (ctx) => {
    expect(await ctx.db.get(profileId)).toMatchObject({
      writingStates: ["NV"],
      lineOfBusinessCodes: ["CGL"],
      officeAddress,
    });
    expect((await ctx.db.get(orgId))?.companyResearch).toMatchObject({
      status: "partial",
      facts: [fact],
    });
    expect(
      await ctx.db
        .query("companyResearchEvents")
        .withIndex("organization", (q) => q.eq("orgId", orgId))
        .collect(),
    ).toHaveLength(2);
  });
});
