"use client";
import { OperationalPanel } from "@claritylabs-inc/ui/components/operational-panel";
import { useEffect, useMemo, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { useConvex, usePaginatedQuery } from "convex/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import dayjs from "dayjs";
import { Building2, Download, Pause, Play, Route } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import { useFollowedState } from "@/hooks/use-followed-state";
import { useTableSort } from "@/hooks/use-table-sort";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import { useCachedOperatorClients } from "@/lib/sync/operator-cached-queries";
import { PillButton } from "@/components/ui/pill-button";
import { StatusTag } from "@claritylabs-inc/ui/components/status-tag";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
  SortableTableHead,
} from "@/components/ui/table";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { CallDetails } from "./call-details";
import {
  defaultFilters,
  LOG_ROUTE_SOURCE_OPTIONS,
  LOG_STATUS_OPTIONS,
  LogSidebar,
  type LogFilters,
} from "./log-filters";
import {
  cost,
  diagnostic,
  displayTask,
  downloadReport,
  tokens,
  callStatusPresentation,
} from "./log-utils";

type Call = FunctionReturnType<
  typeof api.modelRoutingEvents.listCalls
>["page"][number];

const CALL_SORT_COLUMNS = {
  time: (call: Call) => call.timestamp,
  status: (call: Call) => displayTask(call.status ?? "unknown"),
  task: (call: Call) => displayTask(call.taskKind),
  model: (call: Call) => call.model ?? call.callProvider,
  tokens: (call: Call) =>
    call.inputTokens === undefined && call.outputTokens === undefined
      ? undefined
      : (call.inputTokens ?? 0) + (call.outputTokens ?? 0),
  cost: (call: Call) => call.costUsd,
};

