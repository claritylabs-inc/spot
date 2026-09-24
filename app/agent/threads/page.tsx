"use client";

import { MessageSquare, Plus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app-shell";
import { ThreadListRow } from "@/components/agent-thread/thread-list-row";
import { EmptyStateCard } from "@claritylabs-inc/ui/components/empty-state-card";
import { FadeIn } from "@claritylabs-inc/ui/components/fade-in";
import { PillButton } from "@/components/ui/pill-button";
import { openCommandPalette } from "@/components/command-palette";
import type { ThreadDisplayLike } from "@/lib/thread-display";
import { useCachedQuery } from "@/lib/sync/use-cached-query";

export default function AgentThreadsPage() {
  const threads = useCachedQuery("threads.list.active", api.threads.list, {
    archived: false,
  }) as ThreadDisplayLike[] | undefined;

  return (
    <AppShell
      actions={
        <PillButton type="button" onClick={openCommandPalette}>
          <Plus className="h-3.5 w-3.5" />
          New thread
        </PillButton>
      }
    >
      <FadeIn when={true} duration={0.12}>
        {threads === undefined ? (
          <div className="min-h-32" aria-hidden="true" />
        ) : threads.length === 0 ? (
          <EmptyStateCard
            icon={<MessageSquare className="h-5 w-5" />}
            title="No threads yet"
            description="Start a conversation with Spot about your policies, requirements, or connected email."
          />
        ) : (
          <div className="space-y-1">
            {threads.map((thread) => (
              <ThreadListRow key={thread._id} thread={thread} />
            ))}
          </div>
        )}
      </FadeIn>
    </AppShell>
  );
}
