/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { routerJobTokenHash } from "./routerJobs";
const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.useRealTimers());

async function fixture() {
  const t = convexTest(schema, modules);
  const requestStorageId = await t.run((ctx) =>
    ctx.storage.store(
      new Blob(['{"prompt":"test"}'], { type: "application/json" }),
    ),
  );
  const args = {
    invocationKey: "test:run:step:0",
    operation: "generate" as const,
    fingerprint: "a".repeat(64),
    requestToken: "b".repeat(64),
    requestTokenHash: await routerJobTokenHash("b".repeat(64)),
    resultToken: "c".repeat(64),
    resultTokenHash: await routerJobTokenHash("c".repeat(64)),
    requestStorageId,
  };
  const row = await t.mutation(internal.routerJobs.prepare, args);
  return { t, args, row };
}

test("prepares one invocation and rejects conflicting identities", async () => {
  const { t, args, row } = await fixture();
  expect((await t.mutation(internal.routerJobs.prepare, args))._id).toBe(
    row._id,
  );
  await expect(
    t.mutation(internal.routerJobs.prepare, {
      ...args,
      fingerprint: "d".repeat(64),
    }),
  ).rejects.toThrow("identity conflict");
  expect(
    await t.query(internal.routerJobs.authorize, {
      tokenHash: args.requestToken,
      purpose: "request",
    }),
  ).toBeNull();
  expect(
    (
      await t.query(internal.routerJobs.authorize, {
        tokenHash: args.requestTokenHash,
        purpose: "request",
      })
    )?._id,
  ).toBe(row._id);
});

test("accepts callback before submission ACK, binds identity, and removes duplicate result uploads", async () => {
  vi.useFakeTimers();
  const { t, args, row } = await fixture();
  const resultId = await t.run((ctx) =>
    ctx.storage.store(new Blob(['{"text":"done"}'])),
  );
  const finish = {
    id: row._id,
    tokenHash: args.resultTokenHash,
    jobId: "router-1",
    invocationKey: args.invocationKey,
    fingerprint: args.fingerprint,
    status: "succeeded" as const,
    storageId: resultId,
  };
  expect(await t.mutation(internal.routerJobs.finish, finish)).toBe(true);
  await t.mutation(internal.routerJobs.bind, {
    id: row._id,
    jobId: "router-1",
  });
  await expect(
    t.mutation(internal.routerJobs.bind, {
      id: row._id,
      jobId: "router-other",
    }),
  ).rejects.toThrow("identity conflict");
  const duplicateId = await t.run((ctx) =>
    ctx.storage.store(new Blob(['{"text":"other"}'])),
  );
  expect(
    await t.mutation(internal.routerJobs.finish, {
      ...finish,
      storageId: duplicateId,
    }),
  ).toBe(true);
  expect(await t.run((ctx) => ctx.storage.get(duplicateId))).toBeNull();
  expect(
    (
      await t.query(internal.routerJobs.get, {
        invocationKey: args.invocationKey,
      })
    )?.resultStorageId,
  ).toBe(resultId);
  expect(
    await t.query(internal.routerJobs.authorize, {
      tokenHash: args.requestTokenHash,
      purpose: "request",
    }),
  ).toBeNull();
});

test("rejects wrong callback identity and cancellation races without retaining uploaded results", async () => {
  vi.useFakeTimers();
  const { t, args, row } = await fixture();
  const makeResult = () => t.run((ctx) => ctx.storage.store(new Blob(["{}"])));
  const storageId = await makeResult();
  const finish = {
    id: row._id,
    tokenHash: args.resultTokenHash,
    jobId: "router-1",
    invocationKey: args.invocationKey,
    fingerprint: "e".repeat(64),
    status: "succeeded" as const,
    storageId,
  };
  expect(await t.mutation(internal.routerJobs.finish, finish)).toBe(false);
  expect(await t.run((ctx) => ctx.storage.get(storageId))).toBeNull();
  await t.mutation(internal.routerJobs.cancel, { id: row._id });
  const cancelledResultId = await makeResult();
  expect(
    await t.mutation(internal.routerJobs.finish, {
      ...finish,
      fingerprint: args.fingerprint,
      storageId: cancelledResultId,
    }),
  ).toBe(false);
  expect(await t.run((ctx) => ctx.storage.get(cancelledResultId))).toBeNull();
  expect(
    await t.query(internal.routerJobs.authorize, {
      tokenHash: args.resultTokenHash,
      purpose: "result",
    }),
  ).toBeNull();
});

test("cleanup never expires active work and retains a terminal idempotency tombstone", async () => {
  vi.useFakeTimers();
  const { t, args, row } = await fixture();
  vi.advanceTimersByTime(30 * 24 * 60 * 60 * 1000);
  await t.mutation(internal.routerJobs.cleanup, { id: row._id });
  expect(
    await t.run(async (ctx) =>
      Boolean(await ctx.storage.get(args.requestStorageId)),
    ),
  ).toBe(true);
  await t.mutation(internal.routerJobs.cancel, { id: row._id });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const terminal = await t.query(internal.routerJobs.get, {
    invocationKey: args.invocationKey,
  });
  expect(terminal?.status).toBe("cancelled");
  expect(terminal?.requestStorageId).toBeUndefined();
  expect(terminal?.requestToken).toBe("");
  expect(
    await t.run((ctx) => ctx.storage.get(args.requestStorageId)),
  ).toBeNull();
});

test("upload cleanup preserves adopted blobs after a lost mutation acknowledgement", async () => {
  const { t, args } = await fixture();
  const orphan = await t.run((ctx) => ctx.storage.store(new Blob(["orphan"])));
  await t.mutation(internal.routerJobs.cleanupUploads, {
    invocationKey: args.invocationKey,
    storageIds: [args.requestStorageId, orphan],
  });
  expect(
    await t.run(async (ctx) =>
      Boolean(await ctx.storage.get(args.requestStorageId)),
    ),
  ).toBe(true);
  expect(await t.run((ctx) => ctx.storage.get(orphan))).toBeNull();
});
