"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { BrandIcon } from "@/components/ui/brand-icon";
import { typeStyle } from "@/lib/typography";

export function SidebarHeader({
  collapsed,
  headerOrgIcon,
  viewerImage,
  initials,
  headerOrgName,
  onToggleCollapse,
  backHref,
  icon,
}: {
  collapsed: boolean;
  headerOrgIcon?: string | null;
  viewerImage?: string | null;
  initials: string;
  headerOrgName: string;
  onToggleCollapse: () => void;
  backHref?: string;
  icon?: ReactNode;
}) {
  const iconContainerClass = icon
    ? "rounded-md bg-transparent text-foreground"
    : headerOrgIcon
      ? "rounded-md bg-transparent text-foreground"
    : "rounded-full bg-foreground/8 text-foreground";

  return (
    <div className="flex items-center gap-2 px-3 h-12 border-b border-border">
      {!collapsed && backHref ? (
        <Link
          href={backHref}
          className={`flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors flex-1 min-w-0 ${typeStyle("control.button")}`}
        >
          <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
          <span>Back</span>
        </Link>
      ) : null}

      {!collapsed && !backHref ? (
        <>
          <div
            className={`ml-0.5 flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden ${typeStyle("caption.medium")} ${iconContainerClass}`}
          >
            {headerOrgIcon ? (
              <BrandIcon
                src={headerOrgIcon}
                name={headerOrgName}
                size="md"
                className="h-full w-full rounded-[inherit]"
              />
            ) : viewerImage ? (
              <Image
                src={viewerImage}
                alt=""
                width={28}
                height={28}
                unoptimized
                className="w-7 h-7 rounded-full object-cover"
              />
            ) : icon ? (
              icon
            ) : (
              initials
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-foreground truncate ${typeStyle("body.medium")}`}>
              {headerOrgName}
            </p>
          </div>
        </>
      ) : null}

      <button
        type="button"
        onClick={onToggleCollapse}
        aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        title={collapsed ? "Expand navigation" : "Collapse navigation"}
        className="w-7 h-7 hidden lg:flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-foreground/4 transition-colors shrink-0"
      >
        {collapsed && icon ? (
          icon
        ) : collapsed ? (
          <ChevronRight className="w-3.5 h-3.5" />
        ) : (
          <ChevronLeft className="w-3.5 h-3.5" />
        )}
      </button>
    </div>
  );
}
