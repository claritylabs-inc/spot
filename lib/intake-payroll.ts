import { CURRENCY_CODES, isCurrencyCode } from "./currencies";
import { parseCalendarDateInput } from "./date-format";
export const PAYROLL_PERIODS = ["Per year", "Per month", "Every two weeks", "Per week", "Custom dates", "I'm not sure"] as const;
export const PAYROLL_CURRENCIES = CURRENCY_CODES;
export type PayrollGroup = { employees: string; headcount: string; amount: string; currency: string; period: string; start: string; end: string };
export type PayrollAnswer = { version: "payroll-v1"; groups: PayrollGroup[]; legacy?: string };
export const newPayrollGroup = (): PayrollGroup => ({ employees: "", headcount: "", amount: "", currency: "USD", period: "", start: "", end: "" });
export function parsePayrollAnswer(value: string): PayrollAnswer | undefined {
  try {
    const parsed = JSON.parse(value);
    if (parsed?.version !== "payroll-v1" || !Array.isArray(parsed.groups) || parsed.groups.length > 6 ||
      (parsed.legacy !== undefined && (typeof parsed.legacy !== "string" || parsed.legacy.length > 2000)) ||
      parsed.groups.some((row: PayrollGroup) => !row || ["employees", "headcount", "amount", "currency", "period", "start", "end"].some(key => typeof row[key as keyof PayrollGroup] !== "string") ||
        row.employees.length > 120 || row.headcount.length > 12 || row.amount.length > 24 || !isCurrencyCode(row.currency) ||
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
  return !!parsed.groups.length && parsed.groups.every(row => row.employees.trim() &&
    (row.period !== "Custom dates" || (!row.start && !row.end) || (parseCalendarDateInput(row.start) && parseCalendarDateInput(row.end) && row.start <= row.end)));
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

export type PayrollPage = { field: "names" | "headcount" | "period" | "dates" | "amount"; groupIndex: number };
export function payrollPages(value: string): PayrollPage[] {
  return [{field: "names", groupIndex: 0}, ...(parsePayrollAnswer(value)?.groups ?? [])
    .flatMap((group, groupIndex): PayrollPage[] => group.employees.trim() ? [
      {field: "headcount", groupIndex}, {field: "period", groupIndex},
      ...(group.period === "Custom dates" ? [{field: "dates" as const, groupIndex}] : []),
      {field: "amount", groupIndex},
    ] : [])];
}
export function payrollPageTitle(value: string, page: PayrollPage) {
  const group = parsePayrollAnswer(value)?.groups[page.groupIndex];
  const name = group?.employees || "this employee group";

  return page.field === "names" ? "What employee groups do you have?"
    : page.field === "headcount" ? `How many employees are in ${name}?`
    : page.field === "period" ? `What payroll period would you like to use for ${name}?`
    : page.field === "dates" ? `What dates does the payroll for ${name} cover?`
    : `How much do you pay ${name} in total?`;
}
export function payrollPageValue(value: string, page: PayrollPage) {
  const groups = parsePayrollAnswer(value)?.groups ?? [];
  if (page.field === "names") return groups.some(row => row.employees.trim()) ? "named" : "";
  const row = groups[page.groupIndex];
  return !row ? "" : page.field === "dates" ? row.start || row.end : row[page.field];
}
