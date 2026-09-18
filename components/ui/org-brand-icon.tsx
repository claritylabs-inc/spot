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
  size = "sm",
  className,
}: OrgBrandIconProps) {
  return (
    <BrandIcon
      src={iconUrl}
      name={name}
      alt=""
      size={size}
      className={className}
    />
  );
}
