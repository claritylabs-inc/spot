/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import { routerJobTokenHash } from "./routerJobs";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const harness = () => convexTest(schema, modules);
type Harness = ReturnType<typeof harness>;

// Callback capability invariants: a token authorizes exactly one live
// discovery, candidates land only on that discovery, a delivery is applied
// once, and malformed or oversized bodies write nothing.
const tokenA = "a".repeat(64);
const tokenB = "b".repeat(64);
const tokenPending = "e".repeat(64);

async function seed(t: Harness) {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {});
    const insertDiscovery = async (
      name: string,
      token: string,
      routerDiscoveryId: string | undefined,
      status: "running" | "cancelled" | "pending" = "running",
    ) => {
      const orgId = await ctx.db.insert("organizations", { name, type: "client" });
      const discoveryId = await ctx.db.insert("providerDiscoveries", {
        createdByUserId: userId,
        status,
        ...(routerDiscoveryId ? { routerDiscoveryId } : {}),
        tokenHash: await routerJobTokenHash(token),
        criteria: { lines: ["General liability"], states: ["CA"] },
        matchLimit: 25,
        createdAt: Date.now(),
      });
      return { orgId, discoveryId };
    };
    const a = await insertDiscovery("Client A", tokenA, "fa_a");
    const b = await insertDiscovery("Client B", tokenB, "fa_b");
    const cancelled = await insertDiscovery("Client C", "c".repeat(64), "fa_c", "cancelled");
    const pending = await insertDiscovery("Client D", tokenPending, undefined, "pending");
    return { a, b, cancelled, pending };
  });
}

function callback(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: 1,
    discoveryId: "fa_a",
    deliveryId: "delivery-1",
    kind: "completed",
    candidates: [
      {
        candidateId: "cand-1",
        name: "Example Specialty MGA",
        url: "https://www.example-mga.com/programs",
        description: "Program administrator for contractors.",
        conditions: [
          {
            name: "writes_lines",
            matched: true,
            value: "Writes general liability.",
            citations: [
              {
                url: "https://www.example-mga.com/programs",
                title: "Programs",
                excerpts: ["General liability for contractors"],
              },
            ],
          },
        ],
        answers: {
          provider_type: { value: "mga", confidence: "high", citations: [] },
        },
      },
    ],
    ...overrides,
  };
}

function post(t: Harness, token: string | null, body: unknown) {
  return t.fetch(
    `/router-discoveries/events${token ? `?token=${token}` : ""}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
  );
}

const candidates = (t: Harness, discoveryId: Id<"providerDiscoveries">) =>
  t.run((ctx) =>
    ctx.db
      .query("providerDiscoveryCandidates")
      .withIndex("by_discoveryId", (q) => q.eq("discoveryId", discoveryId))
      .collect(),
  );

test("rejects missing, malformed, unknown and cancelled tokens", async () => {
  const t = harness();
  const { cancelled } = await seed(t);
  expect((await post(t, null, callback())).status).toBe(404);
  expect((await post(t, "short", callback())).status).toBe(404);
  expect((await post(t, "d".repeat(64), callback())).status).toBe(404);
  expect(
    (await post(t, "c".repeat(64), callback({ discoveryId: "fa_c" }))).status,
  ).toBe(404);
  expect(await candidates(t, cancelled.discoveryId)).toHaveLength(0);
});

test("a token cannot write candidates for another discovery or organization", async () => {
  const t = harness();
  const { a, b } = await seed(t);
  expect((await post(t, tokenA, callback({ discoveryId: "fa_b" }))).status).toBe(409);
  expect(await candidates(t, a.discoveryId)).toHaveLength(0);
  expect(await candidates(t, b.discoveryId)).toHaveLength(0);
  expect(
    (await post(t, tokenB, callback({ discoveryId: "fa_b", orgId: a.orgId }))).status,
  ).toBe(409);
  expect(await candidates(t, a.discoveryId)).toHaveLength(0);
  expect(await candidates(t, b.discoveryId)).toHaveLength(0);
});

test("applies a delivery once to the token's discovery only", async () => {
  const t = harness();
  const { a, b } = await seed(t);
  expect((await post(t, tokenA, callback())).status).toBe(200);
  expect((await post(t, tokenA, callback())).status).toBe(200);
  const stored = await candidates(t, a.discoveryId);
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({
    discoveryId: a.discoveryId,
    name: "Example Specialty MGA",
    domain: "example-mga.com",
    providerType: "mga",
    status: "pending",
  });
  expect(await candidates(t, b.discoveryId)).toHaveLength(0);
  const discovery = await t.run((ctx) => ctx.db.get(a.discoveryId));
  expect(discovery).toMatchObject({ status: "completed", candidateCount: 1 });
  // A different delivery for an already completed discovery writes nothing.
  expect((await post(t, tokenA, callback({ deliveryId: "delivery-2" }))).status).toBe(409);
  expect(await candidates(t, a.discoveryId)).toHaveLength(1);
});

test("answers 503 while the discovery is still being created", async () => {
  const t = harness();
  const { pending } = await seed(t);
  expect(
    (await post(t, tokenPending, callback({ discoveryId: "fa_d" }))).status,
  ).toBe(503);
  expect(await candidates(t, pending.discoveryId)).toHaveLength(0);
});

test("rejects oversized, malformed and unrecognized bodies without writing", async () => {
  const t = harness();
  const { a } = await seed(t);
  const oversized = JSON.stringify(
    callback({ candidates: [{ ...callback().candidates[0], description: "x".repeat(1200 * 1024) }] }),
  );
  expect((await post(t, tokenA, oversized)).status).toBe(413);
  expect((await post(t, tokenA, "{not json")).status).toBe(400);
  expect((await post(t, tokenA, callback({ contractVersion: 2 }))).status).toBe(400);
  expect((await post(t, tokenA, callback({ extra: true }))).status).toBe(400);
  expect(
    (
      await post(
        t,
        tokenA,
        callback({ candidates: [{ ...callback().candidates[0], note: "x" }] }),
      )
    ).status,
  ).toBe(400);
  expect(await candidates(t, a.discoveryId)).toHaveLength(0);
});
