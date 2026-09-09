import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  canUseAnonymousConvexCloudFallback,
  cloudConvexSelectionKeys,
  conductorContainerNamesOnPort,
  conductorImageTag,
  conductorPorts,
  convexDeploymentNameFromDeployKey,
  ensureNode24,
  generateLocalAuthKeys,
  localConvexUrls,
  parseEnvFile,
  repairLocalConvexSelection,
  repoRoot,
  resolveConductorClRouterConfig,
  resolveConductorMapboxAccessToken,
  workspaceSlug,
  withoutCloudConvexSelection,
} from "./lib/conductor-workspace.mjs";

ensureNode24();
process.chdir(repoRoot);

const contextDirectory = path.join(repoRoot, ".context");
const rootEnvPath = path.join(repoRoot, ".env.local");
const imessageEnvPath = path.join(repoRoot, "imessage-worker", ".env.local");
const localConfigPath = path.join(
  repoRoot,
  ".convex",
  "local",
  "default",
  "config.json",
);
const convexSelectionKeys = new Set(cloudConvexSelectionKeys);

function run(command, args, options = {}) {
  console.log(`\n> ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `${command} exited with status ${result.status ?? "unknown"}`,
    );
  }
  return result.status ?? 1;
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (options.allowFailure) return undefined;
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(
      `${command} exited with status ${result.status ?? "unknown"}`,
    );
  }
  const value = result.stdout.trim();
  return value.length > 0 ? value : undefined;
}

function captureResult(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
    ...options,
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function requiredValue(values, key, source) {
  const value = values.get(key)?.trim();
  if (!value) throw new Error(`${key} is missing from ${source}`);
  return value;
}

function writePrivateFile(filePath, contents) {
  writeFileSync(filePath, contents, { mode: 0o600 });
  chmodSync(filePath, 0o600);
}

function writeRuntimeEnv(fileName, entries) {
  const filePath = path.join(contextDirectory, fileName);
  const contents = Object.entries(entries)
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .map(([key, value]) => {
      if (/\r|\n/.test(value))
        throw new Error(`${key} cannot contain a newline`);
      return `${key}=${value}`;
    })
    .join("\n");
  writePrivateFile(filePath, `${contents}\n`);
  console.log(`Prepared ${path.relative(repoRoot, filePath)}`);
}

function stripCloudConvexSelection() {
  const lines = readFileSync(rootEnvPath, "utf8").split(/\r?\n/);
  const filtered = lines.filter((rawLine) => {
    const line = rawLine.trim().replace(/^export\s+/, "");
    const separator = line.indexOf("=");
    if (separator < 1) return true;
    return !convexSelectionKeys.has(line.slice(0, separator).trim());
  });
  writeFileSync(rootEnvPath, `${filtered.join("\n").replace(/\n+$/, "")}\n`);
}

function deploymentNameFromSelector(selector) {
  const separator = selector.indexOf(":");
  return separator >= 0 ? selector.slice(separator + 1) : selector;
}

function sourceDeploymentKey(sourceDeployment) {
  const dedicatedKey =
    process.env.CONDUCTOR_CONVEX_SOURCE_DEPLOY_KEY?.trim();
  if (dedicatedKey) {
    if (convexDeploymentNameFromDeployKey(dedicatedKey) !== sourceDeployment) {
      throw new Error(
        "CONDUCTOR_CONVEX_SOURCE_DEPLOY_KEY must be a deployment-scoped key for the configured source deployment.",
      );
    }
    return dedicatedKey;
  }

  const ambientKey =
    process.env.CONVEX_DEPLOY_KEY?.trim() ||
    process.env.CONVEX_DEPLOYMENT_TOKEN?.trim();
  return convexDeploymentNameFromDeployKey(ambientKey) === sourceDeployment
    ? ambientKey
    : undefined;
}

function setConvexEnvFromFile(convex, filePath) {
  run(convex, ["env", "set", "--from-file", filePath, "--force"]);
}

function optionalConvexEnv(convex, name) {
  return capture(convex, ["env", "get", name], { allowFailure: true });
}

function ensureContainerService() {
  if (
    run("node", ["scripts/check-container-cli.mjs"], { allowFailure: true }) ===
    0
  ) {
    return;
  }
  run("/bin/zsh", ["-c", "yes | container system start"]);
  run("node", ["scripts/check-container-cli.mjs"]);
}

function buildWorkerImages() {
  const workers = [
    ["extraction-worker", "extraction-worker"],
    ["imessage-worker", "imessage-worker"],
    ["slack-worker", "slack-worker"],
    ["mailbox-scan-worker", "mailbox-scan-worker"],
  ];
  for (const [imageName, directory] of workers) {
    run("container", [
      "build",
      "--platform",
      "linux/amd64",
      "--tag",
      conductorImageTag(imageName),
      "--file",
      `${directory}/Dockerfile`,
      directory,
    ]);
  }
}

function cleanupContainersOnWorkspacePorts() {
  const output = capture("container", ["list", "--all", "--format", "json"]);
  const containers = JSON.parse(output || "[]");
  if (!Array.isArray(containers)) {
    throw new Error("Apple container list did not return an array");
  }

  const { extraction } = conductorPorts();
  for (const containerName of conductorContainerNamesOnPort(
    containers,
    "extraction",
    extraction,
  )) {
    run("container", ["delete", "--force", containerName]);
    console.log(
      `Deleted Apple container ${containerName} occupying this workspace's extraction port.`,
    );
  }
}

