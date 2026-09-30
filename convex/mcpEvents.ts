import dayjs from "dayjs";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { query, mutation, internalQuery, internalMutation, type QueryCtx, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getCurrentOrgAccess } from "./lib/access";
import { getActiveOperatorProfile, getActiveOperatorImpersonation, requireOperatorForUser } from "./lib/operatorIdentity";
import { mcpEventIdentityValidator, type McpEventIdentity } from "./lib/mcpEventIdentity";
import { listMcpEventDefinitions, validateMcpEventFilters, validateMcpEventData, type McpEventName } from "./lib/mcpEventCatalog";

type DatabaseCtx = QueryCtx | MutationCtx;
const filtersValidator = v.record(v.string(), v.string());
const MAX_AUDIENCE_SUBSCRIPTIONS = 200;

async function assertPrincipal(ctx: DatabaseCtx, principal: Pick<Doc<"mcpEventSubscriptions">, "userId" | "orgId" | "principalKind">) {
  if (principal.principalKind === "operator") {
    await requireOperatorForUser(ctx, principal.userId);
    return;
  }
  if (!principal.orgId) throw new Error("Event access denied");
  const [user, org, membership] = await Promise.all([
    ctx.db.get(principal.userId), ctx.db.get(principal.orgId),
    ctx.db.query("orgMemberships").withIndex("organization_user", (query) => query.eq("orgId", principal.orgId!).eq("userId", principal.userId)).first(),
  ]);
  if (!user || user.accountKind === "operator" || !org || org.type !== "client" || org.deletedAt !== undefined || !membership) throw new Error("Event access denied");
}

async function assertTargets(ctx: DatabaseCtx, principal: { principalKind: "organization" | "operator"; orgId?: Id<"organizations"> }, filters: Record<string, string>) {
  const selectedOrg = filters.org_id ? ctx.db.normalizeId("organizations", filters.org_id) : principal.orgId;
  if (filters.org_id && !selectedOrg) throw new Error("Event access denied");
  if (principal.principalKind === "organization" && selectedOrg !== principal.orgId) throw new Error("Event access denied");
  if (selectedOrg) {
    const org = await ctx.db.get(selectedOrg);
    if (!org || org.type !== "client" || org.deletedAt !== undefined) throw new Error("Event access denied");
  }
  if (filters.policy_id) {
    const policyId = ctx.db.normalizeId("policies", filters.policy_id);
    const policy = policyId ? await ctx.db.get(policyId) : null;
    if (!policy?.orgId || (selectedOrg && policy.orgId !== selectedOrg) || policy.deletedAt !== undefined) throw new Error("Event access denied");
    const org = await ctx.db.get(policy.orgId);
    if (!org || org.deletedAt !== undefined) throw new Error("Event access denied");
  }
  if (filters.request_id) {
    const requestId = ctx.db.normalizeId("procurementRequests", filters.request_id);
    const request = requestId ? await ctx.db.get(requestId) : null;
    if (!request || (selectedOrg && request.clientOrgId !== selectedOrg) || (principal.principalKind === "organization" && request.clientVisible === false)) throw new Error("Event access denied");
    const org = await ctx.db.get(request.clientOrgId);
    if (!org || org.deletedAt !== undefined) throw new Error("Event access denied");
  }
  if (filters.vendor_org_id) {
    const vendorOrgId = ctx.db.normalizeId("organizations", filters.vendor_org_id);
    const vendor = vendorOrgId ? await ctx.db.get(vendorOrgId) : null;
    if (!vendor || vendor.deletedAt !== undefined) throw new Error("Event access denied");
    if (principal.principalKind === "organization") {
      const relationship = await ctx.db.query("connectedOrgRelationships").withIndex("vendor_status", (query) => query.eq("vendorOrgId", vendor._id).eq("status", "active")).filter((query) => query.eq(query.field("clientOrgId"), principal.orgId)).first();
      if (!relationship) throw new Error("Event access denied");
    }
  }
}

