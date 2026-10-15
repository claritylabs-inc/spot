"use client";

import dayjs from "dayjs";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
} from "@claritylabs-inc/ui/components/operational-panel";
import { typeStyle } from "@/lib/typography";
import {
  intakeReviewChanges,
  type IntakeReviewVersion,
} from "@/lib/intake-review-changes";

function displayValue(value: string, fallback: string) {
  if (!value) return fallback;
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? dayjs(value).format("MMMM D, YYYY")
    : value;
}

export function IntakeReviewChanges({
  previous,
  current,
}: {
  previous: IntakeReviewVersion;
  current: IntakeReviewVersion;
}) {
  const changes = intakeReviewChanges(previous, current);
  if (!changes.length) return null;
  return (
    <section
      className="mt-6 space-y-4 border-t border-border-subtle pt-6"
      aria-label="Changes to resubmit"
    >
      <h2 className={typeStyle("heading.item")}>Changes to resubmit</h2>
      {changes.map((change) => (
        <section
          key={change.key}
          className="space-y-3"
          aria-label={change.label}
        >
          <h3 className={`${typeStyle("body.default")} text-muted-foreground`}>
            {change.label}
          </h3>
          <OperationalLabelValueList className="[&>dl>div]:grid-cols-1 [&>dl>div]:gap-2 sm:[&>dl>div]:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] sm:[&>dl>div]:gap-4 [&_dd]:min-w-0 [&_dd]:text-left sm:[&_dd]:text-right">
            {[
              {
                label: "Previously submitted",
                value: displayValue(change.before, "Not provided"),
              },
              {
                label: "Updated",
                value: displayValue(change.after, "Removed"),
              },
            ].map(({ label, value }) => (
              <OperationalLabelValueRow
                key={label}
                label={<span className={typeStyle("body.root")}>{label}</span>}
                value={
                  <div
                    className={`whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${typeStyle("body.root")}`}
                  >
                    {value}
                  </div>
                }
              />
            ))}
          </OperationalLabelValueList>
        </section>
      ))}
    </section>
  );
}
