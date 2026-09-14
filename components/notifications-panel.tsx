"use client";

import { useRef, useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  notificationActionHref,
  type NotificationActionPayload,
  type NotificationActionType,
} from "@/convex/lib/notificationTypes";
import type { Id } from "@/convex/_generated/dataModel";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { X } from "lucide-react";
import {
  useCachedNotifications,
  useNotificationCacheActions,
} from "@/lib/sync/spot-cached-queries";
import { typeStyle } from "@/lib/typography";

dayjs.extend(relativeTime);

interface Notification {
  _id: Id<"notifications">;
  type: string;
  title: string;
  body: string;
  status: "unread" | "read" | "actioned" | "dismissed";
  createdAt: number;
  actionType?: NotificationActionType;
  actionPayload?: NotificationActionPayload;
  relatedOrgId?: Id<"organizations">;
  relatedOrgName?: string;
  coalescedCount?: number;
}

interface NotificationsPanelProps {
  orgId: Id<"organizations">;
  onClose: () => void;
  variant?: "popover" | "pane";
}

function notificationActionLabel(notification: Notification) {
  if (!notification.actionType) return undefined;
  switch (notification.actionType) {
    case "view_policy":
      return "Open policy";
    case "view_thread":
      return "Open thread";
    case "view_vendor_compliance":
      return "Open vendor compliance";
    default:
      return undefined;
  }
}

function notificationDisplayTitle(notification: Notification) {
  return notification.title;
}

