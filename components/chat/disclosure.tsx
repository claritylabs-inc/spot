"use client";

import { useId, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * Open state shared by activity disclosures. While `working` it is forced
 * open. When work finishes in this session it stays open (unless `stayOpen`
 * is false) so the trace does not vanish; the user can then collapse it.
 * Disclosures that mount idle start collapsed.
 */
export function useActivityDisclosure(working: boolean, stayOpen = true) {
  const [expanded, setExpanded] = useState(false);
  const [wasWorking, setWasWorking] = useState(working);
  if (wasWorking !== working) {
    setWasWorking(working);
    if (!working) setExpanded(stayOpen);
  }
  return {
    open: working || expanded,
    toggle: () => {
      if (!working) setExpanded(!expanded);
    },
  };
}

/** Shared activity disclosure; open state follows `useActivityDisclosure`. */
export function ChatDisclosure({
  summary,
  working = false,
  compact = false,
  trailingCaret = false,
  collapseWhenDone = false,
  className,
  summaryClassName,
  children,
}: {
  summary: ReactNode;
  working?: boolean;
  compact?: boolean;
  /** Caret after the summary instead of before it. */
  trailingCaret?: boolean;
  /** Collapse once work finishes instead of staying open. */
  collapseWhenDone?: boolean;
  className?: string;
  summaryClassName?: string;
  children: ReactNode;
}) {
  const contentId = useId();
  const { open, toggle } = useActivityDisclosure(
    working,
    !collapseWhenDone,
  );
  const caret = (
    <ChevronRight
      aria-hidden
      className={cn(
        "shrink-0 transition-transform duration-200 motion-reduce:transition-none",
        open && "rotate-90",
        compact ? "size-3.5" : "size-4",
      )}
    />
  );

  return (
    <div className={cn("min-w-0", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        aria-disabled={working}
        onClick={toggle}
        className={cn(
          "flex w-fit items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring",
          working ? "cursor-default" : "cursor-pointer",
          compact ? "gap-1 py-1" : "gap-2 py-2",
          typeStyle("caption.default"),
          summaryClassName,
        )}
      >
        {trailingCaret ? null : caret}
        {summary}
        {trailingCaret ? caret : null}
      </button>
      <DisclosurePanel id={contentId} open={open}>
        {children}
      </DisclosurePanel>
    </div>
  );
}

/** Animated height/opacity panel controlled by a disclosure trigger. */
export function DisclosurePanel({
  id,
  open,
  children,
}: {
  id: string;
  open: boolean;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      id={id}
      inert={!open}
      aria-hidden={!open}
      initial={false}
      animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.32, 0.72, 0, 1] }}
      // Positioned so absolute descendants (e.g. sr-only text) stay clipped
      // instead of extending the transcript's scroll height while collapsed.
      className="relative overflow-hidden"
    >
      {children}
    </motion.div>
  );
}
