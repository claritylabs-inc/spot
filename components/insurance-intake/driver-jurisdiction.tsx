"use client";

import { getCountries } from "react-phone-number-input";
import { useState } from "react";
import { useCountryHint } from "@/hooks/use-country-hint";
import flags from "react-phone-number-input/flags";
import { Field, FieldLabel } from "@claritylabs-inc/ui/components/field";
import { SearchableSelect } from "@claritylabs-inc/ui/components/searchable-select";
import { Input } from "@claritylabs-inc/ui/components/input";
import { typeStyle } from "@/lib/typography";
import { US_STATE_ABBREVIATIONS } from "@/components/ui/address-autofill-input";

const names = new Intl.DisplayNames(["en"], { type: "region" });
export const countryOptions = getCountries()
  .map((code) => {
    const label = names.of(code) || code;
    const Flag = flags[code];
    return {
      value: label,
      label,
      icon: Flag ? (
        <span className="flex h-3 w-4 overflow-hidden rounded-xs">
          <Flag title={label} />
        </span>
      ) : undefined,
    };
  })
  .sort((a, b) => a.label.localeCompare(b.label));
const countries = countryOptions;
const provinces = [
  "Alberta",
  "British Columbia",
  "Manitoba",
  "New Brunswick",
  "Newfoundland and Labrador",
  "Northwest Territories",
  "Nova Scotia",
  "Nunavut",
  "Ontario",
  "Prince Edward Island",
  "Quebec",
  "Saskatchewan",
  "Yukon",
];
const states = Object.keys(US_STATE_ABBREVIATIONS).map((name) =>
  name.replace(/\b\w/g, (letter) => letter.toUpperCase()),
);

/** Keep the existing jurisdiction string compatible with saved applications. */
export function JurisdictionFields({
  value,
  onChange,
  countryLabel = "Country",
  regionLabel = "State / province",
  allowUnknown = false,
  defaultCountry,
}: {
  value: string;
  onChange: (value: string) => void;
  countryLabel?: string;
  regionLabel?: string;
  allowUnknown?: boolean;
  defaultCountry?: string;
}) {
  const hint = useCountryHint(defaultCountry);
  const [touched, setTouched] = useState(false);
  const savedCountry = countries.find(option => value === option.value || value.endsWith(`, ${option.value}`))?.value ?? "";
  const country = savedCountry || (!value && !touched ? hint : "");
  const region = savedCountry ? value.slice(0, -savedCountry.length).replace(/,\s*$/, "") : value;
  const regions =
    country === "United States"
      ? states
      : country === "Canada"
        ? provinces
        : [];
  const options = [...regions, ...(allowUnknown ? ["I'm not sure"] : [])].map((label) => ({ value: label, label }));
  return (
    <div className="space-y-4">
      <Field>
        <FieldLabel className={typeStyle("body.root")}>{countryLabel}</FieldLabel>
        <SearchableSelect
          ariaLabel={countryLabel}
          placeholder="Select country"
          value={country}
          options={countries}
          onChange={(next) => { setTouched(true); onChange(next); }}
        />
      </Field>
      <Field>
        <FieldLabel className={typeStyle("body.root")}>{regionLabel}</FieldLabel>
        {regions.length ? (
          <SearchableSelect
            ariaLabel={regionLabel}
            placeholder="Select state / province"
            value={region}
            options={options}
            onChange={(next) =>
              onChange([next, country].filter(Boolean).join(", "))
            }
          />
        ) : (
          <Input
            aria-label={regionLabel}
            placeholder="State / province"
            value={region}
            disabled={!country && !region}
            onChange={(event) =>
              onChange([event.target.value, country].filter(Boolean).join(", "))
            }
          />
        )}
      </Field>
    </div>
  );
}

export function DriverJurisdiction(props: {value: string; onChange: (value: string) => void; defaultCountry?: string}) {
  return <JurisdictionFields {...props} countryLabel="License issuing country" regionLabel="License issuing state or province" />;
}
export function jurisdictionParts(value: string) {
  const country = countries.find(option => value === option.value || value.endsWith(`, ${option.value}`))?.value ?? "";
  return { country, region: country ? value.slice(0, -country.length).replace(/,\s*$/, "") : value };
}
