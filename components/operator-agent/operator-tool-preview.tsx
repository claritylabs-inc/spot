"use client";

import { useQuery } from "convex/react";
import { Spinner } from "@claritylabs-inc/ui/components/spinner";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import { formatDisplayDate } from "@/lib/date-format";
import { operatorAgentApi } from "@/lib/operator-agent-api";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";

/** What one operator tool call returned, as a faint inset list. */
export function OperatorToolPreview({
  messageId,
  toolCallId,
}: {
  messageId: string;
  toolCallId: string;
}) {
  const items = useQuery(operatorAgentApi.getToolPreview, {
    messageId,
    toolCallId,
  });
  if (items === undefined)
    return <Spinner className="size-3.5 text-muted-foreground" />;
  if (!items?.length)
    return (
      <p className={cn("text-muted-foreground", typeStyle("caption.default"))}>
        No preview available.
      </p>
    );
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-foreground/[0.025]">
      {items.map((item, index) => (
        <li key={index} className="flex min-w-0 items-center gap-2.5 px-3 py-2">
          {item.website ? (
            <OrgBrandIcon
              name={item.title}
              website={item.website}
              size="xs"
              className="size-4 shrink-0 rounded-full ring-1 ring-border-subtle"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "truncate text-foreground",
                typeStyle("caption.default"),
              )}
            >
              {item.title}
            </p>
            {item.subtitle ? (
              <p
                className={cn(
                  "truncate text-muted-foreground/70",
                  typeStyle("caption.default"),
                )}
              >
                {item.subtitle}
              </p>
            ) : null}
          </div>
          {item.date ? (
            <span
              className={cn(
                "shrink-0 text-muted-foreground/70",
                typeStyle("caption.default"),
              )}
            >
              {formatDisplayDate(item.date)}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
