"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import { Loader2, X, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { PillButton } from "@/components/ui/pill-button";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";

/** Right panel shell: 48px header with close, scrollable body, optional action bar. */
export function ArtifactSidebar({
  title,
  status,
  closeLabel,
  onClose,
  header,
  bodyClassName,
  footer,
  children,
}: {
  title: ReactNode;
  status?: ReactNode;
  closeLabel: string;
  onClose: () => void;
  /** Fixed content between the title bar and the scrollable body. */
  header?: ReactNode;
  bodyClassName?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <aside className="flex h-full w-full flex-col overflow-hidden border-l border-input bg-background">
      <div className="flex h-12 items-center justify-between gap-3 border-b border-input px-4">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className={`min-w-0 truncate text-foreground ${typeStyle("heading.micro")}`}>
            {title}
          </h2>
          {status}
        </div>
        <PillButton size="compact" variant="icon" onClick={onClose} label={closeLabel}>
          <X className="h-4 w-4" />
        </PillButton>
      </div>
      {header}
      <div className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-4", bodyClassName)}>
        {children}
      </div>
      {footer ? (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-input px-4 py-3">
          {footer}
        </div>
      ) : null}
    </aside>
  );
}

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
