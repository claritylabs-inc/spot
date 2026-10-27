import { v, type Infer } from "convex/values";
import { singleResultList } from "./toolResultSummary";

/**
 * Typed preview of what a tool call returned, for drilling into its
 * activity row: up to ten items from the result's single list, each reduced
 * to a title, an optional subtitle, date and public website. Nothing else
 * from the result is kept.
 */
export const TOOL_PREVIEW_MAX_ITEMS = 10;

export const toolPreviewItemValidator = v.object({
  title: v.string(),
  subtitle: v.optional(v.string()),
  date: v.optional(v.string()),
  website: v.optional(v.string()),
});
export type ToolPreviewItem = Infer<typeof toolPreviewItemValidator>;

const TITLE_KEYS = [
  "subject",
  "title",
  "name",
  "fileName",
  "filename",
  "label",
];
const SUBTITLE_KEYS = ["from", "sender", "email", "carrier", "status", "type"];
const DATE_KEYS = ["date", "receivedAt", "sentAt", "updatedAt", "createdAt"];
const URL_KEYS = ["url", "website", "link"];

function text(value: unknown, limit: number) {
  if (typeof value !== "string") return;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return;
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, limit - 1).trimEnd()}…`;
}

function first(item: Record<string, unknown>, keys: string[], limit: number) {
  for (const key of keys) {
    const value = text(item[key], limit);
    if (value) return value;
  }
}

function date(item: Record<string, unknown>) {
  for (const key of DATE_KEYS) {
    const value = item[key];
    const time =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Date.parse(value)
          : NaN;
    if (Number.isFinite(time) && time > 0) return new Date(time).toISOString();
  }
}

function website(item: Record<string, unknown>) {
  for (const key of URL_KEYS) {
    const value = item[key];
    if (typeof value !== "string") continue;
    try {
      const url = new URL(value.includes("://") ? value : `https://${value}`);
      if (url.protocol === "https:" || url.protocol === "http:")
        return `https://${url.hostname}`;
    } catch {
      // Not a URL.
    }
  }
}

export function toolResultPreview(output: unknown): ToolPreviewItem[] {
  const list = singleResultList(output);
  if (!list) return [];
  const items: ToolPreviewItem[] = [];
  for (const entry of list.items) {
    if (items.length >= TOOL_PREVIEW_MAX_ITEMS) break;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const item = entry as Record<string, unknown>;
    const site = website(item);
    const title =
      first(item, TITLE_KEYS, 160) ?? (site ? site.slice(8) : undefined);
    if (!title) continue;
    const subtitle = first(item, SUBTITLE_KEYS, 120);
    const when = date(item);
    items.push({
      title,
      ...(subtitle ? { subtitle } : {}),
      ...(when ? { date: when } : {}),
      ...(site ? { website: site } : {}),
    });
  }
  return items;
}
