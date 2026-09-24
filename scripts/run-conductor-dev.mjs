import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  conductorPorts,
  ensureNode24,
  repairLocalConvexSelection,
  repoRoot,
  withoutCloudConvexSelection,
} from "./lib/conductor-workspace.mjs";

ensureNode24();
process.chdir(repoRoot);

const requiredPaths = [
  ".env.local",
  ".context/slack-worker.env",
  ".convex/local/default/config.json",
  "slack-worker/dist/src/index.js",
  "node_modules/.bin/concurrently",
  "node_modules/.bin/convex",
  "node_modules/.bin/next",
  "scripts/watch-conductor-email-captures.mjs",
  "scripts/run-conductor-web.mjs",
];
for (const relativePath of requiredPaths) {
  if (!existsSync(path.join(repoRoot, relativePath))) {
    throw new Error(
      `${relativePath} is missing. Run npm run conductor:setup before starting Conductor development.`,
    );
  }
}

if (repairLocalConvexSelection()) {
  console.log("Restored this workspace's local Convex selection in .env.local.");
}

const { web, slack, convexCloud, convexSite } = conductorPorts();
const logDirectory = path.join(repoRoot, ".context", "logs");
mkdirSync(logDirectory, { recursive: true });
for (const name of ["web", "convex", "slack"]) {
  writeFileSync(path.join(logDirectory, `${name}.log`), "");
}

const markerPath = path.join(repoRoot, ".context", "conductor-run-marker");
writeFileSync(markerPath, `${randomBytes(16).toString("hex")}\n`);

const commands = [
  "node scripts/run-conductor-web.mjs >> .context/logs/web.log 2>&1",
  `CONVEX_AGENT_MODE=anonymous ./node_modules/.bin/convex dev --local-cloud-port ${convexCloud} --local-site-port ${convexSite} >> .context/logs/convex.log 2>&1`,
  `PORT=${slack} node --env-file=.context/slack-worker.env slack-worker/dist/src/index.js >> .context/logs/slack.log 2>&1`,
  "node scripts/watch-conductor-email-captures.mjs",
];

const runEnvironment = {
  ...withoutCloudConvexSelection(process.env),
  CONDUCTOR_RUN_MARKER: markerPath,
};
delete runEnvironment.NO_COLOR;

console.log(`Spot web:              http://localhost:${web}`);
console.log(`Slack mock worker:       http://localhost:${slack}/health`);
console.log(`Convex:                  http://127.0.0.1:${convexCloud}`);
console.log("Spectrum:                npm run conductor:spectrum");
console.log("Logs:                    .context/logs/{web,convex,slack}.log");
console.log("Email/OTP:               shown here; full text in convex.log");
console.log();

const child = spawn(
  path.join(repoRoot, "node_modules", ".bin", "concurrently"),
  [
    "--raw",
    "--kill-others",
    "--names",
    "web,convex,slack,email",
    ...commands,
  ],
  {
    cwd: repoRoot,
    env: runEnvironment,
    stdio: "inherit",
  },
);

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
});
