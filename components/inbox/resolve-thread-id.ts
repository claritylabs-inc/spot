"use client";

import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

type ResolvedThreadId =
  | { status: "none" | "loading" | "unavailable"; threadId: null; redirected: false }
  | { status: "ready"; threadId: Id<"teamEmailThreads">; redirected: boolean };

/**
 * Resolves a `thread` URL value to a team conversation id. Saved links and old
 * notifications may carry a legacy id, which the server maps; an invalid,
 * deleted or out-of-scope id is `unavailable`. Nothing is selected while the
 * lookup is `loading`, and the URL value is never cast to an id.
 */
export function useResolvedThreadId(
  raw: string | null,
  requestId?: Id<"procurementRequests">,
): ResolvedThreadId {
  const resolved = useQuery(
    api.teamInbox.resolveThreadId,
    raw ? { threadId: raw, ...(requestId ? { requestId } : {}) } : "skip",
  );
  if (!raw) return { status: "none", threadId: null, redirected: false };
  if (resolved === undefined)
    return { status: "loading", threadId: null, redirected: false };
  if (resolved === null)
    return { status: "unavailable", threadId: null, redirected: false };
  return { status: "ready", threadId: resolved, redirected: resolved !== raw };
}
