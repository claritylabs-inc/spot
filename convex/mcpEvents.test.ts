/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import dayjs from "dayjs";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { publishMcpEvent } from "./mcpEvents";

const modules = import.meta.glob("./**/*.ts");

async function fixture() {
  const server = convexTest(schema, modules);
  const ids = await server.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { accountKind: "customer" });
    const outsiderId = await ctx.db.insert("users", { accountKind: "customer" });
    const orgId = await ctx.db.insert("organizations", { name: "Client", type: "client" });
    const otherOrgId = await ctx.db.insert("organizations", { name: "Other", type: "client" });
    const membershipId = await ctx.db.insert("orgMemberships", { userId, orgId, role: "admin" });
    await ctx.db.insert("orgMemberships", { userId: outsiderId, orgId: otherOrgId, role: "admin" });
    const tokenId = await ctx.db.insert("oauthTokens", {
      userId, orgId, clientId: "chatgpt", principalKind: "organization",
      resource: "https://spot.example/mcp", tokenHash: "test", scopes: ["read"],
      createdAt: dayjs().valueOf(), expiresAt: dayjs().add(1, "hour").valueOf(),
      refreshExpiresAt: dayjs().add(30, "day").valueOf(),
    });
    return { userId, outsiderId, orgId, otherOrgId, membershipId, tokenId };
  });
  const identity = { principalKind: "organization" as const, userId: ids.userId, orgId: ids.orgId, tokenId: ids.tokenId };
  const subscribe = () => server.mutation(internal.mcpEvents.saveSubscriptionInternal, {
    identity, id: "sub_test", name: "compliance.status_changed", filters: {},
    callbackUrl: "https://receiver.example/callback/private", encryptedSecret: "ciphertext",
    expiresAt: dayjs().add(1, "day").valueOf(),
  });
  return { server, ids, identity, subscribe };
}

test("subscription writes reject forged principals, operator events, and removed membership", async () => {
  const setup = await fixture();
  await expect(setup.server.query(internal.mcpEvents.authorizeInternal, {
    identity: { ...setup.identity, orgId: setup.ids.otherOrgId }, name: "compliance.status_changed", filters: {},
  })).rejects.toThrow();
  await expect(setup.server.query(internal.mcpEvents.authorizeInternal, {
    identity: setup.identity, name: "proposal.review_ready", filters: {},
  })).rejects.toThrow();
  await setup.server.run((ctx) => ctx.db.delete(setup.ids.membershipId));
  await expect(setup.subscribe()).rejects.toThrow();
});

test("renewal is idempotent, rotates keys, and subscription UI never returns secrets or callback paths", async () => {
  const setup = await fixture();
  await setup.subscribe();
  await setup.subscribe();
  const rows = await setup.server.run((ctx) => ctx.db.query("mcpEventSubscriptions").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0].generation).toBe(2);
  const result = await setup.server.withIdentity({ subject: `${setup.ids.userId}|session` }).query(api.mcpEvents.listSubscriptions, {});
  expect(result).toHaveLength(1);
  expect(JSON.stringify(result)).not.toContain("ciphertext");
  expect(JSON.stringify(result)).not.toContain("/callback/private");
  expect(result[0].callbackOrigin).toBe("https://receiver.example");
  await expect(setup.server.withIdentity({ subject: `${setup.ids.outsiderId}|session` }).mutation(api.mcpEvents.revokeSubscription, {
    subscriptionId: rows[0]._id,
  })).rejects.toThrow();
});

