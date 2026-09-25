"use client";

import { useState, type ReactNode } from "react";
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useReducedMotion,
  type Variants,
} from "framer-motion";

const EASE = [0.2, 0, 0, 1] as const;

const slide: Variants = {
  enter: (direction: number) =>
    direction > 0
      ? { x: "100%", opacity: 1, zIndex: 2 }
      : direction < 0
        ? { x: "-24%", opacity: 0.5, zIndex: 0 }
        : { x: 0, opacity: 0, zIndex: 1 },
  center: { x: 0, opacity: 1, zIndex: 1 },
  exit: (direction: number) =>
    direction > 0
      ? { x: "-24%", opacity: 0.5, zIndex: 0 }
      : direction < 0
        ? { x: "100%", opacity: 1, zIndex: 2 }
        : { x: 0, opacity: 0, zIndex: 0 },
};

const fade: Variants = {
  enter: { opacity: 0 },
  center: { opacity: 1 },
  exit: { opacity: 0 },
};

/**
 * Nested menus (a client workspace, settings) slide in from the right over
 * their parent and slide back out when leaving. The container keeps its width,
 * and each menu gets its own shared-layout group for the active indicator.
 */
export function SidebarVariantTransition({
  variantKey,
  depth,
  layoutGroupId,
  children,
}: {
  variantKey: string;
  depth: number;
  layoutGroupId: string;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const [previous, setPrevious] = useState({ variantKey, depth, direction: 0 });
  if (previous.variantKey !== variantKey) {
    setPrevious({
      variantKey,
      depth,
      direction: Math.sign(depth - previous.depth),
    });
  }

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden">
      <AnimatePresence initial={false} custom={previous.direction}>
        <motion.div
          key={variantKey}
          custom={previous.direction}
          variants={reduceMotion ? fade : slide}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{
            x: { type: "spring", stiffness: 520, damping: 46, mass: 0.9 },
            opacity: { duration: 0.16, ease: EASE },
          }}
          className="absolute inset-0 flex flex-col overflow-hidden bg-background will-change-transform"
        >
          <LayoutGroup id={`${layoutGroupId}:${variantKey}`}>
            {children}
          </LayoutGroup>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
