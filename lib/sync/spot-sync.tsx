"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import dayjs from "dayjs";
import {
  createSyncStore,
  defineCollection,
  stableHash,
  SyncProvider,
  useSyncCollection,
  useSyncStore,
  type SyncRecord,
} from "@claritylabs/cl-sync";

const SPOT_SYNC_SCOPE_KEY = "spot:sync-scope";

type SpotSyncScope = {
  userId?: string;
  orgId?: string;
};

type SpotSyncContextValue = {
  scope: SpotSyncScope;
  updateScope: (scope: SpotSyncScope) => void;
  clearScope: () => Promise<void>;
};

const SpotSyncContext = createContext<SpotSyncContextValue | null>(null);

export type CachedShellRecord = SyncRecord & {
  _id: "current";
  viewer?: unknown;
  viewerOrg?: unknown;
  accountKind?: "customer" | "operator";
  onboardingComplete?: boolean;
  membershipRole?: "admin" | "member";
  updatedAt: number;
};

const cachedShellCollection = defineCollection<CachedShellRecord>({
  name: "spot.cachedShell",
  persist: true,
});

function readInitialScope(): SpotSyncScope {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(SPOT_SYNC_SCOPE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SpotSyncScope;
    return {
      userId: typeof parsed.userId === "string" ? parsed.userId : undefined,
      orgId: typeof parsed.orgId === "string" ? parsed.orgId : undefined,
    };
  } catch {
    return {};
  }
}

function persistScope(scope: SpotSyncScope) {
  try {
    localStorage.setItem(SPOT_SYNC_SCOPE_KEY, JSON.stringify(scope));
  } catch {}
}

export function SpotSyncProvider({ children }: { children: ReactNode }) {
  const [scope, setScope] = useState<SpotSyncScope>(() => readInitialScope());
  const store = useMemo(
    () =>
      createSyncStore({
        scope: {
          appId: "spot",
          environment:
            process.env.NEXT_PUBLIC_VERCEL_ENV ??
            process.env.NODE_ENV ??
            "local",
          userId: scope.userId ?? "anonymous",
          orgId: scope.orgId ?? "none",
        },
      }),
    [scope.orgId, scope.userId],
  );

  const updateScope = useCallback((nextScope: SpotSyncScope) => {
    setScope((previous) => {
      const hasUserId = Object.prototype.hasOwnProperty.call(
        nextScope,
        "userId",
      );
      const hasOrgId = Object.prototype.hasOwnProperty.call(
        nextScope,
        "orgId",
      );
      const merged = {
        userId: hasUserId ? nextScope.userId : previous.userId,
        orgId: hasOrgId ? nextScope.orgId : previous.orgId,
      };
      persistScope(merged);
      return merged;
    });
  }, []);

  const clearScope = useCallback(async () => {
    await store.clearScope();
    try {
      localStorage.removeItem(SPOT_SYNC_SCOPE_KEY);
    } catch {}
    setScope({});
  }, [store]);

  const value = useMemo(
    () => ({ scope, updateScope, clearScope }),
    [clearScope, scope, updateScope],
  );

  return (
    <SpotSyncContext.Provider value={value}>
      <SyncProvider store={store}>{children}</SyncProvider>
    </SpotSyncContext.Provider>
  );
}

export function useSpotSync() {
  const value = useContext(SpotSyncContext);
  if (!value) throw new Error("useSpotSync must be used inside SpotSyncProvider");
  return value;
}

export function useCachedShell() {
  return useSyncCollection(cachedShellCollection, {})?.[0];
}

export function useCacheShellRecord() {
  const store = useSyncStore();
  return useCallback(
    async (record: Omit<CachedShellRecord, "_id" | "updatedAt">) => {
      const existing = store.getCollection(cachedShellCollection, {})?.[0];
      const nextRecordFingerprint = stableHash(record);
      if (
        existing &&
        stableHash({
          viewer: existing.viewer,
          viewerOrg: existing.viewerOrg,
          accountKind: existing.accountKind,
          onboardingComplete: existing.onboardingComplete,
          membershipRole: existing.membershipRole,
        }) === nextRecordFingerprint
      ) {
        return;
      }
      await store.upsertCollection(cachedShellCollection, {}, [{
        _id: "current",
        ...record,
        updatedAt: dayjs().valueOf(),
      }]);
    },
    [store],
  );
}
