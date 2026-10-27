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

import { typeStyle } from "@/lib/typography";
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

const IconOnlyActionsContext = React.createContext(false);

/** Compacts secondary navbar actions while preserving primary action labels. */
function PillButtonIconOnlyProvider({
  enabled = true,
  children,
}: {
  enabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <IconOnlyActionsContext.Provider value={enabled}>
      {children}
    </IconOnlyActionsContext.Provider>
  );
}

/** Splits `[<Icon />, "Label"]` children into icon nodes and their text. */
function iconAndText(children: React.ReactNode) {
  const parts = React.Children.toArray(children);
  const text = parts
    .filter((part) => typeof part === "string" || typeof part === "number")
    .join("")
    .trim();
  const icons = parts.filter(
    (part) => typeof part !== "string" && typeof part !== "number",
  );
  return { text, icons };
}

function PillButton(props: PillButtonProps) {
  const {
    variant = "primary",
    size,
    iconOnly,
    expandLabel,
    label: labelProp,
    ...restProps
  } = props;
  const iconOnlyActions = React.useContext(IconOnlyActionsContext);
  const split =
    iconOnlyActions && !iconOnly && variant !== "icon" && variant !== "primary"
      ? iconAndText(restProps.children)
      : null;
  const autoIcon = Boolean(split?.text && split.icons.length);
  const label = autoIcon ? (labelProp ?? split!.text) : labelProp;
  const rest = autoIcon ? { ...restProps, children: split!.icons } : restProps;
  const resolvedVariant =
    variant === "icon" || variant === "iconLabel" ? "ghost" : variant;
  const resolvedSize = size === "small" ? "xs" : size;
  const inheritedSize = usePillButtonSize();
  const typography = typeStyle(
    (resolvedSize ?? inheritedSize) === "large"
      ? "control.button"
      : "control.buttonCompact",
  )
    .split(" ")
    .map((token) => `${token}!`)
    .join(" ");
  // `expandLabel` used to grow the pill on hover, which shifted neighbouring
  // controls. Render those as icon-only pills with a tooltip instead.
  const withTooltip =
    autoIcon ||
    (!iconOnly &&
      (variant === "icon" || variant === "secondary") &&
      expandLabel &&
      Boolean(label));
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
    className: `${rest.className ?? ""} ${typography}`,
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
  PillButtonIconOnlyProvider,
  PillButtonSizeProvider,
  usePillButtonSize,
  type PillButtonProps,
  type LegacyVariant as PillButtonVariant,
  type LegacySize as PillButtonSize,
};
