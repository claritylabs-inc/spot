import dayjs, { type Dayjs } from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";

dayjs.extend(customParseFormat);

const DISPLAY_DATE_FORMAT = "MMM D, YYYY";
const DISPLAY_DATE_TIME_FORMAT = "MMM D, YYYY [at] h:mm A";

const CALENDAR_DATE_INPUT_FORMATS = [
  "MM/DD/YYYY",
  "M/D/YYYY",
  "YYYY-MM-DD",
  "MMM D, YYYY",
  "MMMM D, YYYY",
  "MMM D YYYY",
  "MMMM D YYYY",
];

type DisplayDateValue = string | number | Dayjs | null | undefined;

function parseDisplayDate(value: DisplayDateValue) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const calendarDate = dayjs(trimmed, CALENDAR_DATE_INPUT_FORMATS, true);
    if (calendarDate.isValid()) return calendarDate;
    value = trimmed;
  }

  if (value === null || value === undefined) return null;
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed : null;
}

function formatDisplayValue(
  value: DisplayDateValue,
  format: string,
  fallback: string,
) {
  return parseDisplayDate(value)?.format(format) ?? fallback;
}

export function formatDisplayDate(
  value: DisplayDateValue,
  fallback = "",
) {
  return formatDisplayValue(value, DISPLAY_DATE_FORMAT, fallback);
}

export function formatDisplayPolicyPeriod(
  effectiveDate: DisplayDateValue,
  expirationDate: DisplayDateValue,
  policyTermType?: string | null,
) {
  const effective = formatDisplayDate(effectiveDate);
  const expiration = formatDisplayDate(expirationDate);
  if (policyTermType?.trim().toLowerCase() === "continuous") {
    return effective ? `${effective} — Until Cancelled` : "Until Cancelled";
  }
  if (effective && expiration) return `${effective} – ${expiration}`;
  if (effective) return `Ongoing from ${effective}`;
  if (expiration) return `Through ${expiration}`;
  return "";
}

export function formatDisplayDateTime(
  value: DisplayDateValue,
  fallback = "",
) {
  return formatDisplayValue(value, DISPLAY_DATE_TIME_FORMAT, fallback);
}

const UTC_DATE_TIME_PARTS = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "UTC",
});

/** Same shape as {@link formatDisplayDateTime} but pinned to UTC, so a value
 * rendered on the server and rehydrated in the browser reads identically. */
export function formatDisplayDateTimeUtc(
  value: DisplayDateValue,
  fallback = "",
) {
  const parsed = parseDisplayDate(value);
  if (!parsed) return fallback;
  const parts = UTC_DATE_TIME_PARTS.formatToParts(parsed.valueOf());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("month")} ${part("day")}, ${part("year")} at ${part("hour")}:${part("minute")} ${part("dayPeriod")} UTC`;
}
