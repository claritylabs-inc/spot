import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);

export const OUTREACH_STYLES = ["brief_nudge", "concise_recap", "detailed_recap"] as const;
export type OutreachStyle = (typeof OUTREACH_STYLES)[number];
export const MAX_OUTREACH_FOLLOW_UPS = 4;
export const MAX_LAUNCH_PROVIDERS = 50;
/** Interval choices offered to Jev and operators; the schedule accepts any positive integer. */
export const OUTREACH_INTERVAL_OPTIONS = [2, 3, 5, 7] as const;
export const OUTREACH_DEFAULT_CADENCE = {
  followUpCount: 2,
  intervalBusinessDays: 3,
  style: "brief_nudge",
} as const satisfies OutreachCadence;
/** Follow-ups never land later than this after launch. */
export const OUTREACH_MAX_SPAN_DAYS = 30;
const SEND_HOUR_UTC = 14;

export type OutreachCadence = {
  followUpCount: number;
  intervalBusinessDays: number;
  style: OutreachStyle;
};
export type OutreachScheduleLimits = {
  /** Target effective date (`YYYY-MM-DD`) or timestamp. */
  effectiveDate?: string | number | null;
  /** Response deadline (`YYYY-MM-DD`) or timestamp. */
  deadline?: string | number | null;
};
export type OutreachScheduleStep = {
  index: number;
  kind: "initial" | "follow_up";
  isFinal: boolean;
  dueAt: number;
};
export type OutreachSchedule = {
  steps: OutreachScheduleStep[];
  /** Requested follow-ups that were dropped by the date cutoff or the span cap. */
  droppedFollowUps: number;
};

function isWeekend(date: dayjs.Dayjs) {
  return date.day() === 0 || date.day() === 6;
}
function atSendHour(date: dayjs.Dayjs) {
  return date.hour(SEND_HOUR_UTC).minute(0).second(0).millisecond(0);
}
/** The same day if it is a weekday, otherwise the following Monday. */
function nextBusinessDay(date: dayjs.Dayjs) {
  let day = date;
  while (isWeekend(day)) day = day.add(1, "day");
  return day;
}

/** `days` business days after `from` (weekends skipped), at 14:00 UTC. */
export function addBusinessDays(from: number, days: number) {
  let day = dayjs.utc(from);
  let remaining = Math.max(0, Math.floor(days));
  while (remaining > 0) {
    day = day.add(1, "day");
    if (!isWeekend(day)) remaining -= 1;
  }
  return atSendHour(nextBusinessDay(day)).valueOf();
}
function subtractBusinessDays(from: dayjs.Dayjs, days: number) {
  let day = from;
  let remaining = days;
  while (remaining > 0) {
    day = day.subtract(1, "day");
    if (!isWeekend(day)) remaining -= 1;
  }
  return day;
}
function parseLimit(value?: string | number | null) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? dayjs.utc(value) : dayjs.utc(value.trim());
  return parsed.isValid() ? parsed : null;
}

/**
 * Last UTC day a follow-up may land: one business day before the earlier of the
 * effective date and the deadline, or the span cap from launch.
 */
export function followUpCutoff(launchedAt: number, limits: OutreachScheduleLimits = {}) {
  const cap = dayjs.utc(launchedAt).add(OUTREACH_MAX_SPAN_DAYS, "day").startOf("day");
  const targets = [limits.effectiveDate, limits.deadline].flatMap((value) => {
    const date = parseLimit(value);
    return date ? [subtractBusinessDays(date.startOf("day"), 1)] : [];
  });
  return targets.reduce((earliest, day) => (day.isBefore(earliest) ? day : earliest), cap);
}

