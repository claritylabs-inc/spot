import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(scriptDirectory, "../..");

export const cloudConvexSelectionKeys = [
  "CONDUCTOR_CONVEX_SOURCE_DEPLOY_KEY",
  "CONDUCTOR_CONVEX_SOURCE_DEPLOYMENT",
  "CONVEX_DEPLOYMENT",
  "CONVEX_DEPLOYMENT_TOKEN",
  "CONVEX_DEPLOY_KEY",
  "CONVEX_SELF_HOSTED_ADMIN_KEY",
  "CONVEX_SELF_HOSTED_URL",
  "CONVEX_SITE_URL",
  "CONVEX_URL",
  "NEXT_PUBLIC_CONVEX_SITE_URL",
  "NEXT_PUBLIC_CONVEX_URL",
];

// These credentials belong only in cl-router. Keep the list explicit so local
// setup cannot accidentally strip unrelated integration credentials.
export const consumerAiCredentialNames = [
  "AI_GATEWAY_API_KEY",
  "ANTHROPIC_API_KEY",
  "COHERE_API_KEY",
  "DEEPSEEK_API_KEY",
  "EXA_API_KEY",
  "FIREWORKS_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "MISTRAL_API_KEY",
  "MOONSHOTAI_API_KEY",
  "MOONSHOT_API_KEY",
  "OPENAI_API_KEY",
  "PARALLEL_API_KEY",
  "VERCEL_AI_GATEWAY_API_KEY",
  "XAI_API_KEY",
];