if (!existsSync(rootEnvPath)) {
  throw new Error(
    ".env.local is missing. Add it to the repository root so Conductor Files to copy can seed new workspaces.",
  );
}
if (!existsSync(imessageEnvPath)) {
  throw new Error(
    "imessage-worker/.env.local is missing. Copy imessage-worker/.env.template and set IMESSAGE_TERMINAL_FROM_PHONE.",
  );
}

const initialRootEnv = parseEnvFile(rootEnvPath);
const imessageEnv = parseEnvFile(imessageEnvPath);
const terminalPhone = requiredValue(
  imessageEnv,
  "IMESSAGE_TERMINAL_FROM_PHONE",
  "imessage-worker/.env.local",
);
if (!/^\+[1-9]\d{7,14}$/.test(terminalPhone)) {
  throw new Error("IMESSAGE_TERMINAL_FROM_PHONE must be an E.164 phone number");
}
const configuredTerminalClientPhone = imessageEnv
  .get("IMESSAGE_TERMINAL_CLIENT_PHONE")
  ?.trim();
const terminalClientPhone =
  !configuredTerminalClientPhone || configuredTerminalClientPhone === "+15555550102"
    ? "+12025550102"
    : configuredTerminalClientPhone;
const configuredTerminalPublicPhone = imessageEnv
  .get("IMESSAGE_TERMINAL_PUBLIC_PHONE")
  ?.trim();
const terminalPublicPhone =
  !configuredTerminalPublicPhone || configuredTerminalPublicPhone === "+15555550999"
    ? "+12025550199"
    : configuredTerminalPublicPhone;
for (const [name, value] of [
  ["IMESSAGE_TERMINAL_CLIENT_PHONE", terminalClientPhone],
  ["IMESSAGE_TERMINAL_PUBLIC_PHONE", terminalPublicPhone],
]) {
  if (!/^\+[1-9]\d{7,14}$/.test(value)) {
    throw new Error(`${name} must be an E.164 phone number`);
  }
}
if (new Set([terminalPhone, terminalClientPhone, terminalPublicPhone]).size !== 3) {
  throw new Error("Spectrum terminal test phone numbers must be unique");
}

run("npm", ["ci"]);
run("npm", ["--prefix", "extraction-worker", "ci"]);
run("npm", ["--prefix", "imessage-worker", "ci"]);
run("npm", ["--prefix", "slack-worker", "ci"]);

mkdirSync(contextDirectory, { recursive: true });
const convex = path.join(repoRoot, "node_modules", ".bin", "convex");
const createdLocalDeployment = !existsSync(localConfigPath);
let cloudEnvironment;
let sourceEnvironmentRead = false;

