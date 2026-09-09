/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

// Logo discovery is the only network dependency of the local seed.
vi.mock("./actions/extractCompanyInfo", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./actions/extractCompanyInfo")>();
  const { internalAction } = await import("./_generated/server");
  const { v } = await import("convex/values");
  return {
    ...actual,
    importOrgLogoForOrgInternal: internalAction({
      args: { orgId: v.id("organizations"), url: v.string() },
      handler: async () => ({ success: true }),
    }),
  };
});

const modules = import.meta.glob("./**/*.ts");
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("SPOT_ENV", "local");
  vi.stubEnv("SLACK_MODE", "mock");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

test("rerunning setup preserves edited work and reuses records and stored files", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.action(api.seed.seed, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const before = await t.run(async (ctx) => {
    await ctx.db.patch(ids.requestId!, {
      title: "Renamed during QA",
      status: "binding",
    });
    await ctx.db.patch(ids.policyId, { premiumAmount: 99_000 });
    const profile = await ctx.db
      .query("brokerProfiles")
      .withIndex("broker", (q) => q.eq("brokerOrgId", ids.brokerOrgId))
      .unique();
    await ctx.db.patch(profile!._id, { networkStatus: "inactive" });
    const wiki = await ctx.db.query("orgWikiSections").first();
    await ctx.db.patch(wiki!._id, { body: "User-edited wiki" });
    const section = await ctx.db.query("procurementPacketSections").first();
    await ctx.db.patch(section!._id, { body: "User-edited packet" });
    const archived = (await ctx.db.query("clientFiles").collect()).find(
      (file) => file.archivedAt,
    )!;
    await ctx.db.patch(archived._id, {
      archivedAt: undefined,
      archivedByUserId: undefined,
    });
    return {
      wikiId: wiki!._id,
      sectionId: section!._id,
      archivedId: archived._id,
      files: await ctx.db.query("clientFiles").collect(),
    };
  });
  const second = await t.action(api.seed.seed, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(second.requestId).toBe(ids.requestId);
  expect(second.proposalId).toBe(ids.proposalId);
  expect(second.operatorThreadId).toBe(ids.operatorThreadId);
  await t.run(async (ctx) => {
    expect(await ctx.db.query("pendingEmails").collect()).toHaveLength(0);
    expect(
      await ctx.db.query("procurementProposalExtractionJobs").collect(),
    ).toHaveLength(0);
    expect(await ctx.db.query("procurementRequests").collect()).toHaveLength(1);
    expect(await ctx.db.query("procurementProposals").collect()).toHaveLength(
      1,
    );
    expect(await ctx.db.query("operatorAgentThreads").collect()).toHaveLength(
      1,
    );
    expect(await ctx.db.query("procurementPacketLinks").collect()).toHaveLength(
      1,
    );
    expect((await ctx.db.get(ids.requestId!))?.title).toBe("Renamed during QA");
    expect((await ctx.db.get(ids.requestId!))?.status).toBe("binding");
    expect((await ctx.db.get(ids.policyId))?.premiumAmount).toBe(99_000);
    expect((await ctx.db.get(before.wikiId))?.body).toBe("User-edited wiki");
    expect((await ctx.db.get(before.sectionId))?.body).toBe(
      "User-edited packet",
    );
    expect((await ctx.db.get(before.archivedId))?.archivedAt).toBeUndefined();
    expect(
      (
        await ctx.db
          .query("brokerProfiles")
          .withIndex("broker", (q) => q.eq("brokerOrgId", ids.brokerOrgId))
          .unique()
      )?.networkStatus,
    ).toBe("inactive");
    expect(
      (await ctx.db.query("clientFiles").collect()).map((file) => file.fileId),
    ).toEqual(before.files.map((file) => file.fileId));
  });
});

test.each(["production", "dev", ""])(
  "rejects seeding and cleanup outside local (%s)",
  async (environment) => {
    vi.stubEnv("SPOT_ENV", environment);
    const t = convexTest(schema, modules);
    await expect(t.action(api.seed.seed, {})).rejects.toThrow("SPOT_ENV=local");
    await expect(
      t.mutation(internal.seed.insertLocalFixture, {}),
    ).rejects.toThrow("SPOT_ENV=local");
    await expect(
      t.mutation(internal.seed.removeLegacyDemoFixture, { dryRun: false }),
    ).rejects.toThrow("SPOT_ENV=local");
    await expect(
      t.mutation(internal.seed.removeLocalVerificationArtifacts, {}),
    ).rejects.toThrow("SPOT_ENV=local");
    expect(
      await t.run((ctx) => ctx.db.query("organizations").collect()),
    ).toHaveLength(0);
  },
);
