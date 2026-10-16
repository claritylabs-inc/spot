import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import {
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

if (dryRun) {
  if (existsSync(localDeploymentDirectory)) {
    console.log(
      `Would clear ${path.relative(repoRoot, localDeploymentDirectory)}`,
    );
  } else {
    console.log("No worktree-local Convex database remains to clear.");
  }
  process.exit(0);
}

if (existsSync(localDeploymentDirectory)) {
  rmSync(localDeploymentDirectory, { recursive: true, force: true });
  console.log("Cleared the worktree-local Convex database and auth state.");
} else {
  console.log("No worktree-local Convex database remains to clear.");
}
