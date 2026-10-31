"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { AppSidebarHeader } from "@claritylabs-inc/ui/components/app-shell/app-sidebar";
import type { ReactNode } from "react";
import { BrandIcon } from "@claritylabs-inc/ui/components/brand-icon";
import { LogoIcon } from "@/components/ui/logo-icon";
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
  homeHref = "/",
}: {
  collapsed: boolean;
  headerOrgIcon?: string | null;
  viewerImage?: string | null;
  initials: string;
  headerOrgName: string;
  onToggleCollapse: () => void;
  backHref?: string;
  icon?: ReactNode;
  homeHref?: string;
}) {
  const iconContainerClass = icon
    ? "rounded-md bg-transparent text-foreground"
    : headerOrgIcon
      ? "rounded-md bg-transparent text-foreground"
      : "rounded-full bg-foreground/8 text-foreground";

  if (collapsed) {
    return (
      <>
        <div className="flex h-top-bar shrink-0 items-center justify-center border-b border-border">
          <Link
            href={homeHref}
            aria-label="Home"
            title="Home"
            className="flex h-7 w-7 items-center justify-center rounded-md text-foreground transition-colors hover:bg-foreground/4"
          >
            {icon ?? <LogoIcon size={15} />}
          </Link>
        </div>
        <div className="flex shrink-0 justify-center px-2 py-1.5">
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Expand navigation"
            title="Expand navigation"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-foreground/4 hover:text-foreground"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </>
    );
  }

  return (
    <AppSidebarHeader
      collapsed={collapsed}
      onToggleCollapse={onToggleCollapse}
      brand={
        <div className="flex min-w-0 items-center gap-2">
          {backHref ? (
            <Link
              href={backHref}
              className={`flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors flex-1 min-w-0 ${typeStyle("control.button")}`}
            >
              <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
              <span>Back</span>
            </Link>
          ) : null}

          {!backHref ? (
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
                <p
                  className={`text-foreground truncate ${typeStyle("body.medium")}`}
                >
                  {headerOrgName}
                </p>
              </div>
            </>
          ) : null}
        </div>
      }
    />
  );
}