async function authorize(ctx: DatabaseCtx, identity: McpEventIdentity, name?: string, filters: Record<string, string> = {}) {
  const tokenId = identity.tokenId ? ctx.db.normalizeId("oauthTokens", identity.tokenId) : null;
  const token = tokenId ? await ctx.db.get(tokenId) : null;
  const now = dayjs().valueOf();
  if (!token || token.userId !== identity.userId || (token.principalKind ?? "organization") !== identity.principalKind || token.revokedAt !== undefined || token.expiresAt <= now || !token.scopes.includes("read") || !token.resource || (identity.principalKind === "organization" && token.orgId !== identity.orgId)) throw new Error("Event access denied");
  await assertPrincipal(ctx, { ...token, principalKind: identity.principalKind });
  if (name) {
    validateMcpEventFilters(name, filters);
    if (name === "proposal.review_ready" && identity.principalKind !== "operator") throw new Error("Event access denied");
    await assertTargets(ctx, { ...token, principalKind: identity.principalKind }, filters);
  }
  return {
    userId: token.userId, orgId: token.orgId, principalKind: identity.principalKind,
    clientId: token.clientId, resource: token.resource,
    principalKey: JSON.stringify([identity.principalKind, token.userId, token.orgId ?? null, token.clientId, token.resource]),
  };
}

export const authorizeInternal = internalQuery({
  args: {
    identity: mcpEventIdentityValidator, name: v.optional(v.string()), filters: filtersValidator,
    callbackUrl: v.optional(v.string()), secretFingerprint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const principal = await authorize(ctx, args.identity, args.name, args.filters);
    let callbackVerifiedAt: number | undefined;
    if (args.callbackUrl && args.secretFingerprint) {
      const now = dayjs().valueOf();
      const verified = await ctx.db.query("mcpEventSubscriptions")
        .withIndex("callback", (query) => query.eq("userId", principal.userId)
          .eq("principalKind", principal.principalKind).eq("orgId", principal.orgId)
          .eq("clientId", principal.clientId).eq("resource", principal.resource)
          .eq("callbackUrl", args.callbackUrl!).eq("secretFingerprint", args.secretFingerprint!)
          .eq("active", true))
        .filter((query) => query.and(query.gt(query.field("expiresAt"), now),
          query.gt(query.field("callbackVerifiedAt"), dayjs(now).subtract(5, "minute").valueOf()),
          query.lte(query.field("callbackVerifiedAt"), now)))
        .first();
      callbackVerifiedAt = verified?.callbackVerifiedAt;
    }
    return { ...principal, callbackVerifiedAt };
  },
});

export const listEventsInternal = internalQuery({
  args: { identity: mcpEventIdentityValidator },
  handler: async (ctx, args) => {
    await authorize(ctx, args.identity);
    return { events: listMcpEventDefinitions(args.identity.principalKind) };
  },
});