if (createdLocalDeployment) {
  const sourceSelector =
    process.env.CONDUCTOR_CONVEX_SOURCE_DEPLOYMENT?.trim() ||
    initialRootEnv.get("CONVEX_DEPLOYMENT")?.trim();
  if (!sourceSelector || /^(anonymous|local):/.test(sourceSelector)) {
    throw new Error(
      "A fresh worktree needs a cloud dev CONVEX_DEPLOYMENT in the copied .env.local (or CONDUCTOR_CONVEX_SOURCE_DEPLOYMENT) so setup can clone its environment variables.",
    );
  }
  const sourceDeployment = deploymentNameFromSelector(sourceSelector);
  const deployKey = sourceDeploymentKey(sourceDeployment);
  console.log(
    `Cloning Convex environment variables from ${sourceDeployment}...`,
  );
  const listArguments = deployKey
    ? ["env", "list"]
    : ["env", "list", "--deployment", sourceDeployment];
  const listEnvironment = deployKey
    ? {
        ...withoutCloudConvexSelection(process.env),
        CONVEX_DEPLOY_KEY: deployKey,
      }
    : withoutCloudConvexSelection(process.env);
  const result = captureResult(convex, listArguments, {
    env: listEnvironment,
  });
  if (result.status === 0) {
    sourceEnvironmentRead = true;
    cloudEnvironment = result.stdout.trim() || undefined;
  } else if (
    canUseAnonymousConvexCloudFallback({
      isCloud: process.env.CONDUCTOR_IS_LOCAL === "0",
      hasDeployKey: Boolean(deployKey),
      output: `${result.stderr}\n${result.stdout}`,
    })
  ) {
    console.warn(
      "Convex CLI credentials are unavailable in this Conductor Cloud workspace. Continuing with an anonymous local deployment without shared-dev environment variables; basic browser QA and local email/OTP capture remain available. To enable provider-backed flows, add a dev-scoped CONDUCTOR_CONVEX_SOURCE_DEPLOY_KEY to the Conductor Cloud Computer environment before creating a fresh workspace.",
    );
  } else {
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(
      `${convex} exited with status ${result.status} while reading ${sourceDeployment}`,
    );
  }
  stripCloudConvexSelection();
} else if (repairLocalConvexSelection()) {
  console.log("Restored this workspace's local Convex selection in .env.local.");
}

for (const name of cloudConvexSelectionKeys) delete process.env[name];

const {
  web,
  extraction,
  imessage,
  slack,
  operatorImessage,
  convexCloud,
  convexSite,
} = conductorPorts();
run(
  convex,
  [
    "dev",
    "--once",
    "--local-cloud-port",
    String(convexCloud),
    "--local-site-port",
    String(convexSite),
  ],
  {
    env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
  },
);

const localUrls = localConvexUrls();
if (cloudEnvironment) {
  const importPath = path.join(contextDirectory, "convex-cloud-import.env");
  try {
    writePrivateFile(importPath, `${cloudEnvironment}\n`);
    setConvexEnvFromFile(convex, importPath);
  } finally {
    rmSync(importPath, { force: true });
  }
}

// A successful source import must include complete router execution settings.
// Credential-free Conductor Cloud setup has no imported settings and keeps
// provider-backed flows disabled while basic local browser QA remains usable.
const routerRequired =
  sourceEnvironmentRead || process.env.CONDUCTOR_IS_LOCAL !== "0";
const {
  url: clRouterUrl,
  tasks: clRouterTasks,
  secret: clRouterSecret,
  timeoutMs: clRouterTimeoutMs,
  tenantId: clRouterTenantId,
} = resolveConductorClRouterConfig(
  {
    url: optionalConvexEnv(convex, "CL_ROUTER_URL"),
    tasks: optionalConvexEnv(convex, "CL_ROUTER_TASKS"),
    secret: optionalConvexEnv(convex, "CL_ROUTER_SECRET"),
    timeoutMs: optionalConvexEnv(convex, "CL_ROUTER_TIMEOUT_MS"),
    tenantId: optionalConvexEnv(convex, "CL_ROUTER_TENANT_ID"),
  },
  { required: routerRequired },
);

const extractionPackage = JSON.parse(
  readFileSync(
    path.join(repoRoot, "extraction-worker", "package.json"),
    "utf8",
  ),
);
const expectedSdkVersion =
  extractionPackage.dependencies["@claritylabs/cl-sdk"];
const extractionSecret = createdLocalDeployment
  ? randomBytes(32).toString("hex")
  : optionalConvexEnv(convex, "EXTRACTION_WORKER_SECRET") ||
    randomBytes(32).toString("hex");
const imessageSecret = createdLocalDeployment
  ? randomBytes(32).toString("hex")
  : optionalConvexEnv(convex, "IMESSAGE_WORKER_SECRET") ||
    randomBytes(32).toString("hex");
const operatorImessageSecret = createdLocalDeployment
  ? randomBytes(32).toString("hex")
  : optionalConvexEnv(convex, "OPERATOR_IMESSAGE_WORKER_SECRET") ||
    randomBytes(32).toString("hex");
