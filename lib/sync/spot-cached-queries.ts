"use client";

import { useCallback, useEffect } from "react";
import type { FunctionReturnType } from "convex/server";
import dayjs from "dayjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  cachedQueryArgsKey,
  cachedQueryCollectionFor,
  cachedQueryResult,
  useCachedQuery,
  useSetCachedQuery,
  useUpdateCachedQuery,
  useUpsertCachedQuery,
} from "@/lib/sync/use-cached-query";
import { useSyncStore, type SyncStore } from "@claritylabs/cl-sync";

type NotificationStatus = "unread" | "read" | "actioned";
type NotificationListArgs = {
  orgId: Id<"organizations">;
  status: NotificationStatus;
};
type NotificationList = Array<{
  _id: Id<"notifications">;
  createdAt: number;
  status: string;
  [key: string]: unknown;
}>;
type NotificationRow = NotificationList[number];
type NotificationInput = {
  _id: Id<"notifications">;
  createdAt: number;
  status: string;
};
type AgentTargetList = FunctionReturnType<typeof api.agentTargets.list>;
type ConnectedVendorList = FunctionReturnType<
  typeof api.connectedOrgs.listVendors
>;
type PolicyList = FunctionReturnType<typeof api.policies.listForClient>;
type PolicyDetail = FunctionReturnType<typeof api.policies.get>;
type PolicySummary = FunctionReturnType<typeof api.policies.getSummary>;
type Viewer = FunctionReturnType<typeof api.users.viewer>;
type ViewerOrg = FunctionReturnType<typeof api.orgs.viewerOrg>;
type ThreadList = FunctionReturnType<typeof api.threads.list>;
type ThreadDetail = FunctionReturnType<typeof api.threads.get>;
type ThreadMessages = FunctionReturnType<typeof api.threads.messages>;
type ThreadListArgs = {
  archived: boolean;
};
type ThreadMessageRow = NonNullable<ThreadMessages>[number] & {
  clientMutationId?: string;
};
type OptimisticAttachment = {
  filename: string;
  contentType: string;
  size: number;
  fileId?: Id<"_storage">;
};
type OptimisticThreadSend = {
  threadId: Id<"threads">;
  orgId: Id<"organizations">;
  content: string;
  clientMutationId: string;
  userId?: Id<"users">;
  userName?: string;
  attachments?: OptimisticAttachment[];
  referencedPolicyIds?: Id<"policies">[];
  referencedRequirementIds?: Id<"insuranceRequirements">[];
  referencedMailboxIds?: Id<"connectedEmailAccounts">[];
  skipAgentResponse?: boolean;
};
type OptimisticThreadSeed = {
  threadId: Id<"threads">;
  orgId: Id<"organizations">;
  createdBy: Id<"users">;
  title?: string;
  initialContext?: {
    pageType: string;
    entityId?: string;
    summary?: string;
  };
};

const notificationCacheName = (status: NotificationStatus) =>
  `notifications.listInbox.${status}`;

const viewerCacheNames = [
  "users.viewer",
  "appShell.viewer",
  "authGuard.viewer",
  "commandPalette.viewer",
  "clients.thread.viewer",
  "onboarding.viewer",
  "onboarding.setup.viewer",
  "onboarding.broker.viewer",
  "settings.organization.viewer",
  "settings.team.viewer",
];

const viewerOrgCacheNames = [
  "orgs.viewerOrg",
  "hooks.currentOrg.viewerOrg",
  "appShell.viewerOrg",
  "authGuard.viewerOrg",
  "brandTheme.viewerOrg",
  "commandPalette.viewerOrg",
  "onboarding.viewerOrg",
];

export function patchCachedViewer(
  store: SyncStore,
  patch: Record<string, unknown>,
) {
  for (const cacheName of viewerCacheNames) {
    const collection = cachedQueryCollectionFor<Viewer>(cacheName);
    const argsKey = cachedQueryArgsKey({});
    const current = store.getCollection(collection, argsKey)?.[0]?.value;
    if (!current) continue;
    void store.upsertCollection(collection, argsKey, [
      cachedQueryResult(argsKey, {
        ...current,
        ...patch,
      }),
    ]);
  }
}

