/** Intake amounts are entered without a currency; the business's registration country implies it. */
export function intakeCurrency(country?: string) {
  return country === "Canada" ? "CAD" : "USD";
}

/** Matches payroll formatting: `CAD 5,000,000`. Non-numeric text passes through unchanged. */
export function formatIntakeMoney(value: string, currency: string) {
  const amount = value
    .trim()
    .replace(/^\$\s*/, "")
    .replaceAll(",", "");
  if (!/^\d+(?:\.\d+)?$/.test(amount)) return value;
  return `${currency} ${Number(amount).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
