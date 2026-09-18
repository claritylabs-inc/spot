import { readFileSync } from "node:fs";

const DEFAULT_TIMEOUT_MS = 10_000;
const CHECK_ATTEMPTS = Number(process.env.AGENT_HEALTH_ATTEMPTS ?? "3");
const RETRY_DELAY_MS = Number(
  process.env.AGENT_HEALTH_RETRY_DELAY_MS ?? "10000",
);
const DEPLOYMENTS = JSON.parse(
  readFileSync(new URL("../config/deployments.json", import.meta.url), "utf8"),
);
const EXTRACTION_WORKER_PACKAGE = JSON.parse(
  readFileSync(
    new URL("../extraction-worker/package.json", import.meta.url),
    "utf8",
  ),
);
const EXPECTED_CL_SDK_VERSION =
  EXTRACTION_WORKER_PACKAGE.dependencies?.["@claritylabs/cl-sdk"];

function argValue(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) return process.argv[index + 1];
  return undefined;
}

const DEPLOYMENT_ENV =
  argValue("env") ??
  argValue("environment") ??
  process.env.SPOT_DEPLOYMENT_ENV ??
  process.env.SPOT_ENV ??
  "production";

const deployment = DEPLOYMENTS[DEPLOYMENT_ENV];
if (!deployment) {
  console.error(
    `[agent-health] Unknown deployment environment "${DEPLOYMENT_ENV}". Expected one of: ${Object.keys(DEPLOYMENTS).join(", ")}`,
  );
  process.exit(1);
}

function envOrDefault(envName, defaultValue, label) {
  const rawValue = envName ? process.env[envName] : undefined;
  const value =
    typeof rawValue === "string" && rawValue.trim() !== ""
      ? rawValue.trim()
      : undefined;
  const resolved = value ?? defaultValue;
  if (!resolved) {
    throw new Error(
      `${label} is not configured for ${DEPLOYMENT_ENV}; set ${envName ?? "the corresponding deployment URL"}`,
    );
  }
  return resolved;
}

function optionalClRouterHealthUrl() {
  const explicit = process.env.SPOT_CL_ROUTER_HEALTH_URL?.trim();
  if (explicit) return explicit;
  if (deployment.clRouterHealthUrlEnv || deployment.clRouterHealthUrl) {
    return envOrDefault(
      deployment.clRouterHealthUrlEnv,
      deployment.clRouterHealthUrl,
      "cl-router health URL",
    );
  }
  return undefined;
}

function optionalSlackWorkerHealthUrl() {
  if (!deployment.slack?.required) return undefined;

  const explicit = process.env.SPOT_SLACK_WORKER_HEALTH_URL?.trim();
  if (explicit) return explicit;
  const configured = deployment.slackWorkerHealthUrlEnv
    ? process.env[deployment.slackWorkerHealthUrlEnv]?.trim()
    : undefined;
  if (configured) return configured;
  if (deployment.slackWorkerHealthUrl) return deployment.slackWorkerHealthUrl;
  return envOrDefault(
    deployment.slackWorkerHealthUrlEnv,
    deployment.slackWorkerHealthUrl,
    "Slack worker health URL",
  );
}

function optionalOperatorImessageWorkerHealthUrl() {
  const explicit = process.env.SPOT_OPERATOR_IMESSAGE_WORKER_HEALTH_URL?.trim();
  if (explicit) return explicit;
  const configured = deployment.operatorImessageWorkerHealthUrlEnv
    ? process.env[deployment.operatorImessageWorkerHealthUrlEnv]?.trim()
    : undefined;
  if (configured) return configured;
  if (!deployment.operatorImessage?.required) return undefined;
  return envOrDefault(
    deployment.operatorImessageWorkerHealthUrlEnv,
    deployment.operatorImessageWorkerHealthUrl,
    "operator iMessage worker health URL",
  );
}