export const saveSubscriptionInternal = internalMutation({
  args: {
    identity: mcpEventIdentityValidator, id: v.string(), name: v.string(), filters: filtersValidator,
    callbackUrl: v.string(), encryptedSecret: v.string(), expiresAt: v.number(),
    secretFingerprint: v.optional(v.string()), callbackVerifiedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const principal = await authorize(ctx, args.identity, args.name, args.filters);
    const now = dayjs().valueOf();
    if (!Number.isFinite(args.expiresAt) || args.expiresAt <= now || args.expiresAt > dayjs(now).add(7, "day").valueOf()) throw new Error("Invalid subscription expiration");
    const existing = await ctx.db.query("mcpEventSubscriptions").withIndex("identity", (query) => query.eq("id", args.id)).unique();
    if (existing && (existing.userId !== principal.userId || existing.orgId !== principal.orgId || existing.clientId !== principal.clientId || existing.principalKind !== principal.principalKind || existing.resource !== principal.resource || existing.name !== args.name || existing.callbackUrl !== args.callbackUrl || JSON.stringify(Object.entries(existing.filters).sort()) !== JSON.stringify(Object.entries(args.filters).sort()))) throw new Error("Subscription identity conflict");
    const owned = await ctx.db.query("mcpEventSubscriptions").withIndex("user", (query) => query.eq("userId", principal.userId)).filter((query) => query.and(query.eq(query.field("active"), true), query.gt(query.field("expiresAt"), now))).take(21);
    const audience = await ctx.db.query("mcpEventSubscriptions").withIndex("audience", (query) => query.eq("principalKind", principal.principalKind).eq("orgId", principal.orgId).eq("name", args.name).eq("active", true)).filter((query) => query.gt(query.field("expiresAt"), now)).take(MAX_AUDIENCE_SUBSCRIPTIONS + 1);
    if (!(existing?.active && existing.expiresAt > now) && (owned.length >= 20 || audience.length >= MAX_AUDIENCE_SUBSCRIPTIONS)) throw new Error("Subscription limit reached");
    const value = {
      id: args.id, userId: principal.userId, orgId: principal.orgId, principalKind: principal.principalKind,
      clientId: principal.clientId, resource: principal.resource, name: args.name, filters: args.filters,
      callbackUrl: args.callbackUrl, encryptedSecret: args.encryptedSecret,
      secretFingerprint: args.secretFingerprint, callbackVerifiedAt: args.callbackVerifiedAt,
      previousEncryptedSecret: existing?.active && existing.expiresAt > now ? existing.encryptedSecret : undefined,
      previousSecretUntil: existing?.active && existing.expiresAt > now ? dayjs(now).add(5, "minute").valueOf() : undefined,
      generation: (existing?.generation ?? 0) + 1, active: true, expiresAt: args.expiresAt, updatedAt: now,
    };
    if (existing) await ctx.db.patch(existing._id, value);
    else await ctx.db.insert("mcpEventSubscriptions", { ...value, createdAt: now });
    return { id: args.id, refreshBefore: dayjs(args.expiresAt).toISOString(), cursor: null, truncated: false };
  },
});

export const unsubscribeInternal = internalMutation({
  args: { identity: mcpEventIdentityValidator, id: v.string() },
  handler: async (ctx, args) => {
    const principal = await authorize(ctx, args.identity);
    const existing = await ctx.db.query("mcpEventSubscriptions").withIndex("identity", (query) => query.eq("id", args.id)).unique();
    if (!existing) return {};
    if (existing.userId !== principal.userId || existing.clientId !== principal.clientId || existing.resource !== principal.resource || existing.principalKind !== principal.principalKind || existing.orgId !== principal.orgId) throw new Error("Event access denied");
    await ctx.db.patch(existing._id, { active: false, generation: existing.generation + 1, encryptedSecret: "", previousEncryptedSecret: undefined, previousSecretUntil: undefined, updatedAt: dayjs().valueOf() });
    return {};
  },
});

async function settingsActor(ctx: DatabaseCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Authentication required");
  const operator = await getActiveOperatorProfile(ctx);
  if (operator) return { userId, principalKind: "operator" as const, orgId: undefined };
  const access = await getCurrentOrgAccess(ctx);
  if (!access || access.orgType !== "client") throw new Error("Event access denied");
  return { userId, principalKind: "organization" as const, orgId: access.orgId };
}

export const listSubscriptions = query({
  args: {},
  handler: async (ctx) => {
    const actor = await settingsActor(ctx);
    const rows = await ctx.db.query("mcpEventSubscriptions").withIndex("user", (query) => query.eq("userId", actor.userId)).filter((query) => query.and(query.eq(query.field("principalKind"), actor.principalKind), query.eq(query.field("orgId"), actor.orgId))).order("desc").take(100);
    return rows.map((row) => ({ _id: row._id, name: row.name, filters: row.filters, callbackOrigin: new URL(row.callbackUrl).origin, expiresAt: row.expiresAt, active: row.active && row.expiresAt > dayjs().valueOf(), createdAt: row.createdAt }));
  },
});

export const revokeSubscription = mutation({
  args: { subscriptionId: v.id("mcpEventSubscriptions") },
  handler: async (ctx, args) => {
    if (await getActiveOperatorImpersonation(ctx)) throw new Error("Event access denied");
    const actor = await settingsActor(ctx);
    const row = await ctx.db.get(args.subscriptionId);
    if (!row || row.userId !== actor.userId || row.orgId !== actor.orgId || row.principalKind !== actor.principalKind) throw new Error("Event access denied");
    await ctx.db.patch(row._id, { active: false, generation: row.generation + 1, encryptedSecret: "", previousEncryptedSecret: undefined, previousSecretUntil: undefined, updatedAt: dayjs().valueOf() });
  },
});

