"use client";

import { ChevronRight } from "lucide-react";

import { LogoIcon } from "@/components/ui/logo-icon";
import { typeStyle } from "@/lib/typography";

export function ThinkingSummary({
  tools = [],
  working,
}: {
  tools?: string[];
  working: boolean;
}) {
  const labels = [...new Set(tools)].map(
    (name) => name.charAt(0).toUpperCase() + name.slice(1).replaceAll("_", " "),
  );
  if (!working && labels.length === 0) return null;

  const status = (
    <span className="flex items-center gap-2 text-foreground">
      <span
        className={`inline-flex shrink-0 ${working ? "animate-spin [animation-duration:3s] motion-reduce:animate-none" : ""}`}
      >
        <LogoIcon size={16} />
      </span>
      <span>{working ? "Thinking" : "Activity"}</span>
    </span>
  );

  if (labels.length === 0) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`inline-flex min-h-9 items-center rounded-full border border-border px-4 ${typeStyle("caption.default")}`}
      >
        {status}
      </div>
    );
  }

  return (
    <details
      key={working ? "working" : "finished"}
      className={`group/thinking mb-3 w-fit max-w-full rounded-full border border-border text-muted-foreground open:rounded-2xl ${typeStyle("caption.default")}`}
    >
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-4 rounded-full px-4 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        {status}
        <span className="flex items-center gap-2">
          <span>
            {labels.length} {labels.length === 1 ? "step" : "steps"}
          </span>
          <ChevronRight
            aria-hidden
            className="size-3.5 shrink-0 group-open/thinking:rotate-90"
          />
        </span>
      </summary>
      <ul className="mx-4 space-y-3 border-t border-border pb-4 pl-6 pt-3 break-words">
        {labels.map((label) => (
          <li key={label}>{label}</li>
        ))}
      </ul>
    </details>
  );
}
