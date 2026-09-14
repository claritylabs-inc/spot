// @vitest-environment node
import { expect, test, vi } from "vitest";
import {
  createMigrationRunner,
  requireZero,
} from "../scripts/lib/schema-migration-runner.mjs";

test("verification includes every page and preserves opaque resume cursors", () => {
  const checkpoint = vi.fn();
  const run = vi
    .fn()
    .mockReturnValueOnce({
      remaining: 2,
      scanned: 10,
      isDone: false,
      nextCursor: "opaque:first",
    })
    .mockReturnValueOnce({
      remaining: 0,
      scanned: 1,
      isDone: true,
      nextCursor: null,
    });
  const totals = createMigrationRunner({ run, checkpoint }).pages(
    "verify",
    { table: "records" },
    { optionalCursor: true },
  );
  expect(run.mock.calls).toEqual([
    ["verify", { table: "records" }],
    ["verify", { table: "records", cursor: "opaque:first" }],
  ]);
  expect(totals).toEqual({ remaining: 2, scanned: 11 });
  expect(() => requireZero(totals, "remaining")).toThrow(
    "residual remaining: 2",
  );
  expect(checkpoint.mock.calls[0][0]).toMatchObject({
    cursor: null,
    nextCursor: "opaque:first",
    done: false,
  });
});

test("page verification rejects cursor cycles and incomplete metrics", () => {
  const cycle = vi
    .fn()
    .mockReturnValueOnce({ remaining: 0, isDone: false, cursor: "a" })
    .mockReturnValueOnce({ remaining: 0, isDone: false, cursor: "b" })
    .mockReturnValueOnce({ remaining: 0, isDone: false, cursor: "a" });
  expect(() => createMigrationRunner({ run: cycle }).pages("verify")).toThrow(
    "did not advance",
  );
  const missing = vi
    .fn()
    .mockReturnValueOnce({ remaining: 0, isDone: false, cursor: "a" })
    .mockReturnValueOnce({ isDone: true });
  expect(() => createMigrationRunner({ run: missing }).pages("verify")).toThrow(
    "omitted numeric remaining",
  );
  expect(() => requireZero({}, "remaining")).toThrow(
    "omitted numeric remaining",
  );
});

test("page completion must be explicit and a conflict is checkpointed before stopping", () => {
  for (const result of [
    null,
    {},
    { complete: "true" },
    { isDone: false, complete: true },
  ]) {
    expect(() =>
      createMigrationRunner({ run: () => result }).pages("verify"),
    ).toThrow();
  }
  const checkpoint = vi.fn();
  expect(() =>
    createMigrationRunner({
      run: () => ({ changed: 1, conflicts: ["record-id"], isDone: true }),
      checkpoint,
    }).pages("migrate"),
  ).toThrow("ambiguous");
  expect(checkpoint).toHaveBeenCalledOnce();
});

test("destructive batch completion is never inferred from a missing count or a stalled page", () => {
  expect(() =>
    createMigrationRunner({ run: () => ({ complete: true }) }).batches("purge"),
  ).toThrow("invalid batch");
  expect(() =>
    createMigrationRunner({
      run: () => ({ deleted: 0, complete: false }),
    }).batches("purge"),
  ).toThrow("did not make progress");
  const run = vi
    .fn()
    .mockReturnValueOnce({ deleted: 100, complete: false })
    .mockReturnValueOnce({ deleted: 1, complete: true });
  const log = vi.fn();
  createMigrationRunner({ run, log }).batches("purge");
  expect(log).toHaveBeenCalledWith("purge {}", { affected: 101 });
});
