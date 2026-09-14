import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import dayjs from "dayjs";

const PHASES = [
  "migrations:backfillOperatorUserEmailIdentities",
  "migrations:backfillOperatorProfileEmailIdentities",
  "migrations:backfillOperatorAuthEmailIdentities",
];
const STATUS = "migrations:operatorEmailIdentityBackfillStatus";

function runProductionFunction(name) {
  const result = spawnSync("npx", ["convex", "run", "--prod", name, "{}"], {
    encoding: "utf8",
    timeout: 30_000,
    env: process.env,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Convex command failed: ${name}. Check the deployment migration status.`,
    );
  }
  return JSON.parse(result.stdout);
}

function phasesComplete(status) {
  if (
    !Array.isArray(status.statuses) ||
    status.statuses.length !== PHASES.length
  ) {
    throw new Error("Unexpected operator email identity migration status.");
  }
  for (const name of PHASES) {
    const phase = status.statuses.find((entry) => entry.name === name);
    if (!phase || phase.state === "failed" || phase.state === "canceled") {
      throw new Error(
        `Operator email identity migration did not succeed: ${name}`,
      );
    }
  }
  return status.statuses.every((phase) => phase.isDone === true);
}

export async function completeOperatorEmailIdentityBackfill({
  runFunction = runProductionFunction,
  wait = delay,
  now = () => dayjs().valueOf(),
  timeoutMs = 300_000,
} = {}) {
  const deadline = now() + timeoutMs;
  await runFunction("migrations:runOperatorEmailIdentityBackfill");
  for (;;) {
    const status = await runFunction(STATUS);
    if (phasesComplete(status)) break;
    if (now() >= deadline) {
      throw new Error(
        "Operator email identity backfill exceeded the release wait budget; rerun the release to resume.",
      );
    }
    await wait(2_000);
  }
  const result = await runFunction(
    "migrations:finishOperatorEmailIdentityBackfill",
  );
  const status = await runFunction(STATUS);
  if (
    result.ready !== true ||
    status.ready !== true ||
    !phasesComplete(status)
  ) {
    throw new Error("Operator email identity login gate is not ready.");
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (!process.env.CONVEX_DEPLOY_KEY)
      throw new Error("CONVEX_DEPLOY_KEY is required.");
    await completeOperatorEmailIdentityBackfill();
    console.log("Operator email identity backfill verified; login is enabled.");
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Operator email identity backfill failed.",
    );
    process.exitCode = 1;
  }
}
