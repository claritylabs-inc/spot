import dayjs from "dayjs";
import { v } from "convex/values";
import { getMarkdownDocument, saveMarkdownDocument } from "./markdownDocuments";
import {
  parseMarkdownDocument,
  stringifyMarkdownDocument,
} from "./lib/markdownDocument";
import { internalMutation, internalQuery } from "./_generated/server";

const retiredTable = v.union(
  v.literal("procurementPacketUpdateRuns"),
  v.literal("brokerActivity"),
  v.literal("orgMemory"),
  v.literal("procurementMemory"),
  v.literal("brokerClientAssignments"),
  v.literal("policyDeliverySettings"),
  v.literal("policyDeliveryRules"),
  v.literal("policyDeliveryJobs"),
  v.literal("policyDeliveryAttempts"),
);
const auditTable = v.union(
  v.literal("organizations"),
  v.literal("policies"),
  v.literal("procurementBrokerOutreaches"),
);

export const ownershipAuditPage = internalQuery({
  args: { table: auditTable, cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query(args.table).paginate({
      cursor: args.cursor,
      numItems: 10,
      maximumBytesRead: 2 * 1024 * 1024,
    });
    let blockers = 0;
    let legacyReferences = 0;
    for (const row of page.page) {
      if ("name" in row) {
        if (row.type !== "broker" && row.brokerOrgId) legacyReferences++;
      } else if ("brokerName" in row) {
        if (!row.brokerOrgId) blockers++;
      } else {
        const owner = row.orgId ? await ctx.db.get(row.orgId) : null;
        if (owner?.type === "broker") blockers++;
        if (row.uploadedByBrokerOrgId) {
          legacyReferences++;
          if (!owner) blockers++;
        }
      }
    }
    return {
      checked: page.page.length,
      blockers,
      legacyReferences,
      isDone: page.isDone,
      cursor: page.continueCursor,
    };
  },
});

export const clearLegacyOwnershipPage = internalMutation({
  args: {
    table: v.union(v.literal("organizations"), v.literal("policies")),
    cursor: v.union(v.string(), v.null()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db.query(args.table).paginate({
      cursor: args.cursor,
      numItems: 10,
      maximumBytesRead: 2 * 1024 * 1024,
    });
    let changed = 0;
    for (const row of page.page) {
      const field =
        args.table === "organizations"
          ? "brokerOrgId"
          : "uploadedByBrokerOrgId";
      if (!(field in row)) continue;
      if ("name" in row && row.type === "broker") continue;
      const orgId = "name" in row ? row._id : row.orgId;
      const owner = orgId ? await ctx.db.get(orgId) : null;
      if (!owner || owner.type === "broker")
        throw new Error(
          "Resolve the policy's actual client owner before removing its legacy broker reference",
        );
      changed++;
      if (args.dryRun !== false) continue;
      await ctx.db.insert("operatorAuditEvents", {
        type: "setup_write",
        targetOrgId: owner._id,
        summary:
          "Removed a retired broker association; client ownership and upload provenance are unchanged",
        metadata: {
          migration: "backend_schema_simplification",
          table: args.table,
          recordId: row._id,
          previous: {
            [field]:
              "brokerOrgId" in row
                ? row.brokerOrgId
                : "uploadedByBrokerOrgId" in row
                  ? row.uploadedByBrokerOrgId
                  : undefined,
          },
        },
        createdAt: dayjs().valueOf(),
      });
      await ctx.db.patch(row._id, { [field]: undefined });
    }
    return {
      checked: page.page.length,
      changed,
      isDone: page.isDone,
      cursor: page.continueCursor,
    };
  },
});

export const audit = internalQuery({
  args: { table: retiredTable, cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query(args.table).paginate({
      cursor: args.cursor,
      numItems: 100,
      maximumBytesRead: 2 * 1024 * 1024,
    });
    return {
      count: page.page.length,
      isDone: page.isDone,
      cursor: page.continueCursor,
    };
  },
});

/** Fixed retired domains only. Run after the complete ownership audit and backup. */
export const purgeBatch = internalMutation({
  args: { table: retiredTable },
  handler: async (ctx, args) => {
    const page = await ctx.db.query(args.table).paginate({
      cursor: null,
      numItems: 100,
      maximumBytesRead: 2 * 1024 * 1024,
    });
    for (const row of page.page) await ctx.db.delete(row._id);
    return { deleted: page.page.length, complete: page.isDone };
  },
});

export const clearCompatibilityPage = internalMutation({
  args: {
    table: v.union(
      v.literal("brokerModelSettings"),
      v.literal("companyInformationExtractions"),
      v.literal("connectedEmailAutomationItems"),
      v.literal("pendingEmails"),
      v.literal("globalModelSettings"),
      v.literal("threads"),
    ),
    cursor: v.union(v.string(), v.null()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db.query(args.table).paginate({
      cursor: args.cursor,
      numItems: 10,
      maximumBytesRead: 2 * 1024 * 1024,
    });
    let changed = 0;
    for (const row of page.page) {
      const patch: Record<string, unknown> = {};
      if ("deliveryContactKey" in row) patch.deliveryContactKey = undefined;
      for (const field of [
        "providerKeys",
        "procurementFacts",
        "memoryIds",
        "allowMultipleCoiAttachments",
      ]) {
        if (field in row) patch[field] = undefined;
      }
      if (
        "organizationFacts" in row &&
        row.organizationFacts?.some((fact) => !fact.section)
      ) {
        patch.organizationFacts = row.organizationFacts.map((fact) => ({
          ...fact,
          section: fact.section ?? "profile",
        }));
      }
      if (
        args.table === "globalModelSettings" &&
        "routes" in row &&
        row.routes &&
        "extraction_visual_table_repair" in row.routes
      ) {
        const { extraction_visual_table_repair: retired, ...routes } =
          row.routes;
        void retired;
        patch.routes = routes;
      }
      if (
        args.table === "globalModelSettings" &&
        "explicitRouteOverrides" in row &&
        row.explicitRouteOverrides?.includes("extraction_visual_table_repair")
      ) {
        patch.explicitRouteOverrides = row.explicitRouteOverrides.filter(
          (task) => task !== "extraction_visual_table_repair",
        );
      }
      if (!Object.keys(patch).length) continue;
      changed++;
      if (args.dryRun === false) await ctx.db.patch(row._id, patch);
    }
    return {
      checked: page.page.length,
      changed,
      isDone: page.isDone,
      cursor: page.continueCursor,
    };
  },
});

export const inventoryPolicyHistoryPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("policyUpdateRuns").paginate({
      cursor: args.cursor,
      numItems: 10,
      maximumBytesRead: 2 * 1024 * 1024,
    });
    return {
      count: page.page.length,
      isDone: page.isDone,
      cursor: page.continueCursor,
    };
  },
});