export function ensureNode24() {
  if (process.versions.node.split(".")[0] === "24") {
    const nodeBin = path.dirname(process.execPath);
    if (!process.env.PATH?.split(path.delimiter).includes(nodeBin)) {
      process.env.PATH = `${nodeBin}${path.delimiter}${process.env.PATH ?? ""}`;
    }
    return;
  }

  if (process.env.SPOT_NODE_24_BOOTSTRAPPED === "1") {
    throw new Error(`Spot requires Node 24.x; found ${process.version}`);
  }

  const brewPrefix = spawnSync("brew", ["--prefix", "node@24"], {
    encoding: "utf8",
  });
  const prefix = brewPrefix.status === 0 ? brewPrefix.stdout.trim() : "";
  let nodePath = prefix ? path.join(prefix, "bin", "node") : "";

  if (!nodePath || !existsSync(nodePath)) {
    console.log(
      "Installing the repository-standard Node 24 toolchain with Homebrew...",
    );
    const install = spawnSync("brew", ["install", "node@24"], {
      stdio: "inherit",
    });
    if (install.error) throw install.error;
    if (install.status !== 0) {
      throw new Error("Unable to install Homebrew node@24");
    }
    const installedPrefix = spawnSync("brew", ["--prefix", "node@24"], {
      encoding: "utf8",
    });
    if (installedPrefix.status !== 0) {
      throw new Error(
        "Homebrew installed node@24 but its prefix is unavailable",
      );
    }
    nodePath = path.join(installedPrefix.stdout.trim(), "bin", "node");
  }

  const nodeBin = path.dirname(nodePath);
  const result = spawnSync(nodePath, process.argv.slice(1), {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SPOT_NODE_24_BOOTSTRAPPED: "1",
      PATH: `${nodeBin}${path.delimiter}${process.env.PATH ?? ""}`,
    },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

export function parseEnvText(contents) {
  const values = new Map();
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separator = normalized.indexOf("=");
    if (separator < 1) continue;
    const key = normalized.slice(0, separator).trim();
    let value = normalized.slice(separator + 1).trim();
    const quoted =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")));
    if (quoted) {
      value = value.slice(1, -1);
    } else {
      const inlineComment = value.search(/\s+#/);
      if (inlineComment >= 0) value = value.slice(0, inlineComment).trimEnd();
    }
    values.set(key, value);
  }
  return values;
}

export function parseEnvFile(filePath) {
  return parseEnvText(readFileSync(filePath, "utf8"));
}

const convexSelectionKeys = new Set([
  "CONVEX_DEPLOYMENT",
  "CONVEX_SELF_HOSTED_ADMIN_KEY",
  "CONVEX_SELF_HOSTED_URL",
  "CONVEX_SITE_URL",
  "CONVEX_URL",
  "NEXT_PUBLIC_CONVEX_SITE_URL",
  "NEXT_PUBLIC_CONVEX_URL",
]);

function envAssignmentKey(rawLine) {
  const line = rawLine.trim().replace(/^export\s+/, "");
  const separator = line.indexOf("=");
  if (separator < 1) return undefined;
  return line.slice(0, separator).trim();
}

export function withoutConsumerAiCredentials(contents) {
  const credentialNames = new Set(consumerAiCredentialNames);
  return `${contents
    .split(/\r?\n/)
    .filter((line) => !credentialNames.has(envAssignmentKey(line)))
    .join("\n")
    .replace(/\n+$/, "")}\n`;
}

export function localConvexSelectionContents(contents, config) {
  const deploymentName = config?.deploymentName;
  const cloudPort = config?.ports?.cloud;
  const sitePort = config?.ports?.site;
  if (
    typeof deploymentName !== "string" ||
    deploymentName.length === 0 ||
    !Number.isInteger(cloudPort) ||
    cloudPort <= 0 ||
    cloudPort > 65535 ||
    !Number.isInteger(sitePort) ||
    sitePort <= 0 ||
    sitePort > 65535
  ) {
    throw new Error("The worktree-local Convex configuration is invalid");
  }

  const deploymentType = deploymentName.startsWith("anonymous-")
    ? "anonymous"
    : "local";
  const expected = new Map([
    ["CONVEX_DEPLOYMENT", `${deploymentType}:${deploymentName}`],
    ["NEXT_PUBLIC_CONVEX_URL", `http://127.0.0.1:${cloudPort}`],
    ["NEXT_PUBLIC_CONVEX_SITE_URL", `http://127.0.0.1:${sitePort}`],
  ]);
  const written = new Set();
  const lines = contents.split(/\r?\n/);
  const output = [];

  for (const rawLine of lines) {
    const key = envAssignmentKey(rawLine);
    if (!key || !convexSelectionKeys.has(key)) {
      output.push(rawLine);
      continue;
    }
    if (expected.has(key) && !written.has(key)) {
      output.push(`${key}=${expected.get(key)}`);
      written.add(key);
    }
  }

  for (const [key, value] of expected) {
    if (written.has(key)) continue;
    while (output.at(-1) === "") output.pop();
    output.push(`${key}=${value}`);
  }

  return `${output.join("\n").replace(/\n+$/, "")}\n`;
}

export function repairLocalConvexSelection(workspaceRoot = repoRoot) {
  const configPath = path.join(
    workspaceRoot,
    ".convex",
    "local",
    "default",
    "config.json",
  );
  const envPath = path.join(workspaceRoot, ".env.local");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const contents = readFileSync(envPath, "utf8");
  const repaired = localConvexSelectionContents(contents, config);
  if (repaired === contents) return false;
  writeFileSync(envPath, repaired);
  return true;
}

export function withoutCloudConvexSelection(environment) {
  const sanitized = { ...environment };
  for (const name of cloudConvexSelectionKeys) delete sanitized[name];
  return sanitized;
}

export function convexDeploymentNameFromDeployKey(deployKey) {
  const selector = deployKey?.trim().split("|", 1)[0];
  const match = selector?.match(/^(?:dev|prod):([^:|]+)$/);
  return match?.[1];
}

export function isMissingConvexAccessToken(output) {
  return /\bMissingAccessToken\b/i.test(output);
}

export function canUseAnonymousConvexCloudFallback({
  isCloud,
  hasDeployKey,
  output,
}) {
  return isCloud && !hasDeployKey && isMissingConvexAccessToken(output);
}

/**
 * @param {Map<string, string>} fileEnvironment
 * @param {Record<string, string | undefined>} [environment]
 */
export function resolveConductorMapboxAccessToken(
  fileEnvironment,
  environment = process.env,
) {
  return (
    fileEnvironment.get("MAPBOX_ACCESS_TOKEN")?.trim() ||
    fileEnvironment.get("NEXT_PUBLIC_MAPBOX_TOKEN")?.trim() ||
    environment.MAPBOX_ACCESS_TOKEN?.trim() ||
    environment.NEXT_PUBLIC_MAPBOX_TOKEN?.trim()
  );
}

export function resolveConductorClRouterConfig(values, { required }) {
  const executionEntries = [
    ["CL_ROUTER_URL", values.url?.trim()],
    ["CL_ROUTER_SECRET", values.secret?.trim()],
  ];
  if (!required && executionEntries.every(([, value]) => !value)) {
    return {};
  }

  const missing = executionEntries
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(", ")} must be configured in the source dev Convex environment so Conductor model calls use cl-router`,
    );
  }

  return {
    url: executionEntries[0][1],
    secret: executionEntries[1][1],
    timeoutMs: values.timeoutMs?.trim() || "180000",
    tenantId: values.tenantId?.trim() || "glass",
  };
}

export function generateLocalAuthKeys() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicExponent: 0x10001,
  });
  const privateKeyPem = privateKey.export({
    type: "pkcs8",
    format: "pem",
  });
  const publicJwk = publicKey.export({ format: "jwk" });
  return {
    JWT_PRIVATE_KEY: privateKeyPem.trimEnd().replace(/\n/g, " "),
    JWKS: JSON.stringify({ keys: [{ use: "sig", ...publicJwk }] }),
  };
}

export function conductorPorts(workspaceRoot = repoRoot) {
  const configPath = path.join(
    workspaceRoot,
    ".convex",
    "local",
    "default",
    "config.json",
  );
  let configuredBasePort;
  if (!process.env.CONDUCTOR_PORT && existsSync(configPath)) {
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    const cloudPort = config?.ports?.cloud;
    if (Number.isInteger(cloudPort)) configuredBasePort = cloudPort - 3;
  }
  const basePort = Number.parseInt(
    process.env.CONDUCTOR_PORT ?? String(configuredBasePort ?? 8080),
    10,
  );
  if (!Number.isInteger(basePort) || basePort <= 0 || basePort > 65529) {
    throw new Error("CONDUCTOR_PORT must be an integer between 1 and 65529");
  }
  return {
    web: basePort,
    extraction: basePort + 1,
    imessage: basePort + 2,
    convexCloud: basePort + 3,
    convexSite: basePort + 4,
    slack: basePort + 5,
    operatorImessage: basePort + 6,
  };
}

export function conductorLocalRuntimeOverrides() {
  const { web, extraction, imessage, slack, operatorImessage } = conductorPorts();
  const appUrl = `http://localhost:${web}`;
  return {
    APP_SITE_URL: appUrl,
    AUTH_LINK_SITE_URL: appUrl,
    CLIENT_PORTAL_URL: appUrl,
    SITE_URL: appUrl,
    EXTRACTION_WORKER_URL: `http://127.0.0.1:${extraction}`,
    IMESSAGE_WORKER_URL: `http://127.0.0.1:${imessage}`,
    OPERATOR_IMESSAGE_WORKER_URL: `http://127.0.0.1:${operatorImessage}`,
    SLACK_WORKER_URL: `http://127.0.0.1:${slack}`,
  };
}

export function workspaceSlug(workspacePath = repoRoot) {
  return (
    path
      .basename(path.resolve(workspacePath))
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "workspace"
  );
}

export function conductorImageTag(workerName, workspacePath = repoRoot) {
  return `spot-${workerName}:conductor-${workspaceSlug(workspacePath)}`;
}

export function conductorImageTags(workspacePath = repoRoot) {
  return ["extraction-worker", "imessage-worker", "slack-worker", "mailbox-scan-worker"].map(
    (workerName) => conductorImageTag(workerName, workspacePath),
  );
}

export function conductorContainerName(
  workerName,
  port,
  workspacePath = repoRoot,
) {
  return `spot-${workerName}-${workspaceSlug(workspacePath)}-${port}`;
}

export function conductorContainerNamesOnPort(containers, workerName, port) {
  const prefixes = [`spot-${workerName}-`, `glass-${workerName}-`];
  const suffix = `-${port}`;
  const names = new Set();

  for (const container of containers) {
    for (const name of [container?.id, container?.configuration?.id]) {
      if (
        typeof name === "string" &&
        prefixes.some((prefix) => name.startsWith(prefix)) &&
        name.endsWith(suffix)
      ) {
        names.add(name);
      }
    }
  }

  return [...names];
}

export function localConvexUrls() {
  const config = JSON.parse(
    readFileSync(
      path.join(repoRoot, ".convex", "local", "default", "config.json"),
      "utf8",
    ),
  );
  const env = parseEnvFile(path.join(repoRoot, ".env.local"));
  const deployment = env.get("CONVEX_DEPLOYMENT")?.trim();
  const cloud = env.get("NEXT_PUBLIC_CONVEX_URL")?.trim();
  const site = env.get("NEXT_PUBLIC_CONVEX_SITE_URL")?.trim();
  if (!deployment || !/^(anonymous|local):/.test(deployment)) {
    throw new Error(
      "This worktree is not configured for a native local Convex deployment. Run npm run conductor:setup.",
    );
  }
  if (
    !cloud?.startsWith("http://127.0.0.1:") ||
    !site?.startsWith("http://127.0.0.1:")
  ) {
    throw new Error(
      "The selected local Convex deployment has invalid loopback URLs",
    );
  }
  if (
    cloud !== `http://127.0.0.1:${config.ports?.cloud}` ||
    site !== `http://127.0.0.1:${config.ports?.site}`
  ) {
    throw new Error(
      "Convex has not written its current local ports to .env.local yet",
    );
  }
  return { cloud, site, deployment };
}

export async function waitForLocalConvex({ timeoutMs = 120_000 } = {}) {
  const configPath = path.join(
    repoRoot,
    ".convex",
    "local",
    "default",
    "config.json",
  );
  const envPath = path.join(repoRoot, ".env.local");
  const markerPath = process.env.CONDUCTOR_RUN_MARKER;
  const markerMtime =
    markerPath && existsSync(markerPath)
      ? statSync(markerPath).mtimeMs
      : undefined;
  const started = performance.now();
  let lastError;

  while (performance.now() - started < timeoutMs) {
    try {
      if (!existsSync(configPath) || !existsSync(envPath)) {
        throw new Error("local Convex configuration has not been written yet");
      }
      if (
        markerMtime !== undefined &&
        statSync(configPath).mtimeMs < markerMtime
      ) {
        throw new Error(
          "the current Convex watcher has not selected its ports yet",
        );
      }
      const urls = localConvexUrls();
      const response = await fetch(`${urls.cloud}/instance_name`);
      if (!response.ok)
        throw new Error(`Convex returned HTTP ${response.status}`);
      await response.text();
      return urls;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error(
    `Local Convex did not become ready within ${timeoutMs / 1000} seconds: ${lastError instanceof Error ? lastError.message : "unknown error"}`,
  );
}

/**
 * @typedef {(command: string, args: string[], options: import("node:child_process").SpawnSyncOptionsWithStringEncoding | import("node:child_process").SpawnSyncOptions) => { error?: Error; status: number | null; stdout: string; stderr?: string }} ConductorCommandRunner
 */

/**
 * @param {{ startServiceIfNeeded?: boolean; runCommand?: ConductorCommandRunner }} [options]
 */
export function containerGateway({
  startServiceIfNeeded = false,
  runCommand = /** @type {ConductorCommandRunner} */ (spawnSync),
} = {}) {
  const inspectNetworks = () =>
    runCommand("container", ["network", "list", "--format", "json"], {
      cwd: repoRoot,
      encoding: "utf8",
    });

  let result = inspectNetworks();
  if (result.error) throw result.error;
  if (result.status !== 0 && startServiceIfNeeded) {
    console.log("Apple container service is unavailable; starting it...");
    const start = runCommand(
      "/bin/zsh",
      ["-c", "yes | container system start"],
      {
        cwd: repoRoot,
        env: process.env,
        stdio: "inherit",
      },
    );
    if (start.error) throw start.error;
    if (start.status !== 0) {
      throw new Error(
        "Unable to start the Apple container service. Run `npm run container:system:start` and retry Dev.",
      );
    }
    result = inspectNetworks();
    if (result.error) throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      "Unable to inspect the Apple container default network. Run `npm run container:system:start` and retry Dev.",
    );
  }

  const networks = JSON.parse(result.stdout);
  const defaultNetwork = networks.find(
    (network) =>
      network.id === "default" || network.configuration?.name === "default",
  );
  const gateway = defaultNetwork?.status?.ipv4Gateway;
  if (typeof gateway !== "string" || !/^\d+\.\d+\.\d+\.\d+$/.test(gateway)) {
    throw new Error("Apple container did not report an IPv4 gateway");
  }
  return gateway;
}

export async function listenOnContainerGateway(
  server,
  {
    gateway,
    port,
    timeoutMs = 30_000,
    retryDelayMs = 250,
    now = () => performance.now(),
    sleep = (delayMs) =>
      new Promise((resolve) => setTimeout(resolve, delayMs)),
  },
) {
  const started = now();
  let lastError;

  while (now() - started < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.off("error", onError);
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, gateway);
      });
      return;
    } catch (error) {
      lastError = error;
      if (error?.code !== "EADDRNOTAVAIL") throw error;
      await sleep(retryDelayMs);
    }
  }

  throw new Error(
    `Apple container gateway ${gateway} did not become available within ${timeoutMs / 1000} seconds: ${lastError instanceof Error ? lastError.message : "unknown error"}`,
  );
}
