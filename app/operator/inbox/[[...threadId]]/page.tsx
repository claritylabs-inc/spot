"use client";

import { useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import {
  ConversationUnavailable,
  ReaderBoundary,
} from "@/components/inbox/reader-boundary";
import { useResolvedThreadId } from "@/components/inbox/resolve-thread-id";
import { NewEmailComposer } from "@/components/inbox/new-email-composer";
import { TeamInbox, type InboxThread } from "@/components/inbox/team-inbox";
import { ProcurementEmailDrawer } from "@/components/procurement/procurement-shared";
import { useFollowedState } from "@/hooks/use-followed-state";
import { useCachedOperatorCurrent } from "@/lib/sync/operator-cached-queries";

/**
 * The shared team inbox. `/operator/inbox` and `/operator/inbox/<id>` render the
 * same page, so the list and reader stay mounted as the selection changes.
 */
export default function OperatorInboxPage() {
  const router = useRouter();
  const params = useParams<{ threadId?: string[] }>();
  const current = useCachedOperatorCurrent();
  // Route params arrive decoded; the id is opaque.
  const selectedId = params.threadId?.[0] ?? null;
  // The open draft's id; teammates following along edit the same draft.
  const [composing, setComposing] = useFollowedState<string | null>("inbox:composing", null);

  const select = useCallback(
    (thread: InboxThread | null, options?: { replace?: boolean }) => {
      const path = thread ? `/operator/inbox/${thread._id}` : "/operator/inbox";
      const href = `${path}${window.location.search}`;
      if (options?.replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [router],
  );
  const close = useCallback(() => select(null), [select]);
  // Opening a conversation replaces the composer; its draft is kept for the session.
  useEffect(() => {
    if (selectedId) setComposing(null);
  }, [selectedId, setComposing]);
  const resolved = useResolvedThreadId(selectedId);
  // A saved link with a legacy id moves to the current id.
  useEffect(() => {
    if (resolved.status === "ready" && resolved.redirected)
      router.replace(`/operator/inbox/${resolved.threadId}${window.location.search}`, { scroll: false });
  }, [resolved, router]);

  return (
    <AppShell
      breadcrumbDetail="Inbox"
      rightPanelWide
      rightPanel={
        composing ? (
          <NewEmailComposer
            draftId={composing}
            onClose={() => setComposing(null)}
            onSent={(threadId) => {
              setComposing(null);
              if (threadId) router.push(`/operator/inbox/${threadId}?mailbox=sent`, { scroll: false });
            }}
          />
        ) : resolved.status === "unavailable" ? (
          <ConversationUnavailable onClose={close} />
        ) : resolved.threadId ? (
          <ReaderBoundary resetKey={resolved.threadId} onClose={close}>
            <ProcurementEmailDrawer
              emailThreadId={resolved.threadId}
              readOnly={Boolean(current?.activeImpersonation)}
              onClose={close}
            />
          </ReaderBoundary>
        ) : null
      }
    >
      <TeamInbox
        scope={{ kind: "team" }}
        selectedThreadId={resolved.threadId ?? selectedId}
        onSelect={select}
        onCompose={() => {
          if (selectedId) router.push(`/operator/inbox${window.location.search}`, { scroll: false });
          setComposing((current) => current ?? crypto.randomUUID());
        }}
      />
    </AppShell>
  );
}
