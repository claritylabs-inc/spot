"use client";

import { useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import { PanelsTopLeft, Plus } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";

import { OperatorSidebar } from "@/app/operator/operator-sidebar";
import { AppShell } from "@/components/app-shell";
import { OperatorAgentPanel } from "@/components/operator-agent/operator-agent-panel";
import { useOptionalOperatorAgent } from "@/components/operator-agent/operator-agent-provider";
import { OperatorThreadChannelIcon } from "@/components/operator-agent/operator-thread-channel";
import { operatorThreadContextHref } from "@/components/operator-agent/operator-page-context";
import { PillButton } from "@/components/ui/pill-button";
import {
  normalizeOperatorAgentThread,
  operatorAgentApi,
} from "@/lib/operator-agent-api";

export default function OperatorThreadPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const controller = useOptionalOperatorAgent();
  const rawThread = useQuery(operatorAgentApi.getThread, { threadId: id });
  const detail = useMemo(
    () => normalizeOperatorAgentThread(rawThread),
    [rawThread],
  );
  const contextHref = detail.thread
    ? operatorThreadContextHref(detail.thread)
    : null;
  const createThread = useMutation(operatorAgentApi.createThread);

  async function startThread() {
    try {
      const threadId = await createThread({});
      controller?.setActiveThreadId(threadId);
      router.push(`/operator/threads/${threadId}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not start a thread",
      );
    }
  }

  return (
    <AppShell
      breadcrumbDetail={
        detail.thread ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <OperatorThreadChannelIcon
              channel={detail.thread.channel}
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            <span className="truncate">{detail.thread.title}</span>
          </span>
        ) : (
          "Conversation"
        )
      }
      actions={
        <>
          {contextHref ? (
            <PillButton
              variant="secondary"
              href={contextHref}
              expandLabel
              label="Open with context"
            >
              <PanelsTopLeft className="size-4" />
            </PillButton>
          ) : null}
          <PillButton type="button" onClick={() => void startThread()}>
            <Plus className="size-4" />
            New thread
          </PillButton>
        </>
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
      <div className="absolute inset-0 overflow-hidden">
        <OperatorAgentPanel variant="page" threadId={id} showHeader={false} />
      </div>
    </AppShell>
  );
}
