"use client";

import { useId, useMemo, useState } from "react";
import { useEntityPreview } from "@/hooks/use-entity-preview";
import type { PresentationProps } from "@/lib/chat-presentation";
import { typeStyle } from "@/lib/typography";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
  OperationalPanel,
} from "@/components/ui/operational-panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableNameLink,
  TableRow,
} from "@/components/ui/table";
import { StatusTag } from "@/components/ui/status-tag";
import { usePresentation } from "./context";
import { referenceHref, Sources } from "./references";

export function FactList({ facts }: PresentationProps<"FactList">) {
  const firstSources = [...new Set(facts[0]?.sourceIds)].sort();
  const sharedSources =
    firstSources.length > 0 &&
    facts.every(
      (fact) =>
        JSON.stringify([...new Set(fact.sourceIds)].sort()) ===
        JSON.stringify(firstSources),
    )
      ? firstSources
      : [];
  return (
    <div>
      <OperationalLabelValueList>
        {facts.map((fact, index) => (
          <OperationalLabelValueRow
            key={index}
            label={fact.label}
            value={
              <>
                <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {fact.value || "—"}
                </span>
                {!sharedSources.length ? (
                  <Sources ids={fact.sourceIds} />
                ) : null}
              </>
            }
          />
        ))}
      </OperationalLabelValueList>
      <Sources ids={sharedSources} />
    </div>
  );
}