export function patchCachedViewerOrg(
  store: SyncStore,
  patch: Record<string, unknown>,
) {
  for (const cacheName of viewerOrgCacheNames) {
    const collection = cachedQueryCollectionFor<ViewerOrg>(cacheName);
    const argsKey = cachedQueryArgsKey({});
    const current = store.getCollection(collection, argsKey)?.[0]?.value;
    if (!current?.org) continue;
    void store.upsertCollection(collection, argsKey, [
      cachedQueryResult(argsKey, {
        ...current,
        org: {
          ...current.org,
          ...patch,
        },
      }),
    ]);
  }
}

export function setCachedViewerOrg(store: SyncStore, next: NonNullable<ViewerOrg>) {
  for (const cacheName of viewerOrgCacheNames) {
    const collection = cachedQueryCollectionFor<ViewerOrg>(cacheName);
    const argsKey = cachedQueryArgsKey({});
    void store.upsertCollection(collection, argsKey, [
      cachedQueryResult(argsKey, next),
    ]);
  }
}

export function useViewerCacheActions() {
  const store = useSyncStore();

  return {
    patchViewer: useCallback(
      (patch: Record<string, unknown>) => patchCachedViewer(store, patch),
      [store],
    ),
    patchViewerOrg: useCallback(
      (patch: Record<string, unknown>) => patchCachedViewerOrg(store, patch),
      [store],
    ),
    setViewerOrg: useCallback(
      (next: NonNullable<ViewerOrg>) => setCachedViewerOrg(store, next),
      [store],
    ),
  };
}

export function useCachedViewerOrg() {
  return useCachedQuery("orgs.viewerOrg", api.orgs.viewerOrg, {});
}

export function useCachedPolicyList(archived = false) {
  const policies = useCachedQuery(
    "policies.listForClient",
    api.policies.listForClient,
    {
      documentType: "policy",
      archived,
    },
  ) as PolicyList | undefined;
  const setPolicyDetail = useSetCachedQuery<
    NonNullable<PolicyDetail>,
    { id: Id<"policies"> }
  >("policies.get");
  const setPolicySummary = useSetCachedQuery<
    NonNullable<PolicySummary>,
    { id: Id<"policies"> }
  >("policies.getSummary");

  useEffect(() => {
    if (!policies) return;
    void Promise.all(
      policies.flatMap((policy) => [
        setPolicyDetail(
          { id: policy._id },
          policy as NonNullable<PolicyDetail>,
        ),
        setPolicySummary(
          { id: policy._id },
          policy as unknown as NonNullable<PolicySummary>,
        ),
      ]),
    );
  }, [policies, setPolicyDetail, setPolicySummary]);

  return policies;
}

export function useCachedPolicySummary(id: Id<"policies">) {
  return useCachedQuery("policies.getSummary", api.policies.getSummary, {
    id,
  }) as PolicySummary | undefined;
}

export function useCachedPolicyDetail(id: Id<"policies">, enabled = true) {
  return useCachedQuery(
    "policies.get",
    api.policies.get,
    enabled ? { id } : "skip",
  ) as PolicyDetail | undefined;
}

export function useCachedArchivedThreads() {
  return useCachedQuery("threads.list.archived", api.threads.list, {
    archived: true,
  }) as ThreadList | undefined;
}

function sortMessages(messages: ThreadMessages): ThreadMessages {
  return [...messages].sort((a, b) => a._creationTime - b._creationTime);
}

