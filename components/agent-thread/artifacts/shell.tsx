"use client";

import { useState, type ComponentProps } from "react";
import { Loader2, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { PillButton } from "@/components/ui/pill-button";
import { cn } from "@/lib/utils";

/** Tracks which keyed artifact action is running; failures toast `failure`. */
export function useBusyKey() {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  async function runBusy(
    key: string,
    work: () => Promise<void>,
    failure: string,
  ) {
    setBusyKey(key);
    try {
      await work();
    } catch {
      toast.error(failure);
    } finally {
      setBusyKey(null);
    }
  }
  return { busyKey, runBusy };
}

/** Pill button whose icon becomes a spinner while `busy`. */
export function ActionPill({
  busy,
  icon: Icon,
  iconClassName = "h-3.5 w-3.5",
  children,
  ...props
}: ComponentProps<typeof PillButton> & {
  busy: boolean;
  icon?: LucideIcon;
  iconClassName?: string;
}) {
  return (
    <PillButton {...props}>
      {busy ? (
        <Loader2 className={cn(iconClassName, "animate-spin")} />
      ) : Icon ? (
        <Icon className={iconClassName} />
      ) : null}
      {children}
    </PillButton>
  );
}
