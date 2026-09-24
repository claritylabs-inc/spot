import { createSyncStore } from "@claritylabs/cl-sync";
import { expect, test } from "vitest";
import {
  cachedQueryArgsKey,
  cachedQueryCollectionFor,
  cachedQueryResult,
} from "./use-cached-query";

// cl-sync stores records per collection by `_id`; a shared ID once made every
// policy detail page read whichever policy was cached last.
test("keeps one cached result per args key", async () => {
  const store = createSyncStore({
    scope: { appId: `cached-query-${Math.random()}` },
    persistence: "memory",
  });
  const collection = cachedQueryCollectionFor<{ id: string }>("policies.get");
  const first = cachedQueryArgsKey({ id: "policy-a" });
  const second = cachedQueryArgsKey({ id: "policy-b" });

  await store.upsertCollection(collection, first, [
    cachedQueryResult(first, { id: "policy-a" }),
  ]);
  await store.upsertCollection(collection, second, [
    cachedQueryResult(second, { id: "policy-b" }),
  ]);

  expect(store.getCollection(collection, first)?.[0]?.value).toEqual({
    id: "policy-a",
  });
  expect(store.getCollection(collection, second)?.[0]?.value).toEqual({
    id: "policy-b",
  });
});
