"use client";

import { TagRemoveButton } from "@claritylabs-inc/ui/components/tag-remove-button";
import Link from "next/link";
import { AtSign, Focus } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * Composer chip for the page a chat is about. The current page can be removed
 * and toggled back with `AgentDockContextToggle`; a thread's saved origin is
 * shown read-only.
 */
export function AgentDockContextChip({
  label,
  href,
  retained = false,
  detached = false,
  onRemove,
}: {
  label: string | null;
  /** The saved origin page, when it can be reopened. */
  href?: string | null;
  retained?: boolean;
  detached?: boolean;
  onRemove?: () => void;
}) {
  if (!label) return null;
  if (detached) return null;
  return (
    <span
      title={retained ? `Chat started from ${label}` : `Using ${label}`}
      className={cn(
        "mr-1 flex h-6 min-w-0 shrink-0 items-center gap-1 rounded-full border border-input bg-foreground/[0.03] pl-2 text-foreground/80",
        retained ? "pr-2" : "pr-0.5",
        typeStyle("label.tag"),
      )}
    >
      <AtSign className="size-3 shrink-0 text-muted-foreground" />
      {href ? (
        <Link href={href} className="max-w-48 truncate hover:underline">
          {label}
        </Link>
      ) : (
        <span className="max-w-48 truncate">{label}</span>
      )}
      {!retained && onRemove ? (
        <TagRemoveButton label={`Remove ${label}`} onClick={onRemove} />
      ) : null}
    </span>
  );
}

/** Turns the current page's context on or off for the next message. */
export function AgentDockContextToggle({
  label,
  attached,
  onToggle,
}: {
  label: string | null;
  attached: boolean;
  onToggle: () => void;
}) {
  if (!label) return null;
  return (
    <PillButton
      type="button"
      variant="icon"
      size="compact"
      iconOnly
      label={attached ? `Stop using ${label}` : `Use ${label}`}
      aria-pressed={attached}
      className={cn(attached && "bg-foreground/6 text-foreground")}
      onClick={onToggle}
    >
      <Focus className="size-3.5" />
    </PillButton>
  );
}
