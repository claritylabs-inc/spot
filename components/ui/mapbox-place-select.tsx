"use client";

import { ScrollArea } from "@claritylabs-inc/ui/components/scroll-area";
import { Combobox } from "@base-ui/react/combobox";
import { ChevronDown, Search } from "lucide-react";
import { useEffect, useState } from "react";

import { typeStyle } from "@/lib/typography";

const MAPBOX_ACCESS_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

type PlaceOption = { value: string; label: string };

/** Mapbox Geocoding lookup for countries, or regions (states/provinces) within one country. */
async function searchPlaces(
  kind: "country" | "region",
  query: string,
  countryCode: string | undefined,
  signal: AbortSignal,
): Promise<PlaceOption[]> {
  const params = new URLSearchParams({
    access_token: MAPBOX_ACCESS_TOKEN ?? "",
    types: kind,
    language: "en",
    limit: "10",
    q: query || (kind === "country" ? "united" : "a"),
  });
  if (kind === "region" && countryCode) params.set("country", countryCode);
  const response = await fetch(
    `https://api.mapbox.com/search/geocode/v6/forward?${params}`,
    { signal },
  );
  if (!response.ok) return [];
  const data = (await response.json()) as {
    features?: {
      properties: {
        name: string;
        context?: { country?: { country_code?: string } };
      };
    }[];
  };
  return (data.features ?? []).map((feature) => ({
    value: feature.properties.name,
    label: feature.properties.name,
  }));
}

export function MapboxPlaceSelect({
  kind,
  value,
  onChange,
  countryCode,
  ariaLabel,
  placeholder = "Not provided",
}: {
  kind: "country" | "region";
  value: string;
  onChange: (value: string) => void;
  /** ISO 3166-1 alpha-2 code restricting region results. */
  countryCode?: string;
  ariaLabel: string;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<PlaceOption[]>([]);

  useEffect(() => {
    if (!MAPBOX_ACCESS_TOKEN) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      searchPlaces(kind, query.trim(), countryCode, controller.signal)
        .then(setOptions)
        .catch(() => {});
    }, 150);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [kind, query, countryCode]);

  const items =
    value && !options.some((option) => option.value === value)
      ? [{ value, label: value }, ...options]
      : options;

  return (
    <Combobox.Root<PlaceOption>
      items={items}
      filter={null}
      value={value ? { value, label: value } : null}
      onValueChange={(option) => {
        if (option) {
          setQuery("");
          onChange(option.value);
        }
      }}
      inputValue={query}
      onInputValueChange={setQuery}
      onOpenChange={(open) => {
        if (!open) setQuery("");
      }}
      itemToStringLabel={(option) => option.label}
      isItemEqualToValue={(a, b) => a.value === b.value}
      autoHighlight
    >
      <Combobox.Trigger
        aria-label={ariaLabel}
        className={`flex h-9 w-full min-w-0 items-center justify-between gap-2 overflow-hidden rounded-lg border border-input bg-popover px-3 text-left transition-colors hover:border-border-hover focus:border-border-focus focus:ring-1 focus:ring-input focus:outline-none ${typeStyle("control.input")}`}
      >
        <span
          className={`block min-w-0 flex-1 truncate ${value ? "text-foreground" : "text-muted-foreground/40"}`}
        >
          {value || placeholder}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner
          align="start"
          sideOffset={4}
          className="isolate z-50"
        >
          <Combobox.Popup
            data-typography-role="control.input"
            className={`z-50 w-max max-w-(--available-width) min-w-(--anchor-width) overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-border-emphasized outline-hidden ${typeStyle("control.input")}`}
          >
            <div className="border-b border-border p-1.5">
              <div className="relative">
                <Search className="absolute top-1/2 left-2 h-3 w-3 -translate-y-1/2 text-muted-foreground/40" />
                <Combobox.Input
                  placeholder="Search..."
                  className={`w-full rounded-md bg-foreground/3 py-1.5 pr-2 pl-6.5 placeholder:text-muted-foreground/40 focus:outline-none ${typeStyle("control.input")}`}
                />
              </div>
            </div>
            <Combobox.Empty
              className={`px-3 py-2 empty:p-0 text-muted-foreground/50 ${typeStyle("control.input")}`}
            >
              No results
            </Combobox.Empty>
            <ScrollArea className="max-h-dropdown [&>[data-slot=scroll-area-viewport]]:max-h-[inherit]">
              <Combobox.List>
                {(option: PlaceOption) => (
                  <Combobox.Item
                    key={option.value}
                    value={option}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors data-highlighted:bg-foreground/4 ${typeStyle("control.input")}`}
                  >
                    <span className="flex-1 truncate">{option.label}</span>
                  </Combobox.Item>
                )}
              </Combobox.List>
            </ScrollArea>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
