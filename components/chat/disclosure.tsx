"use client";

import { useId, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";

/** Shared activity disclosure; active turns stay expanded until completion. */
export function ChatDisclosure({
  summary,
  working = false,
  compact = false,
  className,
  summaryClassName,
  children,
}: {
  summary: ReactNode;
  working?: boolean;
  compact?: boolean;
  className?: string;
  summaryClassName?: string;
  children: ReactNode;
}) {
  const contentId = useId();
  const reduceMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const [wasWorking, setWasWorking] = useState(working);
  if (wasWorking !== working) {
    setWasWorking(working);
    setExpanded(false);
  }
  const open = working || expanded;

  return (
    <div className={cn("min-w-0", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        aria-disabled={working}
        onClick={() => {
          if (!working) setExpanded(!expanded);
        }}
        className={cn(
          "flex w-fit items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring",
          working ? "cursor-default" : "cursor-pointer",
          compact ? "gap-1 py-1" : "gap-2 py-2",
          typeStyle("caption.default"),
          summaryClassName,
        )}
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "shrink-0 transition-transform duration-200 motion-reduce:transition-none",
            open && "rotate-90",
            compact ? "size-3.5" : "size-4",
          )}
        />
        {summary}
      </button>
      <motion.div
        id={contentId}
        inert={!open}
        aria-hidden={!open}
        initial={false}
        animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.32, 0.72, 0, 1] }}
        className="overflow-hidden"
      >
        {children}
      </motion.div>
    </div>
  );
}
