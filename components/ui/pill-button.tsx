"use client";

import * as React from "react";
import Link from "next/link";
import {
  PillButton as BasePillButton,
  PillButtonSizeProvider,
  usePillButtonSize,
} from "@claritylabs-inc/ui/components/brand/pill-button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@claritylabs-inc/ui/components/tooltip";

import { isInternalAppHref } from "@/lib/internal-link";

// Keep Next navigation and legacy prop names at the consumer boundary.
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
    ...rest
  } = props;
  const resolvedVariant =
    variant === "icon" || variant === "iconLabel" ? "ghost" : variant;
  const resolvedSize = size === "small" ? "xs" : size;
  // `expandLabel` used to grow the pill on hover, which shifted neighbouring
  // controls. Render those as icon-only pills with a tooltip instead.
  const withTooltip =
    !iconOnly &&
    (variant === "icon" || variant === "secondary") &&
    expandLabel &&
    Boolean(label);
  const icon = Boolean(iconOnly || variant === "icon" || withTooltip);
  const content = icon
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
  const shared = {
    ...content,
    variant: resolvedVariant,
    size: resolvedSize,
    "aria-label": props["aria-label"] ?? label,
    preset: "spot" as const,
    ...(withTooltip ? { title: rest.title ?? "" } : {}),
  };
  let button: React.ReactElement;
  if (rest.href !== undefined) {
    const render =
      rest.render ??
      (isInternalAppHref(rest.href) && rest.download === undefined ? (
        <Link href={rest.href} prefetch />
      ) : undefined);
    button = <BasePillButton {...rest} {...shared} render={render} />;
  } else {
    button = <BasePillButton {...rest} {...shared} />;
  }
  if (!withTooltip) return button;
  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export {
  PillButton,
  PillButtonSizeProvider,
  usePillButtonSize,
  type PillButtonProps,
  type LegacyVariant as PillButtonVariant,
  type LegacySize as PillButtonSize,
};
