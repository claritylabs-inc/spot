"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppTopBar as SharedAppTopBar } from "@claritylabs-inc/ui/components/app-shell/app-top-bar";
import type { Ref } from "react";
import { typeStyle } from "@/lib/typography";
import { OperatorClientSwitcher } from "@/components/operator-client-switcher";
import { ChatAvatar } from "@/components/chat/chat-message";
import { cn } from "@/lib/utils";

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

function resolveAppBreadcrumb(pathname: string) {
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
  name: string;
  avatarUrl?: string | null;
}

/** Overlapping avatars of people active right now, each with a live dot. */
export function PresenceAvatars({
  users,
  max = 4,
  size = "md",
}: {
  users: PresenceUser[];
  max?: number;
  size?: "sm" | "md";
}) {
  if (users.length === 0) return null;
  const avatarSize = size === "sm" ? "size-5" : "size-6";
  return (
    <div className="flex shrink-0 items-center -space-x-1.5">
      {users.slice(0, max).map((u) => (
        <div key={u.userId} className="relative">
          <ChatAvatar
            name={u.name}
            title={u.name}
            imageUrl={u.avatarUrl}
            className={cn(avatarSize, "border-2 border-background")}
          />
          <span className="absolute -right-px -bottom-px size-2 rounded-full border border-background bg-emerald-400" />
        </div>
      ))}
      {users.length > max && (
        <div
          title={users
            .slice(max)
            .map((u) => u.name)
            .join(", ")}
          className={cn(
            avatarSize,
            "flex items-center justify-center rounded-full border-2 border-background bg-foreground/8 text-muted-foreground",
            typeStyle("caption.medium"),
          )}
        >
          +{users.length - max}
        </div>
      )}
    </div>
  );
}

export function AppTopBar({
  actions,
  breadcrumbDetail,
  onMobileMenuToggle,
  presence,
  mobileMenuRef,
  mobileMenuOpen,
}: {
  actions?: React.ReactNode;
  breadcrumbDetail?: React.ReactNode;
  onMobileMenuToggle?: () => void;
  /** Who else is here, shown before the page actions. */
  presence?: React.ReactNode;
  mobileMenuRef?: Ref<HTMLButtonElement>;
  mobileMenuOpen?: boolean;
}) {
  const pathname = usePathname();
  const { label, href } = resolveAppBreadcrumb(pathname);
  return (
    <SharedAppTopBar
      breadcrumb={label}
      breadcrumbHref={href}
      breadcrumbRender={<Link href={href} />}
      breadcrumbDetail={
        breadcrumbDetail && pathname.startsWith("/operator/clients/") ? (
          <span className="flex items-center gap-1.5">
            {breadcrumbDetail}
            <OperatorClientSwitcher />
          </span>
        ) : (
          breadcrumbDetail
        )
      }
      breadcrumbSeparator={<span className="text-muted-foreground/30">/</span>}
      breadcrumbListClassName={`gap-1.5 ${typeStyle("body.default")}`}
      onMobileMenuToggle={onMobileMenuToggle}
      mobileMenuRef={mobileMenuRef}
      mobileMenuOpen={mobileMenuOpen}
      actions={
        <>
          {presence}
          {actions}
        </>
      }
    />
  );
}
