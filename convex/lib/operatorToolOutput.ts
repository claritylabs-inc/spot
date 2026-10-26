import type { ModelMessage } from "ai";
import { stripLeakedToolCallText } from "./leakedToolCallText";

const MAX_TOOL_OUTPUT_BYTES = 24_000;
const MAX_HISTORY_TOOL_BYTES = 128_000;
const encoder = new TextEncoder();
const OUTPUT_NOTE =
  "Tool output was shortened for model context. This is incomplete evidence: page with the returned cursor or narrow the query; omitted results do not prove absence. Do not replay writes to recover omitted output.";

function byteLength(value: unknown) {
  return encoder.encode(JSON.stringify(value) ?? "null").byteLength;
}

function shortText(value: string, bytes: number) {
  if (byteLength(value) <= bytes) return value;
  let low = 0;
  let high = Math.min(value.length, bytes);
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (byteLength(`${value.slice(0, mid)} [shortened]`) <= bytes) low = mid;
    else high = mid - 1;
  }
  // Avoid ending a prefix in the middle of a UTF-16 surrogate pair.
  if (low && /[\uD800-\uDBFF]/.test(value[low - 1])) low -= 1;
  return `${value.slice(0, low)} [shortened]`;
}

/** Keeps structured status, failure and pagination ahead of large evidence fields. */
export function boundToolOutput(
  value: unknown,
  maxBytes = MAX_TOOL_OUTPUT_BYTES,
): unknown {
  const originalBytes = byteLength(value);
  if (originalBytes <= maxBytes) return value;
  const metadata = {
    outputTruncated: true,
    bounded: true,
    originalBytes,
    note: OUTPUT_NOTE,
  };
  let remaining = Math.max(0, maxBytes - byteLength(metadata) - 256);
  const visit = (item: unknown, depth: number): unknown => {
    if (remaining < 32) return null;
    if (typeof item === "string") {
      const text = shortText(item, Math.min(remaining - 16, 2000));
      remaining -= byteLength(text);
      return text;
    }
    if (!item || typeof item !== "object") {
      remaining -= byteLength(item) + 8;
      return item;
    }
    if (depth > 8) {
      remaining -= 32;
      return "[nested content omitted]";
    }
    if (Array.isArray(item)) {
      const result: unknown[] = [];
      for (const entry of item) {
        if (remaining < 64 || result.length >= 25) break;
        remaining -= 8;
        result.push(visit(entry, depth + 1));
      }
      return result;
    }
    const result: Record<string, unknown> = {};
    const priority = [
      "status",
      "failure",
      "writeState",
      "recoverable",
      "code",
      "error",
      "nextCursor",
      "continueCursor",
      "isDone",
      "bounded",
      "id",
      "_id",
      "result",
    ];
    const rank = (key: string) =>
      priority.includes(key) ? priority.indexOf(key) : priority.length;
    const entries = Object.entries(item).sort(([a], [b]) => rank(a) - rank(b));
    for (const [key, entry] of entries.slice(0, 64)) {
      if (remaining < byteLength(key) + 64) break;
      remaining -= byteLength(key) + 8;
      if (
        (key === "nextCursor" || key === "continueCursor") &&
        typeof entry === "string"
      ) {
        // A shortened cursor is invalid. Preserve it verbatim or omit it.
        if (byteLength(entry) < remaining) {
          result[key] = entry;
          remaining -= byteLength(entry);
        } else result.cursorOmitted = true;
        continue;
      }
      result[key] = visit(entry, depth + 1);
    }
    return result;
  };
  const preview = visit(value, 0);
  const result =
    preview && typeof preview === "object" && !Array.isArray(preview)
      ? { ...preview, ...metadata }
      : { preview, ...metadata };
  return result;
}

/** Retain every call/result pair; bound evidence across the entire durable history. */
export function boundToolHistory(messages: ModelMessage[]): ModelMessage[] {
  let remaining = MAX_HISTORY_TOOL_BYTES;
  let count = messages.reduce(
    (total, message) =>
      total + (message.role === "tool" ? message.content.length : 0),
    0,
  );
  if (count * 1024 > MAX_HISTORY_TOOL_BYTES)
    throw new Error(
      "Tool history exceeded the model context limit; continue with fewer records",
    );
  return messages.map((message) => {
    if (message.role === "assistant") {
      return typeof message.content === "string"
        ? { ...message, content: sanitizeOperatorReply(message.content) }
        : {
            ...message,
            content: message.content.map((part) =>
              part.type === "text"
                ? { ...part, text: sanitizeOperatorReply(part.text) }
                : part,
            ),
          };
    }
    if (message.role !== "tool") return message;
    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type !== "tool-result") return part;
        const budget = Math.min(
          MAX_TOOL_OUTPUT_BYTES,
          Math.floor(remaining / Math.max(1, count)),
        );
        count -= 1;
        const output = part.output;
        if (
          output.type !== "json" &&
          output.type !== "text" &&
          output.type !== "error-json" &&
          output.type !== "error-text"
        )
          return part;
        const bounded = boundToolOutput(output.value, budget);
        remaining -= byteLength(bounded);
        return {
          ...part,
          output: {
            type:
              output.type === "error-json" || output.type === "error-text"
                ? ("error-json" as const)
                : ("json" as const),
            value: bounded as import("ai").JSONValue,
          },
        };
      }),
    };
  });
}

const RAW_CALL_TEXT =
  /<\|[^\n<>]{1,60}\|>|\{(?=[^{}]{0,512}"(?:tool_calls|tool_call|function_call|function|recipient_name)"\s*:)|\{\s*"(?:name|toolName|tool)"\s*:\s*"(?:functions\.)?[a-z][a-z0-9]*_[a-z0-9_]+"\s*,\s*"(?:arguments|input|parameters)"\s*:|\{\s*"type"\s*:\s*"tool[_-]call"/;

export function sanitizeOperatorReply(text: string): string {
  const stripped = stripLeakedToolCallText(text);
  const start = RAW_CALL_TEXT.exec(stripped)?.index;
  if (start === undefined && stripped === text) return text.trimEnd();
  return (start === undefined ? stripped : stripped.slice(0, start))
    .replace(/```(?:json)?\s*$/, "")
    .trimEnd();
}
