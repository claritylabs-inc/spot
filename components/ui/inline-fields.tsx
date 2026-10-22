"use client";

import { createContext, useContext, type ReactNode } from "react";
export const InlineFieldsContext = createContext(false);
/** Question-length labels get half the row; narrow panels stack label over value. */
type InlineFieldLayout = "default" | "wide" | "stacked";
const InlineFieldLayoutContext = createContext<InlineFieldLayout>("default");
export const InlineCollectionActionsContext = createContext(false);
import { typeStyle } from "@/lib/typography";

/** Readable field rows whose controls are always live; persistence stays with their owner. */
export function InlineFieldCard({
  children,
  title,
  actions,
  wideLabels = false,
}: {
  children: ReactNode;
  title?: ReactNode;
  actions?: ReactNode;
  wideLabels?: boolean;
}) {
  return (
    <InlineFieldLayoutContext.Provider value={wideLabels ? "wide" : "default"}>
    <div
      data-inline-field-card
      className="overflow-hidden rounded-lg border border-border divide-y divide-border"
    >
      {title && (
        <div className="flex min-h-11 items-center justify-between gap-3 px-4 py-2">
          <h3 className={typeStyle("body.medium")}>{title}</h3>
          {actions}
        </div>
      )}
      {children}
    </div>
    </InlineFieldLayoutContext.Provider>
  );
}
/** Borderless stacked rows for panels, where the panel already frames the content. */
export function InlineFieldList({ children }: { children: ReactNode }) {
  return (
    <InlineFieldLayoutContext.Provider value="stacked">
      <div data-inline-field-card className="divide-y divide-border">
        {children}
      </div>
    </InlineFieldLayoutContext.Provider>
  );
}
export function InlineFieldRow({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  const layout = useContext(InlineFieldLayoutContext);
  return (
    <div
      data-inline-field-row
      data-row-layout={layout === "default" ? undefined : layout}
      className={`grid min-w-0 items-center gap-2 px-4 py-1 ${layout === "stacked" ? "grid-cols-1 gap-y-0.5 py-2" : layout === "wide" ? "grid-cols-1 gap-y-1 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:py-1" : "grid-cols-[minmax(0,0.35fr)_minmax(0,0.65fr)] sm:grid-cols-[minmax(0,min(35%,20rem))_minmax(0,1fr)]"} sm:gap-4 [&_input]:h-9! [&_input]:min-h-9! [&_[data-slot=select-trigger]]:h-9! [&_[data-slot=select-trigger]]:min-h-9! [&_[data-slot=select-trigger]]:items-center! [&_[data-slot=select-trigger]]:py-1! [&_input]:text-left! [&_textarea]:text-left! [&_textarea]:field-sizing-content! [&_textarea]:min-h-9! [&_textarea]:h-auto! [&_textarea]:py-[7px]! [&_textarea]:resize-none! [&:has(textarea)]:items-start [&:has(textarea)>:first-child]:pt-2 [&:has([data-inline-multiline])]:items-start [&:has([data-inline-multiline])>:first-child]:pt-2 [&_[data-slot=select-trigger]]:text-left! [&_[data-slot=select-value]]:text-left! [&_[data-slot=select-trigger]]:whitespace-normal! [&_[data-slot=select-value]]:line-clamp-none! [&_[data-slot=select-value]]:flex! [&_[data-slot=select-value]]:items-center! [&_[data-slot=select-trigger]>svg:last-child]:opacity-0 [&_[data-slot=select-trigger]:focus-visible>svg:last-child]:opacity-100 [&_[data-slot=select-trigger][aria-expanded=true]>svg:last-child]:opacity-100 ${typeStyle("body.default")}`}
    >
      <div className={`text-muted-foreground ${typeStyle("body.default")}`}>
        {label}
      </div>
      <div
        className={`min-w-0 ${typeStyle("body.default")
          .split(" ")
          .map((token) => `[&_button[role=combobox]]:${token}!`)
          .join(
            " ",
          )} [&_button[role=combobox]]:h-9! [&_button[role=combobox]]:min-h-9! [&_button[role=combobox]]:border-transparent! [&_button[role=combobox]]:bg-transparent! [&_button[role=combobox]>svg:last-child]:opacity-0 [&_button[role=combobox]:focus-visible>svg:last-child]:opacity-100 [&_button[role=combobox][aria-expanded=true]>svg:last-child]:opacity-100 [&_button[role=combobox]:hover]:bg-muted! [&_button[role=combobox]:focus-visible]:bg-muted! [&_button[role=combobox][aria-expanded=true]]:bg-muted! [&_button[role=combobox]:focus-visible]:border-input`}
      >
        {children}
      </div>
    </div>
  );
}
