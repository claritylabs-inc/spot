"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  NotebookPen,
  ClipboardCheck,
  FileSearch,
  FolderOpen,
  FileText,
  Settings,
  Users,
} from "lucide-react";
import {
  SectionHeader,
  SidebarMenuItem,
  SidebarTooltipProvider,
} from "@/components/app-sidebar/nav-item";
import { SidebarHeader } from "@/components/app-sidebar/sidebar-header";
import { LogoIcon } from "@/components/ui/logo-icon";
import type { OperatorImpersonationTarget } from "@/lib/operator-navigation";
import {
  useCachedOperatorClients,
  useCachedOperatorCurrent,
} from "@/lib/sync/operator-cached-queries";
import { OperatorClientImpersonationAction } from "./operator-client-impersonation-action";

let beforeImpersonationStart: (() => Promise<boolean>) | null = null;

/** The settings page saves pending edits before the sidebar starts impersonating. */
export function registerOperatorClientBeforeImpersonationStart(
  handler: (() => Promise<boolean>) | null,
) {
  beforeImpersonationStart = handler;
}

type OperatorClientNavigationSection =
  | "policies"
  | "procurement"
  | "files"
  | "wiki"
  | "compliance"
  | "team"
  | "settings";

const INSURANCE_NAV_ITEMS = [
  { id: "policies", label: "Policies", href: "/policies", icon: FileText },
  {
    id: "procurement",
    label: "Procurement",
    href: "/procurement",
    icon: FileSearch,
  },
  {
    id: "compliance",
    label: "Compliance",
    href: "/compliance",
    icon: ClipboardCheck,
  },
] as const;

function activeClientSection({
  pathname,
  tab,
  basePath,
}: {
  pathname: string;
  tab: string | null;
  basePath: string;
}): OperatorClientNavigationSection {
  if (
    pathname === `${basePath}/procurement` ||
    pathname.startsWith(`${basePath}/procurement/`)
  ) {
    return "procurement";
  }
  if (
    pathname === `${basePath}/policies` ||
    pathname.startsWith(`${basePath}/policies/`)
  ) {
    return "policies";
  }
  if (
    pathname === `${basePath}/files` ||
    pathname.startsWith(`${basePath}/files/`)
  ) {
    return "files";
  }
  if (
    pathname === `${basePath}/wiki` ||
    pathname.startsWith(`${basePath}/wiki/`)
  ) {
    return "wiki";
  }
  if (
    pathname === `${basePath}/compliance` ||
    pathname.startsWith(`${basePath}/compliance/`)
  ) {
    return "compliance";
  }
  if (
    pathname === `${basePath}/certificates` ||
    pathname.startsWith(`${basePath}/certificates/`)
  ) {
    return "compliance";
  }
  if (pathname === basePath || pathname === `${basePath}/`) {
    if (tab === "team") return "team";
    if (tab === "settings" || tab === "overview") return "settings";
  }
  return "wiki";
}

export function OperatorClientSidebar({
  collapsed,
  onToggleCollapse,
  clientOrgId,
  activeImpersonation,
  impersonationDisabled = false,
  beforeImpersonationStart,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  clientOrgId: string;
  activeImpersonation: OperatorImpersonationTarget | null | undefined;
  impersonationDisabled?: boolean;
  beforeImpersonationStart?: () => Promise<boolean | void>;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const basePath = `/operator/clients/${clientOrgId}`;
  const active = activeClientSection({
    pathname,
    tab: searchParams.get("tab"),
    basePath,
  });

  return (
    <SidebarTooltipProvider>
      <div className="flex h-full flex-col">
        <SidebarHeader
          collapsed={collapsed}
          initials="OP"
          headerOrgName="Operator"
          onToggleCollapse={onToggleCollapse}
          icon={<LogoIcon size={15} />}
        />

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
          <SidebarMenuItem
            href="/operator/clients"
            label="Clients"
            icon={ArrowLeft}
            active={false}
            collapsed={collapsed}
          />

          <SectionHeader label="Client" collapsed={collapsed} />
          <SidebarMenuItem
            href={`${basePath}/wiki`}
            label="Notes"
            icon={NotebookPen}
            active={active === "wiki"}
            collapsed={collapsed}
          />
          <SidebarMenuItem
            href={`${basePath}/files`}
            label="Files"
            icon={FolderOpen}
            active={active === "files"}
            collapsed={collapsed}
          />
          <SectionHeader label="Insurance" collapsed={collapsed} />
          {INSURANCE_NAV_ITEMS.map((item) => (
            <SidebarMenuItem
              key={item.id}
              href={`${basePath}${item.href}`}
              label={item.label}
              icon={item.icon}
              active={active === item.id}
              collapsed={collapsed}
            />
          ))}

          <SectionHeader label="Settings" collapsed={collapsed} />
          <SidebarMenuItem
            href={`${basePath}?tab=team`}
            label="Team"
            icon={Users}
            active={active === "team"}
            collapsed={collapsed}
          />
          <SidebarMenuItem
            href={`${basePath}?tab=settings`}
            label="Settings"
            icon={Settings}
            active={active === "settings"}
            collapsed={collapsed}
          />
        </nav>

        <div className="flex shrink-0 justify-center border-t border-border px-2 py-2">
          <OperatorClientImpersonationAction
            clientOrgId={clientOrgId}
            activeImpersonation={activeImpersonation}
            beforeStart={beforeImpersonationStart}
            disabled={impersonationDisabled}
            collapsed={collapsed}
          />
        </div>
      </div>
    </SidebarTooltipProvider>
  );
}

/** Client workspace menu for the persistent shell, keyed by the routed client. */
export function OperatorClientShellSidebar({
  clientOrgId,
  collapsed,
  onToggleCollapse,
}: {
  clientOrgId: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const current = useCachedOperatorCurrent();
  const clients = useCachedOperatorClients();
  return (
    <OperatorClientSidebar
      collapsed={collapsed}
      onToggleCollapse={onToggleCollapse}
      clientOrgId={clientOrgId}
      activeImpersonation={current?.activeImpersonation}
      impersonationDisabled={
        !clients?.some((client) => client._id === clientOrgId)
      }
      beforeImpersonationStart={async () => beforeImpersonationStart?.()}
    />
  );
}
