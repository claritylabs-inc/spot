"use client";

import { getCountries } from "react-phone-number-input";
import flags from "react-phone-number-input/flags";
import { Field, FieldLabel } from "@claritylabs-inc/ui/components/field";
import { SearchableSelect } from "@claritylabs-inc/ui/components/searchable-select";
import { Input } from "@claritylabs-inc/ui/components/input";
import { US_STATE_ABBREVIATIONS } from "@/components/ui/address-autofill-input";

const names = new Intl.DisplayNames(["en"], { type: "region" });
const countries = getCountries()
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
export function DriverJurisdiction({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const parts = value.split(",").map((part) => part.trim());
  const country =
    countries.find((option) => option.value === parts.at(-1))?.value ?? "";
  const region = country ? parts.slice(0, -1).join(", ") : value;
  const regions =
    country === "United States"
      ? states
      : country === "Canada"
        ? provinces
        : [];
  const options = regions.map((label) => ({ value: label, label }));
  return (
    <div className="space-y-4">
      <Field>
        <FieldLabel>Country</FieldLabel>
        <SearchableSelect
          ariaLabel="License issuing country"
          placeholder="Select country"
          value={country}
          options={countries}
          onChange={(next) => onChange(next)}
        />
      </Field>
      <Field>
        <FieldLabel>State / province</FieldLabel>
        {regions.length ? (
          <SearchableSelect
            ariaLabel="License issuing state or province"
            placeholder="Select state / province"
            value={region}
            options={options}
            onChange={(next) =>
              onChange([next, country].filter(Boolean).join(", "))
            }
          />
        ) : (
          <Input
            aria-label="License issuing state or province"
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
