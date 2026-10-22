"use client";

import { useContext, useRef, useState } from "react";
import { InlineFieldsContext } from "@/components/ui/inline-fields";
import { Combobox } from "@base-ui/react/combobox";
import { Check, ChevronDown, Search } from "lucide-react";
import { Badge } from "@claritylabs-inc/ui/components/badge";
import { RemoveButton } from "@/components/ui/remove-button";
import { typeStyle } from "@/lib/typography";
import { countryOptions } from "./driver-jurisdiction";
import { INTAKE_UNSURE } from "./unknown-choice";

const options = [...countryOptions, { value: INTAKE_UNSURE, label: INTAKE_UNSURE, icon: undefined }];
type CountryOption = (typeof options)[number];

export function CountriesInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [search, setSearch] = useState("");
  const trigger = useRef<HTMLButtonElement | null>(null);
  const values = value.split(";").map(item => item.trim()).filter(Boolean);
  const selected = values.map(item => options.find(option => option.value === item) ?? { value: item, label: item, icon: undefined });
  const unsure = values.includes(INTAKE_UNSURE);
  const inline = useContext(InlineFieldsContext);
  return <div className={inline ? "space-y-1 py-1" : "space-y-3"}>
    <div className={inline ? undefined : "min-h-14"}>
    {selected.length > 0 && <ul aria-label="Selected countries" className={`flex flex-wrap ${inline ? "gap-1.5" : "gap-2"}`}>{selected.map(option => <li key={option.value} className="min-w-0 max-w-full">
      <Badge variant="outline" className={`h-auto max-w-full gap-2 whitespace-normal bg-popover py-0 pl-3 pr-1 ${inline ? `min-h-8 ${typeStyle("body.default")}` : `min-h-12 ${typeStyle("control.input")}`}`}>
        <span aria-hidden="true" className="shrink-0">{option.icon}</span><span className="min-w-0 whitespace-normal break-words">{option.label}</span>
        <RemoveButton label={`Remove ${option.label}`} onClick={() => {
          onChange(values.filter(item => item !== option.value).join("; "));
          trigger.current?.focus({preventScroll:true});
        }} />
      </Badge>
    </li>)}</ul>}
    </div>
    <Combobox.Root<CountryOption, true> multiple items={options} value={selected}
      inputValue={search} onInputValueChange={setSearch} onOpenChange={open => { if (!open) setSearch(""); }}
      itemToStringLabel={option => option.label} isItemEqualToValue={(a, b) => a.value === b.value} autoHighlight
      onValueChange={items => {
        const next = items.map(item => item.value);
        if (next.includes(INTAKE_UNSURE) && !unsure) onChange(INTAKE_UNSURE);
        else {
          const countries = next.filter(item => item !== INTAKE_UNSURE);
          if (countries.length <= 15) onChange(countries.join("; "));
        }
      }}>
      <Combobox.Trigger ref={trigger} aria-label={label}
        className={inline
          ? `flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md px-3 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus:outline-none ${typeStyle("body.default")}`
          : `flex h-12 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-input bg-popover px-3 text-left transition-colors hover:border-border-hover focus:border-border-focus focus:ring-1 focus:ring-input focus:outline-none ${typeStyle("control.input")}`}>
        <span className={selected.length && !inline ? "text-foreground" : "text-muted-foreground/40"}>
          {unsure ? INTAKE_UNSURE : inline ? selected.length ? "Add country" : "Not provided" : selected.length ? `${selected.length} selected` : "Select countries"}
        </span>
        <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      </Combobox.Trigger>
      <Combobox.Portal><Combobox.Positioner align="start" sideOffset={4} className="isolate z-50">
        <Combobox.Popup className={`w-max max-w-(--available-width) min-w-(--anchor-width) overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-border-emphasized ${typeStyle("control.input")}`}>
          <div className="border-b border-border p-1.5"><div className="relative">
            <Search aria-hidden="true" className="absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground/40" />
            <Combobox.Input aria-label="Search countries" placeholder="Search countries…" className="w-full rounded-md bg-foreground/3 py-1.5 pr-2 pl-6.5 focus:outline-none" />
          </div></div>
          <Combobox.Empty className="px-3 py-2 empty:p-0 text-muted-foreground">No results</Combobox.Empty>
          <Combobox.List className="max-h-dropdown overflow-y-auto">{(option: CountryOption) => <Combobox.Item key={option.value} value={option}
            disabled={!unsure && selected.length >= 15 && !values.includes(option.value) && option.value !== INTAKE_UNSURE}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left data-highlighted:bg-foreground/4 data-disabled:opacity-40">
            <span aria-hidden="true">{option.icon}</span><span className="flex-1">{option.label}</span>
            <Combobox.ItemIndicator><Check aria-hidden="true" className="size-3" /></Combobox.ItemIndicator>
          </Combobox.Item>}</Combobox.List>
        </Combobox.Popup>
      </Combobox.Positioner></Combobox.Portal>
    </Combobox.Root>

  </div>;
}
