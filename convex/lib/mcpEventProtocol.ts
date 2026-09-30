import dayjs from "dayjs";

const MAX_EVENT_NAME_BYTES = 256;
const MAX_ARGUMENTS_BYTES = 8 * 1024;
const MAX_CALLBACK_URL_BYTES = 2048;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TTL_MS = 7 * DEFAULT_TTL_MS;
const MIN_TTL_MS = 60 * 1000;

const REQUEST_FIELDS = new Set([
  "name",
  "arguments",
  "delivery",
  "ttlMs",
  "cursor",
  "_meta",
]);
const DELIVERY_FIELDS = new Set(["mode", "url", "secret"]);

export class McpEventProtocolError extends Error {
  readonly code = -32602;

  constructor(message: string) {
    super(message);
    this.name = "McpEventProtocolError";
  }
}

type PlainRecord = Record<string, unknown>;

function protocolError(message: string): never {
  throw new McpEventProtocolError(message);
}

function isPlainRecord(value: unknown): value is PlainRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertNoSymbolKeys(value: object, context: string) {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    protocolError(`${context} must not contain symbol keys`);
  }
}

function canonicalJsonValue(
  value: unknown,
  seen: Set<object>,
  path: string,
): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        protocolError(`${path} must contain only finite numbers`);
      }
      return JSON.stringify(value);
    case "object":
      break;
    default:
      protocolError(`${path} contains a non-JSON-safe value`);
  }

  if (seen.has(value)) {
    protocolError(`${path} contains a circular reference`);
  }
  seen.add(value);

  let result: string;
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        protocolError(`${path}[${index}] must not be an array hole`);
      }
      items.push(canonicalJsonValue(value[index], seen, `${path}[${index}]`));
    }
    result = `[${items.join(",")}]`;
  } else {
    if (!isPlainRecord(value)) {
      protocolError(`${path} must contain only plain JSON objects`);
    }
    assertNoSymbolKeys(value, path);
    const entries = Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJsonValue(value[key], seen, `${path}.${key}`)}`,
      );
    result = `{${entries.join(",")}}`;
  }

  seen.delete(value);
  return result;
}

export function canonicalMcpEventArguments(
  argumentsValue: Record<string, unknown>,
): string {
  if (!isPlainRecord(argumentsValue)) {
    protocolError("Event arguments must be a plain JSON object");
  }
  return canonicalJsonValue(argumentsValue, new Set(), "arguments");
}

export async function mcpEventSubscriptionIdentity(args: {
  principalKey: string;
  name: string;
  arguments: Record<string, unknown>;
  url: string;
}): Promise<string> {
  const input = canonicalMcpEventArguments({
    principalKey: args.principalKey,
    name: args.name,
    arguments: args.arguments,
    url: args.url,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `sub_${hex}`;
}

function requestedTtl(ttlMs: unknown): number {
  if (ttlMs === undefined) return DEFAULT_TTL_MS;
  if (ttlMs === null) return MAX_TTL_MS;
  if (
    typeof ttlMs !== "number" ||
    !Number.isFinite(ttlMs) ||
    !Number.isInteger(ttlMs) ||
    ttlMs <= 0
  ) {
    protocolError("ttlMs must be null or a positive finite integer");
  }
  return Math.min(Math.max(ttlMs, MIN_TTL_MS), MAX_TTL_MS);
}

export function mcpEventRefreshBefore(ttlMs: unknown, nowMs: number): number {
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) {
    protocolError("nowMs must be a finite number");
  }
  const now = dayjs(nowMs);
  if (!now.isValid()) {
    protocolError("nowMs must be a valid date timestamp");
  }
  return now.add(requestedTtl(ttlMs), "millisecond").valueOf();
}

function assertKnownFields(value: PlainRecord, fields: Set<string>, context: string) {
  assertNoSymbolKeys(value, context);
  for (const key of Object.keys(value)) {
    if (!fields.has(key)) {
      protocolError(`${context} contains unsupported field ${key}`);
    }
  }
}

function assertBoundedString(
  value: unknown,
  field: string,
  maximumBytes: number,
): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    protocolError(`${field} must be a non-empty string`);
  }
  if (new TextEncoder().encode(value).byteLength > maximumBytes) {
    protocolError(`${field} exceeds its maximum size`);
  }
}

function assertValidTtlValue(
  value: unknown,
): asserts value is number | null | undefined {
  if (
    value !== null &&
    value !== undefined &&
    (typeof value !== "number" ||
      !Number.isFinite(value) ||
      !Number.isInteger(value) ||
      value <= 0)
  ) {
    protocolError("ttlMs must be null or a positive finite integer");
  }
}

function assertHttpsUrl(value: unknown): asserts value is string {
  assertBoundedString(value, "delivery.url", MAX_CALLBACK_URL_BYTES);
  try {
    if (new URL(value).protocol !== "https:") {
      protocolError("delivery.url must use HTTPS");
    }
  } catch (error) {
    if (error instanceof McpEventProtocolError) throw error;
    protocolError("delivery.url must be a valid HTTPS URL");
  }
}

export type ParsedMcpEventRequest = {
  name: string;
  arguments: Record<string, unknown>;
  delivery: {
    mode: "webhook";
    url: string;
    secret?: string;
  };
  ttlMs?: number | null;
  cursor: null;
};

export function parseMcpEventRequest(
  params: unknown,
  mode: "subscribe" | "unsubscribe",
): ParsedMcpEventRequest {
  if (mode !== "subscribe" && mode !== "unsubscribe") {
    protocolError("Unsupported MCP event request mode");
  }
  if (!isPlainRecord(params)) {
    protocolError("MCP event params must be a plain object");
  }
  assertKnownFields(params, REQUEST_FIELDS, "MCP event params");

  assertBoundedString(params.name, "name", MAX_EVENT_NAME_BYTES);
  if (!isPlainRecord(params.arguments)) {
    protocolError("arguments must be a plain JSON object");
  }
  const canonicalArguments = canonicalMcpEventArguments(params.arguments);
  if (new TextEncoder().encode(canonicalArguments).byteLength > MAX_ARGUMENTS_BYTES) {
    protocolError("arguments exceed the maximum size");
  }

  if (!isPlainRecord(params.delivery)) {
    protocolError("delivery must be a plain object");
  }
  assertKnownFields(params.delivery, DELIVERY_FIELDS, "delivery");
  if (params.delivery.mode !== "webhook") {
    protocolError("delivery.mode must be webhook");
  }
  assertHttpsUrl(params.delivery.url);

  const secret = params.delivery.secret;
  if (secret !== undefined && (typeof secret !== "string" || secret.length === 0)) {
    protocolError("delivery.secret must be a non-empty string when provided");
  }
  if (mode === "subscribe" && secret === undefined) {
    protocolError("delivery.secret is required for subscribe");
  }

  if (Object.prototype.hasOwnProperty.call(params, "_meta")) {
    if (!isPlainRecord(params._meta)) {
      protocolError("_meta must be a plain object");
    }
    canonicalMcpEventArguments(params._meta);
  }
  if (Object.prototype.hasOwnProperty.call(params, "cursor") && params.cursor != null) {
    protocolError("Only a null cursor is supported");
  }
  assertValidTtlValue(params.ttlMs);

  const delivery: ParsedMcpEventRequest["delivery"] = {
    mode: "webhook",
    url: params.delivery.url,
  };
  if (secret !== undefined) delivery.secret = secret;

  const parsed: ParsedMcpEventRequest = {
    name: params.name,
    arguments: params.arguments,
    delivery,
    cursor: null,
  };
  if (params.ttlMs !== undefined) parsed.ttlMs = params.ttlMs;
  return parsed;
}
