"use client";

import type { ComponentProps } from "react";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Quiet removal affordance for an item within a page or editable collection. */
export function RemoveButton({
  label,
  busy = false,
  className,
  disabled,
  ...props
}: Omit<ComponentProps<"button">, "children"> & {
  label: string;
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      type="button"
      aria-label={props["aria-label"] ?? label}
      title={props.title ?? label}
      disabled={disabled || busy}
      className={cn(
        "flex ml-auto size-8! min-h-8! shrink-0 items-center justify-center border-0 bg-transparent p-0! text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40",
        className,
      )}
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <X className="size-3.5" />
      )}
    </button>
  );
}
