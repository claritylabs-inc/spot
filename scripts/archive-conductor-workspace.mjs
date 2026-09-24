import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import {
  conductorImageTags,
  ensureNode24,
  parseEnvText,
  repoRoot,
} from "./lib/conductor-workspace.mjs";

ensureNode24();
process.chdir(repoRoot);

const localDeploymentDirectory = path.join(repoRoot, ".convex", "local", "default");
const dryRun = process.env.CONDUCTOR_ARCHIVE_DRY_RUN === "1";

if (existsSync(localDeploymentDirectory)) {
  const envPath = path.join(repoRoot, ".env.local");
  const deployment = existsSync(envPath)
    ? parseEnvText(readFileSync(envPath, "utf8"))
        .get("CONVEX_DEPLOYMENT")
        ?.trim()
    : undefined;
  if (!deployment || !/^(anonymous|local):/.test(deployment)) {
    throw new Error(
      "Refusing to clear Convex state because this worktree is not selecting a native local deployment.",
    );
  }
}

function runContainer(args, options = {}) {
  const result = spawnSync("container", args, {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(
      `container ${args.join(" ")} exited with status ${result.status ?? "unknown"}`,
    );
  }
  return result.stdout;
}

function ensureContainerSystem() {
  const status = spawnSync("container", ["system", "status"], {
    cwd: repoRoot,
    env: process.env,
    stdio: "ignore",
  });
  if (status.error?.code === "ENOENT") return false;
  if (status.error) throw status.error;
  if (status.status !== 0) {
    runContainer(["system", "start"], { stdio: "inherit" });
  }
  return true;
}

const imageTags = conductorImageTags();

if (dryRun) {
  for (const imageTag of imageTags) {
    console.log(`Would delete Apple Container image ${imageTag}`);
  }
  if (existsSync(localDeploymentDirectory)) {
    console.log(
      `Would clear ${path.relative(repoRoot, localDeploymentDirectory)}`,
    );
  } else {
    console.log("No worktree-local Convex database remains to clear.");
  }
  process.exit(0);
}

if (ensureContainerSystem()) {
  runContainer(["image", "delete", "--force", ...imageTags], {
    stdio: "inherit",
  });
  console.log(
    `Deleted ${imageTags.length} workspace-scoped Apple Container image tags.`,
  );
} else {
  console.log("Apple Container is not installed; no container resources exist to clear.");
}

if (existsSync(localDeploymentDirectory)) {
  rmSync(localDeploymentDirectory, { recursive: true, force: true });
  console.log("Cleared the worktree-local Convex database and auth state.");
} else {
  console.log("No worktree-local Convex database remains to clear.");
}
