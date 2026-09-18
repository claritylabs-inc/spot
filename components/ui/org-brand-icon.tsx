"use client";

import { BrandIcon } from "@/components/ui/brand-icon";

type OrgBrandIconProps = {
  name?: string | null;
  iconUrl?: string | null;
  website?: string | null;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
};

export function OrgBrandIcon({
  name,
  iconUrl,
  website,
  size = "sm",
  className,
}: OrgBrandIconProps) {
  return (
    <BrandIcon
      src={iconUrl || websiteFaviconUrl(website)}
      name={name}
      alt=""
      size={size}
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
