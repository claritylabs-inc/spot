"use client";

import { useCallback, useEffect, useRef } from "react";
import { useQuery } from "convex/react";
import { type FunctionReference } from "convex/server";
import { type FunctionArgs, type FunctionReturnType } from "convex/server";
import dayjs from "dayjs";
import {
  defineCollection,
  stableHash,
  useSyncCollection,
  useSyncStore,
  type SyncRecord,
} from "@claritylabs/cl-sync";

type CachedQueryRecord<TValue> = SyncRecord & {
  /** The args key: cl-sync stores records per collection by `_id`. */
  _id: string;
  value: TValue;
  updatedAt: number;
};

const collections = new Map<
  string,
  ReturnType<typeof defineCollection<CachedQueryRecord<unknown>, string>>
>();

function collectionFor<TValue>(name: string) {
  const existing = collections.get(name);
  if (existing) {
    return existing as ReturnType<
      typeof defineCollection<CachedQueryRecord<TValue>, string>
    >;
  }
  const collection = defineCollection<CachedQueryRecord<TValue>, string>({
    // v2: records were once all `_id: "result"`, so every args key shared one.
    name: `spot.query.v2.${name}`,
    persist: true,
  });
  collections.set(
    name,
    collection as ReturnType<
      typeof defineCollection<CachedQueryRecord<unknown>, string>
    >,
  );
  return collection;
}

export function cachedQueryCollectionFor<TValue>(name: string) {
  return collectionFor<TValue>(name);
}

export function cachedQueryArgsKey(args: unknown) {
  return stableHash(args);
}

export function cachedQueryResult<TValue>(
  argsKey: string,
  value: TValue,
): CachedQueryRecord<TValue> {
  return { _id: argsKey, value, updatedAt: dayjs().valueOf() };
}

function containsProcessingRecord(value: unknown) {
  return (
    Array.isArray(value) &&
    value.some(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "status" in item &&
        item.status === "processing",
    )
  );
}

export function useCachedQuery<TQuery extends FunctionReference<"query">>(
  cacheName: string,
  query: TQuery,
  args: FunctionArgs<TQuery> | "skip",
): FunctionReturnType<TQuery> | undefined {
  const store = useSyncStore();
  const collection = collectionFor<FunctionReturnType<TQuery>>(cacheName);
  const isSkipped = args === "skip";
  const argsKey = isSkipped ? "skip" : stableHash(args);
  const cached = useSyncCollection(collection, argsKey)?.[0]?.value;
  const serverValue = useQuery(query, args);
  const lastWrittenKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (isSkipped || serverValue === undefined) return;
    if (store.key.includes(":anonymous:")) return;
    if (
      cacheName === "threads.messages.current" &&
      containsProcessingRecord(serverValue)
    ) {
      return;
    }

    const serverValueHash = stableHash(serverValue);

    const writeKey = `${argsKey}:${serverValueHash}`;
    if (lastWrittenKeyRef.current === writeKey) return;

    const current = store.getCollection(collection, argsKey)?.[0]?.value;
    if (current !== undefined && stableHash(current) === serverValueHash) {
      lastWrittenKeyRef.current = writeKey;
      return;
    }

    lastWrittenKeyRef.current = writeKey;
    void store.upsertCollection(collection, argsKey, [
      cachedQueryResult(argsKey, serverValue),
    ]);
  }, [argsKey, cacheName, collection, isSkipped, serverValue, store]);

  return serverValue === undefined ? cached : serverValue;
}

export function useUpdateCachedQuery<TValue, TArgs>(
  cacheName: string,
): (
  args: TArgs | "skip",
  update: (current: TValue) => TValue,
) => Promise<void> {
  const store = useSyncStore();
  const collection = collectionFor<TValue>(cacheName);

  return useCallback(
    async (args, update) => {
      if (args === "skip") return;
      if (store.key.includes(":anonymous:")) return;
      const argsKey = stableHash(args);

      const current = store.getCollection(collection, argsKey)?.[0]?.value;
      if (current === undefined) return;

      await store.upsertCollection(collection, argsKey, [
        cachedQueryResult(argsKey, update(current)),
      ]);
    },
    [collection, store],
  );
}

export function useUpsertCachedQuery<TValue, TArgs>(
  cacheName: string,
): (
  args: TArgs | "skip",
  update: (current: TValue | undefined) => TValue,
) => Promise<void> {
  const store = useSyncStore();
  const collection = collectionFor<TValue>(cacheName);

  return useCallback(
    async (args, update) => {
      if (args === "skip") return;
      if (store.key.includes(":anonymous:")) return;
      const argsKey = stableHash(args);

      const current = store.getCollection(collection, argsKey)?.[0]?.value;
      const next = update(current);
      const nextHash = stableHash(next);
      if (current !== undefined && stableHash(current) === nextHash) return;

      await store.upsertCollection(collection, argsKey, [
        cachedQueryResult(argsKey, next),
      ]);
    },
    [collection, store],
  );
}

export function useSetCachedQuery<TValue, TArgs>(
  cacheName: string,
): (args: TArgs | "skip", value: TValue) => Promise<void> {
  const store = useSyncStore();
  const collection = collectionFor<TValue>(cacheName);

  return useCallback(
    async (args, value) => {
      if (args === "skip") return;
      if (store.key.includes(":anonymous:")) return;
      const argsKey = stableHash(args);
      const nextHash = stableHash(value);
      const current = store.getCollection(collection, argsKey)?.[0]?.value;
      if (current !== undefined && stableHash(current) === nextHash) return;

      await store.upsertCollection(collection, argsKey, [
        cachedQueryResult(argsKey, value),
      ]);
    },
    [collection, store],
  );
}
