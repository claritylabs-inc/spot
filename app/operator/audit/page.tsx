"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import dayjs from "dayjs";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
  OperationalPanel,
} from "@claritylabs-inc/ui/components/operational-panel";
import {
  StatusTag,
  type StatusPresentation,
} from "@claritylabs-inc/ui/components/status-tag";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app-shell";
import { ChatAvatar } from "@/components/chat/chat-message";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { useFollowedState } from "@/hooks/use-followed-state";
import { useTableSort } from "@/hooks/use-table-sort";
import { PillButton } from "@/components/ui/pill-button";
import { ListToolbar } from "@/components/ui/list-toolbar";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
  SortableTableHead,
} from "@/components/ui/table";
import { getOperatorBrokerHref } from "@/lib/operator-navigation";
import { typeStyle } from "@/lib/typography";

type AuditEntry = FunctionReturnType<
  typeof api.operatorAudit.list
>["entries"][number];

const PAGE_SIZE = 100;
const SOURCES = {
  console: "Console",
  agent: "Spot agent",
  mcp: "MCP",
} as const;

const AUDIT_SORT_COLUMNS = {
  time: (entry: AuditEntry) => entry.at,
  operator: (entry: AuditEntry) => entry.actor?.name ?? "System",
  source: (entry: AuditEntry) => sourceLabel(entry),
  action: (entry: AuditEntry) => entry.title,
  target: (entry: AuditEntry) => targetLink(entry)?.label,
};

function isSource(value: string | null): value is keyof typeof SOURCES {
  return value !== null && value in SOURCES;
}

function sourceLabel(entry: AuditEntry) {
  if (entry.source === "mcp") return entry.client ? `MCP · ${entry.client}` : "MCP";
  if (entry.source === "agent") return `Spot agent · ${entry.channel ?? "chat"}`;
  if (entry.source === "console") return "Console";
  return "Recorded event";
}

function statusPresentation(status: AuditEntry["status"]): StatusPresentation {
  switch (status) {
    case "succeeded":
      return { tone: "neutral", indicator: "complete" };
    case "pending":
      return { tone: "neutral", indicator: "progress" };
    case "awaiting_confirmation":
      return { tone: "warning", indicator: "waiting" };
    case "cancelled":
      return { tone: "neutral", indicator: "cancelled" };
    case "failed":
    case "denied":
      return { tone: "danger", indicator: "error" };
    default:
      return { tone: "neutral", indicator: "complete" };
  }
}

function targetLink(entry: AuditEntry) {
  if (entry.request?.clientOrgId) {
    return {
      href: `/operator/clients/${entry.request.clientOrgId}/procurement/${entry.request.id}`,
      label: entry.request.title,
    };
  }
  if (entry.org) {
    return {
      href:
        entry.org.type === "broker"
          ? getOperatorBrokerHref(entry.org.id)
          : `/operator/clients/${entry.org.id}`,
      label: entry.org.name,
    };
  }
  return null;
}

function Actor({ entry }: { entry: AuditEntry }) {
  if (!entry.actor) return <span className="text-muted-foreground">System</span>;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <ChatAvatar
        name={entry.actor.name}
        imageUrl={entry.actor.avatarUrl}
        className="size-5"
      />
      <span className="truncate">{entry.actor.name}</span>
    </span>
  );
}

