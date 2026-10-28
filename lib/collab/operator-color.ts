"use client";

import { useMemo } from "react";
import { useActiveOperators } from "@/hooks/use-operator-presence";

/**
 * Each operator's multiplayer color: their pointer, caret, avatar ring and
 * follow pill. Eight well-separated mid-tone hues that hold white text and
 * read on light and dark backgrounds.
 */
const OPERATOR_COLORS = [
  "#2563eb", // blue
  "#db2777", // pink
  "#16a34a", // green
  "#ea580c", // orange
  "#9333ea", // purple
  "#0891b2", // cyan
  "#dc2626", // red
  "#a16207", // ochre
] as const;

/** FNV-1a: an id's preferred color, spread evenly across the palette. */
function preferredIndex(userId: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < userId.length; index++) {
    hash ^= userId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % OPERATOR_COLORS.length;
}

/**
 * Colors for everyone active, distinct until there are more people than
 * colors: in id order, each takes its preferred color or the next free one.
 * Every browser sees the same active operators, so all agree.
 */
export function assignOperatorColors(userIds: string[]) {
  const colors = new Map<string, string>();
  const taken = new Set<number>();
  for (const userId of [...new Set(userIds)].sort()) {
    let index = preferredIndex(userId);
    for (
      let step = 0;
      step < OPERATOR_COLORS.length && taken.has(index);
      step++
    ) {
      index = (index + 1) % OPERATOR_COLORS.length;
    }
    taken.add(index);
    colors.set(userId, OPERATOR_COLORS[index]);
    if (taken.size === OPERATOR_COLORS.length) taken.clear();
  }
  return colors;
}

/**
 * An operator's color among everyone active now. Every caller reads the same
 * active-operator query, so the dock, pointers and chat header agree.
 */
export function useOperatorColor() {
  const active = useActiveOperators();
  const colors = useMemo(
    () => assignOperatorColors(active.map((operator) => operator.userId)),
    [active],
  );
  return (userId: string) =>
    colors.get(userId) ?? OPERATOR_COLORS[preferredIndex(userId)];
}

/** A soft wash of an operator's color, behind their pill. */
export function operatorTint(color: string) {
  return `color-mix(in srgb, ${color} 14%, transparent)`;
}
