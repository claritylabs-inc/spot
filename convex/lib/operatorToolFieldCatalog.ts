import { z } from "zod";

/**
 * Keeps heavy nested inputs out of the per-turn tool catalog. The model-facing
 * JSON schema of a field is a free-form object; the real schema still validates
 * every call, and its rejections name the allowed keys and values for the
 * offending path. `describe_record_fields` returns the full shapes on demand.
 */

type AnyZod = z.ZodType;
type Def = { type: string } & Record<string, unknown>;

const defOf = (schema: AnyZod) => (schema as unknown as { def: Def }).def;

/** Strips wrappers that do not change the shape callers must send. */
function unwrap(schema: AnyZod): AnyZod {
  let current = schema;
  for (let depth = 0; depth < 8; depth += 1) {
    const def = defOf(current);
    if (
      def.type === "optional" ||
      def.type === "nullable" ||
      def.type === "default" ||
      def.type === "readonly" ||
      def.type === "nonoptional"
    )
      current = def.innerType as AnyZod;
    else if (def.type === "pipe") current = def.in as AnyZod;
    else break;
  }
  return current;
}

function objectShape(schema: AnyZod) {
  const unwrapped = unwrap(schema);
  return defOf(unwrapped).type === "object"
    ? ((unwrapped as unknown as { shape: Record<string, AnyZod> }).shape)
    : null;
}

function enumValues(schema: AnyZod): string[] | null {
  const unwrapped = unwrap(schema);
  const def = defOf(unwrapped);
  if (def.type === "enum")
    return Object.values(def.entries as Record<string, string>);
  if (def.type === "literal") return (def.values as unknown[]).map(String);
  if (def.type === "union") {
    const parts = (def.options as AnyZod[]).map(enumValues);
    return parts.every(Boolean) ? parts.flat() as string[] : null;
  }
  return null;
}

/** The sub-schema reached by following an issue path, or null. */
function schemaAtPath(schema: AnyZod, path: readonly PropertyKey[]) {
  let current: AnyZod | null = schema;
  for (const segment of path) {
    if (!current) return null;
    const unwrapped = unwrap(current);
    const def = defOf(unwrapped);
    if (def.type === "object")
      current = objectShape(unwrapped)?.[String(segment)] ?? null;
    else if (def.type === "array") current = def.element as AnyZod;
    else if (def.type === "record") current = def.valueType as AnyZod;
    else return null;
  }
  return current;
}

/** Keys accepted at an object (or enum-keyed record) schema. */
function allowedKeys(schema: AnyZod | null): string[] | null {
  if (!schema) return null;
  const shape = objectShape(schema);
  if (shape) return Object.keys(shape);
  const unwrapped = unwrap(schema);
  const def = defOf(unwrapped);
  if (def.type === "record") return enumValues(def.keyType as AnyZod);
  return null;
}

/**
 * Compact type notation for a schema, e.g.
 * `{street1?, city?, ownership?: owned|leased, units[]≤50: {name}}`.
 * `named` collapses repeated shapes (such as an address) to a short name.
 */
export function compactShape(
  schema: AnyZod,
  named: ReadonlyMap<AnyZod, string> = new Map(),
): string {
  const unwrapped = unwrap(schema);
  const alias = named.get(unwrapped);
  if (alias) return alias;
  const def = defOf(unwrapped);
  switch (def.type) {
    case "string":
      return (unwrapped as unknown as { format?: string }).format === "url"
        ? "url"
        : "text";
    case "number":
    case "int":
      return "number";
    case "boolean":
      return "boolean";
    case "enum":
    case "literal":
    case "union": {
      const values = enumValues(unwrapped);
      if (values) return values.map((value) => value || '""').join("|");
      return (def.options as AnyZod[])
        .map((option) => compactShape(option, named))
        .join("|");
    }
    case "array": {
      const maximum = (
        unwrapped as unknown as { _zod: { bag: { maximum?: number } } }
      )._zod.bag.maximum;
      return `[${compactShape(def.element as AnyZod, named)}]${maximum ? `≤${maximum}` : ""}`;
    }
    case "record": {
      const keys = enumValues(def.keyType as AnyZod);
      return `{${keys ? keys.join("|") : "key"}: ${compactShape(def.valueType as AnyZod, named)}}`;
    }
    case "object": {
      const shape = objectShape(unwrapped)!;
      const fields = Object.entries(shape).map(([key, value]) => {
        const optional =
          (value as unknown as { _zod: { optin?: string } })._zod.optin ===
          "optional";
        const inner = compactShape(value, named);
        return `${key}${optional ? "?" : ""}${inner === "text" ? "" : `: ${inner}`}`;
      });
      return `{${fields.join(", ")}}`;
    }
    default:
      return "any";
  }
}

function dropNestedNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropNestedNulls);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== null && entry !== undefined)
      .map(([key, entry]) => [key, dropNestedNulls(entry)]),
  );
}

const MESSAGE_LIMIT = 700;

function pathLabel(label: string, path: readonly PropertyKey[]) {
  return [label, ...path.map(String)]
    .join(".")
    .replace(/\.(\d+)(?=\.|$)/g, "[$1]");
}

/** A rejection the model can act on: where it failed and what is allowed there. */
function enrichIssue(
  strict: AnyZod,
  label: string,
  issue: z.core.$ZodIssue,
  named: ReadonlyMap<AnyZod, string>,
) {
  const where = pathLabel(label, issue.path);
  const target = schemaAtPath(strict, issue.path);
  let message: string;
  if (issue.code === "unrecognized_keys") {
    const keys = allowedKeys(target);
    message = `Unknown ${issue.keys.length === 1 ? "key" : "keys"} ${issue.keys.map((key) => JSON.stringify(key)).join(", ")} at ${where}.${keys ? ` Allowed: ${keys.join(", ")}.` : ""}`;
  } else if (issue.code === "invalid_type" && target) {
    const expanded = new Map(named);
    expanded.delete(unwrap(target));
    const shape = compactShape(target, expanded);
    message = `${where}: ${issue.message}. Expected ${shape.length > 400 ? `${shape.slice(0, 400)}…` : shape}`;
  } else {
    message =
      issue.code === "custom" ? issue.message : `${where}: ${issue.message}`;
  }
  return message.length > MESSAGE_LIMIT
    ? `${message.slice(0, MESSAGE_LIMIT)}…`
    : message;
}

/**
 * An optional free-form object in the provider schema whose value is validated
 * strictly by `strict`. A null field means "not provided", and nulls below the
 * top level are dropped first: models send null for omitted keys, and no nested
 * field carries clear-on-null meaning.
 */
export function strictObjectField<TSchema extends AnyZod>(
  strict: TSchema,
  options: {
    label: string;
    hint: string;
    named?: ReadonlyMap<AnyZod, string>;
  },
) {
  return z
    .record(z.string(), z.unknown())
    .describe(options.hint)
    .nullish()
    .transform((value, context): z.output<TSchema> | undefined => {
      if (value == null) return undefined;
      const result = strict.safeParse(dropNestedNulls(value));
      if (result.success) return result.data;
      for (const issue of result.error.issues)
        context.addIssue({
          code: "custom",
          message: enrichIssue(
            strict,
            options.label,
            issue,
            options.named ?? new Map(),
          ),
          path: [...issue.path],
        });
      return z.NEVER;
    });
}

/** Field name → compact shape for every top-level key of an object schema. */
export function shapeCatalog(
  schema: AnyZod,
  named: ReadonlyMap<AnyZod, string> = new Map(),
) {
  return Object.fromEntries(
    Object.entries(objectShape(schema) ?? {}).map(([key, value]) => [
      key,
      compactShape(value, named),
    ]),
  );
}

export function fieldNames(schema: AnyZod) {
  return allowedKeys(schema) ?? [];
}
