import { readFileSync } from "node:fs";

const DEFAULT_TIMEOUT_MS = 10_000;
const CHECK_ATTEMPTS = Number(process.env.AGENT_HEALTH_ATTEMPTS ?? "3");
const RETRY_DELAY_MS = Number(
  process.env.AGENT_HEALTH_RETRY_DELAY_MS ?? "10000",
);
const DEPLOYMENTS = JSON.parse(
  readFileSync(new URL("../config/deployments.json", import.meta.url), "utf8"),
);

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

const urls = {
  convexAgentHealth:
    process.env.SPOT_CONVEX_AGENT_HEALTH_URL ??
    envOrDefault(
      deployment.convexAgentHealthUrlEnv,
      deployment.convexAgentHealthUrl,
      "Convex agent health URL",
    ),
  clRouterHealth: optionalClRouterHealthUrl(),
};

function validateSpotEnv(payload) {
  if (!payload.spotEnv) return;
  if (payload.spotEnv !== deployment.spotEnv) {
    throw new Error(
      `spotEnv expected ${deployment.spotEnv} got ${String(payload.spotEnv)}`,
    );
  }
}

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
            if (
              payload.frozen !== undefined &&
              typeof payload.frozen !== "boolean"
            ) {
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
          throw new Error("operatorSlack.hostTeamConfigured expected true");
        }
        const missingHostScopes = payload.operatorSlack?.missingHostScopes;
        if (!Array.isArray(missingHostScopes)) {
          throw new Error("operatorSlack.missingHostScopes missing");
        }
        if (missingHostScopes.length > 0) {
          throw new Error(
            `host Slack installation is missing scopes: ${missingHostScopes.join(", ")}. Reconnect the host workspace from /operator/channels to reauthorize.`,
          );
        }
      }
      if (
        deployment.imessage?.webhookTransport &&
        payload.imessage?.webhookTransport !== true
      ) {
        throw new Error("imessage.webhookTransport expected true");
      }
    },
  },
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
