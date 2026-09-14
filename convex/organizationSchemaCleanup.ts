import dayjs from "dayjs";
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { clientIdentity } from "./lib/clientProfile";
import { scheduleCompanyResearch } from "./companyResearch";
import { getMarkdownDocument, saveMarkdownDocument } from "./markdownDocuments";
import { readWikiDocument, renderWikiDocument } from "./lib/orgWikiDocument";

const narrativeFields = [
  "context",
  "clientsContext",
  "vendorsContext",
  "insuranceContext",
  "investorsContext",
  "partnersContext",
] as const;
function isOwnedFixture(org: { smokeMarker?: string; name: string }) {
  return Boolean(
    org.smokeMarker ||
    org.name.startsWith("[Synthetic router acceptance]") ||
    org.name.startsWith("[Synthetic worker router transport]"),
  );
}
const args = { cursor: v.union(v.string(), v.null()) };
const limits = { numItems: 10, maximumBytesRead: 2 * 1024 * 1024 };

export const auditPage = internalQuery({
  args,
  handler: async (ctx, input) => {
    const page = await ctx.db
      .query("organizations")
      .paginate({ ...limits, cursor: input.cursor });
    const organizations = page.page.filter((org) => !isOwnedFixture(org));
    return {
      checked: page.page.length,
      missingType: organizations.filter((org) => org.type === undefined).length,
      ...Object.fromEntries(
        ["pending", "running", "completed", "partial", "failed"].map(
          (status) => [
            `research${status[0].toUpperCase()}${status.slice(1)}`,
            organizations.filter(
              (org) => org.companyResearch?.status === status,
            ).length,
          ],
        ),
      ),
      narrativeRows: page.page.filter((org) =>
        narrativeFields.some((field) => org[field] !== undefined),
      ).length,
      entityNoteRows: page.page.filter((org) =>
        org.relatedLegalEntities?.some((entity) => entity.notes !== undefined),
      ).length,
      unnormalizedNames: organizations.filter(
        (org) =>
          (org.type ?? "client") === "client" &&
          clientIdentity(org.name).name !== org.name,
      ).length,
      missingResearch: organizations.filter(
        (org) =>
          (org.type ?? "client") === "client" &&
          !org.companyResearch &&
          !org.smokeMarker,
      ).length,
      brokerOwnedClients: page.page.filter(
        (org) => org.type === "client" && org.brokerOrgId,
      ).length,
      isDone: page.isDone,
      cursor: page.continueCursor,
    };
  },
});

export const migratePage = internalMutation({
  args,
  handler: async (ctx, input) => {
    const page = await ctx.db
      .query("organizations")
      .paginate({ ...limits, cursor: input.cursor });
    let changed = 0;
    const conflicts: string[] = [];
    for (const org of page.page) {
      if (isOwnedFixture(org)) continue;
      if (org.type === undefined) {
        await ctx.db.patch(org._id, { type: "client" });
        changed++;
      }
      const fields = narrativeFields.filter(
        (field) => org[field] !== undefined,
      );
      const entityNotes = (org.relatedLegalEntities ?? []).filter(
        (entity) => entity.notes !== undefined,
      );
      const legalEntities = org.relatedLegalEntities?.map((entity) => {
        const canonical = { ...entity };
        delete canonical.notes;
        return canonical;
      });
      if (fields.length || entityNotes.length) {
        if (
          await ctx.db
            .query("orgWikiSections")
            .withIndex("organization", (q) => q.eq("orgId", org._id))
            .first()
        ) {
          throw new Error(
            "Migrate legacy wiki sections before organization narratives",
          );
        }
        const document = await getMarkdownDocument(ctx, {
          orgId: org._id,
          kind: "company_wiki",
        });
        const parsed = readWikiDocument(document?.markdown ?? "");
        const additions = fields.flatMap((field) => {
          const value = org[field]?.trim();
          return value && !parsed.body.includes(value)
            ? [`### ${field.replace(/Context$/, " relationships")}\n\n${value}`]
            : [];
        });
        for (const entity of entityNotes) {
          const note = entity.notes?.trim();
          if (!note) continue;
          const narrative = `### ${entity.legalName}${entity.relationship ? ` (${entity.relationship})` : ""}\n\n${note}`;
          if (!parsed.body.includes(narrative)) additions.push(narrative);
        }
        if (additions.length) {
          const body = [
            parsed.body.trimEnd(),
            "## Imported company context",
            ...additions,
          ]
            .filter(Boolean)
            .join("\n\n");
          await saveMarkdownDocument(ctx, {
            orgId: org._id,
            kind: "company_wiki",
            filename: document?.filename ?? "company-wiki.md",
            markdown: renderWikiDocument(
              body,
              { ...parsed.metadata, manual: true },
              parsed.frontmatter,
            ),
            expectedRevision: document?.revision ?? 0,
          });
        }
        await ctx.db.patch(org._id, {
          ...Object.fromEntries(fields.map((field) => [field, undefined])),
          ...(entityNotes.length
            ? { relatedLegalEntities: legalEntities }
            : {}),
        });
        changed++;
      }
      if ((org.type ?? "client") !== "client") continue;
      const identity = clientIdentity(org.name, legalEntities);
      if (identity.name !== org.name) {
        const duplicate = await ctx.db
          .query("organizations")
          .withIndex("name", (q) => q.eq("name", identity.name))
          .first();
        if (duplicate && duplicate._id !== org._id)
          conflicts.push(String(org._id));
        else {
          await ctx.db.patch(org._id, identity);
          changed++;
        }
      }
      await scheduleCompanyResearch(ctx, org._id);
    }
    return {
      checked: page.page.length,
      changed,
      conflicts,
      isDone: page.isDone,
      cursor: page.continueCursor,
      checkedAt: dayjs().valueOf(),
    };
  },
});
