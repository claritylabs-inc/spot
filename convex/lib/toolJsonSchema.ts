/**
 * Marks a nullable schema whose null only means "not provided", so the
 * model-facing JSON Schema can advertise it as a plain optional field.
 */
export const OMITTABLE_JSON_SCHEMA_MARKER = "x-omittable";

// Every tool call is re-parsed by its strict Zod schema before execution, so
// string constraints and regexes only spend prompt tokens. Array caps, numeric
// bounds, enums and required keys stay because they steer the model.
const DROPPED_KEYS = new Set([
  "$schema",
  "pattern",
  "format",
  "minLength",
  "maxLength",
  "minItems",
]);

// "Exact organization ID" on `orgId` restates the field name; the system
// prompt carries the exact-ID rule once.
const TRIVIAL_ID_DESCRIPTION = /^Exact [\w\s-]+ ID$/;

type JsonNode = Record<string, unknown>;

function isNullBranch(node: unknown) {
  return Boolean(node) && (node as JsonNode).type === "null";
}

/** Model-facing JSON Schema: same shape, without validation-only noise. */
export function compactToolJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(compactToolJsonSchema);
  if (!schema || typeof schema !== "object") return schema;
  const node = schema as JsonNode;
  if (node[OMITTABLE_JSON_SCHEMA_MARKER] && Array.isArray(node.anyOf)) {
    const branches = node.anyOf.filter((branch) => !isNullBranch(branch));
    if (branches.length === 1) {
      const { anyOf: _anyOf, [OMITTABLE_JSON_SCHEMA_MARKER]: _marker, ...rest } =
        node;
      return compactToolJsonSchema({ ...(branches[0] as JsonNode), ...rest });
    }
  }
  return Object.fromEntries(
    Object.entries(node)
      .filter(
        ([key, value]) =>
          !DROPPED_KEYS.has(key) &&
          key !== OMITTABLE_JSON_SCHEMA_MARKER &&
          !(
            key === "description" &&
            typeof value === "string" &&
            TRIVIAL_ID_DESCRIPTION.test(value)
          ),
      )
      .map(([key, value]) => [key, compactToolJsonSchema(value)]),
  );
}
