/** Loose readers for tool artifact payloads, which arrive as `unknown`. */

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((item): Record<string, unknown>[] => {
        const record = asRecord(item);
        return record ? [record] : [];
      })
    : [];
}

export function asString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

export function asNumber(value: unknown) {
  return typeof value === "number" ? value : undefined;
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
