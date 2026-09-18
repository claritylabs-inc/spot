"use client";
import { useEffect, useMemo, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { useConvex } from "convex/react";
import dayjs from "dayjs";
import { Download, RefreshCw } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app-shell";
import { PillButton } from "@/components/ui/pill-button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import {
  OperationalPanel,
  OperationalLabelValueList,
  OperationalLabelValueRow,
} from "@/components/ui/operational-panel";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { OperatorSidebar } from "../operator-sidebar";
import {
  cost,
  displayTask,
  downloadReport,
  tokens,
  type ModelCall,
} from "../logs/log-utils";
import { summarizeCalls, type UsageRow } from "./usage-summary";

export default function OperatorUsagePage() {
  const convex = useConvex();
  const [to, setTo] = useState(() => dayjs().valueOf());
  const from = dayjs(to).subtract(7, "day").valueOf();
  const [calls, setCalls] = useState<ModelCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<"model" | "task" | "channel">("model");
  const [selected, setSelected] = useState<UsageRow | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      setSelected(null);
      try {
        let cursor: string | null = null;
        const all: ModelCall[] = [];
        for (;;) {
          const page: FunctionReturnType<
            typeof api.modelRoutingEvents.listCalls
          > = await convex.query(api.modelRoutingEvents.listCalls, {
            from,
            to,
            paginationOpts: { cursor, numItems: 250 },
          });
          if (cancelled) return;
          all.push(...page.page);
          if (page.isDone) break;
          cursor = page.continueCursor;
        }
        setCalls(all);
      } catch (error) {
        if (!cancelled)
          setError(
            getUserFacingErrorMessage(error, "Usage could not be loaded"),
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [convex, from, to]);
  const summary = useMemo(() => summarizeCalls(calls, group), [calls, group]);
  const max = Math.max(...summary.days.map((row) => row.cost), 0.000001);
  const matching = selected
    ? new URLSearchParams({
        from: String(from),
        to: String(to),
        [group]: selected.label,
        ...(group === "model" ? { modelExact: "true" } : {}),
      })
    : null;
  return (
    <AppShell
      customSidebar={(props) => <OperatorSidebar {...props} active="usage" />}
      customSidebarStorageKey="operator-sidebar"
      disablePersistentChat
      disableCommandPalette
      actions={
        <>
          <PillButton
            variant="secondary"
            disabled={loading}
            onClick={() => setTo(dayjs().valueOf())}
          >
            <RefreshCw className="size-4" />
            Refresh
          </PillButton>
          <PillButton
            variant="secondary"
            disabled={loading || !!error}
            onClick={() =>
              downloadReport(
                `model-usage-${dayjs(to).format("YYYY-MM-DD")}.json`,
                JSON.stringify(
                  {
                    from: dayjs(from).toISOString(),
                    to: dayjs(to).toISOString(),
                    group,
                    ...summary,
                  },
                  null,
                  2,
                ),
              )
            }
          >
            <Download className="size-4" />
            Export
          </PillButton>
        </>
      }
      rightPanel={
        selected ? (
          <SettingsDrawer
            open
            onOpenChange={(open) => {
              if (!open) setSelected(null);
            }}
            title={displayTask(selected.label)}
            footer={
              <PillButton
                variant="secondary"
                href={`/operator/logs?${matching}`}
              >
                View calls
              </PillButton>
            }
          >
            <OperationalLabelValueList>
              <OperationalLabelValueRow
                label="Calls"
                value={tokens(selected.calls)}
              />
              <OperationalLabelValueRow
                label="Recorded cost"
                value={selected.priced ? cost(selected.cost) : "Unpriced"}
              />
              <OperationalLabelValueRow
                label="Unpriced calls"
                value={tokens(selected.calls - selected.priced)}
              />
              <OperationalLabelValueRow
                label="Input tokens"
                value={selected.tokenCalls ? tokens(selected.input) : "—"}
              />
              <OperationalLabelValueRow
                label="Output tokens"
                value={selected.tokenCalls ? tokens(selected.output) : "—"}
              />
            </OperationalLabelValueList>
          </SettingsDrawer>
        ) : undefined
      }
    >
      <div className="space-y-6">
        <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
          {dayjs(from).format("MMM D")}–{dayjs(to).format("MMM D, YYYY")} · All
          recorded calls
        </p>
        {loading || error ? (
          <p className={typeStyle("body.default")}>
            {error ?? "Loading usage…"}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-6 border-b border-border pb-6 lg:grid-cols-4">
              {[
                [
                  "Recorded cost",
                  summary.total.priced || !summary.total.calls
                    ? cost(summary.total.cost)
                    : "Unpriced",
                ],
                [
                  "Input tokens",
                  summary.total.tokenCalls || !summary.total.calls
                    ? tokens(summary.total.input)
                    : "—",
                ],
                [
                  "Output tokens",
                  summary.total.tokenCalls || !summary.total.calls
                    ? tokens(summary.total.output)
                    : "—",
                ],
                ["Calls", tokens(summary.total.calls)],
              ].map(([label, value]) => (
                <div key={label}>
                  <p
                    className={`text-muted-foreground ${typeStyle("label.metadata")}`}
                  >
                    {label}
                  </p>
                  <p className={`mt-2 ${typeStyle("heading.section")}`}>
                    {value}
                  </p>
                </div>
              ))}
            </div>
            <p
              className={`text-muted-foreground ${typeStyle("caption.default")}`}
            >
              {summary.total.priced.toLocaleString()} of{" "}
              {summary.total.calls.toLocaleString()} calls priced ·{" "}
              {(summary.total.calls - summary.total.priced).toLocaleString()}{" "}
              unpriced · Tokens reported for{" "}
              {summary.total.tokenCalls.toLocaleString()} calls
            </p>
            {summary.days.length ? (
              <div>
                <div
                  className="flex h-40 items-end gap-2"
                  aria-label="Recorded cost by day"
                >
                  {summary.days.map((row) => (
                    <div
                      className="flex h-full min-w-0 flex-1 items-end"
                      key={row.label}
                    >
                      <div
                        className="w-full rounded-t-sm bg-foreground/20"
                        style={{
                          height: `${Math.max(2, (row.cost / max) * 100)}%`,
                        }}
                        role="img"
                        aria-label={`${row.label}: ${cost(row.cost)}`}
                        title={`${row.label}: ${cost(row.cost)}`}
                      />
                    </div>
                  ))}
                </div>
                <div
                  className={`mt-2 flex justify-between text-muted-foreground ${typeStyle("caption.default")}`}
                >
                  <span>{summary.days[0]?.label}</span>
                  <span>{summary.days.at(-1)?.label}</span>
                </div>
              </div>
            ) : (
              <p className={typeStyle("body.default")}>
                No calls recorded in this period.
              </p>
            )}
            <Select
              value={group}
              onValueChange={(value) => {
                if (
                  value === "model" ||
                  value === "task" ||
                  value === "channel"
                ) {
                  setGroup(value);
                  setSelected(null);
                }
              }}
            >
              <SelectTrigger className="w-44" aria-label="Group usage by">
                <SelectValue>{`By ${group}`}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="model">By model</SelectItem>
                <SelectItem value="task">By task</SelectItem>
                <SelectItem value="channel">By channel</SelectItem>
              </SelectContent>
            </Select>
            <OperationalPanel>
              <Table>
                <TableHeader>
                  <TableRow>
                    {[
                      displayTask(group),
                      "Calls",
                      "Input tokens",
                      "Output tokens",
                      "Recorded cost",
                    ].map((label) => (
                      <TableHead key={label}>{label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.rows.map((row) => (
                    <TableRow
                      key={row.label}
                      tabIndex={0}
                      role="button"
                      aria-label={`Inspect ${row.label} usage`}
                      className="cursor-pointer"
                      data-state={
                        selected?.label === row.label ? "selected" : undefined
                      }
                      onClick={() => setSelected(row)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelected(row);
                        }
                      }}
                    >
                      <TableCell>{displayTask(row.label)}</TableCell>
                      <TableCell>{tokens(row.calls)}</TableCell>
                      <TableCell>
                        {row.tokenCalls ? tokens(row.input) : "—"}
                      </TableCell>
                      <TableCell>
                        {row.tokenCalls ? tokens(row.output) : "—"}
                      </TableCell>
                      <TableCell>
                        {row.priced ? cost(row.cost) : "Unpriced"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </OperationalPanel>

          </>
        )}
      </div>
    </AppShell>
  );
}
