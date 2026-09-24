import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { notificationActionHref } from "@/convex/lib/notificationTypes";
import type { ThemeChoice } from "@/hooks/use-theme";
import { WEBMCP_CLIENT_PAGES } from "@/lib/webmcp/catalog";
import { SETTINGS_SECTIONS } from "@/lib/webmcp/definitions/workspace";
import { webMcpError } from "@/lib/webmcp/runtime";
import {
  isoTime,
  num,
  requiredText,
  stringList,
  text,
  type ClientToolContext,
  type ToolMap,
} from "@/components/webmcp/tools/helpers";

const RECORD_ROUTES: Partial<Record<(typeof WEBMCP_CLIENT_PAGES)[number], string>> = {
  policies: "/policies",
  requests: "/requests",
  agent: "/agent/thread",
  connect: "/connect/vendors",
};

export function workspaceToolImplementations(ctx: ClientToolContext): ToolMap {
  const { convex, orgId, router } = ctx;
  return {
    open_spot_page: async (input) => {
      const page = requiredText(input, "page") as (typeof WEBMCP_CLIENT_PAGES)[number];
      if (!WEBMCP_CLIENT_PAGES.includes(page)) {
        return webMcpError(`Unknown page. Use one of: ${WEBMCP_CLIENT_PAGES.join(", ")}.`);
      }
      const recordId = text(input, "record_id");
      const section = text(input, "settings_section");
      let href = page === "agent" ? "/agent/threads" : page === "connect" ? "/connect/vendors" : `/${page}`;
      if (recordId && RECORD_ROUTES[page]) {
        href = `${RECORD_ROUTES[page]}/${encodeURIComponent(recordId)}${page === "connect" ? "/policies" : ""}`;
      }
      if (page === "settings" && section) {
        if (!(SETTINGS_SECTIONS as readonly string[]).includes(section)) {
          return webMcpError(`Unknown settings section. Use one of: ${SETTINGS_SECTIONS.join(", ")}.`);
        }
        href = `/settings?section=${section}`;
      }
      router.push(href);
      return { status: "navigating", url: href };
    },
    list_notifications: async (input) => {
      const notifications = await convex.query(api.notifications.listInbox, {
        orgId,
        status: text(input, "status") as "unread" | "read" | "actioned" | undefined,
        limit: num(input, "limit"),
      });
      return {
        status: "ok",
        notifications: notifications.map((notification) => ({
          notification_id: notification._id,
          type: notification.type,
          title: notification.title,
          body: notification.body ?? null,
          status: notification.status,
          created_at: isoTime(notification.createdAt ?? notification._creationTime),
          href: notificationActionHref(notification.actionType, notification.actionPayload) ?? null,
        })),
      };
    },
    mark_notifications_read: async (input) => {
      const ids = stringList(input, "notification_ids");
      if (!ids) return webMcpError("notification_ids is required.");
      await convex.mutation(api.notifications.markRead, { ids: ids as Id<"notifications">[] });
      return { status: "read", count: ids.length };
    },
    mark_all_notifications_read: async () => {
      await convex.mutation(api.notifications.markAllRead, { orgId });
      return { status: "read" };
    },
    set_theme: async (input) => {
      const theme = requiredText(input, "theme") as ThemeChoice;
      if (!["light", "dark", "system"].includes(theme)) return webMcpError("Unknown theme.");
      ctx.setTheme(theme);
      return { status: "ok", theme };
    },
    sign_out: async () => {
      await ctx.signOut();
      router.replace("/login");
      return { status: "signed_out", next_url: "/login" };
    },
  };
}
