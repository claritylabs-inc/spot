import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const CONTRACT_DIR = fileURLToPath(new URL("../contracts/cl-router/", import.meta.url));

const ROUTING_METADATA = {
  type: "object",
  properties: {
    decision: { type: "string", enum: ["routed", "manual"] },
    primitive: { type: "string" },
    difficulty: {
      anyOf: [
        { type: "string", enum: ["simple", "standard", "complex"] },
        { type: "null" },
      ],
    },
    requiredTier: { type: "integer", enum: [1, 2, 3] },
    selectedTier: { type: "integer", enum: [1, 2, 3] },
    route: {
      type: "object",
      properties: {
        provider: { type: "string", minLength: 1 },
        model: { type: "string", minLength: 1 },
      },
      required: ["provider", "model"],
      additionalProperties: false,
    },
    source: { type: "string", enum: ["jev", "fallback", "manual"] },
    attemptCount: {
      type: "integer",
      exclusiveMinimum: 0,
      maximum: 9007199254740991,
    },
  },
  required: ["decision", "route", "attemptCount"],
  additionalProperties: false,
};

const REQUIREMENTS = {
  type: "object",
  properties: {
    vision: { type: "boolean" },
    tools: { type: "boolean" },
    structuredOutput: { type: "boolean" },
    minInputTokens: {
      type: "integer",
      exclusiveMinimum: 0,
      maximum: 9007199254740991,
    },
  },
  additionalProperties: false,
};

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stripSettings(schema) {
  if (!isRecord(schema?.properties)) return schema;
  const { settings, ...properties } = schema.properties;
  const required = Array.isArray(schema.required)
    ? schema.required.filter((field) => field !== "settings")
    : schema.required;
  return { ...schema, properties, ...(required ? { required } : {}) };
}

function replaceRouting(value) {
  if (Array.isArray(value)) return value.map(replaceRouting);
  if (!isRecord(value)) return value;
  if (
    isRecord(value.properties) &&
    isRecord(value.properties.decision) &&
    isRecord(value.properties.cacheStickinessApplied)
  ) {
    return { $ref: "#/components/schemas/RoutingMetadata" };
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, replaceRouting(item)]),
  );
}

const openapiPath = `${CONTRACT_DIR}/openapi.v1.json`;
const sourcePath = `${CONTRACT_DIR}/source.json`;
const openapi = JSON.parse(await readFile(openapiPath, "utf8"));

openapi.info.description =
  "Spot-local frozen overlay of the cl-router v1 API for the primitive-router cutover. Provider credentials belong exclusively to the router. TODO(cl-router-policy): replace this overlay with the published cl-router OpenAPI snapshot after that PR lands.";

const generatePath = openapi.paths["/v1/generate"];
openapi.paths["/v1/manual"] = structuredClone(generatePath);
openapi.paths["/v1/manual"].post.requestBody.content["application/json"].schema = {
  $ref: "#/components/schemas/ManualRequest",
};
openapi.paths["/v1/manual/stream"] = structuredClone(openapi.paths["/v1/generate/stream"]);
openapi.paths["/v1/manual/stream"].post.requestBody.content["application/json"].schema = {
  $ref: "#/components/schemas/ManualRequest",
};

for (const path of Object.keys(openapi.paths)) {
  if (path.startsWith("/admin/")) delete openapi.paths[path];
}

const generateRequest = openapi.components.schemas.GenerateRequest;
const {
  task,
  taskKind,
  settings,
  sessionKey,
  routing,
  tenantId,
  orgId,
  ...keptGenerateProperties
} = generateRequest.properties;
openapi.components.schemas.GenerateRequest = {
  ...generateRequest,
  properties: {
    tenantId,
    orgId,
    primitive: {
      type: "string",
      enum: [
        "text",
        "reasoning",
        "multimodal",
        "tool_use",
        "embedding",
        "transcription",
      ],
    },
    requirements: REQUIREMENTS,
    ...keptGenerateProperties,
  },
  required: ["primitive"],
};

openapi.components.schemas.ManualRequest = {
  ...openapi.components.schemas.GenerateRequest,
  properties: {
    ...openapi.components.schemas.GenerateRequest.properties,
    route: {
      type: "object",
      properties: {
        provider: { type: "string", minLength: 1 },
        model: { type: "string", minLength: 1 },
      },
      required: ["provider", "model"],
      additionalProperties: false,
    },
  },
  required: ["primitive", "route"],
};

openapi.components.schemas.RoutingMetadata = ROUTING_METADATA;
openapi.components.schemas.EmbedRequest = stripSettings(
  openapi.components.schemas.EmbedRequest,
);
openapi.components.schemas.TranscribeRequest = stripSettings(
  openapi.components.schemas.TranscribeRequest,
);
openapi.components.schemas.TranscribeMetadata = stripSettings(
  openapi.components.schemas.TranscribeMetadata,
);

openapi.components.schemas.JobSubmissionRequest.properties.operation.enum = [
  "generate",
  "manual",
  "embed",
  "retrieve",
  "transcribe",
];

const replaced = replaceRouting({
  ...openapi,
  components: {
    ...openapi.components,
    schemas: {
      ...openapi.components.schemas,
      RoutingMetadata: ROUTING_METADATA,
    },
  },
});
openapi.components = replaced.components;

const serialized = `${JSON.stringify(openapi, null, 2)}\n`;
await writeFile(openapiPath, serialized);
const digest = createHash("sha256").update(serialized).digest("hex");
const source = JSON.parse(await readFile(sourcePath, "utf8"));
source.sha256 = digest;
source.spotLocalFrozenContract = true;
source.notes =
  "TODO(cl-router-policy): replace this Spot-local OpenAPI overlay and SHA with the published cl-router snapshot after the primitive-router PR lands. sourceRevision remains the last imported cl-router commit; the bytes here implement the frozen HTTP contract (primitives, /v1/manual, no admin freeze/pin/policy/rollups/score).";
await writeFile(sourcePath, `${JSON.stringify(source, null, 2)}\n`);
console.log(`updated openapi sha256 ${digest}`);
