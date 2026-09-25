"use client";

import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type AppShellSlotName =
  | "actions"
  | "breadcrumb"
  | "rightPanel"
  | "artifactPanel"
  | "sidebar";

type SlotOwners = Record<AppShellSlotName, string[]>;
type SlotTargets = Record<AppShellSlotName, HTMLElement | null>;

const EMPTY_OWNERS: SlotOwners = {
  actions: [],
  breadcrumb: [],
  rightPanel: [],
  artifactPanel: [],
  sidebar: [],
};
const EMPTY_TARGETS: SlotTargets = {
  actions: null,
  breadcrumb: null,
  rightPanel: null,
  artifactPanel: null,
  sidebar: null,
};

type AppShellSlotsValue = {
  owners: SlotOwners;
  targets: SlotTargets;
  claim: (slot: AppShellSlotName, token: string) => void;
  release: (slot: AppShellSlotName, token: string) => void;
  targetRef: (slot: AppShellSlotName) => (element: HTMLElement | null) => void;
};

const AppShellSlotsContext = createContext<AppShellSlotsValue | null>(null);

/**
 * The persistent shell owns the slot containers; pages portal into them so
 * their chrome keeps page state and context without remounting the shell.
 */
export function AppShellSlotsProvider({ children }: { children: ReactNode }) {
  const [owners, setOwners] = useState(EMPTY_OWNERS);
  const [targets, setTargets] = useState(EMPTY_TARGETS);
  const claim = useCallback((slot: AppShellSlotName, token: string) => {
    setOwners((current) => ({
      ...current,
      [slot]: [...current[slot].filter((owner) => owner !== token), token],
    }));
  }, []);
  const release = useCallback((slot: AppShellSlotName, token: string) => {
    setOwners((current) =>
      current[slot].includes(token)
        ? { ...current, [slot]: current[slot].filter((owner) => owner !== token) }
        : current,
    );
  }, []);
  const targetRefs = useMemo(() => {
    const refs = {} as Record<
      AppShellSlotName,
      (element: HTMLElement | null) => void
    >;
    for (const slot of Object.keys(EMPTY_TARGETS) as AppShellSlotName[]) {
      refs[slot] = (element) =>
        setTargets((current) =>
          current[slot] === element ? current : { ...current, [slot]: element },
        );
    }
    return refs;
  }, []);
  const targetRef = useCallback(
    (slot: AppShellSlotName) => targetRefs[slot],
    [targetRefs],
  );
  const value = useMemo(
    () => ({ owners, targets, claim, release, targetRef }),
    [claim, owners, release, targetRef, targets],
  );
  return (
    <AppShellSlotsContext.Provider value={value}>
      {children}
    </AppShellSlotsContext.Provider>
  );
}

function useAppShellSlots() {
  const value = useContext(AppShellSlotsContext);
  if (!value) throw new Error("App shell slots require AppShellSlotsProvider");
  return value;
}

export function useAppShellSlot(slot: AppShellSlotName) {
  const { owners, targetRef } = useAppShellSlots();
  return { filled: owners[slot].length > 0, setTarget: targetRef(slot) };
}

export function useOptionalAppShellSlots() {
  return useContext(AppShellSlotsContext) !== null;
}

/** Renders `children` into a shell slot; the latest mounted claim wins. */
export function AppShellPortal({
  slot,
  active = true,
  children,
}: {
  slot: AppShellSlotName;
  active?: boolean;
  children: ReactNode;
}) {
  const { owners, targets, claim, release } = useAppShellSlots();
  const token = useId();

  useLayoutEffect(() => {
    if (!active) return;
    claim(slot, token);
    return () => release(slot, token);
  }, [active, claim, release, slot, token]);

  const target = targets[slot];
  if (!active || !target || owners[slot].at(-1) !== token) return null;
  return createPortal(children, target);
}
