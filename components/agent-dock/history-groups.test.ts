import dayjs from "dayjs";
import { expect, test } from "vitest";
import {
  formatAgentDockRelativeTime,
  groupAgentDockHistory,
} from "./history-groups";

const now = dayjs("2026-09-25T15:00:00").valueOf();
const at = (value: string) => dayjs(value).valueOf();

test("history groups newest first by calendar day", () => {
  const groups = groupAgentDockHistory(
    [
      { id: "old", lastMessageAt: at("2026-09-01T09:00:00") },
      { id: "today-early", lastMessageAt: at("2026-09-25T08:00:00") },
      { id: "yesterday", lastMessageAt: at("2026-09-24T23:30:00") },
      { id: "week", lastMessageAt: at("2026-09-20T12:00:00") },
      { id: "today-late", lastMessageAt: at("2026-09-25T14:00:00") },
    ],
    now,
  );
  expect(groups.map((group) => [group.label, group.items.map((item) => item.id)])).toEqual([
    ["Today", ["today-late", "today-early"]],
    ["Yesterday", ["yesterday"]],
    ["This week", ["week"]],
    ["Earlier", ["old"]],
  ]);
});

test("relative times shorten recent activity", () => {
  expect(formatAgentDockRelativeTime(now - 20_000, now)).toBe("Just now");
  expect(formatAgentDockRelativeTime(now - 5 * 60_000, now)).toBe("5m ago");
  expect(formatAgentDockRelativeTime(at("2026-09-25T12:00:00"), now)).toBe("3h ago");
  expect(formatAgentDockRelativeTime(at("2026-09-23T10:00:00"), now)).toBe("Wed 10:00 AM");
  expect(formatAgentDockRelativeTime(at("2026-03-02T10:00:00"), now)).toBe("Mar 2");
  expect(formatAgentDockRelativeTime(at("2025-03-02T10:00:00"), now)).toBe("Mar 2, 2025");
});
