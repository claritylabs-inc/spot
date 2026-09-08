"use client";

import { Combobox } from "@base-ui/react/combobox";
import { ChevronDown, Check, Search } from "lucide-react";
import { useState, type ReactNode } from "react";
import { typeStyle } from "@/lib/typography";

interface SearchableSelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
}

export function SearchableSelect({
  options,
  value,
  ...props
}: SearchableSelectProps) {
  return (
    <SearchableSelectControl
      key={`${value}:${JSON.stringify(options.map(({ value, label }) => [value, label]))}`}
      options={options}
      value={value}
      {...props}
    />
  );
}

function SearchableSelectControl({
  options,
  value,
  onChange,
  placeholder = "Select...",
  disabled = false,
  ariaLabel,
}: SearchableSelectProps) {
  const selected = options.find((o) => o.value === value) ?? null;
  const [inputValue, setInputValue] = useState("");

  return (
    <Combobox.Root
      items={options}
      value={selected}
      onValueChange={(option) => {
        if (option) {
          setInputValue("");
          onChange(option.value);
        }
      }}
      inputValue={inputValue}
      onInputValueChange={setInputValue}
      onOpenChange={(open) => {
        if (!open) setInputValue("");
      }}
      itemToStringLabel={(option) => option.label}
      isItemEqualToValue={(a, b) => a.value === b.value}
      autoHighlight
      disabled={disabled}
    >
      <Combobox.Trigger
        aria-label={ariaLabel}
        className={`flex h-9 w-full min-w-0 items-center justify-between gap-2 overflow-hidden rounded-lg border border-input bg-popover px-3 text-left transition-colors hover:border-border-hover hover:bg-foreground/1.5 focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-input disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-input disabled:hover:bg-popover ${typeStyle("control.menu")}`}
      >
        {selected?.icon ? (
          <span aria-hidden="true" className="shrink-0">
            {selected.icon}
          </span>
        ) : null}
        <span
          className={`block min-w-0 flex-1 truncate ${selected ? "text-foreground" : "text-muted-foreground/40"}`}
          title={selected?.label}
        >
          {selected?.label || placeholder}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      </Combobox.Trigger>

      <Combobox.Portal>
        <Combobox.Positioner
          align="start"
          sideOffset={4}
          className="isolate z-50"
        >
          <Combobox.Popup
            className={`z-50 w-(--anchor-width) overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-border-emphasized outline-hidden duration-75 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 ${typeStyle("control.menu")}`}
          >
            <div className="p-1.5 border-b border-border">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/40" />
                <Combobox.Input
                  placeholder="Search..."
                  className={`w-full pl-6.5 pr-2 py-1.5 rounded-md bg-foreground/3 placeholder:text-muted-foreground/40 focus:outline-none ${typeStyle("control.input")}`}
                />
              </div>
            </div>
            <Combobox.Empty
              className={`px-3 py-2 text-muted-foreground/50 ${typeStyle("control.menu")}`}
            >
              No results
            </Combobox.Empty>
            <Combobox.List className="max-h-48 overflow-y-auto py-1">
              {(option: SearchableSelectOption) => (
                <Combobox.Item
                  key={option.value}
                  value={option}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors data-highlighted:bg-foreground/4 ${typeStyle("control.menu")}`}
                >
                  {option.icon ? (
                    <span aria-hidden="true" className="shrink-0">
                      {option.icon}
                    </span>
                  ) : null}
                  <span className="flex-1 truncate">{option.label}</span>
                  <Combobox.ItemIndicator>
                    <Check className="w-3 h-3 text-foreground shrink-0" />
                  </Combobox.ItemIndicator>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