export default function OperatorLogsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const convex = useConvex();
  const clients = useCachedOperatorClients();
  const filters = Object.fromEntries(
    Object.entries(defaultFilters).map(([key, value]) => [
      key,
      params.get(key) ?? value,
    ]),
  ) as LogFilters;
  const selected = params.get("call") as Id<"modelRoutingEvents"> | null;
  const [filtersOpen, setFiltersOpen] =
    useFollowedState("operator-logs:filters-open", true);
  const [live, setLive] = useFollowedState("operator-logs:live", true);
  const [now, setNow] = useState(() => dayjs().valueOf());
  const [exporting, setExporting] = useState(false);
  const hours = [0.5, 24, 168, 720].includes(Number(filters.hours))
    ? Number(filters.hours)
    : 24;
  const suppliedFrom = Number(params.get("from"));
  const suppliedTo = Number(params.get("to"));
  const fixedRange =
    params.has("from") &&
    params.has("to") &&
    Number.isFinite(suppliedFrom) &&
    Number.isFinite(suppliedTo) &&
    suppliedTo >= suppliedFrom &&
    suppliedTo - suppliedFrom <= 31 * 86400_000;
  const from = fixedRange ? suppliedFrom : now - hours * 3600_000;
  const to = fixedRange ? suppliedTo : now;
  const modelExact = params.get("modelExact") === "true";
  const args = useMemo(
    () => ({
      from,
      to,
      search: filters.search || undefined,
      status: filters.status || undefined,
      task: filters.task || undefined,
      model: filters.model || undefined,
      modelExact,
      channel: filters.channel || undefined,
      routeSource: filters.routeSource || undefined,
      orgId: filters.orgId ? (filters.orgId as Id<"organizations">) : undefined,
    }),
    [
      from,
      to,
      filters.search,
      filters.status,
      filters.task,
      filters.model,
      modelExact,
      filters.channel,
      filters.routeSource,
      filters.orgId,
    ],
  );
  const { results, status, loadMore } = usePaginatedQuery(
    api.modelRoutingEvents.listCalls,
    args,
    { initialNumItems: 100 },
  );
  useEffect(() => {
    if (!live || selected || fixedRange) return;
    const timer = setInterval(() => setNow(dayjs().valueOf()), 15000);
    return () => clearInterval(timer);
  }, [live, selected, fixedRange]);
  // Filter on the server and scan beyond empty pages instead of searching only loaded rows.
  useEffect(() => {
    if (results.length < 50 && status === "CanLoadMore") loadMore(100);
  }, [results.length, status, loadMore]);
  const activity = useMemo(() => {
    const buckets = Array.from({ length: 32 }, (_, index) => ({
      from: Math.floor(from + ((to - from) * index) / 32),
      to: Math.floor(from + ((to - from) * (index + 1)) / 32),
      count: 0,
      errors: 0,
    }));
    for (const call of results) {
      const bucket =
        buckets[
          Math.min(
            31,
            Math.max(
              0,
              Math.floor(
                ((call.timestamp - from) / Math.max(1, to - from)) * 32,
              ),
            ),
          )
        ];
      bucket.count++;
      if (call.status === "error" || call.status === "unknown") bucket.errors++;
    }
    return buckets;
  }, [from, to, results]);
  const tableSort = useTableSort("operator-logs:calls", results, CALL_SORT_COLUMNS, {
    key: "time",
    direction: "desc",
  });
  const peak = Math.max(1, ...activity.map((bucket) => bucket.count));
  function updateParams(next: URLSearchParams) {
    router.replace(`${pathname}?${next}`, { scroll: false });
  }
  function changeFilters(next: LogFilters, resetRange = false) {
    const query = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value === defaultFilters[key as keyof LogFilters]) query.delete(key);
      else query.set(key, value);
    }
    if (resetRange || next.hours !== filters.hours) {
      query.delete("from");
      query.delete("to");
    }
    if (next.model !== filters.model) query.delete("modelExact");
    query.delete("call");
    updateParams(query);
  }
  function select(id: string | null) {
    const query = new URLSearchParams(params);
    if (id) query.set("call", id);
    else query.delete("call");
    updateParams(query);
  }
  async function exportLogs() {
    setExporting(true);
    try {
      const lines: string[] = [];
      let cursor: string | null = null;
      for (;;) {
        const page: FunctionReturnType<
          typeof api.modelRoutingEvents.listCalls
        > = await convex.query(api.modelRoutingEvents.listCalls, {
          ...args,
          paginationOpts: { cursor, numItems: 250 },
        });
        lines.push(
          ...page.page.map((call) =>
            JSON.stringify(JSON.parse(diagnostic(call))),
          ),
        );
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
      downloadReport(
        `model-logs-${dayjs(to).format("YYYY-MM-DD")}.jsonl`,
        lines.join("\n"),
        "application/x-ndjson",
      );
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Could not export logs"));
    } finally {
      setExporting(false);
    }
  }
  return (
    <AppShell
      sidebar={({ collapsed, onToggleCollapse }) => (
        <LogSidebar
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          filters={filters}
          customRange={fixedRange}
          onChange={changeFilters}
        />
      )}
      rightPanel={
        selected ? (
          <CallDetails
            key={selected}
            id={selected}
            onClose={() => select(null)}
          />
        ) : undefined
      }
      actions={
        <>
          {!fixedRange ? (
            <PillButton
              variant="secondary"
              onClick={() => {
                setLive((value) => !value);
                setNow(dayjs().valueOf());
              }}
            >
              {live ? (
                <Pause className="size-4" />
              ) : (
                <Play className="size-4" />
              )}
              {live ? "Pause" : "Live"}
            </PillButton>
          ) : null}
          <PillButton
            variant="secondary"
            disabled={exporting}
            onClick={() => void exportLogs()}
          >
            <Download className="size-4" />
            {exporting ? "Exporting…" : "Export"}
          </PillButton>
        </>
      }
    >
      <div className="space-y-4">
        <ListToolbar
          followKey="operator-logs"
          onClearFilters={() =>
            changeFilters({
              ...filters,
              status: "",
              orgId: "",
              routeSource: "",
            })
          }
          filters={[
            {
              id: "status",
              label: "Status",
              inline: true,
              options: LOG_STATUS_OPTIONS,
              value: filters.status ? [filters.status] : [],
              onChange: ([value]) =>
                changeFilters({ ...filters, status: value ?? "" }),
            },
            {
              id: "client",
              label: "Client",
              icon: <Building2 />,
              options: (clients ?? []).map((client) => ({
                value: client._id,
                label: client.name,
                icon: (
                  <OrgBrandIcon
                    name={client.name}
                    iconUrl={client.iconUrl}
                    website={client.website}
                    size="xs"
                  />
                ),
              })),
              value: filters.orgId ? [filters.orgId] : [],
              onChange: ([value]) =>
                changeFilters({ ...filters, orgId: value ?? "" }),
            },
            {
              id: "routeSource",
              label: "Route source",
              icon: <Route />,
              options: LOG_ROUTE_SOURCE_OPTIONS,
              value: filters.routeSource ? [filters.routeSource] : [],
              onChange: ([value]) =>
                changeFilters({ ...filters, routeSource: value ?? "" }),
            },
          ]}
          search={{
            value: filters.search,
            onChange: (search) => changeFilters({ ...filters, search }),
            label: "Search logs",
            placeholder: "Search task, error, request or run ID…",
          }}
          actions={
            <span
              className={`text-muted-foreground ${typeStyle("caption.default")}`}
            >
              {dayjs(from).format("MMM D, HH:mm")} –{" "}
              {dayjs(to).format("MMM D, HH:mm Z")}
              {selected && live ? " · Live paused while inspecting" : ""}
            </span>
          }
        />
        {results.length ? (
          <div>
            <div
              className="flex h-10 items-end gap-1"
              aria-label="Activity in loaded calls"
            >
              {activity.map((bucket, index) => (
                <button
                  key={`${bucket.from}:${index}`}
                  type="button"
                  className={`min-w-0 flex-1 rounded-t-sm focus-visible:outline focus-visible:outline-ring ${bucket.errors ? "bg-destructive/40" : "bg-foreground/20"}`}
                  style={{
                    height: `${Math.max(3, (bucket.count / peak) * 100)}%`,
                  }}
                  title={`${dayjs(bucket.from).format("HH:mm")} · ${bucket.count} loaded calls`}
                  aria-label={`Inspect interval starting ${dayjs(bucket.from).format("MMM D HH:mm")}: ${bucket.count} loaded calls`}
                  onClick={() => {
                    const next = new URLSearchParams(params);
                    next.set("from", String(bucket.from));
                    next.set("to", String(bucket.to));
                    next.delete("call");
                    updateParams(next);
                  }}
                />
              ))}
            </div>
            <p
              className={`mt-2 text-muted-foreground ${typeStyle("caption.default")}`}
            >
              Activity in {results.length.toLocaleString()} loaded calls
            </p>
          </div>
        ) : null}
        <OperationalPanel>
          <Table>
            <TableHeader>
              <TableRow>
                {(
                  [
                    ["time", "Time"],
                    ["status", "Status"],
                    ["task", "Task"],
                    ["model", "Model"],
                    ["tokens", "Tokens"],
                    ["cost", "Cost"],
                  ] as const
                ).map(([key, label]) => (
                  <SortableTableHead key={key} {...tableSort.head(key)}>
                    {label}
                  </SortableTableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {tableSort.rows.map((call) => (
                <TableRow
                  key={call._id}
                  tabIndex={0}
                  role="button"
                  aria-label={`Inspect ${displayTask(call.taskKind)}`}
                  data-state={selected === call._id ? "selected" : undefined}
                  className="cursor-pointer focus-visible:outline focus-visible:outline-ring"
                  onClick={() => select(call._id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      select(call._id);
                    }
                  }}
                >
                  <TableCell className="text-muted-foreground">
                    {dayjs(call.timestamp).format("MMM D HH:mm:ss")}
                  </TableCell>
                  <TableCell>
                    <StatusTag
                      {...callStatusPresentation(call.status)}
                    >
                      {displayTask(call.status ?? "unknown")}
                    </StatusTag>
                  </TableCell>
                  <TableCell>{displayTask(call.taskKind)}</TableCell>
                  <TableCell>{call.model ?? call.callProvider ?? "—"}</TableCell>
                  <TableCell>
                    {call.inputTokens === undefined &&
                    call.outputTokens === undefined
                      ? "—"
                      : tokens(
                          (call.inputTokens ?? 0) + (call.outputTokens ?? 0),
                        )}
                  </TableCell>
                  <TableCell>{cost(call.costUsd)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </OperationalPanel>
        {results.length === 0 ? (
          <p
            className={`py-8 text-center text-muted-foreground ${typeStyle("body.default")}`}
          >
            {status === "Exhausted"
              ? "No calls match this time range and filters."
              : "Searching calls…"}
          </p>
        ) : null}
        {status === "CanLoadMore" || status === "LoadingMore" ? (
          <PillButton
            variant="secondary"
            disabled={status === "LoadingMore"}
            onClick={() => loadMore(250)}
          >
            {status === "LoadingMore" ? "Searching…" : "Load older calls"}
          </PillButton>
        ) : null}
      </div>
    </AppShell>
  );
}
