/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { routerJobTokenHash } from "./routerJobs";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const harness = () => convexTest(schema, modules);
type Harness = ReturnType<typeof harness>;

// Callback capability invariants: a token authorizes exactly one active
// monitor, a delivery is applied once, and malformed or oversized bodies write
// nothing.
const tokenA = "a".repeat(64);
const tokenB = "b".repeat(64);

async function seed(t: Harness) {
  return t.run(async (ctx) => {
    const insertMonitor = async (
      name: string,
      token: string,
      routerMonitorId: string,
      status: "active" | "cancelled" = "active",
    ) => {
      const orgId = await ctx.db.insert("organizations", { name, type: "client" });
      const userId = await ctx.db.insert("users", {});
      const monitorId = await ctx.db.insert("clientWebMonitors", {
        orgId,
        routerMonitorId,
        status,
        query: "material developments",
        frequency: "1d",
        tokenHash: await routerJobTokenHash(token),
        createdAt: 1,
        createdByUserId: userId,
      });
      return { orgId, monitorId };
    };
    const a = await insertMonitor("Client A", tokenA, "mon_a");
    const b = await insertMonitor("Client B", tokenB, "mon_b");
    const cancelled = await insertMonitor("Client C", "c".repeat(64), "mon_c", "cancelled");
    return { a, b, cancelled };
  });
}

function callback(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: 1,
    monitorId: "mon_a",
    deliveryId: "delivery-1",
    kind: "events",
    events: [
      {
        eventId: "event-1",
        summary: "Regulator fined the company.",
        answers: {
          headline: {
            value: "Regulator fines Client A",
            confidence: "high",
            citations: [],
          },
          materiality: { value: "high", confidence: "medium", citations: [] },
        },
        citations: [{ url: "https://news.example.com/story", title: "Story" }],
      },
    ],
    ...overrides,
  };
}

function post(
  t: Harness,
  token: string | null,
  body: unknown,
) {
  return t.fetch(
    `/router-monitors/events${token ? `?token=${token}` : ""}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
  );
}

const events = (t: Harness, orgId: Id<"organizations">) =>
  t.run((ctx) =>
    ctx.db
      .query("clientWebMonitorEvents")
      .withIndex("by_org_received", (q) => q.eq("orgId", orgId))
      .collect(),
  );

test("rejects missing, malformed, unknown and cancelled tokens", async () => {
  const t = harness();
  await seed(t);
  expect((await post(t, null, callback())).status).toBe(404);
  expect((await post(t, "short", callback())).status).toBe(404);
  expect((await post(t, "d".repeat(64), callback())).status).toBe(404);
  expect(
    (await post(t, "c".repeat(64), callback({ monitorId: "mon_c" }))).status,
  ).toBe(404);
});

test("a token cannot write events for another monitor's organization", async () => {
  const t = harness();
  const { a, b } = await seed(t);
  const response = await post(t, tokenA, callback({ monitorId: "mon_b" }));
  expect(response.status).toBe(409);
  expect(await events(t, a.orgId)).toHaveLength(0);
  expect(await events(t, b.orgId)).toHaveLength(0);
  const mismatchedOrg = await post(
    t,
    tokenB,
    callback({ monitorId: "mon_b", orgId: a.orgId }),
  );
  expect(mismatchedOrg.status).toBe(409);
  expect(await events(t, a.orgId)).toHaveLength(0);
});

test("applies a delivery once and answers duplicates with success", async () => {
  const t = harness();
  const { a, b } = await seed(t);
  expect((await post(t, tokenA, callback())).status).toBe(200);
  expect((await post(t, tokenA, callback())).status).toBe(200);
  const stored = await events(t, a.orgId);
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({
    headline: "Regulator fines Client A",
    materiality: "high",
    citations: [{ url: "https://news.example.com/story", title: "Story" }],
  });
  expect(await events(t, b.orgId)).toHaveLength(0);
});

test("rejects oversized, malformed and unrecognized bodies without writing", async () => {
  const t = harness();
  const { a } = await seed(t);
  const oversized = JSON.stringify(
    callback({ events: [{ eventId: "e", summary: "x".repeat(300 * 1024), citations: [] }] }),
  );
  expect((await post(t, tokenA, oversized)).status).toBe(413);
  expect((await post(t, tokenA, "{not json")).status).toBe(400);
  expect((await post(t, tokenA, callback({ contractVersion: 2 }))).status).toBe(400);
  expect((await post(t, tokenA, callback({ extra: true }))).status).toBe(400);
  expect(
    (await post(t, tokenA, callback({ events: [{ eventId: "e", citations: [], note: "x" }] })))
      .status,
  ).toBe(400);
  expect(await events(t, a.orgId)).toHaveLength(0);
});

test("a failed execution records an error and no events", async () => {
  const t = harness();
  const { a } = await seed(t);
  const response = await post(
    t,
    tokenA,
    callback({ kind: "execution_failed", deliveryId: "delivery-2", events: [] }),
  );
  expect(response.status).toBe(200);
  expect(await events(t, a.orgId)).toHaveLength(0);
  const monitor = await t.run((ctx) => ctx.db.get(a.monitorId));
  expect(monitor?.error).toBeTruthy();
});
