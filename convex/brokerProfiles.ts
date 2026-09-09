import dayjs from "dayjs";
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { getOrgAccess } from "./lib/access";
import { isLobCode } from "./lib/linesOfBusiness";
import {
  requireOperator,
  requireOperatorForUser,
  writeOperatorAudit,
} from "./lib/operatorIdentity";

const statusValidator = v.union(
  v.literal("prospect"),
  v.literal("active"),
  v.literal("inactive"),
  v.literal("blacklisted"),
);
const addressValidator = v.object({
  street1: v.optional(v.string()),
  street2: v.optional(v.string()),
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  postalCode: v.optional(v.string()),
  country: v.optional(v.string()),
});
const USPS_STATES = new Set([
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
  "DC",
]);

function normalizeStates(values: string[]) {
  const states = Array.from(
    new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean)),
  );
  if (states.some((state) => !USPS_STATES.has(state)))
    throw new Error("Writing states must use USPS abbreviations");
  return states.sort();
}

function normalizeLines(values: string[]) {
  const lines = Array.from(
    new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean)),
  );
  if (lines.some((line) => !isLobCode(line))) {
    throw new Error("Lines must use exact ACORD LOBCd values");
  }
  return lines.sort();
}

async function requireBroker(
  ctx: QueryCtx | MutationCtx,
  brokerOrgId: Id<"organizations">,
) {
  const broker = await ctx.db.get(brokerOrgId);
  if (!broker || broker.type !== "broker")
    throw new Error("Broker organization not found");
  return broker;
}

async function requireDirectOperatorWrite(
  ctx: MutationCtx,
  operatorUserId: Id<"users">,
) {
  const operator = await requireOperatorForUser(ctx, operatorUserId);
  const activeImpersonation = await ctx.db
    .query("operatorImpersonationSessions")
    .withIndex("operator_status", (q) =>
      q.eq("operatorUserId", operatorUserId).eq("status", "active"),
    )
    .first();
  if (activeImpersonation) throw new Error("IMPERSONATION_READ_ONLY");
  return operator;
}

async function profileRow(
  ctx: QueryCtx,
  broker: Doc<"organizations">,
  includeNetworkActivity = true,
) {
  const profile = await ctx.db
    .query("brokerProfiles")
    .withIndex("broker", (q) => q.eq("brokerOrgId", broker._id))
    .unique();
  const memberships = await ctx.db
    .query("orgMemberships")
    .withIndex("organization", (q) => q.eq("orgId", broker._id))
    .collect();
  const contacts = await Promise.all(
    memberships.map(async (membership) => {
      const user = await ctx.db.get(membership.userId);
      return user
        ? {
            userId: user._id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            role: membership.role,
          }
        : null;
    }),
  );
  const [lastOutreach, proposals] = includeNetworkActivity
    ? await Promise.all([
        ctx.db
          .query("procurementBrokerOutreaches")
          .withIndex("broker", (q) => q.eq("brokerOrgId", broker._id))
          .order("desc")
          .first(),
        ctx.db
          .query("procurementProposals")
          .withIndex("broker", (q) => q.eq("brokerOrgId", broker._id))
          .collect(),
      ])
    : [null, []];
  return {
    broker: {
      _id: broker._id,
      name: broker.name,
      website: broker.website,
      iconStorageId: broker.iconStorageId,
      iconUrl: broker.iconStorageId
        ? await ctx.storage.getUrl(broker.iconStorageId)
        : null,
    },
    profile,
    contacts: contacts.filter(Boolean),
    ...(includeNetworkActivity
      ? {
          lastOutreachAt: lastOutreach?.updatedAt,
          proposalCount: proposals.length,
        }
      : {}),
  };
}

export async function getBrokerProfileDetails(
  ctx: QueryCtx,
  brokerOrgId: Id<"organizations">,
) {
  return await profileRow(ctx, await requireBroker(ctx, brokerOrgId));
}

export async function listBrokerProfiles(
  ctx: QueryCtx,
  args: {
    search?: string;
    status?: "prospect" | "active" | "inactive" | "blacklisted";
    writingState?: string;
    lineOfBusinessCode?: string;
    limit?: number;
  },
) {
  // Filtering after `take(limit)` silently dropped matching brokers whenever
  // the first page was full of non-matches. The directory is operator-only and
  // intentionally bounded after filtering so every network profile is eligible.
  const brokers = await ctx.db
    .query("organizations")
    .withIndex("type", (q) => q.eq("type", "broker"))
    .collect();
  const rows = await Promise.all(
    brokers.map((broker) => profileRow(ctx, broker)),
  );
  const search = args.search?.trim().toLowerCase();
  const state = args.writingState?.trim().toUpperCase();
  const line = args.lineOfBusinessCode?.trim().toUpperCase();
  const limit = Math.max(1, Math.min(args.limit ?? 500, 500));
  return rows
    .filter(
      (row) =>
        (!search ||
          [row.broker.name, row.broker.website].some((value) =>
            value?.toLowerCase().includes(search),
          )) &&
        (!args.status || row.profile?.networkStatus === args.status) &&
        (!state || row.profile?.writingStates.includes(state)) &&
        (!line || row.profile?.lineOfBusinessCodes.includes(line)),
    )
    .slice(0, limit);
}

