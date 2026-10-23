"use client";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { StatusTag } from "@claritylabs-inc/ui/components/status-tag";
import { PillButton } from "@/components/ui/pill-button";
import { typeStyle } from "@/lib/typography";
/** Match the review disclosures while keeping Edit separate from toggling. */
export function ReviewSection({
  title,
  step,
  onEdit,
  children,
  complete,
  collapsible = true,
}: {
  title: string;
  step: number;
  onEdit?: (step: number) => void;
  children: ReactNode;
  complete?: boolean;
  collapsible?: boolean;
}) {
  const heading = (
    <>
      <h2 className={typeStyle("heading.item")}>{title}</h2>
      <div className="flex items-center gap-3">
        {complete !== undefined && (
          <StatusTag
            className={typeStyle("body.large")}
            tone={complete ? "success" : "neutral"}
            indicator={complete ? "complete" : "progress"}
          >
            {complete ? "Complete" : "In Progress"}
          </StatusTag>
        )}
        {onEdit && (
          <PillButton
            variant="ghost"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onEdit(step);
            }}
          >
            Edit
          </PillButton>
        )}
        {collapsible && (
          <ChevronDown
            aria-hidden="true"
            className="size-4 transition-transform group-open:rotate-180"
          />
        )}
      </div>
    </>
  );
  const content = <div className="space-y-4 pb-3 pt-1">{children}</div>;
  if (!collapsible)
    return (
      <section aria-label={title}>
        <div className="flex items-center justify-between gap-3 py-3">
          {heading}
        </div>
        {content}
      </section>
    );
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        {heading}
      </summary>
      {content}
    </details>
  );
}
