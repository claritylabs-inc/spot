"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";

/** Native `<details>` with the chat chevron summary. */
export function ChatDisclosure({
  summary,
  compact = false,
  className,
  summaryClassName,
  children,
}: {
  summary: ReactNode;
  compact?: boolean;
  className?: string;
  summaryClassName?: string;
  children: ReactNode;
}) {
  return (
    <details className={cn("min-w-0 [&[open]>summary>svg]:rotate-90", className)}>
      <summary
        className={cn(
          "flex w-fit cursor-pointer list-none items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden",
          compact ? "gap-1 py-1" : "gap-2 py-2",
          typeStyle("caption.default"),
          summaryClassName,
        )}
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "shrink-0",
            compact ? "size-3.5" : "size-4",
          )}
        />
        {summary}
      </summary>
      {children}
    </details>
  );
}
