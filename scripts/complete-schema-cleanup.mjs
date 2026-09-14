import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import dayjs from "dayjs";

const TABLES = [
  "organizations", "pendingEmails", "slackInboundEvents", "slackActors", "notifications",
  "threadMessages", "certificateRequestHolds", "appCardAccessLinks", "globalModelSettings",
];
const PHASES = [
  "cleanupOrganizationSettings", "cleanupPendingEmailStorage", "cleanupSlackAttachmentStorage",
  "cleanupNotificationExpiry", "cleanupThreadPolicyChangeReferences", "cleanupHoldPolicyChangeReferences",
  "cleanupCardPolicyChangeReferences", "cleanupRetiredModelRoute", "backfillSlackActorSpotIdentity",
].map((name) => `migrations:${name}`);

export async function completeSchemaCleanup({
  runFunction,
  expectedEnv,
  wait = (milliseconds) => delay(milliseconds),
  now = () => dayjs().valueOf(),
  report = console.log,
  timeoutMs = 600_000,
}) {
  const deadline = now() + timeoutMs;
  const requireBudget = () => {
    if (now() >= deadline) throw new Error("Schema cleanup exceeded the release wait budget; rerun to resume.");
  };
  async function audit(phase) {
    let changes = 0;
    let blockers = 0;
    for (const table of TABLES) {
      let cursor = null;
      let scanned = 0;
      let tableChanges = 0;
      let tableBlockers = 0;
      for (;;) {
        requireBudget();
        const page = await runFunction("schemaCleanup:audit", { table, cursor });
        if (page.spotEnv !== expectedEnv || page.table !== table) throw new Error("Schema cleanup target does not match the selected environment.");
        scanned += page.scanned;
        tableChanges += page.changes;
        tableBlockers += page.blockers;
        if (page.isDone) break;
        if (!page.cursor || page.cursor === cursor) throw new Error("Schema cleanup audit cursor did not advance.");
        cursor = page.cursor;
      }
      changes += tableChanges;
      blockers += tableBlockers;
      report(JSON.stringify({ phase, table, scanned, changes: tableChanges, blockers: tableBlockers }));
    }
    return { changes, blockers };
  }

  const before = await audit("before");
  if (before.blockers) throw new Error("Schema cleanup requires review of incompatible rows; no migration started.");
  await runFunction("migrations:runSchemaCleanup", {});
  for (;;) {
    requireBudget();
    const statuses = await runFunction("migrations:schemaCleanupStatus", {});
    if (!Array.isArray(statuses) || statuses.length !== PHASES.length) throw new Error("Unexpected schema cleanup migration status.");
    for (const name of PHASES) {
      const phase = statuses.find((entry) => entry.name === name);
      if (!phase || phase.state === "failed" || phase.state === "canceled") throw new Error(`Schema cleanup failed: ${name}`);
    }
    if (statuses.every((phase) => phase.isDone === true)) break;
    await wait(2_000);
  }
  const after = await audit("after");
  if (after.changes || after.blockers) throw new Error("Schema cleanup still has residual fields or incompatible rows.");
  report(`Schema cleanup verified for ${expectedEnv}; no residual fields.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const expectedEnv = process.argv[process.argv.indexOf("--env") + 1];
    if (!["production", "dev", "local"].includes(expectedEnv)) throw new Error("Pass --env production, dev, or local.");
    await completeSchemaCleanup({
      expectedEnv,
      runFunction(name, args) {
        const result = spawnSync("npx", ["convex", "run", ...(expectedEnv === "production" ? ["--prod"] : []), name, JSON.stringify(args)], {
          encoding: "utf8", timeout: 60_000, env: process.env,
        });
        if (result.error || result.status !== 0) throw new Error(`Convex cleanup command failed: ${name}. Inspect the deployment logs.`);
        return JSON.parse(result.stdout);
      },
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Schema cleanup failed.");
    process.exitCode = 1;
  }
}
