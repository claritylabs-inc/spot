import dayjs from "dayjs";
import type { ModelCall } from "../logs/log-utils";
export type UsageRow = {
  label: string;
  calls: number;
  priced: number;
  cost: number;
  input: number;
  output: number;
  tokenCalls: number;
};
export function emptyUsage(label: string): UsageRow {
  return {
    label,
    calls: 0,
    priced: 0,
    cost: 0,
    input: 0,
    output: 0,
    tokenCalls: 0,
  };
}
export function addCall(row: UsageRow, call: ModelCall) {
  row.calls++;
  if (call.costUsd != null) {
    row.priced++;
    row.cost += call.costUsd;
  }
  if (call.inputTokens !== undefined || call.outputTokens !== undefined)
    row.tokenCalls++;
  row.input += call.inputTokens ?? 0;
  row.output += call.outputTokens ?? 0;
}
export function summarizeCalls(
  calls: ModelCall[],
  group: "model" | "task" | "channel",
) {
  const total = emptyUsage("Total"),
    rows = new Map<string, UsageRow>(),
    days = new Map<string, UsageRow>();
  for (const call of calls) {
    if (call.kind !== "call") continue;
    addCall(total, call);
    const label =
      group === "model"
        ? (call.model ?? call.callProvider ?? "Not reported")
        : call[group];
    if (!rows.has(label)) rows.set(label, emptyUsage(label));
    addCall(rows.get(label)!, call);
    const date = dayjs(call.timestamp).format("YYYY-MM-DD");
    if (!days.has(date)) days.set(date, emptyUsage(date));
    addCall(days.get(date)!, call);
  }
  return {
    total,
    rows: [...rows.values()].sort((a, b) => b.cost - a.cost),
    days: [...days.values()].sort((a, b) => a.label.localeCompare(b.label)),
  };
}