const slackSecret = createdLocalDeployment
  ? randomBytes(32).toString("hex")
  : optionalConvexEnv(convex, "SLACK_WORKER_SECRET") ||
    randomBytes(32).toString("hex");
const slackWebhookSecret = createdLocalDeployment
  ? randomBytes(32).toString("hex")
  : optionalConvexEnv(convex, "SLACK_SIGNING_SECRET") ||
    randomBytes(32).toString("hex");
const existingJwtPrivateKey = createdLocalDeployment
  ? undefined
  : optionalConvexEnv(convex, "JWT_PRIVATE_KEY");
const existingJwks = createdLocalDeployment
  ? undefined
  : optionalConvexEnv(convex, "JWKS");
const localAuthKeys =
  existingJwtPrivateKey && existingJwks
    ? { JWT_PRIVATE_KEY: existingJwtPrivateKey, JWKS: existingJwks }
    : generateLocalAuthKeys();
const operatorTerminalPhone =
  imessageEnv.get("OPERATOR_IMESSAGE_TERMINAL_FROM_PHONE")?.trim() ||
  "+12025550100";
if (!/^\+[1-9]\d{7,14}$/.test(operatorTerminalPhone)) {
  throw new Error(
    "OPERATOR_IMESSAGE_TERMINAL_FROM_PHONE must be an E.164 phone number",
  );
}
const localAppUrl = `http://localhost:${web}`;
const overridesPath = path.join(contextDirectory, "convex-local-overrides.env");

try {
  writeRuntimeEnv("convex-local-overrides.env", {
    SPOT_ENV: "local",
    OPERATOR_BOOTSTRAP_EMAILS: "terry@claritylabs.inc",
    OPERATOR_OWNER_EMAILS: "terry@claritylabs.inc",
    JWT_PRIVATE_KEY: localAuthKeys.JWT_PRIVATE_KEY,
    JWKS: localAuthKeys.JWKS,
    MAPBOX_ACCESS_TOKEN: resolveConductorMapboxAccessToken(initialRootEnv),
    ALLOW_DEV_CLEAR: "true",
    EMAIL_DELIVERY_MODE: "capture",
    IMESSAGE_ENABLED: "false",
    IMESSAGE_TERMINAL_ENABLED: "true",
    IMESSAGE_TERMINAL_BROKER_PHONE: terminalPhone,
    IMESSAGE_TERMINAL_CLIENT_PHONE: terminalClientPhone,
    IMESSAGE_TERMINAL_PUBLIC_PHONE: terminalPublicPhone,
    IMESSAGE_WORKER_URL: `http://127.0.0.1:${imessage}`,
    IMESSAGE_WORKER_SECRET: imessageSecret,
    OPERATOR_IMESSAGE_ENABLED: "false",
    OPERATOR_IMESSAGE_TERMINAL_ENABLED: "true",
    OPERATOR_IMESSAGE_WORKER_URL: `http://127.0.0.1:${operatorImessage}`,
    OPERATOR_IMESSAGE_WORKER_SECRET: operatorImessageSecret,
    SLACK_ENABLED: "true",
    SLACK_MODE: "mock",
    SLACK_CLARITY_TEAM_ID: "T-CLARITY-FIXTURE",
    OPERATOR_SLACK_ENABLED: "true",
    OPERATOR_SLACK_BOT_USER_ID: "U-SPOT",
    SLACK_WORKER_URL: `http://127.0.0.1:${slack}`,
    SLACK_WORKER_SECRET: slackSecret,
    SLACK_SIGNING_SECRET: slackWebhookSecret,
    EXTRACTION_WORKER_MODE: "external",
    EXTRACTION_WORKER_URL: `http://127.0.0.1:${extraction}`,
    EXTRACTION_WORKER_SECRET: extractionSecret,
    EXTRACTION_WORKER_EXPECTED_PROTOCOL_VERSION: "source-tree-v1",
    EXTRACTION_WORKER_EXPECTED_CL_SDK_VERSION: expectedSdkVersion,
    APP_SITE_URL: localAppUrl,
    AUTH_LINK_SITE_URL: localAppUrl,
    CLIENT_PORTAL_URL: localAppUrl,
    SITE_URL: localAppUrl,
  });
  setConvexEnvFromFile(convex, overridesPath);
} finally {
  rmSync(overridesPath, { force: true });
}

