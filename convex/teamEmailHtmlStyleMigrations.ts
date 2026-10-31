import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "./_generated/api";
import schema from "./schema";
import { classifyEmailHtml, emailHtmlSignals } from "../lib/email-html-style";

const migrations = new Migrations(components.migrations, { schema });

// Jev requests are spread over this window so the backfill never floods cl-router.
const SPREAD_MS = 60 * 60 * 1000;

/**
 * Queues HTML style classification for stored messages that predate it and whose
 * markup alone does not settle their style. Resumable; each message is judged at
 * most once because classification skips messages that already have `htmlStyle`.
 */
export const classifyExisting = migrations.define({
  table: "teamEmailMessages",
  batchSize: 50,
  migrateOne: async (ctx, message) => {
    if (!message.bodyHtml || message.htmlStyle !== undefined) return;
    if (classifyEmailHtml(emailHtmlSignals(message.bodyHtml))) return;
    await ctx.scheduler.runAfter(
      Math.floor(Math.random() * SPREAD_MS),
      internal.actions.teamEmailHtmlStyles.classify,
      { messageId: message._id },
    );
  },
});

export const run = migrations.runner();