export function NotificationsPanel({
  orgId,
  onClose,
  variant = "popover",
}: NotificationsPanelProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"unread" | "read">("unread");
  const unreadNotifications = useCachedNotifications(orgId, "unread") as
    | (Notification & { relatedOrgName?: string })[]
    | undefined;
  const readNotifications = useCachedNotifications(orgId, "read") as
    | (Notification & { relatedOrgName?: string })[]
    | undefined;
  const actionedNotifications = useCachedNotifications(orgId, "actioned") as
    | (Notification & { relatedOrgName?: string })[]
    | undefined;
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);
  const { markReadLocally } = useNotificationCacheActions(orgId);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (variant !== "popover") return;

    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose, variant]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  async function handleNotificationClick(notification: Notification) {
    if (notification.status === "unread") {
      void markReadLocally([notification]);
      await markRead({ ids: [notification._id] });
    }

    const href = notificationActionHref(
      notification.actionType,
      notification.actionPayload,
    );
    if (href) {
      router.push(href);
      onClose();
    }
  }

  const visibleReadNotifications = useMemo(() => {
    if (!readNotifications || !actionedNotifications) return undefined;
    return [...readNotifications, ...actionedNotifications]
      .filter((n: Notification) => n.status !== "dismissed")
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [actionedNotifications, readNotifications]);

  const visibleUnreadNotifications = useMemo(
    () =>
      unreadNotifications?.filter(
        (n: Notification) => n.status !== "dismissed",
      ),
    [unreadNotifications],
  );

  const activeNotifications =
    activeTab === "unread"
      ? visibleUnreadNotifications
      : visibleReadNotifications;
  const isLoading = activeNotifications === undefined;
  const unreadCount = visibleUnreadNotifications?.length ?? 0;
  const readCount = visibleReadNotifications?.length ?? 0;

  return (
    <div
      ref={panelRef}
      className={
        variant === "pane"
          ? "flex h-full w-full min-w-0 max-w-full shrink-0 flex-col overflow-hidden border-r border-border bg-background"
          : "absolute left-2 right-2 top-full mt-2 z-50 min-w-[18rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border border-border-emphasized bg-background shadow-lg"
      }
    >
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
        <span className={`min-w-0 truncate text-foreground ${typeStyle("body.medium")}`}>
          Notifications
        </span>
        <button
          type="button"
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground/40 hover:text-foreground hover:bg-foreground/4 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div
        className="flex h-12 min-w-0 shrink-0 items-center gap-1 border-b border-border px-2"
        role="tablist"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "unread"}
          onClick={() => setActiveTab("unread")}
          className={`min-w-0 flex-1 rounded-md px-2 py-1.5 transition-colors ${typeStyle("control.button")} ${
            activeTab === "unread"
              ? "bg-foreground/6 text-foreground"
              : "text-muted-foreground hover:bg-foreground/4 hover:text-foreground"
          }`}
        >
          Unread
          {unreadCount > 0 && (
            <span className={`ml-1.5 text-muted-foreground/60 ${typeStyle("caption.default")}`}>
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "read"}
          onClick={() => setActiveTab("read")}
          className={`min-w-0 flex-1 rounded-md px-2 py-1.5 transition-colors ${typeStyle("control.button")} ${
            activeTab === "read"
              ? "bg-foreground/6 text-foreground"
              : "text-muted-foreground hover:bg-foreground/4 hover:text-foreground"
          }`}
        >
          Read
          {readCount > 0 && (
            <span className={`ml-1.5 text-muted-foreground/60 ${typeStyle("caption.default")}`}>
              {readCount > 99 ? "99+" : readCount}
            </span>
          )}
        </button>
      </div>

      {/* List */}
      <div
        className={
          variant === "pane"
            ? "min-h-0 flex-1 overflow-y-auto"
            : "max-h-100 overflow-y-auto"
        }
      >
        {isLoading ? (
          <div className="min-h-24" aria-hidden="true" />
        ) : activeNotifications.length === 0 ? (
          <div className={`px-3 py-6 text-center text-muted-foreground/40 ${typeStyle("body.default")}`}>
            No {activeTab} notifications
          </div>
        ) : (
          activeNotifications.map((notification: Notification) => {
            const isUnread = notification.status === "unread";
            const isClickable =
              !!(notification.actionType && notification.actionPayload);
            const actionLabel = notificationActionLabel(notification);

            return (
              <button
                key={notification._id}
                type="button"
                onClick={() =>
                  handleNotificationClick(notification as Notification)
                }
                className={`flex w-full min-w-0 items-start gap-2.5 border-b border-border-subtle px-3 py-2.5 text-left transition-colors ${
                  isClickable ? "hover:bg-foreground/4" : "cursor-default"
                } ${isUnread ? "bg-foreground/2" : ""}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <p className={`min-w-0 flex-1 truncate text-foreground ${typeStyle("body.default")}`}>
                      {notificationDisplayTitle(notification)}
                    </p>
                    {(notification.coalescedCount ?? 1) > 1 && (
                      <span className={`inline-flex items-center px-1 py-0 rounded bg-foreground/8 text-muted-foreground ${typeStyle("caption.medium")}`}>
                        ×{notification.coalescedCount}
                      </span>
                    )}
                  </div>
                  {notification.relatedOrgName && (
                    <p className={`mt-0.5 truncate text-muted-foreground/50 ${typeStyle("caption.default")}`}>
                      {notification.relatedOrgName}
                    </p>
                  )}
                  <p
                    className={`mt-0.5 wrap-break-word text-muted-foreground/60 ${typeStyle("caption.default")} ${
                      variant === "pane" ? "" : "line-clamp-2"
                    }`}
                  >
                    {notification.body}
                  </p>
                  <p className={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground/40 ${typeStyle("caption.default")}`}>
                    <span>{dayjs(notification.createdAt).fromNow()}</span>
                    {actionLabel && (
                      <span className="text-muted-foreground/60">
                        {actionLabel}
                      </span>
                    )}
                  </p>
                </div>
                {isUnread && (
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0 mt-1.5" />
                )}
              </button>
            );
          })
        )}
      </div>

      {/* Footer */}
      {activeTab === "unread" && unreadCount > 0 && (
        <div className="px-3 py-2 border-t border-border">
          <button
            type="button"
            onClick={() => {
              if (visibleUnreadNotifications) {
                void markReadLocally(visibleUnreadNotifications);
              }
              void markAllRead({ orgId });
            }}
            className={`text-muted-foreground/50 hover:text-foreground transition-colors ${typeStyle("control.buttonCompact")}`}
          >
            Mark all as read
          </button>
        </div>
      )}
    </div>
  );
}
