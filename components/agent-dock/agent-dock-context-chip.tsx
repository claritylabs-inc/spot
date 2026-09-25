"use client";

import { TagRemoveButton } from "@claritylabs-inc/ui/components/tag-remove-button";
import Link from "next/link";
import { AtSign, Focus } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * Composer chip for the page a chat is about, either the current page or the
 * context saved on the thread. Removing it detaches the page from the chat.
 */
export function AgentDockContextChip({
  label,
  href,
  detached = false,
  onRemove,
}: {
  label: string | null;
  /** The context page, when it can be reopened. */
  href?: string | null;
  detached?: boolean;
  onRemove?: () => void;
}) {
  if (!label) return null;
  if (detached) return null;
  return (
    <span
      title={`Using ${label}`}
      className={cn(
        "mr-1 flex h-6 min-w-0 shrink-0 items-center gap-1 rounded-full border border-input bg-foreground/[0.03] pl-2 text-foreground/80",
        onRemove ? "pr-0.5" : "pr-2",
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
      {onRemove ? (
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
