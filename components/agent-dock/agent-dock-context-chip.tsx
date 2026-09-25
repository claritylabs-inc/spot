"use client";

import { TagRemoveButton } from "@claritylabs-inc/ui/components/tag-remove-button";
import Link from "next/link";
import { AtSign, Plus } from "lucide-react";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * Composer chip for the page a chat is about. New chats can drop the current
 * page and add it back; a thread's saved origin is shown read-only.
 */
export function AgentDockContextChip({
  label,
  href,
  retained = false,
  detached = false,
  onRemove,
  onAttach,
}: {
  label: string | null;
  /** The saved origin page, when it can be reopened. */
  href?: string | null;
  retained?: boolean;
  detached?: boolean;
  onRemove?: () => void;
  onAttach?: () => void;
}) {
  if (!label) return null;
  if (detached) {
    return (
      <button
        type="button"
        onClick={onAttach}
        className={cn(
          "mr-1 flex h-6 shrink-0 items-center gap-1 rounded-full border border-dashed border-input px-2 text-muted-foreground transition-colors hover:text-foreground",
          typeStyle("label.tag"),
        )}
      >
        <Plus className="size-3" />
        <span className="max-w-40 truncate">{label}</span>
      </button>
    );
  }
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
