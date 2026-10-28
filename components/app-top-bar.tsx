"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppTopBar as SharedAppTopBar } from "@claritylabs-inc/ui/components/app-shell/app-top-bar";
import type { Ref } from "react";
import { typeStyle } from "@/lib/typography";
import { OperatorClientSwitcher } from "@/components/operator-client-switcher";
import { Avatar } from "@claritylabs-inc/ui/components/avatar";
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
  "/operator/procurement": { label: "Procurement" },
  "/operator/brokers": { label: "Insurance providers" },
  "/operator/channels": { label: "Channels" },
  "/operator/audit": { label: "Audit log" },
  "/operator/team": { label: "Team" },
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
  name: string;
  avatarUrl?: string | null;
  /** The person's multiplayer color for their ring; live green otherwise. */
  color?: string;
}

/** Overlapping avatars of people active right now, each ringed as live. */
export function PresenceAvatars({
  users,
  max = 4,
  size = "md",
  selectedUserId,
  onSelect,
  selectLabel,
}: {
  users: PresenceUser[];
  max?: number;
  size?: "sm" | "md";
  /** Ringed in the brand color, for example the person being followed. */
  selectedUserId?: string | null;
  /** Makes each avatar a button. */
  onSelect?: (user: PresenceUser) => void;
  /** Button tooltip, such as "Follow Ada". */
  selectLabel?: (user: PresenceUser) => string;
}) {
  if (users.length === 0) return null;
  const avatarSize = size === "sm" ? "size-5" : "size-7";
  return (
    <div className="flex shrink-0 items-center -space-x-1">
      {users.slice(0, max).map((u) => {
        const selected = u.userId === selectedUserId;
        const avatar = (
          // The ring sits on a wrapper: Avatar keeps its own inline style.
          <span
            className={cn(
              "block rounded-full",
              size === "sm" ? "ring-[1.5px]" : "ring-2",
              u.color ? null : selected ? "ring-brand" : "ring-emerald-400",
            )}
            style={
              u.color
                ? ({ "--tw-ring-color": u.color } as React.CSSProperties)
                : undefined
            }
          >
            <Avatar
              name={u.name}
              title={onSelect ? undefined : u.name}
              imageUrl={u.avatarUrl}
              className={cn(avatarSize, "border-2 border-background")}
            />
          </span>
        );
        return onSelect ? (
          <button
            key={u.userId}
            type="button"
            title={selectLabel?.(u) ?? u.name}
            aria-pressed={selected}
            onClick={() => onSelect(u)}
            className="relative rounded-full transition-transform hover:z-10 hover:-translate-y-px focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {avatar}
          </button>
        ) : (
          <div key={u.userId} className="relative">
            {avatar}
          </div>
        );
      })}
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
  tabs,
}: {
  /** Page-owned tabs (or the portal target for them), right of the breadcrumb. */
  tabs?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbDetail?: React.ReactNode;
  onMobileMenuToggle?: () => void;
  /** Who else is here, shown before the page actions. */
  presence?: React.ReactNode;
  mobileMenuRef?: Ref<HTMLButtonElement>;
  mobileMenuOpen?: boolean;
}) {
  const pathname = usePathname();
  const resolved = resolveAppBreadcrumb(pathname);
  // Previous/next client belongs to a client record, not the list.
  const clientRecord = /^\/operator\/clients\/[^/]+/.test(pathname);
  // Deep client records (a request, a policy) lead with the client name from
  // their own detail; a "Clients" root would crowd it out.
  const { label, href } =
    breadcrumbDetail && /^\/operator\/clients\/[^/]+\/[^/]+\/[^/]+/.test(pathname)
      ? { label: null, href: resolved.href }
      : resolved;
  return (
    <SharedAppTopBar
      breadcrumb={label}
      breadcrumbHref={href}
      breadcrumbRender={<Link href={href} />}
      navigation={clientRecord ? <OperatorClientSwitcher /> : undefined}
      breadcrumbDetail={breadcrumbDetail}
      breadcrumbSeparator={<span className="text-muted-foreground/30">/</span>}
      breadcrumbListClassName={`gap-1.5 ${typeStyle("body.default")}`}
      onMobileMenuToggle={onMobileMenuToggle}
      mobileMenuRef={mobileMenuRef}
      mobileMenuOpen={mobileMenuOpen}
      tabs={tabs}
      actions={
        <>
          {presence}
          {actions}
        </>
      }
    />
  );
}
