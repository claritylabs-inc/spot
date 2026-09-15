"use client";

import {
  createContext,
  forwardRef,
  useContext,
  type MouseEvent,
  type Ref,
  type ReactNode,
} from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { typeStyle } from "@/lib/typography";

type PillButtonVariant =
  | "primary"
  | "secondary"
  | "destructive"
  | "ghost"
  | "icon"
  | "iconLabel";
type PillButtonSize = "default" | "compact" | "large";

type PillButtonContentProps =
  | {
      iconOnly: true;
      expandLabel?: false;
      label: string;
      children?: ReactNode;
    }
  | {
      iconOnly?: false;
      expandLabel: true;
      label: string;
      children?: ReactNode;
    }
  | {
      iconOnly?: false;
      expandLabel?: false;
      label?: string;
      children?: ReactNode;
    };

type CommonPillButtonProps = PillButtonContentProps & {
  variant?: PillButtonVariant;
  size?: PillButtonSize;
  roomyOnMobile?: boolean;
};

type PillButtonButtonProps = CommonPillButtonProps &
  Omit<HTMLMotionProps<"button">, "children" | "ref" | "type"> & {
    href?: never;
    type?: "button" | "submit" | "reset";
  };

type PillButtonAnchorProps = CommonPillButtonProps &
  Omit<HTMLMotionProps<"a">, "children" | "ref"> & {
    href: string;
    disabled?: boolean;
  };

type PillButtonProps = PillButtonButtonProps | PillButtonAnchorProps;

const PillButtonSizeContext = createContext<PillButtonSize | undefined>(
  undefined,
);

function PillButtonSizeProvider({
  children,
  size,
}: {
  children: ReactNode;
  size: PillButtonSize;
}) {
  return (
    <PillButtonSizeContext.Provider value={size}>
      {children}
    </PillButtonSizeContext.Provider>
  );
}

const MOTION_TRANSITION = {
  duration: 0.08,
  ease: [0.2, 0, 0, 1] as const,
};

const MotionLink = motion.create(Link);

function isInternalAppHref(href: string) {
  return href.startsWith("/") && !href.startsWith("//");
}

type VariantConfig = {
  classes: string;
  hover?: HTMLMotionProps<"button">["whileHover"];
  tap?: HTMLMotionProps<"button">["whileTap"];
};

const variantConfig: Record<PillButtonVariant, VariantConfig> = {
  primary: {
    classes:
      "[--pill-primary-bg:var(--brand,#000000)] [--pill-primary-fg:var(--brand-foreground,#ffffff)] dark:[--pill-primary-bg:var(--foreground)] dark:[--pill-primary-fg:var(--background)] !bg-[var(--pill-primary-bg)] ![color:var(--pill-primary-fg)] hover:!bg-[color-mix(in_srgb,var(--pill-primary-bg)_86%,var(--background))] hover:ring-1 hover:ring-border-emphasized active:!bg-[color-mix(in_srgb,var(--pill-primary-bg)_76%,var(--background))]",
    tap: { scale: 0.98 },
  },
  secondary: {
    classes:
      "border border-input bg-transparent text-muted-foreground hover:border-border-hover hover:bg-foreground/[0.03] hover:text-foreground",
    tap: { opacity: 0.78 },
  },
  destructive: {
    classes:
      "bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive focus-visible:ring-destructive/20",
    tap: { opacity: 0.78 },
  },
  ghost: {
    classes:
      "bg-transparent text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
    tap: { opacity: 0.78 },
  },
  icon: {
    classes:
      "bg-transparent text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
    tap: { opacity: 0.78 },
  },
  iconLabel: {
    classes:
      "bg-transparent text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
    tap: { opacity: 0.78 },
  },
};

const sizeClasses: Record<PillButtonSize, string> = {
  default: `h-8 px-5 gap-2 ${typeStyle("control.buttonCompact")}`,
  compact: `h-7 px-3 gap-1.5 ${typeStyle("control.buttonCompact")}`,
  large: `h-12 px-5 gap-2 ${typeStyle("control.button")}`,
};

const iconSizeClasses: Record<PillButtonSize, string> = {
  default: "h-8 w-8 p-0",
  compact: "h-7 w-7 p-0",
  large: "h-12 w-12 p-0",
};

const expandableIconSizeClasses: Record<PillButtonSize, string> = {
  default:
    "h-8 min-w-8 overflow-hidden px-2 focus-visible:px-5 focus-visible:duration-[280ms] [@media(hover:hover)_and_(pointer:fine)]:hover:px-5 [@media(hover:hover)_and_(pointer:fine)]:hover:duration-[280ms]",
  compact:
    "h-7 min-w-7 overflow-hidden px-[7px] focus-visible:px-3 focus-visible:duration-[280ms] [@media(hover:hover)_and_(pointer:fine)]:hover:px-3 [@media(hover:hover)_and_(pointer:fine)]:hover:duration-[280ms]",
  large:
    "h-12 min-w-12 overflow-hidden px-4 focus-visible:px-5 focus-visible:duration-[280ms] [@media(hover:hover)_and_(pointer:fine)]:hover:px-5 [@media(hover:hover)_and_(pointer:fine)]:hover:duration-[280ms]",
};

const expandingLabelClasses =
  "min-w-0 -translate-x-0.5 overflow-hidden whitespace-nowrap opacity-0 transition-[opacity,transform] duration-[180ms] [transition-timing-function:cubic-bezier(0.33,1,0.68,1)] group-focus-visible/pill:translate-x-0 group-focus-visible/pill:opacity-100 group-focus-visible/pill:duration-[280ms] motion-reduce:transition-none [@media(hover:hover)_and_(pointer:fine)]:group-hover/pill:translate-x-0 [@media(hover:hover)_and_(pointer:fine)]:group-hover/pill:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:group-hover/pill:duration-[280ms]";