export async function publishMcpEvent(ctx: MutationCtx, event: { name: McpEventName; key: string; orgId: Id<"organizations">; targetUserId?: Id<"users">; data: Record<string, string> }) {
  validateMcpEventData(event.name, event.data);
  if (event.data.org_id !== event.orgId) throw new Error("Event organization mismatch");
  const now = dayjs().valueOf();
  const audiences = event.name === "proposal.review_ready" ? ["operator" as const] : ["organization" as const, "operator" as const];
  for (const principalKind of audiences) {
    const rows = await ctx.db.query("mcpEventSubscriptions").withIndex("audience", (query) => query.eq("principalKind", principalKind).eq("orgId", principalKind === "organization" ? event.orgId : undefined).eq("name", event.name).eq("active", true)).filter((query) => query.gt(query.field("expiresAt"), now)).take(MAX_AUDIENCE_SUBSCRIPTIONS);
    for (const subscription of rows) {
      if (event.targetUserId && subscription.userId !== event.targetUserId) continue;
      if (Object.entries(subscription.filters).some(([key, value]) => event.data[key] !== value)) continue;
      const eventId = `evt_${event.name}_${event.key}`;
      const existing = await ctx.db.query("mcpEventDeliveries").withIndex("event_subscription", (query) => query.eq("eventId", eventId).eq("subscriptionId", subscription._id)).unique();
      if (existing) continue;
      const deliveryId = await ctx.db.insert("mcpEventDeliveries", {
        subscriptionId: subscription._id, eventId, name: event.name, orgId: event.orgId,
        targetUserId: event.targetUserId, data: event.data, timestamp: dayjs(now).toISOString(),
        status: "pending", attempts: 0, nextAttemptAt: now, expiresAt: dayjs(now).add(1, "day").valueOf(),
      });
      await ctx.scheduler.runAfter(0, internal.actions.mcpEvents.deliver, { deliveryId });
    }
  }
}

async function authorizeDelivery(ctx: DatabaseCtx, delivery: Doc<"mcpEventDeliveries">) {
  const now = dayjs().valueOf();
  const subscription = await ctx.db.get(delivery.subscriptionId);
  if (!subscription || !subscription.active || subscription.expiresAt <= now || delivery.expiresAt <= now || (delivery.targetUserId && subscription.userId !== delivery.targetUserId) || (subscription.principalKind === "organization" && subscription.orgId !== delivery.orgId)) return null;
  try {
    await assertPrincipal(ctx, subscription);
    const tokens = await ctx.db.query("oauthTokens").withIndex("user_client", (query) => query.eq("userId", subscription.userId).eq("clientId", subscription.clientId)).order("desc").take(100);
    if (!tokens.some((token) => token.revokedAt === undefined && (token.principalKind ?? "organization") === subscription.principalKind && token.orgId === subscription.orgId && token.resource === subscription.resource && token.scopes.includes("read") && (token.expiresAt > now || (token.refreshExpiresAt ?? 0) > now))) return null;
    if (delivery.name === "proposal.review_ready" && subscription.principalKind !== "operator") return null;
    if (Object.entries(subscription.filters).some(([key, value]) => delivery.data[key] !== value)) return null;
    const targets = Object.fromEntries(Object.entries(delivery.data).filter(([key]) => ["org_id", "policy_id", "request_id", "vendor_org_id"].includes(key)));
    await assertTargets(ctx, subscription, targets);
    if (delivery.data.review_id) {
      const reviewId = ctx.db.normalizeId("procurementProposalReviews", delivery.data.review_id);
      const review = reviewId ? await ctx.db.get(reviewId) : null;
      const proposal = review ? await ctx.db.get(review.proposalId) : null;
      const request = review ? await ctx.db.get(review.requestId) : null;
      if (!review || !proposal || !request || proposal.status === "archived" || proposal.extractionFingerprint !== review.extractionFingerprint || (request.packetRevision ?? 0) !== review.packetRevision || proposal._id !== delivery.data.proposal_id || request._id !== delivery.data.request_id) return null;
    }
    return subscription;
  } catch { return null; }
}

