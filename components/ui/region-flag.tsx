import { CountryFlag } from "@/components/ui/country-flag";

// Files in public/flags/regions.
const REGION_FLAGS = new Set([
  "CA-AB",
  "CA-BC",
  "CA-MB",
  "CA-NB",
  "CA-NL",
  "CA-NS",
  "CA-NT",
  "CA-NU",
  "CA-ON",
  "CA-PE",
  "CA-QC",
  "CA-SK",
  "CA-YT",
  "US-AK",
  "US-AL",
  "US-AR",
  "US-AZ",
  "US-CA",
  "US-CO",
  "US-CT",
  "US-DC",
  "US-DE",
  "US-FL",
  "US-GA",
  "US-HI",
  "US-IA",
  "US-ID",
  "US-IL",
  "US-IN",
  "US-KS",
  "US-KY",
  "US-LA",
  "US-MA",
  "US-MD",
  "US-ME",
  "US-MI",
  "US-MN",
  "US-MO",
  "US-MS",
  "US-MT",
  "US-NC",
  "US-ND",
  "US-NE",
  "US-NH",
  "US-NJ",
  "US-NM",
  "US-NV",
  "US-NY",
  "US-OH",
  "US-OK",
  "US-OR",
  "US-PA",
  "US-RI",
  "US-SC",
  "US-SD",
  "US-TN",
  "US-TX",
  "US-UT",
  "US-VA",
  "US-VT",
  "US-WA",
  "US-WI",
  "US-WV",
  "US-WY",
]);

/** A state or province flag, falling back to the country flag. */
export function RegionFlag({
  country,
  region,
  label,
}: {
  country: string;
  region: string;
  label: string;
}) {
  const code = `${country}-${region}`;
  if (!REGION_FLAGS.has(code)) return <CountryFlag code={country} label={label} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny static icon
    <img
      src={`/flags/regions/${code}.webp`}
      alt={label}
      title={label}
      width={16}
      height={12}
      loading="lazy"
      className="h-3 w-4 shrink-0 rounded-xs object-cover"
    />
  );
}
