import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const archive = process.argv[2];
if (!archive) throw new Error("Supply the reviewed pre-migration archive");
function command(program, args) {
  const result = spawnSync(program, args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 300_000,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${program} failed: ${result.stderr || result.error?.message}`,
    );
  return result.stdout;
}
const run = (name, args) =>
  JSON.parse(
    command("npx", ["convex", "run", "--prod", name, JSON.stringify(args)]),
  );
if (
  command("npx", ["convex", "env", "get", "--prod", "SPOT_ENV"]).trim() !==
  "production"
)
  throw new Error("Expected the production migration target");
const rows = command("unzip", ["-p", archive, "orgMemory/documents.jsonl"])
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
if (
  rows.length !== 22 ||
  rows.some(
    (row) =>
      row.type !== "fact" ||
      row.source !== "extraction" ||
      row.provenance?.kind !== "organization_fact",
  ) ||
  new Set(rows.map((row) => row.orgId)).size !== 1
)
  throw new Error("Archive differs from the reviewed 22 company facts");
const orgId = rows[0].orgId;
const facts = rows.map((row) => ({
  id: row._id,
  content: row.content,
  createdAt: row.createdAt,
}));
const before = run("orgWiki:getInternal", { orgId });
if (!before) throw new Error("Expected the existing shared company wiki");
const audit = run("backendSchemaLegacy:restoreArchivedCompanyFacts", {
  orgId,
  facts,
});
const applied = run("backendSchemaLegacy:restoreArchivedCompanyFacts", {
  orgId,
  facts,
  dryRun: false,
});
const after = run("orgWiki:getInternal", { orgId });
if (
  !after.body.startsWith(before.body.trimEnd()) ||
  facts.some((fact) => !after.body.includes(fact.content.trim()))
)
  throw new Error(
    "Wiki readback did not preserve all current and archived content",
  );
const replay = run("backendSchemaLegacy:restoreArchivedCompanyFacts", {
  orgId,
  facts,
  dryRun: false,
});
const repeated = run("orgWiki:getInternal", { orgId });
if (replay.added !== 0 || JSON.stringify(after) !== JSON.stringify(repeated))
  throw new Error("Recovery replay changed the wiki");
const report = {
  sourceFacts: facts.length,
  audit,
  applied,
  replay,
  currentContentPreserved: true,
  allFactsPreserved: true,
  replayUnchanged: true,
};
writeFileSync(
  join(process.env.SCHEMA_MIGRATION_OUTPUT_DIR, "company-fact-recovery.json"),
  JSON.stringify(report, null, 2),
  { mode: 0o600 },
);
console.log(JSON.stringify(report));
