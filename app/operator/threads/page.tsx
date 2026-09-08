"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Archive,
  ArchiveRestore,
  Loader2,
  MessageSquare,
  Maximize2,
  Plus,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { OperatorSidebar } from "@/app/operator/operator-sidebar";
import { AppShell } from "@/components/app-shell";
import { useOptionalOperatorAgent } from "@/components/operator-agent/operator-agent-provider";
import {
  OperatorThreadChannelIcon,
  operatorThreadChannelLabel,
} from "@/components/operator-agent/operator-thread-channel";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { OperatorAgentPanel } from "@/components/operator-agent/operator-agent-panel";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import { OperationalPanel } from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  normalizeOperatorAgentThread,
  normalizeOperatorAgentThreads,
  operatorAgentApi,
} from "@/lib/operator-agent-api";
import { formatDisplayDateTime } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

export default function OperatorThreadsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const controller = useOptionalOperatorAgent();
  const showArchived = searchParams.get("view") === "archived";
  const rawThreads = useQuery(operatorAgentApi.listThreads, {
    limit: 100,
    archived: showArchived,
  });
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const selectedRaw = useQuery(
    operatorAgentApi.getThread,
    selectedThreadId ? { threadId: selectedThreadId } : "skip",
  );
  const selected = useMemo(
    () => normalizeOperatorAgentThread(selectedRaw).thread,
    [selectedRaw],
  );
  const intents = useQuery(operatorAgentApi.listIntents, {});
  const threads = useMemo(
    () => normalizeOperatorAgentThreads(rawThreads),
    [rawThreads],
  );
  const createThread = useMutation(operatorAgentApi.createThread);
  const archiveThread = useMutation(operatorAgentApi.archiveThread);
  const unarchiveThread = useMutation(operatorAgentApi.unarchiveThread);
  const startIntent = useMutation(operatorAgentApi.startIntent);
  const [updatingThreadId, setUpdatingThreadId] = useState<string | null>(null);
  const [launchingIntentId, setLaunchingIntentId] = useState<string | null>(
    null,
  );

  async function startThread() {
    try {
      const threadId = await createThread({});
      controller?.setActiveThreadId(threadId);
      router.push(`/operator/threads/${threadId}`);
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Could not start a thread"));
    }
  }

  async function updateArchiveState(threadId: string) {
    setUpdatingThreadId(threadId);
    try {
      if (selected?.archivedAt) {
        await unarchiveThread({ threadId });
        toast.success("Thread restored");
      } else {
        await archiveThread({ threadId });
        if (controller?.activeThreadId === threadId) {
          controller.setActiveThreadId(null);
        }
        toast.success("Thread archived");
      }
      setSelectedThreadId(null);
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          `Could not ${selected?.archivedAt ? "restore" : "archive"} the thread`,
        ),
      );
    } finally {
      setUpdatingThreadId(null);
    }
  }

  async function launchIntent(intentId: string) {
    if (launchingIntentId) return;
    setLaunchingIntentId(intentId);
    try {
      const result = await startIntent({ intentId });
      controller?.setActiveThreadId(result.threadId);
      router.push(`/operator/threads/${result.threadId}`);
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not start the operator task"),
      );
    } finally {
      setLaunchingIntentId(null);
    }
  }

  return (
    <AppShell
      actions={
        <PillButton type="button" onClick={() => void startThread()}>
          <Plus className="size-4" />
          New thread
        </PillButton>
      }
      rightPanel={
        selected ? (
          <SettingsDrawer
            open
            contentClassName="my-0 min-h-0 flex-1"
            title={selected.title}
            onOpenChange={(open) => {
              if (!open) setSelectedThreadId(null);
            }}
            footer={
              <>
                <PillButton
                  variant="secondary"
                  href={`/operator/threads/${selected.id}`}
                >
                  <Maximize2 className="size-3.5" />
                  Open conversation
                </PillButton>
                <PillButton
                  variant="secondary"
                  disabled={updatingThreadId !== null}
                  onClick={() => void updateArchiveState(selected.id)}
                >
                  {updatingThreadId ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : selected.archivedAt ? (
                    <ArchiveRestore className="size-3.5" />
                  ) : (
                    <Archive className="size-3.5" />
                  )}
                  {selected.archivedAt ? "Restore thread" : "Archive thread"}
                </PillButton>
              </>
            }
          >
            <div className="min-h-0 flex-1">
              <OperatorAgentPanel
                key={selected.id}
                variant="page"
                threadId={selected.id}
                showHeader={false}
              />
            </div>
          </SettingsDrawer>
        ) : undefined
      }
      customSidebar={({ collapsed, onToggleCollapse }) => (
        <OperatorSidebar
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          active="threads"
        />
      )}
      customSidebarStorageKey="operator-sidebar"
      disablePersistentChat
      disableCommandPalette
    >
      <div className="space-y-4">
        <Tabs
          value={showArchived ? "archived" : "active"}
          onValueChange={(value) =>
            router.push(
              value === "archived"
                ? "/operator/threads?view=archived"
                : "/operator/threads",
            )
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <TabsList variant="pill">
              <TabsTrigger value="active">Active</TabsTrigger>
              <TabsTrigger value="archived">Archived</TabsTrigger>
            </TabsList>
            <div className="flex flex-wrap gap-2 sm:ml-auto">
              {intents?.map((intent) => (
                <PillButton
                  key={intent.id}
                  type="button"
                  size="compact"
                  variant="secondary"
                  disabled={launchingIntentId !== null}
                  onClick={() => void launchIntent(intent.id)}
                >
                  {launchingIntentId === intent.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : null}
                  {intent.label}
                </PillButton>
              ))}
            </div>
          </div>
        </Tabs>

        {rawThreads === undefined ? (
          <OperationalPanel>
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          </OperationalPanel>
        ) : threads.length === 0 ? (
          <EmptyStateCard
            icon={
              showArchived ? (
                <Archive className="size-5" />
              ) : (
                <MessageSquare className="size-5" />
              )
            }
            title={
              showArchived
                ? "No archived threads"
                : "No active operator threads"
            }
            description={
              showArchived
                ? "Threads you archive will appear here."
                : "Start a thread here, or message Spot from Slack or iMessage."
            }
            actionLabel={showArchived ? undefined : "Start a thread"}
            onAction={showArchived ? undefined : () => void startThread()}
          />
        ) : (
          <OperationalPanel>
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[65%] sm:w-[50%]">
                    Conversation
                  </TableHead>
                  <TableHead className="w-[35%] sm:w-[20%]">Channel</TableHead>
                  <TableHead className="hidden w-[30%] text-right sm:table-cell">
                    Last activity
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {threads.map((thread) => {
                  return (
                    <TableRow
                      key={thread.id}
                      tabIndex={0}
                      onClick={() => setSelectedThreadId(thread.id)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        setSelectedThreadId(thread.id);
                      }}
                      className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    >
                      <TableCell>
                        <p
                          className={`truncate text-foreground ${typeStyle("body.medium")}`}
                        >
                          {thread.title}
                        </p>
                        <p
                          className={`truncate text-muted-foreground sm:hidden ${typeStyle("caption.default")}`}
                        >
                          {formatDisplayDateTime(thread.lastMessageAt)}
                        </p>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <OperatorThreadChannelIcon
                            channel={thread.channel}
                            className="size-3.5 shrink-0"
                          />
                          <span className="truncate">
                            {operatorThreadChannelLabel(thread.channel)}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className="hidden text-right text-muted-foreground sm:table-cell">
                        {formatDisplayDateTime(thread.lastMessageAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </OperationalPanel>
        )}
      </div>
    </AppShell>
  );
}
