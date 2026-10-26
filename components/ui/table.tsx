import * as React from "react";
import Link from "next/link";
import {
  Table as BaseTable,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  TableNameLink as BaseTableNameLink,
  SortableTableHead,
} from "@claritylabs-inc/ui/components/table";

// Every table's columns are resizable unless a caller opts out.
function Table({
  resizable = true,
  ...props
}: React.ComponentProps<typeof BaseTable>) {
  return <BaseTable resizable={resizable} {...props} />;
}

type BaseTableNameLinkProps = React.ComponentProps<typeof BaseTableNameLink>;

// Keep Next client navigation when rendering shared links.
function TableNameLink({ href, render, ...props }: BaseTableNameLinkProps) {
  return (
    <BaseTableNameLink
      href={href}
      render={render ?? <Link href={href} />}
      {...props}
    />
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  TableNameLink,
  SortableTableHead,
};
