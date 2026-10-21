"use client";

import { useCallback, useMemo } from "react";
import dayjs from "dayjs";
import type { FunctionReturnType } from "convex/server";
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
type OperatorExtractionRunList = FunctionReturnType<
  typeof api.operator.listExtractionRuns
>;
type EmptyArgs = Record<string, never>;
type OperatorStatus = OperatorClientRow["clientAccessStatus"];
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

export function useCachedOperatorExtractionRuns(policyId: Id<"policies">) {
  return useCachedQuery(
    "operator.listExtractionRuns",
    api.operator.listExtractionRuns,
    { policyId },
  ) as OperatorExtractionRunList | undefined;
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
        dba: undefined,
        website: input.website,
        iconStorageId: undefined,
        iconUrl: null,
        agentHandle: undefined,
        clientAccessStatus: "limited",
        onboardingComplete: true,
        primaryContactName: input.adminName,
        primaryContactEmail: input.adminEmail,
        primaryContactPhone: input.adminPhone,
        featureFlags: {},
        adminUserId: undefined,
        adminName: input.adminName,
        adminEmail: input.adminEmail,
        adminPhone: input.adminPhone,
        applicationInProgress: false,
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
            ? { ...client, clientAccessStatus: status }
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