const PillButton = forwardRef<
  HTMLButtonElement | HTMLAnchorElement,
  PillButtonProps
>(
  (
    {
      variant = "primary",
      size: requestedSize,
      roomyOnMobile = false,
      iconOnly = false,
      expandLabel = false,
      label,
      className,
      children,
      "aria-label": ariaLabel,
      title,
      ...props
    },
    ref,
  ) => {
    const inheritedSize = useContext(PillButtonSizeContext);
    const size = inheritedSize ?? requestedSize ?? "default";
    const isIcon = iconOnly || variant === "icon";
    const isExpandableIcon =
      !iconOnly &&
      (variant === "icon" || variant === "secondary") &&
      expandLabel &&
      Boolean(label);
    const showsLabel =
      !iconOnly &&
      Boolean(label) &&
      (isExpandableIcon || variant === "iconLabel");
    const config = variantConfig[variant];
    const disabled = "disabled" in props && Boolean(props.disabled);
    const renderedLabel = showsLabel ? (
      <span
        data-pill-expand-label={isExpandableIcon || undefined}
        className={isExpandableIcon ? expandingLabelClasses : undefined}
      >
        {label}
      </span>
    ) : null;
    const content = isExpandableIcon ? (
      <span className="grid min-w-0 grid-cols-[auto_minmax(0,0fr)] items-center gap-0 transition-[grid-template-columns,gap] duration-[180ms] [transition-timing-function:cubic-bezier(0.33,1,0.68,1)] group-focus-visible/pill:grid-cols-[auto_minmax(0,1fr)] group-focus-visible/pill:gap-1.5 group-focus-visible/pill:duration-[280ms] motion-reduce:transition-none [@media(hover:hover)_and_(pointer:fine)]:group-hover/pill:grid-cols-[auto_minmax(0,1fr)] [@media(hover:hover)_and_(pointer:fine)]:group-hover/pill:gap-1.5 [@media(hover:hover)_and_(pointer:fine)]:group-hover/pill:duration-[280ms]">
        {children}
        {renderedLabel}
      </span>
    ) : (
      <>
        {children}
        {renderedLabel}
      </>
    );
    const classes = cn(
      "inline-flex shrink-0 items-center justify-center rounded-full outline-none duration-150 ease-out select-none focus-visible:ring-2 focus-visible:ring-border-emphasized disabled:opacity-50 disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:cursor-not-allowed [&_svg]:shrink-0 [&_svg]:text-current",
      isExpandableIcon
        ? `group/pill transition-[padding,background-color,border-color,color,opacity] duration-[180ms] [transition-timing-function:cubic-bezier(0.33,1,0.68,1)] motion-reduce:transition-colors ${typeStyle(size === "large" ? "control.button" : "control.buttonCompact")}`
        : "transition-colors",
      config.classes,
      isExpandableIcon
        ? expandableIconSizeClasses[size]
        : isIcon
          ? iconSizeClasses[size]
          : sizeClasses[size],
      roomyOnMobile && !inheritedSize &&
        (isIcon ? "max-sm:h-9 max-sm:w-9" : "max-sm:h-9 max-sm:px-4"),
      className,
    );

    if ("href" in props && props.href) {
      const {
        disabled: _disabled,
        href,
        onClick,
        tabIndex,
        ...anchorProps
      } = props;
      const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (disabled) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      };
      const sharedAnchorProps = {
        "aria-disabled": disabled || undefined,
        "aria-label": ariaLabel ?? label,
        "data-icon-only": isIcon || undefined,
        "data-expand-label": isExpandableIcon || undefined,
        className: classes,
        onClick: handleClick,
        tabIndex: disabled ? -1 : tabIndex,
        title: title ?? (isIcon && !isExpandableIcon ? label : undefined),
        transition: MOTION_TRANSITION,
        whileHover: disabled ? undefined : config.hover,
        whileTap: disabled ? undefined : config.tap,
      };
      const useClientRouter =
        isInternalAppHref(href) && anchorProps.download === undefined;

      if (useClientRouter) {
        return (
          <MotionLink
            ref={ref as Ref<HTMLAnchorElement>}
            href={href}
            prefetch
            {...sharedAnchorProps}
            {...anchorProps}
          >
            {content}
          </MotionLink>
        );
      }

      return (
        <motion.a
          ref={ref as Ref<HTMLAnchorElement>}
          href={href}
          {...sharedAnchorProps}
          {...anchorProps}
        >
          {content}
        </motion.a>
      );
    }

    const { type = "button", ...buttonProps } = props as PillButtonButtonProps;

    return (
      <motion.button
        ref={ref as Ref<HTMLButtonElement>}
        type={type}
        aria-label={ariaLabel ?? label}
        data-icon-only={isIcon || undefined}
        data-expand-label={isExpandableIcon || undefined}
        title={title ?? (isIcon && !isExpandableIcon ? label : undefined)}
        whileHover={disabled ? undefined : config.hover}
        whileTap={disabled ? undefined : config.tap}
        transition={MOTION_TRANSITION}
        className={classes}
        {...buttonProps}
      >
        {content}
      </motion.button>
    );
  },
);

PillButton.displayName = "PillButton";

export {
  PillButton,
  PillButtonSizeProvider,
  type PillButtonProps,
  type PillButtonVariant,
  type PillButtonSize,
};
