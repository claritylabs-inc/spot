"use client";
import { SearchableSelect } from "@claritylabs-inc/ui/components/searchable-select";
import { CURRENCIES } from "@/lib/currencies";
import { typeStyle } from "@/lib/typography";

const options = CURRENCIES.map(({code,name}) => {
  const symbol = new Intl.NumberFormat("en", {style:"currency", currency:code, currencyDisplay:"narrowSymbol"})
    .formatToParts(0).find(part=>part.type==="currency")?.value ?? code;
  return {
    value:code,
    label:`${code} — ${name}`,
    icon:<span aria-hidden="true" className={`inline-flex min-w-6 justify-center text-muted-foreground ${typeStyle("control.input")}`}>{symbol}</span>,
  };
});

/** Standard ISO code values, searchable names, and locale-supplied symbols. */
export function CurrencySelect({value,onChange,ariaLabel="Currency"}: {value:string;onChange:(value:string)=>void;ariaLabel?:string}) {
  return <SearchableSelect value={value} onChange={onChange} options={options} ariaLabel={ariaLabel} placeholder="Select currency"/>;
}
