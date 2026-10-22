"use client";

import { typeStyle } from "@/lib/typography";
import { SearchableMultiSelect } from "@claritylabs-inc/ui/components/searchable-select";
import {
  BROKER_COUNTRY_CODES,
  BROKER_REGION_CODES,
  CANADIAN_PROVINCES,
  USPS_STATE_NAMES,
  brokerRegionCountry,
} from "@/convex/lib/brokerProfileValidation";

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
const countries = BROKER_COUNTRY_CODES.map((value) => ({
  value,
  label: countryNames.of(value) ?? value,
})).sort((a, b) => a.label.localeCompare(b.label));
const regions = BROKER_REGION_CODES.map((value) => ({
  value,
  label: `${USPS_STATE_NAMES[value] ?? CANADIAN_PROVINCES[value as keyof typeof CANADIAN_PROVINCES]} (${value}) · ${brokerRegionCountry(value) === "CA" ? "Canada" : "United States"}`,
})).sort((a, b) => a.label.localeCompare(b.label));

export function AppetiteCountriesField({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <SearchableMultiSelect
      typographyRole="control.menu"
      ariaLabel="Countries serviced"
      placeholder="Select countries"
      options={countries}
      value={value}
      onChange={onChange}
      disabled={disabled}
    />
  );
}

export function AppetiteRegionsField({
  countries,
  value,
  onChange,
  disabled,
  ariaLabel = "States / provinces serviced",
}: {
  countries: string[];
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const options = regions.filter((option) =>
    countries.includes(brokerRegionCountry(option.value)),
  );
  return (
    <div className="w-full">
      <SearchableMultiSelect
        typographyRole="control.menu"
        ariaLabel={ariaLabel}
        placeholder="Select states / provinces"
        options={options}
        value={value}
        onChange={onChange}
        disabled={disabled || !options.length}
      />
      {!options.length && (
        <p
          className={`px-3 py-1 text-muted-foreground ${typeStyle("caption.default")}`}
        >
          Select Canada or United States to choose states or provinces.
        </p>
      )}
    </div>
  );
}

export function AppetiteNationwideField({
  countries: selectedCountries,
  value,
  onChange,
  disabled,
}: {
  countries: string[];
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="w-full">
      <SearchableMultiSelect
        typographyRole="control.menu"
        ariaLabel="Nationwide service"
        placeholder="No nationwide service confirmed"
        options={countries.filter((option) =>
          selectedCountries.includes(option.value),
        )}
        value={value}
        onChange={onChange}
        disabled={disabled || !selectedCountries.length}
      />
      {!!value.length && (
        <p
          className={`px-3 py-1 text-muted-foreground ${typeStyle("caption.default")}`}
        >
          Includes all states/provinces, except any exclusions below.
        </p>
      )}
    </div>
  );
}
