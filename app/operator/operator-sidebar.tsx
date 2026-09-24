"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import {
  Building2,
  List,
  LogOut,
  ScrollText,
  Settings,
  ChartNoAxesColumn,
  Radio,
  User,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  SectionHeader,
  SidebarHeaderLink,
  SidebarMenuItem,
  SidebarTooltipProvider,
} from "@/components/app-sidebar/nav-item";
import {
  MENU_ITEM_ACTIVE,
  MENU_ITEM_BASE,
  MENU_ITEM_INACTIVE,
} from "@/components/app-sidebar/nav-config";
import { SidebarHeader } from "@/components/app-sidebar/sidebar-header";
import { SidebarThreadArchiveAction } from "@/components/app-sidebar/sidebar-thread-archive-action";
import { LogoIcon } from "@/components/ui/logo-icon";
import { useOptionalOperatorAgent } from "@/components/operator-agent/operator-agent-provider";
import { OperatorThreadChannelIcon } from "@/components/operator-agent/operator-thread-channel";
import {
  normalizeOperatorAgentThreads,
  operatorAgentApi,
} from "@/lib/operator-agent-api";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

export function OperatorSidebar({
  collapsed,
  onToggleCollapse,
  active,
  onOpenLogFilters,
}: {
  onOpenLogFilters?: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  active:
    | "threads"
    | "brokers"
    | "clients"
    | "channels"
    | "usage"
    | "logs"
    | "profile"
    | "settings";
}) {
  const { signOut } = useAuthActions();
  const pathname = usePathname();
  const router = useRouter();
  const controller = useOptionalOperatorAgent();
  const rawThreads = useQuery(operatorAgentApi.listThreads, {
    limit: 8,
    archived: false,
  });
  const threads = normalizeOperatorAgentThreads(rawThreads);
  const archiveThread = useMutation(operatorAgentApi.archiveThread);
  const [archivingThreadId, setArchivingThreadId] = useState<string | null>(
    null,
  );

  async function handleArchiveThread(threadId: string, isActive: boolean) {
    setArchivingThreadId(threadId);
    try {
      await archiveThread({ threadId });
      if (controller?.activeThreadId === threadId) {
        controller.setActiveThreadId(null);
      }
      if (isActive) {
        const nextThread = threads.find((thread) => thread.id !== threadId);
        router.push(
          nextThread
            ? `/operator/threads/${nextThread.id}`
            : "/operator/threads",
        );
      }
      toast.success("Thread archived");
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not archive the thread"),
      );
    } finally {
      setArchivingThreadId(null);
    }
  }

  return (
    <SidebarTooltipProvider>
      <SidebarHeader
        collapsed={collapsed}
        initials="OP"
        headerOrgName="Operator"
        onToggleCollapse={onToggleCollapse}
        icon={<LogoIcon size={15} />}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-2">
        {collapsed ? (
          <SidebarMenuItem
            href="/operator/threads"
            label="Threads"
            icon={List}
            active={active === "threads"}
            collapsed
          />
        ) : (
          <>
            <div className="flex items-center justify-between px-3 pb-1.5 pt-3">
              <span
                className={`text-muted-foreground/50 ${typeStyle("caption.medium")}`}
              >
                Threads
              </span>
              <SidebarHeaderLink
                href="/operator/threads"
                label="All threads"
                icon={List}
                active={pathname === "/operator/threads"}
              />
            </div>
            {threads.map((thread) => {
              const href = `/operator/threads/${thread.id}`;
              const isActive = pathname === href;
              return (
                <Link
                  key={thread.id}
                  href={href}
                  className={`group flex items-center gap-2 px-3 py-1.5 ${MENU_ITEM_BASE} ${typeStyle("control.button")} ${
                    isActive ? MENU_ITEM_ACTIVE : MENU_ITEM_INACTIVE
                  }`}
                >
                  <OperatorThreadChannelIcon
                    channel={thread.channel}
                    className="size-3.5 shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {thread.title}
                  </span>
                  <SidebarThreadArchiveAction
                    disabled={archivingThreadId !== null}
                    pending={archivingThreadId === thread.id}
                    onArchive={() => handleArchiveThread(thread.id, isActive)}
                  />
                </Link>
              );
            })}
          </>
        )}
        <SectionHeader label="Accounts" collapsed={collapsed} />
        <div className="flex flex-col gap-1">
          <SidebarMenuItem
            href="/operator/clients"
            label="Clients"
            icon={Users}
            active={active === "clients"}
            collapsed={collapsed}
          />
          <SidebarMenuItem
            href="/operator/brokers"
            label="Insurance providers"
            icon={Building2}
            active={active === "brokers"}
            collapsed={collapsed}
          />
        </div>
        <SectionHeader label="DevOps" collapsed={collapsed} />
        <div className="flex flex-col gap-1">
          <SidebarMenuItem
            href="/operator/channels"
            label="Channels"
            icon={Radio}
            active={active === "channels"}
            collapsed={collapsed}
          />
          <SidebarMenuItem
            href="/operator/usage"
            label="Usage"
            icon={ChartNoAxesColumn}
            active={active === "usage"}
            collapsed={collapsed}
          />
          <SidebarMenuItem
            {...(onOpenLogFilters
              ? { onClick: onOpenLogFilters }
              : { href: "/operator/logs" })}
            label="Logs"
            icon={ScrollText}
            active={active === "logs"}
            collapsed={collapsed}
          />
        </div>
      </div>
      <div className="space-y-0.5 border-t border-border px-2 py-2">
        <SidebarMenuItem
          href="/operator/settings"
          label="Settings"
          icon={Settings}
          active={active === "settings"}
          collapsed={collapsed}
        />
        <SidebarMenuItem
          href="/operator/profile"
          label="Profile"
          icon={User}
          active={active === "profile"}
          collapsed={collapsed}
        />
        <SidebarMenuItem
          onClick={() => void signOut()}
          label="Sign out"
          icon={LogOut}
          active={false}
          collapsed={collapsed}
        />
      </div>
    </SidebarTooltipProvider>
  );
}
