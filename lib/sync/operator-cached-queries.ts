"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import type { FunctionReturnType } from "convex/server";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  useCachedQuery,
  useUpdateCachedQuery,
  useUpsertCachedQuery,
} from "@/lib/sync/use-cached-query";

type OperatorCurrent = FunctionReturnType<typeof api.operator.current>;
type OperatorClientList = FunctionReturnType<typeof api.operator.listClients>;
type OperatorClientRow = OperatorClientList[number];
export type OperatorRouterCapabilities = FunctionReturnType<
  typeof api.clRouterOperations.getCapabilities
>;
type OperatorExtractionRunList = FunctionReturnType<
  typeof api.operator.listExtractionRuns
>;
type OperatorDemoSalesTranscriptList = FunctionReturnType<
  typeof api.operator.listPublicDemoSalesTranscripts
>;
type OperatorDemoSalesTranscriptDetail = FunctionReturnType<
  typeof api.operator.getPublicDemoSalesTranscript
>;
type EmptyArgs = Record<string, never>;
type OperatorStatus = OperatorClientRow["operatorStatus"];
type DemoSalesTranscriptListArgs = {
  limit?: number;
};
type OptimisticClientInput = {
  clientOrgId: Id<"organizations">;
  name: string;
  website?: string;
  adminEmail?: string;
  adminName?: string;
  adminPhone?: string;
};

function sortByCreatedAtDesc<T extends { createdAt: number }>(rows: T[]) {
  return [...rows].sort((a, b) => b.createdAt - a.createdAt);
}

export function operatorDemoSalesTranscriptListArgs(
  limit = 250,
): DemoSalesTranscriptListArgs {
  return { limit };
}

export function useCachedOperatorCurrent() {
  return useCachedQuery("operator.current", api.operator.current, {}) as
    | OperatorCurrent
    | undefined;
}

export function useCachedOperatorBrokers(search?: string) {
  const rows = useCachedQuery(
    "brokerProfiles.list",
    api.brokerProfiles.list,
    search ? { search } : {},
  );
  return useMemo(
    () => rows?.map(({ broker }) => broker),
    [rows],
  );
}

export function useCachedOperatorClients() {
  return useCachedQuery(
    "operator.listClients",
    api.operator.listClients,
    {},
  ) as OperatorClientList | undefined;
}

export function useOperatorRouterCapabilities() {
  const getCapabilities = useAction(api.clRouterOperations.getCapabilities);
  const [capabilities, setCapabilities] =
    useState<OperatorRouterCapabilities>();
  const [loading, setLoading] = useState(true);

  const fetchCapabilities = useCallback(async () => {
    try {
      return await getCapabilities({});
    } catch {
      return {
        availability: "unavailable",
        fetchedAt: dayjs().valueOf(),
        message: "Router capabilities are temporarily unavailable.",
      } as const;
    }
  }, [getCapabilities]);

  useEffect(() => {
    let active = true;
    void fetchCapabilities().then((next) => {
      if (!active) return;
      setCapabilities(next);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [fetchCapabilities]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setCapabilities(await fetchCapabilities());
    setLoading(false);
  }, [fetchCapabilities]);

  return { capabilities, loading, refresh };
}

export function useCachedOperatorExtractionRuns(policyId: Id<"policies">) {
  return useCachedQuery(
    "operator.listExtractionRuns",
    api.operator.listExtractionRuns,
    { policyId },
  ) as OperatorExtractionRunList | undefined;
}

export function useCachedOperatorDemoSalesTranscripts(limit = 250) {
  return useCachedQuery(
    "operator.listPublicDemoSalesTranscripts",
    api.operator.listPublicDemoSalesTranscripts,
    operatorDemoSalesTranscriptListArgs(limit),
  ) as OperatorDemoSalesTranscriptList | undefined;
}

export function useCachedOperatorDemoSalesTranscriptDetail(
  transcriptId: string | null,
) {
  return useCachedQuery(
    "operator.getPublicDemoSalesTranscript",
    api.operator.getPublicDemoSalesTranscript,
    transcriptId
      ? { id: transcriptId as Id<"publicDemoSalesTranscripts"> }
      : "skip",
  ) as OperatorDemoSalesTranscriptDetail | undefined;
}

export function useOperatorClientCacheActions() {
  const upsertClients = useUpsertCachedQuery<OperatorClientList, EmptyArgs>(
    "operator.listClients",
  );
  const updateClients = useUpdateCachedQuery<OperatorClientList, EmptyArgs>(
    "operator.listClients",
  );

  const seedClient = useCallback(
    async (input: OptimisticClientInput) => {
      const now = dayjs().valueOf();
      const row = {
        _id: input.clientOrgId,
        name: input.name,
        website: input.website,
        iconStorageId: undefined,
        iconUrl: null,
        agentHandle: undefined,
        operatorStatus: "onboarding",
        onboardingComplete: true,
        primaryContactName: input.adminName,
        primaryContactEmail: input.adminEmail,
        primaryContactPhone: input.adminPhone,
        featureFlags: {},
        adminUserId: undefined,
        adminName: input.adminName,
        adminEmail: input.adminEmail,
        adminPhone: input.adminPhone,
        createdAt: now,
      } satisfies OperatorClientRow;
      await upsertClients({}, (current) =>
        sortByCreatedAtDesc([
          row,
          ...(current ?? []).filter((client) => client._id !== row._id),
        ]),
      );
    },
    [upsertClients],
  );

  const patchClientStatus = useCallback(
    async (clientOrgId: Id<"organizations">, status: OperatorStatus) => {
      await updateClients({}, (current) =>
        current.map((client) =>
          client._id === clientOrgId
            ? { ...client, operatorStatus: status }
            : client,
        ),
      );
    },
    [updateClients],
  );

  const patchClientSettings = useCallback(
    async (
      clientOrgId: Id<"organizations">,
      patch: Partial<
        Pick<
          OperatorClientRow,
          | "name"
          | "website"
          | "agentHandle"
          | "primaryContactName"
          | "primaryContactEmail"
          | "primaryContactPhone"
          | "featureFlags"
          | "adminName"
          | "adminPhone"
        >
      >,
    ) => {
      await updateClients({}, (current) =>
        current.map((client) =>
          client._id === clientOrgId ? { ...client, ...patch } : client,
        ),
      );
    },
    [updateClients],
  );

  return { seedClient, patchClientStatus, patchClientSettings };
}

