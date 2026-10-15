"use client";

import {
  Children,
  createContext,
  isValidElement,
  useContext,
  type ReactNode,
  type ComponentPropsWithoutRef,
} from "react";
import type { Components, ExtraProps } from "react-markdown";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
} from "@claritylabs-inc/ui/components/operational-panel";
import { ProseMarkdown } from "@/components/prose-markdown";
import { typeStyle } from "@/lib/typography";

const RowCardContext = createContext(false);
export function MarkdownReviewTable({
  children,
  node,
  extraRows,
}: ComponentPropsWithoutRef<"table"> & ExtraProps & { extraRows?: ReactNode }) {
  const rows =
    node?.children.flatMap((section) =>
      section.type === "element"
        ? section.children.filter(
            (row) => row.type === "element" && row.tagName === "tr",
          )
        : [],
    ) ?? [];
  const labelValues =
    Boolean(extraRows) ||
    (rows.length > 0 &&
      rows.every(
        (row) =>
          row.type === "element" &&
          row.children.filter((cell) => cell.type === "element").length === 2,
      ));
  return (
    <RowCardContext.Provider value={labelValues}>
      {labelValues ? (
        <OperationalLabelValueList className="my-3 [&>dl>div]:grid-cols-1 [&>dl>div]:gap-2 sm:[&>dl>div]:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] sm:[&>dl>div]:gap-4 [&_dd]:min-w-0 [&_dd]:text-left sm:[&_dd]:text-right [&>dl>div:has([data-review-prose])]:grid-cols-1 [&>dl>div:has([data-review-prose])]:gap-y-1 [&>dl>div:has([data-review-prose])_dd]:text-left">
          {children}
          {extraRows}
        </OperationalLabelValueList>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">{children}</table>
        </div>
      )}
    </RowCardContext.Provider>
  );
}
const PacketHead: NonNullable<Components["thead"]> = ({ children }) =>
  useContext(RowCardContext) ? null : <thead>{children}</thead>;
const PacketBody: NonNullable<Components["tbody"]> = ({ children }) =>
  useContext(RowCardContext) ? <>{children}</> : <tbody>{children}</tbody>;
const PacketRow: NonNullable<Components["tr"]> = ({ children, node }) => {
  const rowCards = useContext(RowCardContext);
  if (!rowCards) return <tr>{children}</tr>;
  if (
    node?.children.some(
      (child) => child.type === "element" && child.tagName === "th",
    )
  )
    return null;
  const cells = Children.toArray(children)
    .filter(isValidElement)
    .map((cell) => (cell.props as { children?: ReactNode }).children);
  const longAnswer = node?.children.some(
    (cell) =>
      cell.type === "element" &&
      cell.children.some(
        (child) => child.type === "text" && child.value.length > 160,
      ),
  );
  return (
    <OperationalLabelValueRow
      layout={longAnswer ? "stacked" : "responsive"}
      label={<span className={typeStyle("body.root")}>{cells[0]}</span>}
      value={
        <div
          data-review-prose={longAnswer || undefined}
          className={`whitespace-pre-wrap break-words ${typeStyle("body.root")}`}
        >
          {cells[1]}
        </div>
      }
    />
  );
};
export const markdownReviewRows: Components = {
  table: MarkdownReviewTable,
  thead: PacketHead,
  tbody: PacketBody,
  tr: PacketRow,
};
export function MarkdownReview({ children }: { children: string }) {
  return (
    <div data-review-content>
      <ProseMarkdown
        gfm
        headingRole="heading.item"
        components={markdownReviewRows}
        className="w-full max-w-none [&>h2]:mt-8 [&>h2:first-child]:mt-0"
      >
        {children}
      </ProseMarkdown>
    </div>
  );
}