export const claimDeliveryInternal = internalMutation({
  args: { deliveryId: v.id("mcpEventDeliveries"), lease: v.string() },
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    const now = dayjs().valueOf();
    if (!delivery || !["pending", "sending"].includes(delivery.status) || delivery.nextAttemptAt > now || (delivery.status === "sending" && (delivery.leaseUntil ?? 0) > now)) return null;
    const subscription = await authorizeDelivery(ctx, delivery);
    if (!subscription || delivery.attempts >= 5) {
      await ctx.db.patch(delivery._id, { status: "cancelled", lease: undefined, leaseUntil: undefined });
      return null;
    }
    await ctx.db.patch(delivery._id, { status: "sending", attempts: delivery.attempts + 1, lease: args.lease, leaseUntil: dayjs(now).add(30, "second").valueOf() });
    return { delivery, subscription };
  },
});

export const checkDeliveryInternal = internalQuery({
  args: { deliveryId: v.id("mcpEventDeliveries"), lease: v.string(), generation: v.number() },
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery || delivery.status !== "sending" || delivery.lease !== args.lease || (delivery.leaseUntil ?? 0) <= dayjs().valueOf()) return false;
    const subscription = await authorizeDelivery(ctx, delivery);
    return subscription?.generation === args.generation;
  },
});

export const finishDeliveryInternal = internalMutation({
  args: { deliveryId: v.id("mcpEventDeliveries"), lease: v.string(), generation: v.number(), statusCode: v.number(), permanent: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery || delivery.status !== "sending" || delivery.lease !== args.lease || (delivery.leaseUntil ?? 0) <= dayjs().valueOf()) return;
    const subscription = await authorizeDelivery(ctx, delivery);
    const rotated = subscription && subscription.generation !== args.generation;
    const accepted = args.statusCode >= 200 && args.statusCode < 300;
    const transient = args.statusCode === 0 || args.statusCode === 408 || args.statusCode === 429 || args.statusCode >= 500;
    const terminal = args.statusCode === 410 || args.statusCode === 413 || args.permanent;
    const retry = !!subscription && !terminal && delivery.attempts < 5 && (rotated || transient);
    const status = !subscription ? "cancelled" : retry ? "pending" : accepted ? "accepted" : "failed";
    const nextAttemptAt = dayjs().add(Math.min(60_000, 1_000 * 2 ** delivery.attempts), "millisecond").valueOf();
    await ctx.db.patch(delivery._id, { status, statusCode: args.statusCode, nextAttemptAt, lease: undefined, leaseUntil: undefined });
    if (retry) await ctx.scheduler.runAfter(Math.max(0, nextAttemptAt - dayjs().valueOf()), internal.actions.mcpEvents.deliver, { deliveryId: delivery._id });
  },
});

export const recoverInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = dayjs().valueOf();
    const pending = await ctx.db.query("mcpEventDeliveries").withIndex("due", (query) => query.eq("status", "pending").lte("nextAttemptAt", now)).take(50);
    const sending = await ctx.db.query("mcpEventDeliveries").withIndex("lease", (query) => query.eq("status", "sending").lte("leaseUntil", now)).take(50);
    for (const row of [...pending, ...sending]) await ctx.scheduler.runAfter(0, internal.actions.mcpEvents.deliver, { deliveryId: row._id });
    const expired = await ctx.db.query("mcpEventDeliveries").withIndex("expiry", (query) => query.lt("expiresAt", dayjs(now).subtract(7, "day").valueOf())).take(100);
    for (const row of expired) await ctx.db.delete(row._id);
    const subscriptions = await ctx.db.query("mcpEventSubscriptions").withIndex("expiry", (query) => query.eq("active", true).lte("expiresAt", now)).take(100);
    for (const row of subscriptions) await ctx.db.patch(row._id, { active: false, generation: row.generation + 1, encryptedSecret: "", previousEncryptedSecret: undefined, previousSecretUntil: undefined, updatedAt: now });
    return { scheduled: pending.length + sending.length, removed: expired.length };
  },
});