run(convex, [
  "run",
  "seed:seed",
  JSON.stringify({
    brokerPhone: terminalPhone,
    clientPhone: terminalClientPhone,
    operatorPhone: operatorTerminalPhone,
  }),
]);

writeRuntimeEnv("extraction-worker.env", {
  CONVEX_URL: localUrls.cloud,
  SPOT_ENV: "local",
  EXTRACTION_WORKER_SECRET: extractionSecret,
  EXTRACTION_WORKER_ID: `conductor-${workspaceSlug()}`,
  EXTRACTION_JOB_CONCURRENCY: "8",
  EXTRACTION_PREVIEW_CONCURRENCY: "2",
  CL_ROUTER_URL: clRouterUrl,
  CL_ROUTER_TASKS: clRouterTasks,
  CL_ROUTER_SECRET: clRouterSecret,
  CL_ROUTER_TIMEOUT_MS: clRouterTimeoutMs,
  CL_ROUTER_TENANT_ID: clRouterTenantId,
  FIREWORKS_API_KEY: optionalConvexEnv(convex, "FIREWORKS_API_KEY"),
  OPENAI_API_KEY: optionalConvexEnv(convex, "OPENAI_API_KEY"),
  ANTHROPIC_API_KEY: optionalConvexEnv(convex, "ANTHROPIC_API_KEY"),
  DEEPSEEK_API_KEY: optionalConvexEnv(convex, "DEEPSEEK_API_KEY"),
  GOOGLE_GENERATIVE_AI_API_KEY: optionalConvexEnv(
    convex,
    "GOOGLE_GENERATIVE_AI_API_KEY",
  ),
  MISTRAL_API_KEY: optionalConvexEnv(convex, "MISTRAL_API_KEY"),
  COHERE_API_KEY: optionalConvexEnv(convex, "COHERE_API_KEY"),
  XAI_API_KEY: optionalConvexEnv(convex, "XAI_API_KEY"),
});
writeRuntimeEnv("imessage-worker.env", {
  SPOT_ENV: "local",
  IMESSAGE_CHANNEL_ROLE: "customer",
  IMESSAGE_ENABLED: "false",
  SPECTRUM_PROVIDER: "terminal",
  CONVEX_SITE_URL: localUrls.site,
  IMESSAGE_WORKER_SECRET: imessageSecret,
  IMESSAGE_TERMINAL_FROM_PHONE: terminalPhone,
  IMESSAGE_TERMINAL_BROKER_PHONE: terminalPhone,
  IMESSAGE_TERMINAL_CLIENT_PHONE: terminalClientPhone,
  IMESSAGE_TERMINAL_PUBLIC_PHONE: terminalPublicPhone,
  IMESSAGE_TERMINAL_SPACE_ID:
    imessageEnv.get("IMESSAGE_TERMINAL_SPACE_ID")?.trim() || "chat-1",
});
writeRuntimeEnv("operator-imessage-worker.env", {
  SPOT_ENV: "local",
  IMESSAGE_CHANNEL_ROLE: "operator",
  OPERATOR_IMESSAGE_ENABLED: "false",
  OPERATOR_IMESSAGE_TERMINAL_ENABLED: "true",
  SPECTRUM_PROVIDER: "terminal",
  CONVEX_SITE_URL: localUrls.site,
  OPERATOR_IMESSAGE_WORKER_SECRET: operatorImessageSecret,
  OPERATOR_IMESSAGE_TERMINAL_FROM_PHONE: operatorTerminalPhone,
  IMESSAGE_TERMINAL_SPACE_ID:
    imessageEnv.get("OPERATOR_IMESSAGE_TERMINAL_SPACE_ID")?.trim() ||
    "operator-chat-1",
});
writeRuntimeEnv("slack-worker.env", {
  SPOT_ENV: "local",
  SLACK_WORKER_MODE: "mock",
  SLACK_WORKER_SECRET: slackSecret,
  SLACK_SIGNING_SECRET: slackWebhookSecret,
});

run("npm", ["run", "check:agent-workers"]);

if (process.env.CONDUCTOR_IS_LOCAL !== "0") {
  ensureContainerService();
  cleanupContainersOnWorkspacePorts();
  buildWorkerImages();
}

console.log(
  "\nConductor workspace ready with its own local Convex database. Run the default Dev template to start Spot, Convex, extraction, the Slack mock worker, and automatic email/OTP capture. Start customer Spectrum with npm run conductor:spectrum or operator Spectrum with npm run conductor:operator-spectrum.",
);