function chainFollowUps(args: {
  firstDueAt: number;
  count: number;
  intervalBusinessDays: number;
  launchedAt: number;
  limits?: OutreachScheduleLimits;
  firstIndex: number;
}): OutreachSchedule {
  const cutoff = followUpCutoff(args.launchedAt, args.limits);
  const steps: OutreachScheduleStep[] = [];
  for (let offset = 0; offset < args.count; offset += 1) {
    const dueAt =
      offset === 0
        ? args.firstDueAt
        : addBusinessDays(args.firstDueAt, offset * args.intervalBusinessDays);
    // Due times only grow, so the first one past the cutoff ends the chain.
    if (dayjs.utc(dueAt).startOf("day").isAfter(cutoff)) break;
    steps.push({ index: args.firstIndex + offset, kind: "follow_up", isFinal: false, dueAt });
  }
  return { steps, droppedFollowUps: args.count - steps.length };
}
function normalizedInterval(value: number) {
  return Math.max(1, Math.floor(value) || 1);
}
function markFinal<T extends { isFinal: boolean }>(steps: T[]) {
  if (steps.length) steps[steps.length - 1] = { ...steps[steps.length - 1], isFinal: true };
  return steps;
}

/**
 * Initial send at launch, then follow-up k due k x interval business days later
 * (weekends skipped, 14:00 UTC). Follow-ups beyond the cutoff are dropped; the
 * last remaining step is final.
 */
export function buildOutreachSchedule(args: {
  launchAt: number;
  cadence: Pick<OutreachCadence, "followUpCount" | "intervalBusinessDays">;
  limits?: OutreachScheduleLimits;
}): OutreachSchedule {
  const interval = normalizedInterval(args.cadence.intervalBusinessDays);
  const count = Math.min(
    MAX_OUTREACH_FOLLOW_UPS,
    Math.max(0, Math.floor(args.cadence.followUpCount) || 0),
  );
  const followUps = count
    ? chainFollowUps({
        firstDueAt: addBusinessDays(args.launchAt, interval),
        count,
        intervalBusinessDays: interval,
        launchedAt: args.launchAt,
        limits: args.limits,
        firstIndex: 1,
      })
    : { steps: [], droppedFollowUps: 0 };
  return {
    steps: markFinal([
      { index: 0, kind: "initial" as const, isFinal: false, dueAt: args.launchAt },
      ...followUps.steps,
    ]),
    droppedFollowUps: followUps.droppedFollowUps,
  };
}

/**
 * Re-times the unsent steps from when a step actually went out. `remaining` is
 * the number of unsent follow-ups and `nextIndex` the index of the first one.
 * Steps past the cutoff are dropped (the caller cancels them); the last kept
 * step becomes final. `notBefore` delays the first step, for example after an
 * auto-reply resumes a sequence.
 */
export function recomputeScheduleAfterSend(args: {
  sentAt: number;
  launchedAt: number;
  nextIndex: number;
  remaining: number;
  intervalBusinessDays: number;
  limits?: OutreachScheduleLimits;
  notBefore?: number;
}): OutreachSchedule {
  const interval = normalizedInterval(args.intervalBusinessDays);
  let firstDueAt = addBusinessDays(args.sentAt, interval);
  if (args.notBefore !== undefined) {
    const earliest = atSendHour(nextBusinessDay(dayjs.utc(args.notBefore)));
    firstDueAt = Math.max(
      firstDueAt,
      earliest.valueOf() >= args.notBefore ? earliest.valueOf() : addBusinessDays(args.notBefore, 1),
    );
  }
  const chain = chainFollowUps({
    firstDueAt,
    count: Math.max(0, Math.floor(args.remaining)),
    intervalBusinessDays: interval,
    launchedAt: args.launchedAt,
    limits: args.limits,
    firstIndex: args.nextIndex,
  });
  return { ...chain, steps: markFinal(chain.steps) };
}

/** The next step's due time after an actual send, or `null` when the cutoff passed. */
export function nextDueAfterSend(
  args: Omit<Parameters<typeof recomputeScheduleAfterSend>[0], "remaining" | "nextIndex">,
) {
  return (
    recomputeScheduleAfterSend({ ...args, remaining: 1, nextIndex: 0 }).steps[0]?.dueAt ?? null
  );
}
