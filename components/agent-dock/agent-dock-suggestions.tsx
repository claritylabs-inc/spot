"use client";

import { Spinner } from "@claritylabs-inc/ui/components/spinner";
import { LogoIcon } from "@/components/ui/logo-icon";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";

export type AgentDockSuggestionItem = { id: string; label: string };

/** Suggested prompts, anchored just above the composer of an empty chat. */
export function AgentDockSuggestions({
  items,
  pendingId = null,
  disabled = false,
  onSelect,
}: {
  items: AgentDockSuggestionItem[];
  pendingId?: string | null;
  disabled?: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="mt-auto pb-2">
      <ul aria-label="Suggested prompts" className="flex flex-col gap-0.5">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              disabled={disabled || pendingId !== null}
              onClick={() => onSelect(item.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-md py-2 text-left text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none disabled:opacity-50",
                typeStyle("body.default"),
              )}
            >
              {pendingId === item.id ? (
                <Spinner className="size-3.5 shrink-0" />
              ) : (
                <LogoIcon size={14} className="shrink-0 text-muted-foreground/60" />
              )}
              <span className="min-w-0 truncate">{item.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
