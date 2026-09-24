import * as React from "react";
import Link from "next/link";
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  TableNameLink as BaseTableNameLink,
} from "@claritylabs-inc/ui/components/table";

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
};
