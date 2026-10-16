import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { repoRoot } from "./lib/conductor-workspace.mjs";

const environments = ["production"];
const cliArgs = process.argv.slice(2);
const bootstrap = cliArgs.includes("--bootstrap");
const requested = cliArgs.filter((arg) => arg !== "--bootstrap");
const targets = requested.length ? requested : environments;

for (const target of targets) {
  if (!environments.includes(target)) {
    throw new Error(`Unknown Slack app environment: ${target}`);
  }
}

const contextDirectory = path.join(repoRoot, ".context", "slack-apps");
mkdirSync(contextDirectory, { recursive: true });
chmodSync(contextDirectory, 0o700);
const deploymentConfig = JSON.parse(
  readFileSync(path.join(repoRoot, "config", "deployments.json"), "utf8"),
);
const serviceToken =
  process.env.SLACK_SERVICE_TOKEN?.trim() ||
  process.env.SLACK_CONFIG_TOKEN?.trim();
if (!serviceToken) {
  throw new Error(
    "SLACK_SERVICE_TOKEN or SLACK_CONFIG_TOKEN is required for Slack Manifest API calls",
  );
}

for (const target of targets) {
  const manifestPath = path.join(
    repoRoot,
    "config",
    "slack",
    "manifests",
    `${target}.json`,
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (bootstrap) {
    delete manifest.settings?.event_subscriptions;
    delete manifest.settings?.interactivity;
  }
  const outputPath = path.join(contextDirectory, `${target}.json`);
  const previous = existsSync(outputPath)
    ? JSON.parse(readFileSync(outputPath, "utf8"))
    : undefined;
  const appId = previous?.app_id ?? deploymentConfig[target]?.slack?.appId;
  const method = appId ? "apps.manifest.update" : "apps.manifest.create";
  const result = spawnSync(
    "slack",
    [
      "api",
      method,
      "--json",
      JSON.stringify(appId ? { app_id: appId, manifest } : { manifest }),
      "--no-color",
      "--skip-update",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, SLACK_USER_TOKEN: serviceToken },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Slack CLI failed for ${target}: ${result.stderr || result.stdout}`,
    );
  }
  const response = JSON.parse(result.stdout);
  const responseAppId = response.app_id ?? appId;
  if (!response.ok || !responseAppId || (!appId && !response.credentials)) {
    throw new Error(
      `Slack rejected the ${target} manifest: ${response.error ?? "unknown error"}`,
    );
  }
  const savedResponse = {
    ...previous,
    ...response,
    app_id: responseAppId,
    manifest_mode: bootstrap ? "bootstrap" : "complete",
    ...(previous?.credentials && !response.credentials
      ? { credentials: previous.credentials }
      : {}),
  };
  writeFileSync(outputPath, `${JSON.stringify(savedResponse, null, 2)}\n`, {
    mode: 0o600,
  });
  chmodSync(outputPath, 0o600);
  console.log(
    `${appId ? "Updated" : "Created"} ${target} Slack app ${responseAppId}${bootstrap ? " (bootstrap manifest)" : ""}; response saved to ${path.relative(repoRoot, outputPath)}`,
  );
}
