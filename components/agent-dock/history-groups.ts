import dayjs from "dayjs";

export type AgentDockHistoryGroup<T> = {
  label: "Today" | "Yesterday" | "This week" | "Earlier";
  items: T[];
};

const GROUP_ORDER: AgentDockHistoryGroup<unknown>["label"][] = [
  "Today",
  "Yesterday",
  "This week",
  "Earlier",
];

function groupLabel(time: number, now: number) {
  const day = dayjs(time).startOf("day");
  const today = dayjs(now).startOf("day");
  if (!day.isBefore(today)) return "Today";
  if (day.isSame(today.subtract(1, "day"))) return "Yesterday";
  if (day.isAfter(today.subtract(7, "day"))) return "This week";
  return "Earlier";
}

/** Groups newest-first threads by calendar day relative to `now`. */
export function groupAgentDockHistory<T extends { lastMessageAt: number }>(
  items: T[],
  now: number,
): AgentDockHistoryGroup<T>[] {
  const buckets = new Map<AgentDockHistoryGroup<T>["label"], T[]>();
  for (const item of [...items].sort(
    (left, right) => right.lastMessageAt - left.lastMessageAt,
  )) {
    const label = groupLabel(item.lastMessageAt, now);
    buckets.set(label, [...(buckets.get(label) ?? []), item]);
  }
  return GROUP_ORDER.flatMap((label) => {
    const groupItems = buckets.get(label);
    return groupItems ? [{ label, items: groupItems }] : [];
  });
}

export function formatAgentDockRelativeTime(time: number, now: number) {
  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24 && dayjs(time).isSame(now, "day")) return `${hours}h ago`;
  const date = dayjs(time);
  if (dayjs(now).diff(date, "day") < 7) return date.format("ddd h:mm A");
  return date.isSame(now, "year")
    ? date.format("MMM D")
    : date.format("MMM D, YYYY");
}