export function ComparisonTable({
  columns,
  rows,
}: PresentationProps<"ComparisonTable">) {
  const { openEvidence } = usePresentation();
  return (
    <OperationalPanel>
      <Table aria-label="Comparison">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Item</TableHead>
            {columns.map((column) => (
              <TableHead
                key={column.id}
                scope="col"
                className="min-w-32 whitespace-normal"
              >
                {column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => {
            const inspect = () =>
              openEvidence?.({
                title: row.label,
                values: columns.map((column, valueIndex) => ({
                  label: column.label,
                  value: row.values[valueIndex],
                })),
                sourceIds: row.sourceIds,
              });
            return (
              <TableRow
                key={index}
                tabIndex={0}
                aria-label={`Inspect ${row.label}`}
                onClick={inspect}
                onKeyDown={(event) => {
                  if (
                    event.target === event.currentTarget &&
                    (event.key === "Enter" || event.key === " ")
                  ) {
                    event.preventDefault();
                    inspect();
                  }
                }}
                className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <TableHead
                  scope="row"
                  className="min-w-32 whitespace-normal align-top py-3 text-foreground"
                >
                  {row.label}
                </TableHead>
                {row.values.map((value, i) => (
                  <TableCell
                    key={i}
                    className="max-w-72 whitespace-pre-wrap align-top [overflow-wrap:anywhere]"
                  >
                    {value || "—"}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </OperationalPanel>
  );
}

const statuses = {
  satisfied: { label: "Satisfied", tone: "success" },
  missing: { label: "Missing", tone: "danger" },
  uncertain: { label: "Uncertain", tone: "warning" },
  information: { label: "Information", tone: "neutral" },
} as const;

export function FindingsList({ findings }: PresentationProps<"FindingsList">) {
  return (
    <OperationalPanel>
      <ul className="divide-y divide-border">
        {findings.map((finding, index) => (
          <li key={index} className="space-y-2 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span className={typeStyle("body.medium")}>{finding.label}</span>
              <StatusTag tone={statuses[finding.status].tone}>
                {statuses[finding.status].label}
              </StatusTag>
            </div>
            <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
              {finding.detail}
            </p>
            <Sources ids={finding.sourceIds} />
          </li>
        ))}
      </ul>
    </OperationalPanel>
  );
}

export function RequirementMatrix({
  requirements,
}: PresentationProps<"RequirementMatrix">) {
  const [status, setStatus] = useState("all");
  const visible = requirements.filter(
    (row) => status === "all" || row.status === status,
  );
  return (
    <div className="space-y-3">
      <Select
        value={status}
        onValueChange={(value) => setStatus(value ?? "all")}
      >
        <SelectTrigger aria-label="Filter requirements">
          <SelectValue>
            {status === "all"
              ? "All requirements"
              : status === "satisfied"
                ? "Satisfied"
                : status === "missing"
                  ? "Missing"
                  : "Uncertain"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All requirements</SelectItem>
          {["satisfied", "missing", "uncertain"].map((value) => (
            <SelectItem key={value} value={value}>
              {value === "satisfied"
                ? "Satisfied"
                : value === "missing"
                  ? "Missing"
                  : "Uncertain"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FindingsList
        findings={visible.map((row) => ({ ...row, detail: row.evidence }))}
      />
      {!visible.length ? (
        <p className="text-muted-foreground" role="status">
          No matching requirements.
        </p>
      ) : null}
    </div>
  );
}

export function RecordList({ records }: PresentationProps<"RecordList">) {
  const { references, openRecord } = usePresentation();
  const { openPreview } = useEntityPreview();
  const [filter, setFilter] = useState("");
  const [order, setOrder] = useState("original");
  const filterId = useId();
  const visible = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase();
    const items = records.flatMap((record) => {
      const reference = references.get(record.referenceId);
      return reference &&
        `${reference.label} ${record.detail ?? ""}`
          .toLocaleLowerCase()
          .includes(query)
        ? [{ ...record, reference }]
        : [];
    });
    if (order !== "original")
      items.sort(
        (a, b) =>
          (order === "ascending" ? 1 : -1) *
          a.reference.label.localeCompare(b.reference.label, undefined, {
            numeric: true,
            sensitivity: "base",
          }),
      );
    return items;
  }, [filter, order, records, references]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <div className="min-w-40 flex-1">
          <label htmlFor={filterId} className="sr-only">
            Filter results
          </label>
          <Input
            id={filterId}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter results"
          />
        </div>
        <Select
          value={order}
          onValueChange={(value) => setOrder(value ?? "original")}
        >
          <SelectTrigger aria-label="Sort results" className="w-40">
            <SelectValue>
              {order === "original"
                ? "Original order"
                : order === "ascending"
                  ? "Name A–Z"
                  : "Name Z–A"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="original">Original order</SelectItem>
            <SelectItem value="ascending">Name A–Z</SelectItem>
            <SelectItem value="descending">Name Z–A</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <OperationalPanel>
        <Table aria-label="Results">
          <TableBody>
            {visible.map(({ reference, detail }, index) => {
              const href = referenceHref(reference);
              const open = () =>
                reference.kind === "policy"
                  ? openPreview({
                      type: "policy",
                      id: reference.recordId,
                      page: reference.page,
                      citedSourceSpanIds: reference.sourceSpanIds,
                    })
                  : openRecord(reference, detail);
              return (
                <TableRow
                  key={`${reference.id}:${index}`}
                  tabIndex={0}
                  aria-label={`Preview ${reference.label}`}
                  onClick={open}
                  onKeyDown={(event) => {
                    if (
                      event.target === event.currentTarget &&
                      (event.key === "Enter" || event.key === " ")
                    ) {
                      event.preventDefault();
                      open();
                    }
                  }}
                  className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <TableCell className="whitespace-normal [overflow-wrap:anywhere]">
                    {href ? (
                      <TableNameLink href={href}>
                        {reference.label}
                      </TableNameLink>
                    ) : (
                      <span className={typeStyle("body.medium")}>
                        {reference.label}
                      </span>
                    )}
                    {detail ? (
                      <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                        {detail}
                      </p>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {!visible.length ? (
          <p role="status" className="p-4 text-muted-foreground">
            No matching results.
          </p>
        ) : null}
      </OperationalPanel>
      <p
        role="status"
        className={`text-muted-foreground ${typeStyle("caption.default")}`}
      >
        {visible.length} of {records.length} results
      </p>
    </div>
  );
}