export async function updateBrokerProfileByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    brokerOrgId: Id<"organizations">;
    networkStatus?: "prospect" | "active" | "inactive" | "blacklisted";
    officeAddress?: Doc<"brokerProfiles">["officeAddress"];
    writingStates?: string[];
    lineOfBusinessCodes?: string[];
    name?: string;
    website?: string | null;
    iconStorageId?: Id<"_storage"> | null;
  },
) {
  const operator = await requireDirectOperatorWrite(ctx, args.operatorUserId);
  const broker = await requireBroker(ctx, args.brokerOrgId);
  const now = dayjs().valueOf();
  if (
    args.iconStorageId &&
    !(await ctx.storage.getMetadata(args.iconStorageId))
  )
    throw new Error("Broker logo not found");
  const existing = await ctx.db
    .query("brokerProfiles")
    .withIndex("broker", (q) => q.eq("brokerOrgId", broker._id))
    .unique();
  const profilePatch = {
    networkStatus: args.networkStatus ?? existing?.networkStatus ?? "prospect",
    officeAddress: args.officeAddress ?? existing?.officeAddress,
    writingStates: args.writingStates
      ? normalizeStates(args.writingStates)
      : (existing?.writingStates ?? []),
    lineOfBusinessCodes: args.lineOfBusinessCodes
      ? normalizeLines(args.lineOfBusinessCodes)
      : (existing?.lineOfBusinessCodes ?? []),
    updatedByUserId: operator.userId,
    updatedAt: now,
  };
  const profileId = existing
    ? (await ctx.db.patch(existing._id, profilePatch), existing._id)
    : await ctx.db.insert("brokerProfiles", {
        brokerOrgId: broker._id,
        ...profilePatch,
        createdByUserId: operator.userId,
        createdAt: now,
      });
  const orgPatch: Partial<Doc<"organizations">> = {};
  if (args.name !== undefined) orgPatch.name = args.name.trim() || broker.name;
  if (args.website !== undefined)
    orgPatch.website = args.website?.trim() || undefined;
  if (args.iconStorageId !== undefined)
    orgPatch.iconStorageId = args.iconStorageId ?? undefined;
  if (Object.keys(orgPatch).length) await ctx.db.patch(broker._id, orgPatch);
  await writeOperatorAudit(ctx, {
    operatorUserId: operator.userId,
    type: "setup_write",
    targetOrgId: broker._id,
    summary: `Updated broker network profile for ${broker.name}`,
    metadata: { profileId },
  });
  return { profileId };
}

export const list = query({
  args: {
    search: v.optional(v.string()),
    status: v.optional(statusValidator),
    writingState: v.optional(v.string()),
    lineOfBusinessCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    return await listBrokerProfiles(ctx, args);
  },
});

export const get = query({
  args: { brokerOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.brokerOrgId, {
      allowOperator: true,
    });
    if (access.accessType !== "member" && access.accessType !== "operator")
      throw new Error("Unauthorized");
    return await profileRow(
      ctx,
      await requireBroker(ctx, args.brokerOrgId),
      access.accessType === "operator",
    );
  },
});

