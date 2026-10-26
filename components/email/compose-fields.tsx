"use client";

import type { ComponentProps, ReactNode } from "react";

import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * Mail-client compose fields shared by the team inbox composers and editable
 * email artifacts: muted inline labels over borderless values, then the body.
 */
export function EmailComposeRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-11 items-center gap-3 border-b border-border px-4 py-1">
      <span
        className={`w-14 shrink-0 text-muted-foreground ${typeStyle("body.default")}`}
      >
        {label}
      </span>
      <div
        className={`flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 ${typeStyle("body.default")}`}
      >
        {children}
      </div>
    </div>
  );
}

export function EmailComposeInput({
  className,
  ...props
}: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-9 min-w-32 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/60",
        typeStyle("body.default"),
        className,
      )}
      {...props}
    />
  );
}

export function EmailComposeMessage({
  className,
  ...props
}: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "w-full resize-none bg-transparent px-4 py-2.5 outline-none field-sizing-content placeholder:text-muted-foreground/60",
        typeStyle("body.default"),
        className,
      )}
      {...props}
    />
  );
}

/** Addresses typed into a To/Cc/Bcc field, split on commas, semicolons or lines. */
export function parseEmailAddressList(value: string): string[] {
  return value
    .split(/[,;\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
