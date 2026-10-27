/**
 * Public-safe result summary for a tool activity row ("3 threads",
 * "25+ results"). Derived only from result structure: a count and a noun
 * taken from a code-defined field name, never from returned values.
 */

const GENERIC_KEYS = new Set([
  "data",
  "entries",
  "hits",
  "items",
  "matches",
  "records",
  "results",
  "rows",
  "values",
]);

/** Fields that describe a page, not its contents. */
const IGNORED_KEYS = new Set([
  "attachments",
  "errors",
  "families",
  "fields",
  "missing",
  "notes",
  "queries",
  "warnings",
]);

const MORE_KEYS = ["nextCursor", "cursor", "continueCursor"] as const;
const TOTAL_KEYS = ["total", "totalCount", "count"] as const;

export const TOOL_RESULT_SUMMARY_PATTERN = /^\d{1,6}\+? [a-z][a-z ]{0,31}$/;

function words(key: string) {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .toLowerCase()
    .trim();
}

function singular(noun: string) {
  if (noun.endsWith("ies")) return `${noun.slice(0, -3)}y`;
  if (/(ses|xes|ches|shes)$/.test(noun)) return noun.slice(0, -2);
  if (noun.endsWith("s") && !noun.endsWith("ss")) return noun.slice(0, -1);
  return noun;
}

function label(count: number, key: string, more: boolean) {
  const plural = GENERIC_KEYS.has(key) ? "results" : words(key);
  const noun = count === 1 && !more ? singular(plural) : plural;
  const summary = `${count}${more ? "+" : ""} ${noun}`;
  return TOOL_RESULT_SUMMARY_PATTERN.test(summary) ? summary : undefined;
}

function unwrap(output: unknown): unknown {
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const record = output as Record<string, unknown>;
    if (record.status === "succeeded" && "result" in record)
      return unwrap(record.result);
  }
  return output;
}

/** The one unambiguous list in a result, with its field name. */
export function singleResultList(
  output: unknown,
):
  | { key: string; items: unknown[]; record?: Record<string, unknown> }
  | undefined {
  const result = unwrap(output);
  if (Array.isArray(result)) return { key: "results", items: result };
  if (!result || typeof result !== "object") return;
  const record = result as Record<string, unknown>;
  const lists = Object.entries(record).filter(
    ([key, value]) => Array.isArray(value) && !IGNORED_KEYS.has(key),
  );
  if (lists.length !== 1) return;
  const [key, items] = lists[0] as [string, unknown[]];
  return { key, items, record };
}

export function summarizeToolResult(output: unknown): string | undefined {
  const list = singleResultList(output);
  if (!list) return;
  const { key, items, record } = list;
  if (!record) return label(items.length, key, false);
  const more = MORE_KEYS.some(
    (field) => typeof record[field] === "string" && record[field],
  );
  const total = TOTAL_KEYS.map((field) => record[field]).find(
    (field): field is number =>
      typeof field === "number" &&
      Number.isInteger(field) &&
      field >= items.length,
  );
  return label(total ?? items.length, key, more && total === undefined);
}
