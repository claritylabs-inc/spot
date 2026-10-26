import type { ReactNode } from "react";
import { OperationalPanel } from "@claritylabs-inc/ui/components/operational-panel";
import { Skeleton } from "@claritylabs-inc/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@claritylabs-inc/ui/components/table";
import { cn } from "@/lib/utils";

/** A skeleton bar sized to one line of body text so rows keep their final height. */
export function SkeletonLine({ className }: { className?: string }) {
  return (
    <div className="flex h-5 items-center">
      <Skeleton className={cn("h-3.5", className)} />
    </div>
  );
}

export function SkeletonTag({ className }: { className?: string }) {
  return <Skeleton className={cn("h-5 w-20 rounded-full", className)} />;
}

export function PillTabsSkeleton({ tabs }: { tabs: string[] }) {
  return (
    <div className="flex items-center gap-1">
      {tabs.map((width, index) => (
        <Skeleton key={index} className={cn("h-6 rounded-full", width)} />
      ))}
    </div>
  );
}

export type TableSkeletonColumn = {
  className?: string;
  cell: ReactNode;
};

export function TableSkeleton({
  columns,
  rows = 6,
  className,
}: {
  columns: TableSkeletonColumn[];
  rows?: number;
  className?: string;
}) {
  return (
    <OperationalPanel as="div" aria-hidden="true">
      <Table className={className}>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((column, index) => (
              <TableHead key={index} className={column.className}>
                <Skeleton className="h-3 w-16" />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }, (_, row) => (
            <TableRow key={row} className="hover:bg-transparent">
              {columns.map((column, index) => (
                <TableCell key={index} className={column.className}>
                  {column.cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </OperationalPanel>
  );
}

/** Mirrors `MarkdownEditor` with its toolbar portaled into the top bar. */
export function MarkdownDocumentSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <div className="min-h-96 space-y-3 p-6">
        <Skeleton className="h-6 w-56 max-w-full" />
        <SkeletonLine className="w-full" />
        <SkeletonLine className="w-11/12" />
        <SkeletonLine className="w-4/5" />
        <div className="pt-3">
          <Skeleton className="h-5 w-40" />
        </div>
        <SkeletonLine className="w-full" />
        <SkeletonLine className="w-3/4" />
      </div>
    </div>
  );
}
