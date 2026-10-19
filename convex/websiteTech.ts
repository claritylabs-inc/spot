import dayjs from "dayjs";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { assertNoOperatorImpersonation } from "./lib/clientFiles";
import { requireOperator } from "./lib/operatorIdentity";
import {
  websiteTechDisclosureValidator,
  websiteTechDomain,
  websiteTechInferenceValidator,
  websiteTechSignalValidator,
} from "./lib/websiteTech";

const FRESH_MS = 30 * 24 * 60 * 60 * 1_000;
const FAILED_RETRY_MS = 24 * 60 * 60 * 1_000;
const STALE_RUN_MS = 15 * 60 * 1_000;

/**
 * Queue a best-effort tech-stack scan for a website. Never throws for bad input and never
 * blocks the caller; recent or in-flight scans of the same hostname are reused.
 */
export async function scheduleWebsiteTechScan(
  ctx: MutationCtx,
  website: string | undefined,
  options: { force?: boolean } = {},
) {
  const domain = websiteTechDomain(website);
  if (!domain) return false;
  const existing = await ctx.db
    .query("websiteTechProfiles")
    .withIndex("domain", (q) => q.eq("domain", domain))
    .unique();
  const now = dayjs().valueOf();
  if (existing) {
    const age = now - existing.updatedAt;
    const inFlight =
      (existing.status === "pending" || existing.status === "running") &&
      age < STALE_RUN_MS;
    const recent =
      (existing.status === "completed" && age < FRESH_MS) ||
      (existing.status === "failed" && age < FAILED_RETRY_MS);
    if (inFlight || (recent && !options.force)) return false;
  }
  const runId = crypto.randomUUID();
  if (existing)
    await ctx.db.patch(existing._id, {
      status: "pending",
      runId,
      error: undefined,
      updatedAt: now,
    });
  else
    await ctx.db.insert("websiteTechProfiles", {
      domain,
      status: "pending",
      runId,
      signals: [],
      disclosures: [],
      updatedAt: now,
    });
  await ctx.scheduler.runAfter(0, internal.actions.websiteTech.run, {
    domain,
    runId,
  });
  return true;
}

export async function readWebsiteTechProfile(
  ctx: QueryCtx,
  website: string | undefined,
) {
  const domain = websiteTechDomain(website);
  if (!domain) return null;
  const profile = await ctx.db
    .query("websiteTechProfiles")
    .withIndex("domain", (q) => q.eq("domain", domain))
    .unique();
  return profile
    ? {
        domain: profile.domain,
        status: profile.status,
        signals: profile.signals,
        disclosures: profile.disclosures,
        inferences: profile.inferences ?? [],
        completedAt: profile.completedAt,
        updatedAt: profile.updatedAt,
      }
    : null;
}

export const claim = internalMutation({
  args: { domain: v.string(), runId: v.string() },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("websiteTechProfiles")
      .withIndex("domain", (q) => q.eq("domain", args.domain))
      .unique();
    if (profile?.status !== "pending" || profile.runId !== args.runId)
      return false;
    await ctx.db.patch(profile._id, {
      status: "running",
      updatedAt: dayjs().valueOf(),
    });
    return true;
  },
});

export const finish = internalMutation({
  args: {
    domain: v.string(),
    runId: v.string(),
    signals: v.array(websiteTechSignalValidator),
    disclosures: v.array(websiteTechDisclosureValidator),
    inferences: v.array(websiteTechInferenceValidator),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("websiteTechProfiles")
      .withIndex("domain", (q) => q.eq("domain", args.domain))
      .unique();
    if (profile?.status !== "running" || profile.runId !== args.runId) return;
    const found = args.signals.length > 0 || args.disclosures.length > 0;
    const now = dayjs().valueOf();
    await ctx.db.patch(profile._id, {
      // A failed rescan keeps the last good findings rather than erasing them.
      status: found || !args.error ? "completed" : "failed",
      ...(found || !args.error
        ? {
            signals: args.signals.slice(0, 80),
            disclosures: args.disclosures.slice(0, 40),
            inferences: args.inferences,
            completedAt: now,
          }
        : {}),
      error: args.error?.slice(0, 500),
      updatedAt: now,
    });
  },
});

export const getForOperator = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const org = await ctx.db.get(args.orgId);
    if (!org || org.deletedAt !== undefined) return null;
    return {
      website: org.website ?? null,
      profile: await readWebsiteTechProfile(ctx, org.website),
    };
  },
});

export const rescanForOperator = mutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await assertNoOperatorImpersonation(ctx, operator.userId);
    const org = await ctx.db.get(args.orgId);
    if (!org || org.deletedAt !== undefined)
      throw new Error("Organization not found");
    return await scheduleWebsiteTechScan(ctx, org.website, { force: true });
  },
});

export const scheduleInternal = internalMutation({
  args: { website: v.string(), force: v.optional(v.boolean()) },
  handler: async (ctx, args) =>
    await scheduleWebsiteTechScan(ctx, args.website, { force: args.force }),
});