function AuditDetails({
  entry,
  onClose,
}: {
  entry: AuditEntry;
  onClose: () => void;
}) {
  const target = targetLink(entry);
  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={entry.title}
    >
      <OperationalLabelValueList>
        <OperationalLabelValueRow
          label="When"
          value={dayjs(entry.at).format("MMM D, YYYY h:mm:ss A")}
        />
        <OperationalLabelValueRow
          label="Operator"
          value={entry.actor?.name ?? "System"}
        />
        <OperationalLabelValueRow label="Source" value={sourceLabel(entry)} />
        {entry.status ? (
          <OperationalLabelValueRow
            label="Status"
            value={entry.status.replaceAll("_", " ")}
          />
        ) : null}
        {entry.effect ? (
          <OperationalLabelValueRow
            label="Effect"
            value={entry.effect.replaceAll("_", " ")}
          />
        ) : null}
        {entry.functionName ? (
          <OperationalLabelValueRow
            label="Function"
            value={<code>{entry.functionName}</code>}
          />
        ) : null}
        {target ? (
          <OperationalLabelValueRow
            label="Target"
            value={
              <Link href={target.href} className="underline underline-offset-4">
                {target.label}
              </Link>
            }
          />
        ) : null}
      </OperationalLabelValueList>
      {entry.detail ? (
        <p className={`mt-4 break-words ${typeStyle("body.default")}`}>
          {entry.detail}
        </p>
      ) : null}
      {entry.error ? (
        <p
          className={`mt-4 break-words text-destructive ${typeStyle("body.default")}`}
        >
          {entry.error}
        </p>
      ) : null}
      {entry.writes.length ? (
        <div className="mt-6 space-y-2">
          <p className={`text-muted-foreground ${typeStyle("label.field")}`}>
            Changed records
          </p>
          <ul className={`space-y-1 ${typeStyle("caption.default")}`}>
            {entry.writes.map((write) => (
              <li key={`${write.op}:${write.id}`} className="flex gap-2">
                <span className="w-14 shrink-0 text-muted-foreground">
                  {write.op}
                </span>
                <span className="shrink-0">{write.table ?? "record"}</span>
                <code className="truncate text-muted-foreground">{write.id}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </SettingsDrawer>
  );
}

export default function OperatorAuditPage() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [limit, setLimit] = useFollowedState("operator-audit:limit", PAGE_SIZE);
  const [selectedId, setSelectedId] = useFollowedState<string | null>(
    "operator-audit:selected-entry",
    null,
  );
  const operatorParam = params.get("operator");
  const sourceParam = params.get("source");
  const source = isSource(sourceParam) ? sourceParam : undefined;
  const operators = useQuery(api.operatorAudit.operators, {});
  const latest = useQuery(api.operatorAudit.list, {
    operatorUserId: (operatorParam as Id<"users"> | null) ?? undefined,
    source,
    limit,
  });
  // Keep rows on screen while a larger page loads.
  const [feed, setFeed] = useState(latest);
  if (latest !== undefined && latest !== feed) setFeed(latest);
  const entries = feed?.entries ?? [];
  const tableSort = useTableSort("operator-audit:entries", entries, AUDIT_SORT_COLUMNS, {
    key: "time",
    direction: "desc",
  });
  const selected = entries.find((entry) => entry.id === selectedId) ?? null;

  function setFilters(values: Partial<Record<"operator" | "source", string>>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setLimit(PAGE_SIZE);
    setFeed(undefined);
    setSelectedId(null);
    router.replace(`${pathname}?${next}`, { scroll: false });
  }

  return (
    <AppShell
      rightPanel={
        selected ? (
          <AuditDetails
            key={selected.id}
            entry={selected}
            onClose={() => setSelectedId(null)}
          />
        ) : undefined
      }
    >
      <div className="space-y-4">
        <ListToolbar
          followKey="operator-audit"
          onClearFilters={() => setFilters({ operator: "", source: "" })}
          filters={[
            {
              id: "operator",
              label: "Operator",
              inline: true,
              options: (operators ?? []).map((operator) => ({
                value: operator.userId,
                label: operator.name,
              })),
              value: operatorParam ? [operatorParam] : [],
              onChange: ([value]) => setFilters({ operator: value ?? "" }),
            },
            {
              id: "source",
              label: "Source",
              inline: true,
              options: Object.entries(SOURCES).map(([value, label]) => ({
                value,
                label,
              })),
              value: source ? [source] : [],
              onChange: ([value]) => setFilters({ source: value ?? "" }),
            },
          ]}
        />
        <OperationalPanel>
          <Table>
            <TableHeader>
              <TableRow>
                {(
                  [
                    ["time", "Time"],
                    ["operator", "Operator"],
                    ["source", "Source"],
                    ["action", "Action"],
                    ["target", "Target"],
                  ] as const
                ).map(([key, label]) => (
                  <SortableTableHead key={key} {...tableSort.head(key)}>
                    {label}
                  </SortableTableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {tableSort.rows.map((entry) => {
                const target = targetLink(entry);
                return (
                  <TableRow
                    key={entry.id}
                    tabIndex={0}
                    role="button"
                    aria-label={`Inspect ${entry.title}`}
                    data-state={selectedId === entry.id ? "selected" : undefined}
                    className="cursor-pointer focus-visible:outline focus-visible:outline-ring"
                    onClick={() => setSelectedId(entry.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedId(entry.id);
                      }
                    }}
                  >
                    <TableCell
                      className="whitespace-nowrap text-muted-foreground"
                      title={dayjs(entry.at).format("MMM D, YYYY h:mm:ss A")}
                    >
                      {dayjs(entry.at).format("MMM D HH:mm:ss")}
                    </TableCell>
                    <TableCell className="max-w-44">
                      <Actor entry={entry} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {sourceLabel(entry)}
                    </TableCell>
                    <TableCell className="max-w-md">
                      <span className="flex items-center gap-2">
                        {entry.status ? (
                          <StatusTag {...statusPresentation(entry.status)}>
                            {entry.title}
                          </StatusTag>
                        ) : (
                          <span className="truncate">{entry.title}</span>
                        )}
                      </span>
                      {entry.detail ? (
                        <span
                          className={`block truncate text-muted-foreground ${typeStyle("caption.default")}`}
                        >
                          {entry.detail}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="max-w-56 truncate">
                      {target ? (
                        <Link
                          href={target.href}
                          className="underline-offset-4 hover:underline"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {target.label}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </OperationalPanel>
        {entries.length === 0 ? (
          <p
            className={`py-8 text-center text-muted-foreground ${typeStyle("body.default")}`}
          >
            {feed === undefined ? "Loading activity…" : "No activity recorded yet."}
          </p>
        ) : null}
        {feed?.hasMore && limit < 500 ? (
          <PillButton
            variant="secondary"
            onClick={() => setLimit((value) => Math.min(500, value + PAGE_SIZE))}
          >
            Load older activity
          </PillButton>
        ) : null}
      </div>
    </AppShell>
  );
}
