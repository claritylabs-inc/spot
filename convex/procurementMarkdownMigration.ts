import { parseMarkdownDocument } from "./lib/markdownDocument";
import {
  readProcurementFileNotes,
  saveProcurementFileNotes,
} from "./lib/procurementFileNotes";
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { getMarkdownDocument } from "./markdownDocuments";
import {
  migratePacketDocuments,
  retireLegacyPacketSection,
} from "./lib/packetDocuments";
import {
  requestNarrative,
  saveRequestNarrative,
} from "./lib/procurementNarrative";
import {
  readOutreachLog,
  saveOutreachLog,
  legacyOutreachLog,
} from "./lib/outreachLog";

const args = {
  table: v.union(
    v.literal("procurementRequests"),
    v.literal("procurementBrokerOutreaches"),
    v.literal("procurementFileItems"),
    v.literal("procurementPacketSections"),
  ),
  cursor: v.union(v.string(), v.null()),
};

export const auditPage = internalQuery({
  args,
  handler: async (ctx, args) => {
    if (args.table === "procurementPacketSections") {
      const page = await ctx.db
        .query("procurementPacketSections")
        .paginate({ cursor: args.cursor, numItems: 10 });
      return {
        scanned: page.page.length,
        remaining: page.page.length,
        missing: page.page.map((row) => ({ id: row._id })),
        isDone: page.isDone,
        cursor: page.continueCursor,
      };
    }
    if (args.table === "procurementRequests") {
      const page = await ctx.db
        .query("procurementRequests")
        .paginate({ cursor: args.cursor, numItems: 10 });
      const missing = [];
      for (const row of page.page) {
        const absent = [];
        if (
          !(await getMarkdownDocument(ctx, {
            orgId: row.clientOrgId,
            requestId: row._id,
            kind: "request_intake",
          }))
        )
          absent.push("request_intake");
        if (absent.length || row.narrative !== undefined)
          missing.push({
            id: row._id,
            absent,
            legacyNarrative: row.narrative !== undefined,
          });
      }
      return {
        scanned: page.page.length,
        remaining: missing.length,
        missing,
        isDone: page.isDone,
        cursor: page.continueCursor,
      };
    }
    if (args.table === "procurementFileItems") {
      const page = await ctx.db
        .query("procurementFileItems")
        .paginate({ cursor: args.cursor, numItems: 10 });
      const missing = page.page
        .filter((row) => row.notes !== undefined)
        .map((row) => ({ id: row._id }));
      return {
        scanned: page.page.length,
        remaining: missing.length,
        missing,
        isDone: page.isDone,
        cursor: page.continueCursor,
      };
    }
    const page = await ctx.db
      .query("procurementBrokerOutreaches")
      .paginate({ cursor: args.cursor, numItems: 10 });
    const missing = [];
    for (const row of page.page) {
      const document = await getMarkdownDocument(ctx, {
        orgId: row.clientOrgId,
        outreachId: row._id,
        kind: "outreach_log",
      });
      if (
        !document ||
        row.notes !== undefined ||
        row.applicationUrl !== undefined ||
        row.applicationQuestions !== undefined ||
        row.quoteSummary !== undefined ||
        row.quoteAmount !== undefined ||
        row.quoteCurrency !== undefined ||
        row.quoteUrl !== undefined
      )
        missing.push({ id: row._id });
    }
    return {
      scanned: page.page.length,
      remaining: missing.length,
      missing,
      isDone: page.isDone,
      cursor: page.continueCursor,
    };
  },
});

export const migratePage = internalMutation({
  args,
  handler: async (ctx, args) => {
    if (args.table === "procurementPacketSections") {
      const page = await ctx.db
        .query("procurementPacketSections")
        .paginate({ cursor: args.cursor, numItems: 1 });
      for (const row of page.page) await retireLegacyPacketSection(ctx, row);
      return {
        scanned: page.page.length,
        isDone: page.isDone,
        cursor: page.continueCursor,
      };
    }
    if (args.table === "procurementRequests") {
      const page = await ctx.db
        .query("procurementRequests")
        .paginate({ cursor: args.cursor, numItems: 1 });
      for (const row of page.page) {
        await migratePacketDocuments(ctx, row._id);
        const existing = await getMarkdownDocument(ctx, {
          orgId: row.clientOrgId,
          requestId: row._id,
          kind: "request_intake",
        });
        if (!existing)
          await saveRequestNarrative(
            ctx,
            row,
            await requestNarrative(ctx, row),
          );
        if (
          existing &&
          row.narrative !== undefined &&
          parseMarkdownDocument(existing.markdown).body !== row.narrative
        )
          throw new Error(
            "Canonical intake differs from the legacy narrative; reconcile both versions before clearing it",
          );
        if (row.narrative !== undefined)
          await ctx.db.patch(row._id, { narrative: undefined });
      }
      return {
        scanned: page.page.length,
        isDone: page.isDone,
        cursor: page.continueCursor,
      };
    }
    if (args.table === "procurementFileItems") {
      const page = await ctx.db
        .query("procurementFileItems")
        .paginate({ cursor: args.cursor, numItems: 1 });
      for (const row of page.page) {
        if (row.notes === undefined) continue;
        const content = await readProcurementFileNotes(ctx, row);
        if (content !== row.notes)
          throw new Error(
            "Canonical file notes differ from legacy notes; reconcile before clearing",
          );
        await saveProcurementFileNotes(ctx, row, content);
        await ctx.db.patch(row._id, { notes: undefined });
      }
      return {
        scanned: page.page.length,
        isDone: page.isDone,
        cursor: page.continueCursor,
      };
    }
    const page = await ctx.db
      .query("procurementBrokerOutreaches")
      .paginate({ cursor: args.cursor, numItems: 1 });
    for (const row of page.page) {
      const existing = await getMarkdownDocument(ctx, {
        orgId: row.clientOrgId,
        outreachId: row._id,
        kind: "outreach_log",
      });
      const legacy = legacyOutreachLog(row);
      if (
        existing &&
        legacy.trim() &&
        !parseMarkdownDocument(existing.markdown).body.includes(legacy)
      )
        throw new Error(
          "Canonical market log differs from legacy content; reconcile both versions before clearing",
        );
      if (!existing)
        await saveOutreachLog(ctx, row, await readOutreachLog(ctx, row));
      await ctx.db.patch(row._id, {
        notes: undefined,
        applicationUrl: undefined,
        applicationQuestions: undefined,
        quoteSummary: undefined,
        quoteAmount: undefined,
        quoteCurrency: undefined,
        quoteUrl: undefined,
      });
    }
    return {
      scanned: page.page.length,
      isDone: page.isDone,
      cursor: page.continueCursor,
    };
  },
});
