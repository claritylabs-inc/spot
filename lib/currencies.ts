import iso4217 from "./data/iso-4217.json";

/** SIX ISO 4217 List One snapshot; exclude fund units, metals and non-currencies.
 * Update from the source/published metadata in the data file, keeping UI and
 * server validation on the same version rather than runtime-specific ICU lists.
 */
export const CURRENCIES = iso4217.currencies;
export const CURRENCY_CODES: readonly string[] = CURRENCIES.map(currency => currency.code);
const codes = new Set(CURRENCY_CODES);
export function isCurrencyCode(value: string) { return codes.has(value); }
