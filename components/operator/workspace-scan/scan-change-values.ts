import { formatDisplayDate } from "@/lib/date-format";

const FIELD_LABELS: Record<string, string> = {
  completionOutcome: "Completion outcome",
  provider: "Reported provider",
  purchaseDate: "Reported purchase date",
  kind: "Outcome",
  targetEffectiveDate: "Target effective date",
  lineOfBusinessCodes: "Lines of business",
  writingStates: "Writing states",
  networkStatus: "Network status",
  clientVisible: "Client visibility",
  mailingAddress: "Mailing address",
  primaryContactEmail: "Contact email",
  content: "Company facts",
  street1: "Street",
  street2: "Address line 2",
};

export function scanFieldLabel(field: string) {
  const words = field.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ");
  return FIELD_LABELS[field] ?? words.charAt(0).toUpperCase() + words.slice(1);
}

function displayValue(value: unknown, field: string): string {
  if (value === null || value === undefined) return "Not set";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value))
    return value.map((item) => displayValue(item, field)).join("\n") || "None";
  if (typeof value === "object")
    return Object.entries(value)
      .map(
        ([key, item]) => `${scanFieldLabel(key)}: ${displayValue(item, key)}`,
      )
      .join("\n");
  if (typeof value === "string") {
    if (field === "targetEffectiveDate" || field === "purchaseDate")
      return formatDisplayDate(value, value);
    if (field === "status" || field === "networkStatus" || field === "kind")
      return scanFieldLabel(value);
    return value;
  }
  return String(value);
}

export function scanChangeValue(value: string | null, field: string) {
  if (value === null) return "Not set";
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return value;
  }
  return displayValue(parsed, field);
}
