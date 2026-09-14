import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import {
  createMigrationRunner,
  requireZero,
} from "./lib/schema-migration-runner.mjs";
import { join } from "node:path";
import dayjs from "dayjs";

const apply = process.argv.includes("--apply");
const prod = process.argv.includes("--prod");
const output =
  process.env.SCHEMA_MIGRATION_OUTPUT_DIR ?? ".context/schema-migration";
mkdirSync(output, { recursive: true, mode: 0o700 });
const report = {
  startedAt: dayjs().toISOString(),
  production: prod,
  apply,
  results: [],
};

function command(args) {
  const result = spawnSync("npx", ["convex", ...args], {
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `Convex ${args[0]} failed: ${result.stderr?.slice(-2000) || result.error?.message}`,
    );
  return result.stdout;
}
function run(name, args = {}) {
  return JSON.parse(
    command(["run", ...(prod ? ["--prod"] : []), name, JSON.stringify(args)]),
  );
}
function log(name, totals) {
  report.results.push({ name, ...totals });
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ name, ...totals }));
}
const { pages, batches } = createMigrationRunner({
  run,
  log,
  checkpoint: (page) => {
    report.checkpoint = {
      name: page.name,
      args: page.args,
      page: page.page,
      cursor: page.cursor ?? null,
      nextCursor: page.nextCursor ?? null,
    };
    appendFileSync(join(output, "pages.jsonl"), `${JSON.stringify(page)}\n`, {
      mode: 0o600,
    });
    writeFileSync(
      join(output, "report.json"),
      JSON.stringify(report, null, 2),
      { mode: 0o600 },
    );
  },
});

const ownershipTables = [
  "organizations",
  "policies",
  "procurementBrokerOutreaches",
];
const procurementTables = [
  "procurementRequests",
  "procurementBrokerOutreaches",
  "procurementFileItems",
  "procurementPacketSections",
];
const certificateTables = [
  "requirementSourceDocuments",
  "certificateHolders",
  "certificateWorkflowJobs",
];
const policyTables = [
  "certificateWorkflowSettings",
  "policies",
  "policyFiles",
  "sourceChunks",
];
const procurementCleanupTables = [
  "procurementBrokerOutreaches",
  "procurementRequests",
  "procurementProposalReviews",
];
const oauthTables = ["oauthAuthCodes", "oauthTokens"];
const compatibilityTables = [
  "brokerModelSettings",
  "companyInformationExtractions",
  "connectedEmailAutomationItems",
  "pendingEmails",
  "globalModelSettings",
  "threads",
];
const retiredTables = [
  "procurementPacketUpdateRuns",
  "brokerActivity",
  "orgMemory",
  "procurementMemory",
  "brokerClientAssignments",
  "policyDeliverySettings",
  "policyDeliveryRules",
  "policyDeliveryJobs",
  "policyDeliveryAttempts",
];
const retainedTables = [
  "procurementRequirementDrafts",
  "procurementRequestRequirements",
  "procurementSpecifications",
  "procurementRequestActivities",
  "procurementRequestDocuments",
  "clientInvitations",
  "brokerActivity",
];

function auditAll() {
  let ownershipBlockers = 0;
  for (const table of ownershipTables)
    ownershipBlockers += pages("backendSchemaLegacy:ownershipAuditPage", {
      table,
    }).blockers;
  const organization = pages("organizationSchemaCleanup:auditPage");
  const wiki = run("orgWiki:verifyLegacyMigration");
  if (typeof wiki.complete !== "boolean")
    throw new Error("Wiki verification omitted completion status");
  for (const table of procurementTables)
    pages("procurementMarkdownMigration:auditPage", { table });
  log(
    "retired procurement Markdown documents",
    run("procurementMarkdownMigration:verifyRetiredDocuments"),
  );
  for (const target of certificateTables)
    pages("certificateNotesMigration:verifyPage", { target });
  for (const target of policyTables)
    pages("policySchemaCleanup:verifyPage", { target });
  for (const table of procurementCleanupTables)
    pages("procurementSchemaCleanup:auditPage", { table });
  for (const table of oauthTables) {
    pages("oauthScopeMigration:audit", { table }, { optionalCursor: true });
    pages("oauthScopeMigration:verify", { table }, { optionalCursor: true });
  }
  for (const table of compatibilityTables)
    pages("backendSchemaLegacy:clearCompatibilityPage", {
      table,
      dryRun: true,
    });
  pages("retiredConversationMemory:audit", {}, { optionalCursor: true });
  for (const table of retiredTables)
    pages("backendSchemaLegacy:audit", { table });
  const retained = {
    policyUpdateRuns: pages("backendSchemaLegacy:inventoryPolicyHistoryPage")
      .count,
  };
  for (const table of retainedTables)
    retained[table] = pages("procurementSchemaCleanup:inventoryLegacyPage", {
      table,
    }).count;
  report.retainedLegacyRows = retained;
  return { ownershipBlockers, organization };
}

