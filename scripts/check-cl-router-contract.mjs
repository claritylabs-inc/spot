import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const CONTRACT_DIR = fileURLToPath(
  new URL("../contracts/cl-router/", import.meta.url),
);
const OPENAPI_PATH = `${CONTRACT_DIR}/openapi.v1.json`;
const FIXTURES_PATH = `${CONTRACT_DIR}/fixtures.v1.json`;
const SOURCE_PATH = `${CONTRACT_DIR}/source.json`;
const REQUIRED_OPERATION_KEYS = [
  "get /health",
  "post /v1/generate",
  "post /v1/generate/stream",
  "post /v1/embed",
  "post /v1/transcribe",
  "get /v1/capabilities",
  "post /v1/retrieve",
  "post /v1/feedback",
  "post /admin/freeze",
  "post /admin/pin",
  "get /admin/policy",
  "get /admin/rollups",
  "post /admin/score",
];
const REQUIRED_FIXTURE_SCHEMAS = [
  "GenerateRequest",
  "GenerateResponse",
  "StreamEvent",
  "EmbedRequest",
  "EmbedResponse",
  "TranscribeMetadata",
  "TranscribeRequest",
  "TranscribeResponse",
  "CapabilitiesResponse",
  "RetrieveRequest",
  "RetrieveResponse",
  "FeedbackRequest",
  "FeedbackResponse",
  "HealthResponse",
  "FreezeRequest",
  "FreezeResponse",
  "PinRequest",
  "PinResponse",
  "ScoreRequest",
  "AdminPolicyResponse",
  "AdminRollupResponse",
  "AdminScoreResponse",
];

function fail(message) {
  throw new Error(`cl-router contract check failed: ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readJson(path, label) {
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    fail(`could not read ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return { source, value: JSON.parse(source) };
  } catch (error) {
    fail(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function schemaId(name) {
  return `https://spot.local/contracts/cl-router/v1/schemas/${encodeURIComponent(name)}`;
}

function rewriteComponentRefs(value) {
  if (Array.isArray(value)) return value.map(rewriteComponentRefs);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (
        key === "$ref"
        && typeof item === "string"
        && item.startsWith("#/components/schemas/")
      ) {
        return [key, schemaId(item.slice("#/components/schemas/".length))];
      }
      return [key, rewriteComponentRefs(item)];
    }),
  );
}

function formatValidationErrors(errors) {
  return (errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .join("; ");
}

function compileSchemas(openapi) {
  const schemas = openapi.components?.schemas;
  assert(isRecord(schemas), "components.schemas is missing");

  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    validateFormats: false,
  });
  for (const [name, schema] of Object.entries(schemas)) {
    assert(isRecord(schema), `schema ${name} is not an object`);
    ajv.addSchema({
      ...rewriteComponentRefs(schema),
      $id: schemaId(name),
    });
  }

  const validators = new Map();
  for (const name of Object.keys(schemas)) {
    let validator;
    try {
      validator = ajv.getSchema(schemaId(name));
    } catch (error) {
      fail(`schema ${name} does not compile: ${error instanceof Error ? error.message : String(error)}`);
    }
    assert(validator, `schema ${name} could not be compiled`);
    validators.set(name, validator);
  }
  return validators;
}

function expectedRef(schema) {
  return `#/components/schemas/${schema}`;
}

function checkOperationBindings(openapi, operations) {
  assert(Array.isArray(operations) && operations.length > 0, "operation bindings are missing");
  const operationKeys = new Set(
    operations.map((operation) => `${operation.method} ${operation.path}`),
  );
  assert(operationKeys.size === operations.length, "operation fixtures contain duplicates");
  for (const key of REQUIRED_OPERATION_KEYS) {
    assert(operationKeys.has(key), `required operation fixture ${key} is missing`);
  }
  for (const contract of operations) {
    const operation = openapi.paths?.[contract.path]?.[contract.method];
    assert(operation, `${contract.method.toUpperCase()} ${contract.path} is missing`);
    assert(
      Array.isArray(contract.responses) && contract.responses.length > 0,
      `${contract.name} must declare a response binding`,
    );
    if (contract.method === "post") {
      assert(contract.request, `${contract.name} must declare a request binding`);
    }

    if (contract.request) {
      const requestBody = operation.requestBody;
      assert(isRecord(requestBody), `${contract.name} request body is missing`);
      if (contract.request.required === true) {
        assert(requestBody.required === true, `${contract.name} request body must be required`);
      }
      const requestSchema = requestBody.content?.[contract.request.mediaType]?.schema;
      assert(isRecord(requestSchema), `${contract.name} ${contract.request.mediaType} request schema is missing`);
      if (contract.request.schema) {
        assert(
          requestSchema.$ref === expectedRef(contract.request.schema),
          `${contract.name} request must reference ${contract.request.schema}`,
        );
      }
      if (contract.request.requiredFields) {
        for (const field of contract.request.requiredFields) {
          assert(
            requestSchema.required?.includes(field),
            `${contract.name} multipart request must require ${field}`,
          );
        }
      }
    }

    for (const response of contract.responses ?? []) {
      assert(typeof response.schema === "string", `${contract.name} response schema is missing`);
      const responseSchema = operation.responses?.[response.status]?.content?.[response.mediaType]?.schema;
      assert(
        isRecord(responseSchema),
        `${contract.name} ${response.status} ${response.mediaType} response schema is missing`,
      );
      assert(
        responseSchema.$ref === expectedRef(response.schema),
        `${contract.name} ${response.status} response must reference ${response.schema}`,
      );
    }
  }
}

