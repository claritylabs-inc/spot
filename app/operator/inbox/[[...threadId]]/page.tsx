"use client";

import { useCallback } from "react";
import { useParams, useRouter } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { ReaderBoundary } from "@/components/inbox/reader-boundary";
import { TeamInbox, type InboxThread } from "@/components/inbox/team-inbox";
import { ProcurementEmailDrawer } from "@/components/procurement/procurement-shared";
import type { Id } from "@/convex/_generated/dataModel";
import { useCachedOperatorCurrent } from "@/lib/sync/operator-cached-queries";

/**
 * The shared team inbox. `/operator/inbox` and `/operator/inbox/<id>` render the
 * same page, so the list and reader stay mounted as the selection changes.
 */
export default function OperatorInboxPage() {
  const router = useRouter();
  const params = useParams<{ threadId?: string[] }>();
  const current = useCachedOperatorCurrent();
  const selectedId = params.threadId?.[0]
    ? decodeURIComponent(params.threadId[0])
    : null;

  const select = useCallback(
    (thread: InboxThread | null, options?: { replace?: boolean }) => {
      const href = thread ? `/operator/inbox/${thread._id}` : "/operator/inbox";
      if (options?.replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [router],
  );
  const close = useCallback(() => select(null), [select]);

  return (
    <AppShell
      breadcrumbDetail="Inbox"
      rightPanel={
        selectedId ? (
          <ReaderBoundary resetKey={selectedId} onClose={close}>
            <ProcurementEmailDrawer
              emailThreadId={selectedId as Id<"teamEmailThreads">}
              readOnly={Boolean(current?.activeImpersonation)}
              onClose={close}
            />
          </ReaderBoundary>
        ) : null
      }
    >
      <TeamInbox
        scope={{ kind: "team" }}
        selectedThreadId={selectedId}
        onSelect={select}
      />
    </AppShell>
  );
}