test("callback verification cache is bounded and isolated by principal, destination, and key", async () => {
  vi.useFakeTimers();
  try {
    const setup = await fixture();
    const callbackUrl = "https://receiver.example/callback/private";
    const callbackVerifiedAt = dayjs().valueOf();
    await setup.server.mutation(internal.mcpEvents.saveSubscriptionInternal, {
      identity: setup.identity, id: "sub_verified", name: "compliance.status_changed", filters: {},
      callbackUrl, encryptedSecret: "ciphertext", secretFingerprint: "key_one", callbackVerifiedAt,
      expiresAt: dayjs().add(1, "day").valueOf(),
    });
    const authorization = { identity: setup.identity, filters: {}, callbackUrl, secretFingerprint: "key_one" };
    expect((await setup.server.query(internal.mcpEvents.authorizeInternal, authorization)).callbackVerifiedAt).toBe(callbackVerifiedAt);
    expect((await setup.server.query(internal.mcpEvents.authorizeInternal, { ...authorization, callbackUrl: "https://receiver.example/other" })).callbackVerifiedAt).toBeUndefined();
    expect((await setup.server.query(internal.mcpEvents.authorizeInternal, { ...authorization, secretFingerprint: "key_two" })).callbackVerifiedAt).toBeUndefined();
    await expect(setup.server.query(internal.mcpEvents.authorizeInternal, { ...authorization, identity: { ...setup.identity, userId: setup.ids.outsiderId } })).rejects.toThrow();
    vi.advanceTimersByTime(5 * 60_000);
    expect((await setup.server.query(internal.mcpEvents.authorizeInternal, authorization)).callbackVerifiedAt).toBeUndefined();
  } finally { vi.useRealTimers(); }
});

test("publication deduplicates and app disconnect cancels pending delivery", async () => {
  vi.useFakeTimers();
  try {
    const setup = await fixture();
    await setup.subscribe();
    const event = { name: "compliance.status_changed" as const, key: "transition:1", orgId: setup.ids.orgId, data: { org_id: setup.ids.orgId, status: "gap", notification_type: "own_compliance_gap" } };
    await setup.server.run((ctx) => publishMcpEvent(ctx, event));
    await setup.server.run((ctx) => publishMcpEvent(ctx, event));
    const deliveries = await setup.server.run((ctx) => ctx.db.query("mcpEventDeliveries").collect());
    expect(deliveries).toHaveLength(1);
    await setup.server.run((ctx) => ctx.db.patch(setup.ids.tokenId, { revokedAt: dayjs().valueOf() }));
    expect(await setup.server.mutation(internal.mcpEvents.claimDeliveryInternal, { deliveryId: deliveries[0]._id, lease: "lease-1" })).toBeNull();
    expect((await setup.server.run((ctx) => ctx.db.get(deliveries[0]._id)))?.status).toBe("cancelled");
  } finally { vi.useRealTimers(); }
});

test("expired leases recover, stale completions cannot acknowledge, and 410 is terminal", async () => {
  vi.useFakeTimers();
  try {
    const setup = await fixture();
    await setup.subscribe();
    await setup.server.run((ctx) => publishMcpEvent(ctx, { name: "compliance.status_changed", key: "transition:2", orgId: setup.ids.orgId, data: { org_id: setup.ids.orgId, status: "gap", notification_type: "own_compliance_gap" } }));
    const delivery = await setup.server.run((ctx) => ctx.db.query("mcpEventDeliveries").first());
    expect(delivery).not.toBeNull();
    await setup.server.mutation(internal.mcpEvents.claimDeliveryInternal, { deliveryId: delivery!._id, lease: "old" });
    expect(await setup.server.mutation(internal.mcpEvents.claimDeliveryInternal, { deliveryId: delivery!._id, lease: "other" })).toBeNull();
    vi.advanceTimersByTime(31_000);
    const claim = await setup.server.mutation(internal.mcpEvents.claimDeliveryInternal, { deliveryId: delivery!._id, lease: "new" });
    expect(claim).not.toBeNull();
    await setup.server.mutation(internal.mcpEvents.finishDeliveryInternal, { deliveryId: delivery!._id, lease: "old", generation: claim!.subscription.generation, statusCode: 200 });
    expect((await setup.server.run((ctx) => ctx.db.get(delivery!._id)))?.status).toBe("sending");
    await setup.server.mutation(internal.mcpEvents.finishDeliveryInternal, { deliveryId: delivery!._id, lease: "new", generation: claim!.subscription.generation, statusCode: 410 });
    expect((await setup.server.run((ctx) => ctx.db.get(delivery!._id)))?.status).toBe("failed");
  } finally { vi.useRealTimers(); }
});