function hasExactSecurityBinding(operation, schemeName) {
  return Array.isArray(operation.security)
    && operation.security.length === 1
    && isRecord(operation.security[0])
    && Object.keys(operation.security[0]).length === 1
    && Array.isArray(operation.security[0][schemeName])
    && operation.security[0][schemeName].length === 0;
}

function checkSecurityBindings(openapi) {
  const securitySchemes = openapi.components?.securitySchemes;
  assert(isRecord(securitySchemes), "components.securitySchemes is missing");
  for (const schemeName of ["inferenceBearerAuth", "adminBearerAuth"]) {
    const scheme = securitySchemes[schemeName];
    assert(
      isRecord(scheme) && scheme.type === "http" && scheme.scheme === "bearer",
      `${schemeName} must be an HTTP bearer security scheme`,
    );
  }

  const healthOperation = openapi.paths?.["/health"]?.get;
  assert(isRecord(healthOperation), "GET /health is missing");
  assert(
    Array.isArray(healthOperation.security) && healthOperation.security.length === 0,
    "GET /health must be explicitly public",
  );

  for (const [path, pathItem] of Object.entries(openapi.paths ?? {})) {
    if (!path.startsWith("/v1/") && !path.startsWith("/admin/")) continue;
    assert(isRecord(pathItem), `${path} path item is malformed`);
    const schemeName = path.startsWith("/v1/")
      ? "inferenceBearerAuth"
      : "adminBearerAuth";
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!["get", "post", "put", "patch", "delete", "options", "head", "trace"].includes(method)) {
        continue;
      }
      assert(isRecord(operation), `${method.toUpperCase()} ${path} is malformed`);
      assert(
        hasExactSecurityBinding(operation, schemeName),
        `${method.toUpperCase()} ${path} must use only ${schemeName}`,
      );
    }
  }
}

function checkFixtures(validators, fixtures) {
  assert(Array.isArray(fixtures) && fixtures.length > 0, "schema fixtures are missing");
  const fixtureNames = new Set();
  const fixtureSchemas = new Set(fixtures.map((fixture) => fixture.schema));
  for (const schema of REQUIRED_FIXTURE_SCHEMAS) {
    assert(fixtureSchemas.has(schema), `required ${schema} fixture is missing`);
  }
  for (const fixture of fixtures) {
    assert(typeof fixture.name === "string" && fixture.name.length > 0, "fixture name is missing");
    assert(!fixtureNames.has(fixture.name), `fixture name ${fixture.name} is duplicated`);
    fixtureNames.add(fixture.name);
    const validator = validators.get(fixture.schema);
    assert(validator, `${fixture.name} references missing schema ${fixture.schema}`);
    if (!validator(fixture.value)) {
      fail(`${fixture.name} is invalid: ${formatValidationErrors(validator.errors)}`);
    }
  }
}


const [{ source: openapiSource, value: openapi }, { value: fixtureFile }, { value: provenance }] =
  await Promise.all([
    readJson(OPENAPI_PATH, "OpenAPI snapshot"),
    readJson(FIXTURES_PATH, "contract fixtures"),
    readJson(SOURCE_PATH, "snapshot provenance"),
  ]);

assert(openapi.openapi === "3.1.0", `expected OpenAPI 3.1.0, received ${openapi.openapi ?? "missing"}`);
assert(openapi.info?.version === "1.0.0", `expected API version 1.0.0, received ${openapi.info?.version ?? "missing"}`);
assert(provenance.sourceRepository === "claritylabs-inc/cl-router", "source repository is not cl-router");
assert(typeof provenance.sourcePath === "string" && provenance.sourcePath.length > 0, "source path is missing");
assert(
  typeof provenance.sourceRevision === "string"
    && /^[a-f0-9]{40}$/.test(provenance.sourceRevision),
  "source revision must be a full lowercase 40-character Git commit SHA",
);
assert(
  provenance.sourceWorktreeDirty === false,
  "released contract snapshots must come from a clean source worktree",
);
assert(
  typeof provenance.sha256 === "string" && /^[a-f0-9]{64}$/.test(provenance.sha256),
  "snapshot SHA-256 is missing or malformed",
);
const actualDigest = sha256(openapiSource);
assert(
  actualDigest === provenance.sha256,
  `snapshot digest drifted (expected ${provenance.sha256}, received ${actualDigest})`,
);

const validators = compileSchemas(openapi);
checkOperationBindings(openapi, fixtureFile.operations);
checkSecurityBindings(openapi);
checkFixtures(validators, fixtureFile.fixtures);

console.log(
  `cl-router contract OK: ${fixtureFile.fixtures.length} fixtures, ${fixtureFile.operations.length} operations, sha256 ${actualDigest.slice(0, 12)}`,
);