try {
  if (prod && !process.env.CONVEX_DEPLOY_KEY)
    throw new Error("Production migration requires its deployment key");
  if (
    prod &&
    command(["env", "get", "SPOT_ENV", "--prod"]).trim() !== "production"
  )
    throw new Error(
      "Production migration target must report SPOT_ENV=production",
    );
  // Complete every prerequisite audit before taking a backup or mutating rows.
  const initial = auditAll();
  report.ownershipBlockers = initial.ownershipBlockers;
  if (!apply) {
    report.completedAt = dayjs().toISOString();
    report.readyForNarrowing = false;
    log("audit finished", { ownershipBlockers: initial.ownershipBlockers });
  } else {
    requireZero({ blockers: initial.ownershipBlockers }, "blockers");
    const backup = join(
      output,
      `database-${dayjs().format("YYYYMMDD-HHmmss")}.zip`,
    );
    command([
      "export",
      ...(prod ? ["--prod"] : []),
      "--include-file-storage",
      "--path",
      backup,
    ]);
    if (statSync(backup).size === 0)
      throw new Error("Database backup is empty");
    log("database and file-storage backup", { filename: backup });
    for (const table of ["organizations", "policies"]) {
      pages("backendSchemaLegacy:clearLegacyOwnershipPage", {
        table,
        dryRun: false,
      });
      requireZero(
        pages("backendSchemaLegacy:ownershipAuditPage", { table }),
        "blockers",
        "legacyReferences",
      );
    }
    batches("orgWiki:migrateLegacyBatch");
    if (run("orgWiki:verifyLegacyMigration").complete !== true)
      throw new Error("Legacy wiki remains");
    pages("organizationSchemaCleanup:migratePage");
    requireZero(
      pages("organizationSchemaCleanup:auditPage"),
      "narrativeRows",
      "entityNoteRows",
      "unnormalizedNames",
      "missingResearch",
      "missingType",
      "brokerOwnedClients",
    );
    for (const table of procurementTables) {
      pages("procurementMarkdownMigration:migratePage", { table });
      requireZero(
        pages("procurementMarkdownMigration:auditPage", { table }),
        "remaining",
      );
    }
    const retiredDocuments = run(
      "procurementMarkdownMigration:verifyRetiredDocuments",
    );
    log(
      "retired procurement Markdown documents after migration",
      retiredDocuments,
    );
    if (retiredDocuments.complete !== true)
      throw new Error(
        "Retired procurement Markdown documents remain; reconcile their owners before narrowing",
      );
    for (const target of certificateTables) {
      pages("certificateNotesMigration:migratePage", { target, dryRun: false });
      requireZero(
        pages("certificateNotesMigration:verifyPage", { target }),
        "remaining",
      );
    }
    for (const target of policyTables) {
      pages("policySchemaCleanup:cleanupPage", { target, dryRun: false });
      requireZero(
        pages("policySchemaCleanup:verifyPage", { target }),
        "remaining",
      );
    }
    for (const table of procurementCleanupTables) {
      pages("procurementSchemaCleanup:migratePage", { table });
      requireZero(
        pages("procurementSchemaCleanup:auditPage", { table }),
        "changed",
        "unboundReviews",
      );
    }
    for (const table of oauthTables) {
      pages(
        "oauthScopeMigration:migrateBatch",
        { table },
        { optionalCursor: true },
      );
      requireZero(
        pages(
          "oauthScopeMigration:verify",
          { table },
          { optionalCursor: true },
        ),
        "remaining",
      );
    }
    for (const table of compatibilityTables) {
      pages("backendSchemaLegacy:clearCompatibilityPage", {
        table,
        dryRun: false,
      });
      requireZero(
        pages("backendSchemaLegacy:clearCompatibilityPage", {
          table,
          dryRun: true,
        }),
        "changed",
      );
    }
    batches("retiredConversationMemory:purgeBatch");
    if (run("retiredConversationMemory:verify").complete !== true)
      throw new Error("Retired conversation rows remain");
    for (const table of retiredTables) {
      batches("backendSchemaLegacy:purgeBatch", { table });
      requireZero(pages("backendSchemaLegacy:audit", { table }), "count");
    }
    let blockers = 0;
    let legacyReferences = 0;
    for (const table of ownershipTables) {
      const ownership = pages("backendSchemaLegacy:ownershipAuditPage", {
        table,
      });
      blockers += ownership.blockers;
      legacyReferences += ownership.legacyReferences;
    }
    requireZero({ blockers, legacyReferences }, "blockers", "legacyReferences");
    const finalRetained = {
      policyUpdateRuns: pages("backendSchemaLegacy:inventoryPolicyHistoryPage")
        .count,
    };
    for (const table of retainedTables)
      finalRetained[table] = pages(
        "procurementSchemaCleanup:inventoryLegacyPage",
        { table },
      ).count;
    report.finalRetainedLegacyRows = finalRetained;
    report.completedAt = dayjs().toISOString();
    report.readyForNarrowing = true;
    report.narrowingScope =
      "Only verified migrated tables/fields; retainedLegacyRows remain outside this gate";
    log("verified migrations finished", {
      ownershipBlockers: blockers,
      retainedLegacyRows: report.retainedLegacyRows,
    });
  }
} catch (error) {
  report.readyForNarrowing = false;
  report.error = error instanceof Error ? error.message : String(error);
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2), {
    mode: 0o600,
  });
  console.error(report.error);
  process.exitCode = 1;
}