export function useThreadCacheActions() {
  const upsertMessages = useUpsertCachedQuery<
    ThreadMessages,
    { threadId: Id<"threads"> }
  >("threads.messages.current");
  const updateThread = useUpdateCachedQuery<
    NonNullable<ThreadDetail>,
    { id: Id<"threads"> }
  >("threads.get.current");
  const upsertThread = useUpsertCachedQuery<
    ThreadDetail,
    { id: Id<"threads"> }
  >("threads.get.current");
  const upsertActiveThreads = useUpsertCachedQuery<ThreadList, ThreadListArgs>(
    "threads.list.active",
  );
  const updateActiveThreads = useUpdateCachedQuery<ThreadList, ThreadListArgs>(
    "threads.list.active",
  );

  const seedOptimisticThread = useCallback(
    async (seed: OptimisticThreadSeed) => {
      const now = dayjs().valueOf();
      const thread = {
        _id: seed.threadId,
        _creationTime: now,
        orgId: seed.orgId,
        title: seed.title ?? "New chat",
        createdBy: seed.createdBy,
        lastMessageAt: now,
        initialContext: seed.initialContext,
        originChannel: "chat" as const,
      } satisfies NonNullable<ThreadDetail>;

      await Promise.all([
        upsertThread({ id: seed.threadId }, () => thread),
        upsertActiveThreads({ archived: false }, (current) => {
          const existing = current ?? [];
          const next = [
            thread,
            ...existing.filter((item) => item._id !== seed.threadId),
          ];
          return next.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
        }),
      ]);
    },
    [upsertActiveThreads, upsertThread],
  );

  const appendOptimisticSend = useCallback(
    async (send: OptimisticThreadSend) => {
      const now = dayjs().valueOf();
      const userMessageId =
        `${send.threadId}:local:${send.clientMutationId}` as Id<"threadMessages">;
      const agentMessageId =
        `${send.threadId}:local:${send.clientMutationId}:agent` as Id<"threadMessages">;

      await Promise.all([
        upsertMessages({ threadId: send.threadId }, (current) => {
          const existing = current ?? [];
          if (
            existing.some(
              (message) =>
                (message as ThreadMessageRow).clientMutationId ===
                send.clientMutationId,
            )
          ) {
            return existing;
          }

          const userMessage: ThreadMessageRow = {
            _id: userMessageId,
            _creationTime: now,
            threadId: send.threadId,
            orgId: send.orgId,
            clientMutationId: send.clientMutationId,
            channel: "chat",
            role: "user",
            userId: send.userId,
            userName: send.userName ?? "You",
            content: send.content,
            attachments: send.attachments,
            referencedPolicyIds: send.referencedPolicyIds,
            referencedRequirementIds: send.referencedRequirementIds,
            referencedMailboxIds: send.referencedMailboxIds,
          };
          const next = [...existing, userMessage];

          if (!send.skipAgentResponse) {
            next.push({
              _id: agentMessageId,
              _creationTime: now + 1,
              threadId: send.threadId,
              orgId: send.orgId,
              clientMutationId: send.clientMutationId,
              channel: "chat",
              role: "agent",
              content: "",
              status: "processing",
              replyToMessageId: userMessageId,
            });
          }

          return sortMessages(next);
        }),
        updateThread({ id: send.threadId }, (current) => ({
          ...current,
          lastMessageAt: now,
        })),
        updateActiveThreads({ archived: false }, (current) =>
          current
            .map((thread) =>
              thread._id === send.threadId
                ? { ...thread, lastMessageAt: now }
                : thread,
            )
            .sort((a, b) => b.lastMessageAt - a.lastMessageAt),
        ),
      ]);
    },
    [updateActiveThreads, updateThread, upsertMessages],
  );

  const markOptimisticSendFailed = useCallback(
    async (args: {
      threadId: Id<"threads">;
      clientMutationId: string;
      error: string;
    }) => {
      await upsertMessages({ threadId: args.threadId }, (current) =>
        (current ?? []).map((message) => {
          const row = message as ThreadMessageRow;
          if (row.clientMutationId !== args.clientMutationId) return message;
          if (row.role !== "agent") return message;
          return {
            ...row,
            status: "error",
            content: args.error,
            error: args.error,
          };
        }),
      );
    },
    [upsertMessages],
  );

  return {
    appendOptimisticSend,
    markOptimisticSendFailed,
    seedOptimisticThread,
  };
}

