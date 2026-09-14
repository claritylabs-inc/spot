import { isLobCode, type AcordLobCode } from "./linesOfBusiness";
import { NoWriteInputError } from "./noWriteInputError";

export const USPS_STATE_CODES = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
  "DC",
] as const;

const USPS_STATES = new Set<string>(USPS_STATE_CODES);

export function normalizeBrokerWritingStates(values: readonly string[]) {
  const states = Array.from(
    new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean)),
  );
  const invalid = states.filter((state) => !USPS_STATES.has(state));
  if (invalid.length > 0) {
    throw new NoWriteInputError(
      "invalid_writing_state",
      `Invalid writing state ${invalid.join(", ")}. Use exact two-letter USPS state codes.`,
    );
  }
  return states.sort();
}

export function normalizeBrokerLineOfBusinessCodes(
  values: readonly string[],
): AcordLobCode[] {
  const lines = Array.from(
    new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean)),
  );
  const invalid = lines.filter((line) => !isLobCode(line));
  if (invalid.length > 0) {
    throw new NoWriteInputError(
      "invalid_acord_lob",
      `Invalid ACORD LOBCd ${invalid.join(", ")}. Use exact catalog codes; common commercial codes include CGL (General Liability), PROP (Commercial Property), and AUTOB (Business Automobile).`,
    );
  }
  return lines.sort() as AcordLobCode[];
}
