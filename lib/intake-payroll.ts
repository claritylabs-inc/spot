import { parseCalendarDateInput } from "./date-format";
export const PAYROLL_PERIODS = ["Per year", "Per month", "Every two weeks", "Per week", "Custom dates", "I'm not sure"] as const;
export const PAYROLL_CURRENCIES = ["USD", "CAD", "EUR", "GBP", "AUD", "NZD", "CHF", "JPY"] as const;
export type PayrollGroup = { employees: string; headcount: string; amount: string; currency: string; period: string; start: string; end: string };
export type PayrollAnswer = { version: "payroll-v1"; groups: PayrollGroup[]; legacy?: string };
export const newPayrollGroup = (): PayrollGroup => ({ employees: "", headcount: "", amount: "", currency: "USD", period: "", start: "", end: "" });
export function parsePayrollAnswer(value: string): PayrollAnswer | undefined {
  try {
    const parsed = JSON.parse(value);
    if (parsed?.version !== "payroll-v1" || !Array.isArray(parsed.groups) || parsed.groups.length > 6 ||
      (parsed.legacy !== undefined && (typeof parsed.legacy !== "string" || parsed.legacy.length > 2000)) ||
      parsed.groups.some((row: PayrollGroup) => !row || ["employees", "headcount", "amount", "currency", "period", "start", "end"].some(key => typeof row[key as keyof PayrollGroup] !== "string") ||
        row.employees.length > 120 || row.headcount.length > 12 || row.amount.length > 24 || !PAYROLL_CURRENCIES.includes(row.currency as typeof PAYROLL_CURRENCIES[number]) ||
        !["", "Next 12 months", "Last 12 months", ...PAYROLL_PERIODS].includes(row.period) || row.start.length > 10 || row.end.length > 10 ||
        (row.amount && row.amount !== "I'm not sure" && !/^\d[\d,]*(?:\.\d{0,2})?$/.test(row.amount)) ||
        (row.headcount && row.headcount !== "I'm not sure" && !/^\d+$/.test(row.headcount)))) return;
    return parsed;
  } catch { return; }
}
export function payrollAnswerComplete(value: string) {
  if (!value || value === "I'm not sure") return true;
  const parsed = parsePayrollAnswer(value);
  if (!parsed) return !value.trim().startsWith('{'); // Retain historical prose without inventing a split.
  return !!parsed.groups.length && parsed.groups.every(row => row.employees.trim() && row.amount && row.period &&
    (row.period !== "Custom dates" || (parseCalendarDateInput(row.start) && parseCalendarDateInput(row.end) && row.start <= row.end)));
}
export function formatPayrollAnswer(value: string) {
  const parsed = parsePayrollAnswer(value);
  if (!parsed) return value;
  return [...(parsed.legacy ? [`Previous answer: ${parsed.legacy}`] : []), ...parsed.groups.map(row => {
    const amount = row.amount === "I'm not sure" ? "Payroll: I'm not sure" : row.amount ? `${row.currency} ${Number(row.amount.replaceAll(",", "")).toLocaleString("en-US", {maximumFractionDigits:2})}` : "Payroll not provided";
    const period = row.period === "Custom dates" ? `${row.start || "?"} to ${row.end || "?"}` : row.period || "Period not provided";
    return `${row.employees || "Employee group"}${row.headcount ? ` (${row.headcount} employees)` : ""}: ${amount}; ${period}`;
  })].join("\n");
}
