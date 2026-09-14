import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import {
  PACKET_FILES,
  migratePacketDocuments,
  packetFileVisibility,
} from "./lib/packetDocuments";
import { parseDocumentVisibility } from "./lib/markdownDocument";

const args = {
  table: v.union(
    v.literal("procurementRequests"),
    v.literal("procurementBrokerOutreaches"),
    v.literal("procurementFileItems"),
    v.literal("procurementPacketSections"),
  ),
  cursor: v.union(v.string(), v.null()),
};
const legacyOutreachFields = [
  "notes",
  "applicationUrl",
  "applicationQuestions",
  "quoteSummary",
  "quoteAmount",
  "quoteCurrency",
  "quoteUrl",
];

export const auditPage = internalQuery({
  args,
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query(args.table)
      .paginate({ cursor: args.cursor, numItems: 10 });
    const missing = [];
    for (const row of page.page) {
      if (args.table === "procurementPacketSections") {
        missing.push({ id: row._id });
        continue;
      }
      if ("inboxToken" in row) {
        const documents = await ctx.db
          .query("markdownDocuments")
          .withIndex("request_kind", (q) =>
            q.eq("requestId", row._id).eq("kind", "packet"),
          )
          .collect();
        if (
          row.narrative !== undefined ||
          documents.length !== 2 ||
          !PACKET_FILES.every((filename) =>
            documents.some(
              (document) =>
                document.filename === filename &&
                parseDocumentVisibility(document.markdown) ===
                  packetFileVisibility(filename),
            ),
          )
        )
          missing.push({ id: row._id });
      } else if ("brokerName" in row) {
        const document = await ctx.db
          .query("markdownDocuments")
          .withIndex("outreach_kind", (q) =>
            q.eq("outreachId", row._id).eq("kind", "outreach_log"),
          )
          .first();
        if (document || legacyOutreachFields.some((field) => field in row))
          missing.push({ id: row._id });
      } else if ("label" in row) {
        const document = await ctx.db
          .query("markdownDocuments")
          .withIndex("file_kind", (q) =>
            q.eq("fileItemId", row._id).eq("kind", "procurement_file_notes"),
          )
          .first();
        if (document || row.notes !== undefined) missing.push({ id: row._id });
      }
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
    const page = await ctx.db
      .query(args.table)
      .paginate({ cursor: args.cursor, numItems: 1 });
    for (const row of page.page)
      await migratePacketDocuments(
        ctx,
        "requestId" in row ? row.requestId : row._id,
      );
    return {
      scanned: page.page.length,
      isDone: page.isDone,
      cursor: page.continueCursor,
    };
  },
});

export const verifyRetiredDocuments = internalQuery({
  args: {},
  handler: async (ctx) => {
    const remaining = [];
    for (const kind of ["outreach_log", "procurement_file_notes"] as const) {
      const document = await ctx.db
        .query("markdownDocuments")
        .withIndex("kind", (q) => q.eq("kind", kind))
        .first();
      if (document) remaining.push({ id: document._id, kind });
    }
    return { complete: remaining.length === 0, remainingSamples: remaining };
  },
});