/** Deploy-key-only recovery from the audited pre-migration export. Removed
 * with the rest of this one-time migration module after readback succeeds. */
export const restoreArchivedCompanyFacts = internalMutation({
  args: {
    orgId: v.id("organizations"),
    facts: v.array(
      v.object({ id: v.string(), content: v.string(), createdAt: v.number() }),
    ),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (
      args.facts.length > 25 ||
      args.facts.some(
        (fact) =>
          !fact.id ||
          !fact.content.trim() ||
          fact.content.length > 2000 ||
          !dayjs(fact.createdAt).isValid(),
      )
    )
      throw new Error("Expected a bounded batch of archived company facts");
    const org = await ctx.db.get(args.orgId);
    if (org?.type !== "client") throw new Error("Expected an existing client");
    const document = await getMarkdownDocument(ctx, {
      orgId: args.orgId,
      kind: "company_wiki",
    });
    if (!document)
      throw new Error("Migrate the company wiki before restoring facts");
    const { frontmatter, body } = parseMarkdownDocument(document.markdown);
    const previous = frontmatter.legacyCompanyFacts ?? [];
    if (
      !Array.isArray(previous) ||
      previous.some((id) => typeof id !== "string")
    )
      throw new Error("Invalid legacy company fact metadata");
    const seen = new Set(previous);
    const additions = args.facts.filter((fact) => {
      if (seen.has(fact.id)) return false;
      seen.add(fact.id);
      return true;
    });
    if (args.dryRun !== false || !additions.length)
      return { added: additions.length };
    const historical = additions
      .map(
        (fact) =>
          `- Extracted ${dayjs(fact.createdAt).format("YYYY-MM-DD")}: ${fact.content.trim()}`,
      )
      .join("\n");
    await saveMarkdownDocument(ctx, {
      orgId: args.orgId,
      kind: "company_wiki",
      filename: "company-wiki.md",
      expectedRevision: document.revision,
      markdown: stringifyMarkdownDocument(
        { ...frontmatter, legacyCompanyFacts: [...seen] },
        `${body.trimEnd()}\n\n## Historical company information\n\nPreserved from earlier company extractions; the original source references were not recorded. These details have not been reverified and may differ from the current profile.\n\n${historical}`,
      ),
    });
    return { added: additions.length };
  },
});
