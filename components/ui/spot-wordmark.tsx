import type { CSSProperties } from "react";
import { LogoIcon } from "@/components/ui/logo-icon";
import { SPOT_WORDMARK } from "@/lib/spot-wordmark";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";

export function SpotWordmark({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center text-foreground",
        typeStyle("brand.wordmark"),
        className,
      )}
      style={{ display: "inline-flex", alignItems: "center", ...style }}
    >
      <svg
        width={`${SPOT_WORDMARK.width / SPOT_WORDMARK.height}em`}
        height="1em"
        viewBox={`0 0 ${SPOT_WORDMARK.width} ${SPOT_WORDMARK.height}`}
        fill="none"
        role="img"
        aria-label="Spot"
        className="shrink-0"
      >
        <LogoIcon size={SPOT_WORDMARK.height} />
        <path d={SPOT_WORDMARK.path} fill="currentColor" />
      </svg>
    </span>
  );
}