export function useArchivedThreadCacheActions() {
  const upsertArchived = useUpsertCachedQuery<ThreadList, ThreadListArgs>(
    "threads.list.archived",
  );
  const updateArchived = useUpdateCachedQuery<ThreadList, ThreadListArgs>(
    "threads.list.archived",
  );
  const upsertActive = useUpsertCachedQuery<ThreadList, ThreadListArgs>(
    "threads.list.active",
  );
  const updateActive = useUpdateCachedQuery<ThreadList, ThreadListArgs>(
    "threads.list.active",
  );
  const updateThread = useUpdateCachedQuery<
    NonNullable<ThreadDetail>,
    { id: Id<"threads"> }
  >("threads.get.current");

  const archiveThreadLocally = useCallback(
    async (threadId: Id<"threads">) => {
      const now = dayjs().valueOf();
      let archivedThread: ThreadList[number] | null = null;
      await updateActive({ archived: false }, (current) => {
        archivedThread =
          current.find((thread) => thread._id === threadId) ?? null;
        return current.filter((thread) => thread._id !== threadId);
      });
      await updateThread({ id: threadId }, (current) => ({
        ...current,
        archivedAt: now,
      }));
      if (!archivedThread) return;
      await upsertArchived({ archived: true }, (current) => [
        { ...archivedThread!, archivedAt: now },
        ...(current ?? []).filter((thread) => thread._id !== threadId),
      ]);
    },
    [updateActive, updateThread, upsertArchived],
  );

  const removeArchivedThreadLocally = useCallback(
    async (threadId: Id<"threads">) => {
      await updateArchived({ archived: true }, (current) =>
        current.filter((thread) => thread._id !== threadId),
      );
    },
    [updateArchived],
  );

  const unarchiveThreadLocally = useCallback(
    async (threadId: Id<"threads">) => {
      let activeThread: ThreadList[number] | null = null;
      await updateArchived({ archived: true }, (current) => {
        activeThread =
          current.find((thread) => thread._id === threadId) ?? null;
        return current.filter((thread) => thread._id !== threadId);
      });
      await updateThread({ id: threadId }, (current) => {
        const { archivedAt: _archivedAt, ...rest } = current;
        return rest as NonNullable<ThreadDetail>;
      });
      if (!activeThread) return;
      const archivedRow = activeThread as ThreadList[number];
      const { archivedAt: _archivedAt, ...rest } = archivedRow;
      await upsertActive({ archived: false }, (current) =>
        [rest, ...(current ?? []).filter((thread) => thread._id !== threadId)]
          .sort((a, b) => b.lastMessageAt - a.lastMessageAt),
      );
    },
    [updateArchived, updateThread, upsertActive],
  );

  return {
    archiveThreadLocally,
    removeArchivedThreadLocally,
    unarchiveThreadLocally,
  };
}

export function useCachedAgentTargets(orgId?: Id<"organizations">) {
  return useCachedQuery(
    "agentTargets.list",
    api.agentTargets.list,
    orgId ? { orgId } : "skip",
  ) as AgentTargetList | undefined;
}

export function useCachedConnectedVendors(orgId?: Id<"organizations">) {
  return useCachedQuery(
    "connectedOrgs.listVendors",
    api.connectedOrgs.listVendors,
    orgId ? { orgId } : "skip",
  ) as ConnectedVendorList | undefined;
}

export function useCachedNotifications(
  orgId: Id<"organizations">,
  status: NotificationStatus,
) {
  return useCachedQuery(
    notificationCacheName(status),
    api.notifications.listInbox,
    {
      orgId,
      status,
    },
  ) as NotificationList | undefined;
}

function mergeReadNotifications(
  current: NotificationList,
  notifications: NotificationInput[],
): NotificationList {
  const byId = new Map<string, NotificationRow>();
  for (const notification of notifications) {
    byId.set(String(notification._id), {
      ...(notification as NotificationRow),
      status: "read",
    });
  }
  for (const notification of current) {
    byId.set(String(notification._id), notification);
  }
  return Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function useNotificationCacheActions(orgId: Id<"organizations">) {
  const updateUnread = useUpdateCachedQuery<
    NotificationList,
    NotificationListArgs
  >(notificationCacheName("unread"));
  const updateRead = useUpdateCachedQuery<
    NotificationList,
    NotificationListArgs
  >(notificationCacheName("read"));

  const markReadLocally = useCallback(
    async (notifications: NotificationInput[]) => {
      const ids = new Set(
        notifications.map((notification) => String(notification._id)),
      );
      await Promise.all([
        updateUnread({ orgId, status: "unread" }, (current) =>
          current.filter((notification) => !ids.has(String(notification._id))),
        ),
        updateRead({ orgId, status: "read" }, (current) =>
          mergeReadNotifications(current, notifications),
        ),
      ]);
    },
    [orgId, updateRead, updateUnread],
  );

  return { markReadLocally };
}
