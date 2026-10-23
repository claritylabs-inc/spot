"use client";

import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * Unread team mail for the sidebar. The count is bounded server side, so a
 * `limited` result is a lower bound and renders as "N+".
 */
export function InboxUnreadBadge({ collapsed }: { collapsed: boolean }) {
  const unread = useQuery(api.teamInbox.unreadCount, {});
  if (!unread || (unread.count === 0 && !unread.limited)) return null;
  const text =
    unread.count === 0 ? "•" : unread.limited ? `${unread.count}+` : String(unread.count);
  const label = unread.limited
    ? `At least ${unread.count} unread`
    : `${unread.count} unread`;
  if (collapsed)
    return (
      <span
        role="status"
        aria-label={label}
        className="absolute top-1 right-1.5 size-2 rounded-full bg-foreground"
      />
    );
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        "min-w-5 rounded-full bg-foreground px-1.5 text-center text-background",
        typeStyle("caption.medium"),
      )}
    >
      {text}
    </span>
  );
}
