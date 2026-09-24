"use client";

import * as React from "react";
import Link from "next/link";
import {
  PillButton as BasePillButton,
  PillButtonSizeProvider,
  usePillButtonSize,
} from "@claritylabs-inc/ui/components/brand/pill-button";

import { isInternalAppHref } from "@/lib/internal-link";
import { cn } from "@/lib/utils";
import { typeStyle } from "@/lib/typography";

// Preserve Spot navigation, legacy variants, and dimensions around the shared renderer.
type LegacyVariant =
  | "primary"
  | "secondary"
  | "destructive"
  | "ghost"
  | "icon"
  | "iconLabel";
type LegacySize = "xs" | "small" | "compact" | "default" | "large";

type AdaptLegacyProps<T> = T extends unknown
  ? Omit<T, "variant" | "size"> & { variant?: LegacyVariant; size?: LegacySize }
  : never;
type PillButtonProps = AdaptLegacyProps<
  React.ComponentProps<typeof BasePillButton>
>;

function PillButton(props: PillButtonProps) {
  const {
    variant = "primary",
    size,
    iconOnly,
    expandLabel,
    label,
    className,
    ...rest
  } = props;
  const resolvedVariant =
    variant === "icon" || variant === "iconLabel" ? "ghost" : variant;
  const resolvedSize = size === "small" ? "xs" : size;
  const inheritedSize = usePillButtonSize();
  const effectiveSize = inheritedSize ?? resolvedSize ?? "default";
  const expandable =
    !iconOnly &&
    (variant === "icon" || variant === "secondary") &&
    expandLabel &&
    Boolean(label);
  const icon = Boolean(iconOnly || variant === "icon");
  const content = expandable
    ? {
        expandLabel: true as const,
        iconOnly: false as const,
        label: label ?? "",
      }
    : icon
      ? {
          iconOnly: true as const,
          expandLabel: false as const,
          label: label ?? "",
        }
      : {
          iconOnly: false as const,
          expandLabel: false as const,
          label: variant === "iconLabel" ? label : undefined,
        };
  const dimensions = expandable
    ? {
        xs: "h-6 min-w-8 px-2 focus-visible:px-3 [@media(hover:hover)_and_(pointer:fine)]:hover:px-3",
        compact:
          "h-7 min-w-10 px-3 focus-visible:px-4 [@media(hover:hover)_and_(pointer:fine)]:hover:px-4",
        default: "h-8 min-w-8 px-2",
        large:
          "h-12 min-w-12 px-4 focus-visible:px-5 [@media(hover:hover)_and_(pointer:fine)]:hover:px-5",
      }[effectiveSize]
    : icon
      ? {
          xs: "h-6 w-8 p-0",
          compact: "h-7 w-10 p-0",
          default: "size-8 p-0",
          large: "size-12 p-0",
        }[effectiveSize]
      : {
          xs: "h-6 px-2",
          compact: "h-7 px-4",
          default: "h-8 px-5",
          large: "h-12 px-5",
        }[effectiveSize];
  const shared = {
    ...content,
    variant: resolvedVariant,
    size: resolvedSize,
    "aria-label": props["aria-label"] ?? label,
    className: cn(
      typeStyle(
        effectiveSize === "large" ? "control.button" : "control.buttonCompact",
      ),
      dimensions,
      "active:translate-y-0 focus-visible:ring-2 focus-visible:ring-border-emphasized",
      variant !== "secondary" && "border-0",
      variant === "primary" &&
        "!bg-brand !text-brand-foreground hover:!bg-[color-mix(in_srgb,var(--brand)_86%,var(--background))] active:!bg-[color-mix(in_srgb,var(--brand)_76%,var(--background))]",
      variant === "secondary" &&
        "hover:border-border-hover hover:!bg-foreground/[0.03] hover:!text-foreground",
      resolvedVariant === "ghost" &&
        "hover:!bg-foreground/[0.04] hover:!text-foreground",
      variant === "destructive" &&
        "hover:!bg-destructive/15 hover:!text-destructive focus-visible:ring-destructive/20",
      props.roomyOnMobile &&
        !inheritedSize &&
        (icon ? "max-sm:size-9" : "max-sm:h-9 max-sm:px-4"),
      className,
    ),
  };
  if (rest.href !== undefined) {
    const render =
      rest.render ??
      (isInternalAppHref(rest.href) && rest.download === undefined ? (
        <Link href={rest.href} prefetch />
      ) : undefined);
    return <BasePillButton {...rest} {...shared} render={render} />;
  }
  return <BasePillButton {...rest} {...shared} />;
}

export {
  PillButton,
  PillButtonSizeProvider,
  usePillButtonSize,
  type PillButtonProps,
  type LegacyVariant as PillButtonVariant,
  type LegacySize as PillButtonSize,
};
