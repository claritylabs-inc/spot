"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppTopBar as SharedAppTopBar } from "@claritylabs-inc/ui/components/app-shell/app-top-bar";
import type { Ref } from "react";
import { typeStyle } from "@/lib/typography";

const BREADCRUMB_MAP: Record<string, { label: string; href?: string }> = {
  "/": { label: "Dashboard" },
  "/policies": { label: "Policies" },
  "/requests": { label: "Requests" },
  "/files": { label: "Files" },
  "/broker": { label: "Profile" },
  "/broker/team": { label: "Team" },
  "/connect": { label: "Connect" },
  "/connect/clients": { label: "Clients", href: "/connect/clients" },
  "/connect/vendors": { label: "Vendors", href: "/connect/vendors" },
  "/compliance": { label: "Compliance" },
  "/certificates": { label: "Certificates" },
  "/settings": { label: "Settings" },
  "/profile": { label: "Profile" },
  "/operator/clients": { label: "Clients", href: "/operator/clients" },
  "/operator/brokers": { label: "Insurance providers" },
  "/operator/channels": { label: "Channels" },
  "/operator/logs": { label: "Logs" },
  "/operator/usage": { label: "Usage" },
  "/operator/profile": { label: "Profile" },
  "/operator/settings": { label: "Settings" },
};

export function resolveAppBreadcrumb(pathname: string) {
  const normalizedPathname =
    pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

  let matchedPath = normalizedPathname;
  let crumb = BREADCRUMB_MAP[normalizedPathname];
  if (!crumb) {
    const segments = normalizedPathname.split("/").filter(Boolean);
    for (let i = segments.length - 1; i >= 1; i--) {
      const candidate = "/" + segments.slice(0, i).join("/");
      if (BREADCRUMB_MAP[candidate]) {
        matchedPath = candidate;
        crumb = BREADCRUMB_MAP[candidate];
        break;
      }
    }
  }

  // An unmapped route has no parent to link back to, so the page renders its
  // own detail alone rather than a placeholder crumb.
  return crumb
    ? { label: crumb.label, href: crumb.href ?? matchedPath }
    : { label: null, href: matchedPath };
}

export interface PresenceUser {
  userId: string;
  userName?: string;
  lastSeen: number;
}

export function PresenceAvatars({ users }: { users: PresenceUser[] }) {
  if (users.length === 0) return null;

  function getInitials(name?: string) {
    if (!name) return "?";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }

  return (
    <div className="flex items-center -space-x-1.5">
      {users.slice(0, 4).map((u) => (
        <div
          key={u.userId}
          title={u.userName}
          className={`relative w-6 h-6 rounded-full bg-foreground/8 border-2 border-background flex items-center justify-center text-foreground ${typeStyle("caption.medium")}`}
        >
          {getInitials(u.userName)}
          <span className="absolute -bottom-px -right-px w-2 h-2 rounded-full bg-emerald-400 border border-background" />
        </div>
      ))}
      {users.length > 4 && (
        <div
          className={`w-6 h-6 rounded-full bg-foreground/8 border-2 border-background flex items-center justify-center text-muted-foreground ${typeStyle("caption.medium")}`}
        >
          +{users.length - 4}
        </div>
      )}
    </div>
  );
}

export function AppTopBar({
  actions,
  breadcrumbDetail,
  onMobileMenuToggle,
  presenceUsers,
  mobileMenuRef,
  mobileMenuOpen,
}: {
  actions?: React.ReactNode;
  breadcrumbDetail?: React.ReactNode;
  onMobileMenuToggle?: () => void;
  presenceUsers?: PresenceUser[];
  mobileMenuRef?: Ref<HTMLButtonElement>;
  mobileMenuOpen?: boolean;
}) {
  const pathname = usePathname();
  const { label, href } = resolveAppBreadcrumb(pathname);
  return (
    <SharedAppTopBar
      className="pr-3 lg:pr-3"
      breadcrumb={label}
      breadcrumbHref={href}
      breadcrumbRender={<Link href={href} />}
      breadcrumbDetail={breadcrumbDetail}
      breadcrumbSeparator={<span className="text-muted-foreground/30">/</span>}
      breadcrumbListClassName={`gap-1.5 ${typeStyle("body.default")}`}
      onMobileMenuToggle={onMobileMenuToggle}
      mobileMenuRef={mobileMenuRef}
      mobileMenuOpen={mobileMenuOpen}
      actions={
        <>
          {presenceUsers && presenceUsers.length > 0 ? (
            <>
              <PresenceAvatars users={presenceUsers} />
              <div className="w-px h-4 bg-foreground/10" />
            </>
          ) : null}
          {actions}
        </>
      }
    />
  );
}
