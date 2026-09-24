"use client";

import { useCallback, type FocusEventHandler } from "react";
import dynamic from "next/dynamic";
import type { AddressAutofillRetrieveResponse } from "@mapbox/search-js-core";
import type { Theme as MapboxSearchTheme } from "@mapbox/search-js-web";

import { Input } from "@claritylabs-inc/ui/components/input";
import { mapboxTypographyAdapter } from "@/lib/typography";

const AddressAutofill = dynamic(
  () =>
    import("@mapbox/search-js-react").then((module) => ({
      default: module.AddressAutofill,
    })),
  { ssr: false },
);

const MAPBOX_ACCESS_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const MAPBOX_ADDRESS_AUTOFILL_OPTIONS = { language: "en", proximity: "ip" } as const;
const MAPBOX_ADDRESS_AUTOFILL_POPOVER_OPTIONS = {
  placement: "bottom-start",
  flip: true,
  offset: 6,
} as const;
const MAPBOX_ADDRESS_AUTOFILL_THEME = {
  variables: {
    unit: "14px",
    minWidth: "min(388px, calc(100vw - 32px))",
    spacing: "0",
    padding: "8px",
    paddingFooterLabel: "8px 10px",
    colorText: "var(--popover-foreground)",
    colorPrimary: "var(--primary)",
    colorSecondary: "var(--muted-foreground)",
    colorBackground: "var(--popover)",
    colorBackgroundHover: "var(--accent)",
    colorBackgroundActive: "var(--secondary)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    boxShadow: "0 16px 40px rgba(0, 0, 0, 0.35)",
    ...mapboxTypographyAdapter.variables,
  },
  cssText: `
    .MapboxSearchListbox {
      overflow: hidden;
    }

    ${mapboxTypographyAdapter.cssText}
  `,
} satisfies MapboxSearchTheme;

const US_STATE_ABBREVIATIONS: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  "district of columbia": "DC",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
};

export type AutofillAddress = {
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  formatted?: string;
};

function normalizeUsState(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  return US_STATE_ABBREVIATIONS[trimmed.toLowerCase()] ?? trimmed;
}

function formattedAddress(address: AutofillAddress) {
  const locality = [
    address.city,
    [address.state, address.zip].filter(Boolean).join(" "),
  ].filter(Boolean).join(", ");
  return [
    address.street1,
    address.street2,
    locality,
    address.country,
  ].filter(Boolean).join(", ");
}

function addressFromRetrieve(response: AddressAutofillRetrieveResponse): AutofillAddress | null {
  const address = response.features[0]?.properties;
  if (!address) return null;
  const result: AutofillAddress = {
    street1: address.address_line1 ?? address.address ?? address.feature_name ?? "",
    street2: address.address_line2 ?? "",
    city: address.address_level2 ?? address.address_level3 ?? "",
    state: normalizeUsState(address.address_level1),
    zip: address.postcode ?? "",
    country: address.country ?? address.country_code?.toUpperCase() ?? "",
  };
  result.formatted = formattedAddress(result);
  return result;
}

export function AddressAutofillInput({
  id,
  value,
  onChange,
  display = "formatted",
  placeholder = "Search for an address",
  autoComplete = "street-address",
  disabled = false,
  className,
  onFocus,
  onBlur,
  onRetrieve,
}: {
  id: string;
  value: AutofillAddress;
  onChange: (address: AutofillAddress) => void;
  display?: "formatted" | "street1";
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
  className?: string;
  onFocus?: FocusEventHandler<HTMLInputElement>;
  onBlur?: FocusEventHandler<HTMLInputElement>;
  onRetrieve?: (address: AutofillAddress) => void;
}) {
  const displayedValue = display === "street1"
    ? value.street1 ?? ""
    : value.formatted || formattedAddress(value);

  const handleRetrieve = useCallback((response: AddressAutofillRetrieveResponse) => {
    const address = addressFromRetrieve(response);
    if (!address) return;
    onChange(address);
    onRetrieve?.(address);
  }, [onChange, onRetrieve]);

  const input = (
    <Input
      id={id}
      value={displayedValue}
      onChange={(event) => {
        const nextValue = event.target.value;
        onChange(display === "street1"
          ? { ...value, street1: nextValue, formatted: undefined }
          : nextValue
            ? { street1: nextValue, formatted: nextValue }
            : {});
      }}
      placeholder={placeholder}
      autoComplete={autoComplete}
      disabled={disabled}
      className={className}
      onFocus={onFocus}
      onBlur={onBlur}
    />
  );

  if (!MAPBOX_ACCESS_TOKEN) return input;
  return (
    <AddressAutofill
      accessToken={MAPBOX_ACCESS_TOKEN}
      options={MAPBOX_ADDRESS_AUTOFILL_OPTIONS}
      theme={MAPBOX_ADDRESS_AUTOFILL_THEME}
      popoverOptions={MAPBOX_ADDRESS_AUTOFILL_POPOVER_OPTIONS}
      onRetrieve={handleRetrieve}
    >
      {input}
    </AddressAutofill>
  );
}