const urls = {
  convexAgentHealth:
    process.env.SPOT_CONVEX_AGENT_HEALTH_URL ??
    envOrDefault(
      deployment.convexAgentHealthUrlEnv,
      deployment.convexAgentHealthUrl,
      "Convex agent health URL",
    ),
  imessageWorkerHealth:
    process.env.SPOT_IMESSAGE_WORKER_HEALTH_URL ??
    envOrDefault(
      deployment.imessageWorkerHealthUrlEnv,
      deployment.imessageWorkerHealthUrl,
      "iMessage worker health URL",
    ),
  operatorImessageWorkerHealth: optionalOperatorImessageWorkerHealthUrl(),
  extractionWorkerHealth:
    process.env.SPOT_EXTRACTION_WORKER_HEALTH_URL ??
    envOrDefault(
      deployment.extractionWorkerHealthUrlEnv,
      deployment.extractionWorkerHealthUrl,
      "extraction worker health URL",
    ),
  clRouterHealth: optionalClRouterHealthUrl(),
  slackWorkerHealth: optionalSlackWorkerHealthUrl(),
};

function validateSpotEnv(payload) {
  if (!payload.spotEnv) return;
  if (payload.spotEnv !== deployment.spotEnv) {
    throw new Error(
      `spotEnv expected ${deployment.spotEnv} got ${String(payload.spotEnv)}`,
    );
  }
}