export const upsert = mutation({
  args: {
    brokerOrgId: v.id("organizations"),
    name: v.optional(v.string()),
    website: v.optional(v.union(v.string(), v.null())),
    iconStorageId: v.optional(v.union(v.id("_storage"), v.null())),
    networkStatus: v.optional(statusValidator),
    officeAddress: v.optional(addressValidator),
    writingStates: v.optional(v.array(v.string())),
    lineOfBusinessCodes: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const broker = await requireBroker(ctx, args.brokerOrgId);
    const access = await getOrgAccess(ctx, args.brokerOrgId, {
      allowOperator: true,
    });
    if (access.accessType === "member") {
      const impersonation = await ctx.db
        .query("operatorImpersonationSessions")
        .withIndex("operator_status", (q) =>
          q.eq("operatorUserId", access.userId).eq("status", "active"),
        )
        .first();
      if (impersonation) throw new Error("IMPERSONATION_READ_ONLY");
    }
    if (
      access.accessType !== "operator" &&
      !(access.accessType === "member" && access.role === "admin")
    )
      throw new Error("Broker admin required");
    const now = dayjs().valueOf();
    if (
      args.iconStorageId &&
      !(await ctx.storage.getMetadata(args.iconStorageId))
    )
      throw new Error("Broker logo not found");
    const brokerPatch: Partial<Doc<"organizations">> = {};
    if (args.name !== undefined)
      brokerPatch.name = args.name.trim() || broker.name;
    if (args.website !== undefined)
      brokerPatch.website = args.website?.trim() || undefined;
    if (args.iconStorageId !== undefined)
      brokerPatch.iconStorageId = args.iconStorageId ?? undefined;
    if (Object.keys(brokerPatch).length)
      await ctx.db.patch(broker._id, brokerPatch);
    const existing = await ctx.db
      .query("brokerProfiles")
      .withIndex("broker", (q) => q.eq("brokerOrgId", args.brokerOrgId))
      .unique();
    if (
      access.accessType !== "operator" &&
      args.networkStatus !== undefined &&
      args.networkStatus !== (existing?.networkStatus ?? "prospect")
    )
      throw new Error("Only operators can change broker network status");
    const patch = {
      networkStatus:
        args.networkStatus ?? existing?.networkStatus ?? "prospect",
      officeAddress:
        args.officeAddress === undefined
          ? existing?.officeAddress
          : {
              ...existing?.officeAddress,
              ...args.officeAddress,
            },
      writingStates:
        args.writingStates === undefined
          ? (existing?.writingStates ?? [])
          : normalizeStates(args.writingStates),
      lineOfBusinessCodes:
        args.lineOfBusinessCodes === undefined
          ? (existing?.lineOfBusinessCodes ?? [])
          : normalizeLines(args.lineOfBusinessCodes),
      updatedByUserId: access.userId,
      updatedAt: now,
    };
    const profileId = existing
      ? (await ctx.db.patch(existing._id, patch), existing._id)
      : await ctx.db.insert("brokerProfiles", {
          brokerOrgId: args.brokerOrgId,
          ...patch,
          createdByUserId: access.userId,
          createdAt: now,
        });
    if (access.accessType === "operator")
      await writeOperatorAudit(ctx, {
        operatorUserId: access.userId,
        type: "setup_write",
        targetOrgId: broker._id,
        summary: `Updated broker network profile for ${broker.name}`,
        metadata: { profileId },
      });
    return profileId;
  },
});

export const generateLogoUploadUrl = mutation({
  args: { brokerOrgId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireBroker(ctx, args.brokerOrgId);
    const access = await getOrgAccess(ctx, args.brokerOrgId, {
      allowOperator: true,
    });
    if (
      access.accessType !== "operator" &&
      !(access.accessType === "member" && access.role === "admin")
    )
      throw new Error("Broker admin required");
    return await ctx.storage.generateUploadUrl();
  },
});

export async function createStandaloneBrokerByOperator(
  ctx: MutationCtx,
  args: {
    operatorUserId: Id<"users">;
    name: string;
    website?: string;
    networkStatus?: "prospect" | "active" | "inactive" | "blacklisted";
    officeAddress?: Doc<"brokerProfiles">["officeAddress"];
    writingStates?: string[];
    lineOfBusinessCodes?: string[];
    source: "operator" | "agent";
  },
) {
  const operator = await requireDirectOperatorWrite(ctx, args.operatorUserId);
  const name = args.name.trim();
  if (!name) throw new Error("Broker name is required");
  const now = dayjs().valueOf();
  const brokerOrgId = await ctx.db.insert("organizations", {
    name,
    type: "broker",
    website: args.website?.trim() || undefined,
    operatorStatus: "live",
    onboardingComplete: true,
  });
  const profileId = await ctx.db.insert("brokerProfiles", {
    brokerOrgId,
    networkStatus: args.networkStatus ?? "prospect",
    officeAddress: args.officeAddress,
    writingStates: normalizeStates(args.writingStates ?? []),
    lineOfBusinessCodes: normalizeLines(args.lineOfBusinessCodes ?? []),
    createdByUserId: operator.userId,
    updatedByUserId: operator.userId,
    createdAt: now,
    updatedAt: now,
  });
  await writeOperatorAudit(ctx, {
    operatorUserId: operator.userId,
    type: "broker_created",
    targetOrgId: brokerOrgId,
    summary: `Created standalone broker profile ${name}`,
    metadata: { profileId, hasPortalUsers: false, source: args.source },
  });
  return { brokerOrgId, profileId };
}

export const createStandalone = mutation({
  args: {
    name: v.string(),
    website: v.optional(v.string()),
    networkStatus: statusValidator,
    officeAddress: v.optional(addressValidator),
    writingStates: v.array(v.string()),
    lineOfBusinessCodes: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return await createStandaloneBrokerByOperator(ctx, {
      operatorUserId: operator.userId,
      ...args,
      source: "operator",
    });
  },
});
