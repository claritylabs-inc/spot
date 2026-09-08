"use client";

import { ArchiveRestore } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ThreadListRow } from "@/components/agent-thread/thread-list-row";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import { FadeIn } from "@/components/ui/fade-in";
import { useCachedArchivedThreads } from "@/lib/sync/spot-cached-queries";

export default function ArchivePage() {
  const threads = useCachedArchivedThreads();

  return (
    <AppShell breadcrumbDetail="Archive">
      <FadeIn when={true} duration={0.12}>
        {(threads ?? []).length === 0 ? (
          <EmptyStateCard
            icon={<ArchiveRestore className="h-5 w-5" />}
            title="No archived threads"
            description="Archived conversations are kept here."
          />
        ) : (
          <div className="space-y-1">
            {(threads ?? []).map((thread) => (
              <ThreadListRow key={thread._id} thread={thread} />
            ))}
          </div>
        )}
      </FadeIn>
    </AppShell>
  );
}
