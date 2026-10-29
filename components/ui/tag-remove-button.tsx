"use client";

import { X } from "lucide-react";

/** Round remove button for the end of a pill or tag. */
export function TagRemoveButton({
  label,
  onClick,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
    >
      <X aria-hidden="true" className="size-2.5" />
    </button>
  );
}
