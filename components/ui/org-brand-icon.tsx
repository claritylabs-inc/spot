"use client";

import { cn } from "@/lib/utils";
import { Avatar } from "@claritylabs-inc/ui/components/avatar";
import { BrandIcon } from "@claritylabs-inc/ui/components/brand-icon";

type OrgBrandIconProps = {
  name?: string | null;
  iconUrl?: string | null;
  website?: string | null;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  /** `circle` crops round and insets marks the crop would clip. */
  shape?: "rounded" | "circle";
  className?: string;
};

const AVATAR_SIZE = {
  xs: "size-3.5",
  sm: "size-6",
  md: "size-7",
  lg: "size-8",
  xl: "size-16",
} as const;

export function OrgBrandIcon({
  name,
  iconUrl,
  website,
  size = "sm",
  shape,
  className,
}: OrgBrandIconProps) {
  const src = iconUrl || websiteFaviconUrl(website);
  if (!src && name?.trim())
    return (
      <Avatar
        name={name}
        className={cn(
          AVATAR_SIZE[size],
          shape !== "circle" && "rounded-md",
          className,
        )}
      />
    );
  return (
    <BrandIcon
      src={src}
      name={name}
      alt=""
      size={size}
      shape={shape}
      className={className}
    />
  );
}

function websiteFaviconUrl(website?: string | null) {
  const value = website?.trim();
  if (!value) return undefined;

  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return `/api/favicon?domain=${encodeURIComponent(url.hostname)}`;
  } catch {
    return undefined;
  }
}
