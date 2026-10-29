"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";
import {
  MAX_OUTREACH_FOLLOW_UPS,
  OUTREACH_INTERVAL_OPTIONS,
} from "@/convex/lib/providerOutreachSchedule";

/** Shared follow-up count select for provider and client outreach. */
export function FollowUpCountSelect({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const label = (count: number) =>
    count === 0 ? "None" : `${count} follow-up${count === 1 ? "" : "s"}`;
  return (
    <Select
      value={String(value)}
      disabled={disabled}
      onValueChange={(next) => onChange(Number(next))}
    >
      <SelectTrigger aria-label="Follow-ups" className="w-full">
        <SelectValue>{label(value)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {Array.from({ length: MAX_OUTREACH_FOLLOW_UPS + 1 }, (_, count) => (
          <SelectItem key={count} value={String(count)}>
            {label(count)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Shared business-day interval select for provider and client outreach. */
export function IntervalSelect({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const intervals = Array.from(
    new Set<number>([...OUTREACH_INTERVAL_OPTIONS, value]),
  ).sort((a, b) => a - b);
  return (
    <Select
      value={String(value)}
      disabled={disabled}
      onValueChange={(next) => onChange(Number(next))}
    >
      <SelectTrigger
        aria-label="Business days between follow-ups"
        className="w-full"
      >
        <SelectValue>{value} business days</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {intervals.map((days) => (
          <SelectItem key={days} value={String(days)}>
            {days} business days
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
