"use client";

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
  return (
    <details
      key={working ? "working" : "finished"}
      open={working}
      className={`mb-3 text-muted-foreground ${typeStyle("caption.default")}`}
    >
      <summary className="w-fit cursor-pointer select-none">
        {working ? "Thinking" : "Activity"}
        {labels.length > 0
          ? ` · ${labels.length} ${labels.length === 1 ? "step" : "steps"}`
          : ""}
      </summary>
      <div className="ml-1 mt-2 border-l border-border pl-3">
        {labels.map((label) => (
          <p key={label} className="my-1">
            {label}
          </p>
        ))}
        {working ? (
          <p className="my-1">
            {labels.length
              ? "Preparing the next step…"
              : "Preparing a response…"}
          </p>
        ) : null}
      </div>
    </details>
  );
}
