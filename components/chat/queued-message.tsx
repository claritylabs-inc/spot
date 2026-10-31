"use client";

import type { ReactNode } from "react";
import { Clock } from "lucide-react";
import {
  PromptReferenceText,
  type PromptReference,
} from "@/components/prompt-reference-tag";
import { PillButton } from "@/components/ui/pill-button";
import { RemoveButton } from "@/components/ui/remove-button";
import { cn } from "@/lib/utils";
import { typeStyle } from "@/lib/typography";

/**
 * A message waiting above the composer ("Queued: … · Send now · ×"). Shared
 * by the client thread's local queue and the operator chat's durable queue.
 */
export function QueuedMessageRow({
  label = "Queued",
  text,
  references,
  leading,
  failed = false,
  sending = false,
  onSendNow,
  actions,
  onCancel,
  cancelLabel = "Remove queued message",
}: {
  label?: string;
  text: string;
  references?: PromptReference[];
  /** Replaces the clock, e.g. the sender's avatar. */
  leading?: ReactNode;
  failed?: boolean;
  sending?: boolean;
  onSendNow?: () => void;
  /** Extra controls before Send now. */
  actions?: ReactNode;
  onCancel?: () => void;
  cancelLabel?: string;
}) {
  return (
    <div className="mb-2 flex items-center gap-2 rounded-lg border border-input bg-card px-2.5 py-2">
      {leading ?? (
        <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground/35" />
      )}
      <p
        className={cn(
          "min-w-0 flex-1 truncate",
          failed ? "text-destructive/80" : "text-muted-foreground/55",
          typeStyle("caption.default"),
        )}
      >
        {label}:{" "}
        <PromptReferenceText
          content={text}
          references={references ?? []}
          className="text-foreground/75"
        />
      </p>
      {actions}
      {onSendNow ? (
        <PillButton
          type="button"
          size="compact"
          onClick={onSendNow}
          disabled={sending}
        >
          {sending ? "Sending" : "Send now"}
        </PillButton>
      ) : null}
      {onCancel ? (
        <RemoveButton
          type="button"
          onClick={onCancel}
          disabled={sending}
          label={cancelLabel}
        />
      ) : null}
    </div>
  );
}