function normalizeVersionSpec(value) {
  return typeof value === "string"
    ? value.trim().replace(/^[~^=v]+/, "")
    : undefined;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is missing`);
  }
  return value.trim();
}

function assertSameVersion(label, actual, expected) {
  const normalizedActual = normalizeVersionSpec(actual);
  const normalizedExpected = normalizeVersionSpec(expected);
  if (
    !normalizedActual ||
    !normalizedExpected ||
    normalizedActual !== normalizedExpected
  ) {
    throw new Error(
      `${label} expected ${String(expected)} got ${String(actual)}`,
    );
  }
}

let convexAgentPayload;

const checks = [
  ...(urls.clRouterHealth
    ? [
        {
          name: "cl-router",
          url: urls.clRouterHealth,
          validate(payload) {
            if (payload.status !== "ok" || payload.database !== true) {
              throw new Error(
                `reported status=${String(payload.status)} database=${String(payload.database)}`,
              );
            }
            if (payload.environment !== deployment.spotEnv) {
              throw new Error(
                `environment expected ${deployment.spotEnv} got ${String(payload.environment)}`,
              );
            }
            if (
              !(
                typeof payload.policyVersion === "string" ||
                payload.policyVersion === null
              )
            ) {
              throw new Error("policyVersion is invalid");
            }
            if (typeof payload.frozen !== "boolean") {
              throw new Error("frozen state is invalid");
            }
          },
        },
      ]
    : []),
  {
    name: "Convex agent configuration",
    url: urls.convexAgentHealth,
    validate(payload) {
      if (payload.ok !== true) {
        throw new Error(`reported ok=${String(payload.ok)}`);
      }
      validateSpotEnv(payload);
      const missing = Object.entries(payload.checks ?? {})
        .filter(([, value]) => value !== true)
        .map(([key]) => key);
      if (missing.length > 0) {
        throw new Error(`missing checks: ${missing.join(", ")}`);
      }
      if (
        payload.emailDeliveryMode &&
        deployment.email?.deliveryMode &&
        payload.emailDeliveryMode !== deployment.email.deliveryMode
      ) {
        throw new Error(
          `emailDeliveryMode expected ${deployment.email.deliveryMode} got ${String(payload.emailDeliveryMode)}`,
        );
      }
      const extractionWorker = payload.extractionWorker;
      if (!extractionWorker || typeof extractionWorker !== "object") {
        throw new Error(
          "extractionWorker compatibility config missing from Convex health",
        );
      }
      if (deployment.workers?.extractionProtocol) {
        if (
          extractionWorker.expectedProtocolVersion !==
          deployment.workers.extractionProtocol
        ) {
          throw new Error(
            `extractionWorker.expectedProtocolVersion expected ${deployment.workers.extractionProtocol} got ${String(extractionWorker.expectedProtocolVersion)}`,
          );
        }
      }
      if (EXPECTED_CL_SDK_VERSION) {
        assertSameVersion(
          "extractionWorker.expectedClSdkVersion",
          extractionWorker.expectedClSdkVersion,
          EXPECTED_CL_SDK_VERSION,
        );
      }
      convexAgentPayload = payload;
      if (payload.operatorAgent?.modelConfigured !== true) {
        throw new Error("operatorAgent.modelConfigured expected true");
      }
      const slackEnabled = payload.slack?.enabled ?? false;
      if (slackEnabled !== deployment.slack?.enabled) {
        throw new Error(
          `slack.enabled expected ${String(deployment.slack?.enabled)} got ${String(slackEnabled)}`,
        );
      }
      if (payload.slack?.mode !== deployment.slack?.mode) {
        throw new Error(
          `slack.mode expected ${String(deployment.slack?.mode)} got ${String(payload.slack?.mode)}`,
        );
      }
      if (deployment.operatorSlack?.required) {
        if (payload.operatorSlack?.enabled !== true) {
          throw new Error(
            `operatorSlack.enabled expected true got ${String(payload.operatorSlack?.enabled)}`,
          );
        }
        if (payload.operatorSlack?.hostTeamConfigured !== true) {
          throw new Error(
            "operatorSlack.hostTeamConfigured expected true",
          );
        }
        const missingHostScopes = payload.operatorSlack?.missingHostScopes;
        if (!Array.isArray(missingHostScopes)) {
          throw new Error("operatorSlack.missingHostScopes missing");
        }
        if (missingHostScopes.length > 0) {
          throw new Error(
            `host Slack installation is missing scopes: ${missingHostScopes.join(", ")}. Reconnect the host workspace from /operator/settings?section=channels to reauthorize.`,
          );
        }
      }
      const operatorImessageRequired = Boolean(
        urls.operatorImessageWorkerHealth,
      );
      if (
        operatorImessageRequired &&
        payload.operatorImessage?.inboundEnabled !== true
      ) {
        throw new Error(
          `operatorImessage.inboundEnabled expected true got ${String(payload.operatorImessage?.inboundEnabled)}`,
        );
      }
      if (
        operatorImessageRequired &&
        payload.operatorImessage?.contactPhoneConfigured !== true
      ) {
        throw new Error(
          "operatorImessage.contactPhoneConfigured expected true",
        );
      }
      if (
        payload.operatorImessage?.inboundEnabled === true &&
        (!payload.operatorImessage?.workerUrlConfigured ||
          !payload.operatorImessage?.workerSecretConfigured)
      ) {
        throw new Error("operator iMessage Convex wiring is incomplete");
      }
      if (
        DEPLOYMENT_ENV === "production" &&
        payload.operatorImessage?.inboundEnabled === true &&
        !operatorImessageRequired
      ) {
        throw new Error(
          "operator iMessage is enabled without its production health URL enforcement flip",
        );
      }
    },
  },
  {
    name: "iMessage worker",
    url: urls.imessageWorkerHealth,
    validate(payload) {
      const expected = {
        ok: true,
        service: "spot-imessage-worker",
        channelRole: deployment.imessage.channelRole,
        transport: deployment.imessage.transport,
        imessageEnabled: deployment.imessage.imessageEnabled,
        convexSiteConfigured: true,
        workerSecretConfigured: true,
        photonConfigured: deployment.imessage.photonConfigured,
      };
      const failures = Object.entries(expected)
        .filter(([key, value]) => payload[key] !== value)
        .map(
          ([key, value]) =>
            `${key} expected ${String(value)} got ${String(payload[key])}`,
        );
      if (failures.length > 0) {
        throw new Error(failures.join("; "));
      }
      validateSpotEnv(payload);
      for (const port of deployment.imessage.requiredHttpPorts ?? []) {
        if (
          !Array.isArray(payload.httpPorts) ||
          !payload.httpPorts.includes(port)
        ) {
          throw new Error(`worker is not listening on required port ${port}`);
        }
      }
    },
  },
  ...(urls.operatorImessageWorkerHealth
    ? [
        {
          name: "Operator iMessage worker",
          url: urls.operatorImessageWorkerHealth,
          validate(payload) {
            const expected = {
              ok: true,
              service: "spot-imessage-worker",
              channelRole: deployment.operatorImessage.channelRole,
              transport: deployment.operatorImessage.transport,
              imessageEnabled: deployment.operatorImessage.imessageEnabled,
              convexSiteConfigured: true,
              workerSecretConfigured: true,
              photonConfigured: deployment.operatorImessage.photonConfigured,
            };
            const failures = Object.entries(expected)
              .filter(([key, value]) => payload[key] !== value)
              .map(
                ([key, value]) =>
                  `${key} expected ${String(value)} got ${String(payload[key])}`,
              );
            if (failures.length > 0) throw new Error(failures.join("; "));
            validateSpotEnv(payload);
            for (const port of
              deployment.operatorImessage.requiredHttpPorts ?? []) {
              if (
                !Array.isArray(payload.httpPorts) ||
                !payload.httpPorts.includes(port)
              ) {
                throw new Error(
                  `worker is not listening on required port ${port}`,
                );
              }
            }
          },
        },
      ]
    : []),
  {
    name: "Extraction worker",
    url: urls.extractionWorkerHealth,
    validate(payload) {
      if (payload.ok !== true) {
        throw new Error(`reported ok=${String(payload.ok)}`);
      }
      validateSpotEnv(payload);
      const expectedProtocol = deployment.workers?.extractionProtocol;
      if (
        expectedProtocol &&
        payload.workerProtocolVersion !== expectedProtocol
      ) {
        throw new Error(
          `unexpected protocol ${String(payload.workerProtocolVersion)}; expected ${expectedProtocol}`,
        );
      }
      const convexExtractionWorker = convexAgentPayload?.extractionWorker;
      if (
        !convexExtractionWorker ||
        typeof convexExtractionWorker !== "object"
      ) {
        throw new Error(
          "Convex extraction worker compatibility config unavailable",
        );
      }
      const convexExpectedProtocol = requireString(
        convexExtractionWorker.expectedProtocolVersion,
        "Convex extractionWorker.expectedProtocolVersion",
      );
      if (payload.workerProtocolVersion !== convexExpectedProtocol) {
        throw new Error(
          `workerProtocolVersion expected ${convexExpectedProtocol} got ${String(payload.workerProtocolVersion)}`,
        );
      }
      const convexExpectedClSdkVersion = requireString(
        convexExtractionWorker.expectedClSdkVersion,
        "Convex extractionWorker.expectedClSdkVersion",
      );
      assertSameVersion(
        "worker cl-sdk version",
        payload.clSdkVersion,
        convexExpectedClSdkVersion,
      );
      if (EXPECTED_CL_SDK_VERSION) {
        assertSameVersion(
          "worker cl-sdk package spec",
          payload.clSdkVersion,
          EXPECTED_CL_SDK_VERSION,
        );
      }
    },
  },
  ...(urls.slackWorkerHealth
    ? [
        {
          name: "Slack worker",
          url: urls.slackWorkerHealth,
          validate(payload) {
            const expected = {
              ok: true,
              service: "spot-slack-worker",
              mode: deployment.slack.mode,
              workerSecretConfigured: true,
              tokenBrokerConfigured: true,
              clarityTeamConfigured: true,
              outboundEnabled: true,
              actorResolutionEnabled: true,
              connectProvisioningEnabled: true,
              channelInventoryEnabled: true,
              publicChannelJoinEnabled: true,
              blockKitEnabled: true,
              messageUpdatesEnabled: true,
              reactionsEnabled: true,
              agentStatusEnabled: true,
              streamingEnabled: true,
              interactivityResponsesEnabled: true,
              feedbackModalsEnabled: true,
              reconciliationEnabled: true,
            };
            const failures = Object.entries(expected)
              .filter(([key, value]) => payload[key] !== value)
              .map(
                ([key, value]) =>
                  `${key} expected ${String(value)} got ${String(payload[key])}`,
              );
            if (failures.length > 0) throw new Error(failures.join("; "));
            validateSpotEnv(payload);
          },
        },
      ]
    : []),
];

async function fetchJson(check) {
  const response = await fetch(check.url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCheck(check) {
  let lastError;
  const attempts =
    Number.isInteger(CHECK_ATTEMPTS) && CHECK_ATTEMPTS > 0 ? CHECK_ATTEMPTS : 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const payload = await fetchJson(check);
      check.validate(payload);
      const suffix = attempts > 1 ? ` attempt ${attempt}/${attempts}` : "";
      console.log(`[agent-health] OK ${check.name}: ${check.url}${suffix}`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(RETRY_DELAY_MS);
    }
  }
  throw lastError;
}

const failures = [];

for (const check of checks) {
  try {
    await runCheck(check);
  } catch (error) {
    failures.push(
      `[agent-health] FAIL ${check.name}: ${check.url}\n  ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`[agent-health] ${DEPLOYMENT_ENV} deployment health passed`);
