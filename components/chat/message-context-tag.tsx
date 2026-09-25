import { Focus } from "lucide-react";

import { cn } from "@/lib/utils";
import { typeStyle } from "@/lib/typography";

/** The page context a user message was sent with, shown inline before its text. */
export function MessageContextTag({
  context,
  className,
}: {
  context: { pageType: string; summary?: string } | undefined;
  className?: string;
}) {
  if (!context) return null;
  const label = context.summary?.trim() || context.pageType.replaceAll("_", " ");
  return (
    <span
      title={`Sent with ${label}`}
      className={cn(
        "mr-1.5 inline-flex h-5 max-w-[min(16rem,100%)] items-center gap-1 rounded-sm bg-foreground/6 px-1.5 align-middle text-muted-foreground",
        typeStyle("label.tag"),
        className,
      )}
    >
      <Focus className="size-3 shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}
