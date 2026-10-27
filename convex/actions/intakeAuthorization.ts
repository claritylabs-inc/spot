"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { generateIntakeAuthorizationPdf } from "../lib/intakeAuthorizationPdf";

export const generate = internalAction({
  args: { authorizationId: v.id("requestIntakeAuthorizations") },
  handler: async (ctx, { authorizationId }) => {
    const row: Doc<"requestIntakeAuthorizations"> | null = await ctx.runQuery(internal.intakeAuthorizations.getInternal, { authorizationId });
    if (!row) return null;
    let fileId: Id<"_storage"> | undefined;
    try {
      const pdf = await generateIntakeAuthorizationPdf({ ...row, declarationId: String(row._id) });
      fileId = await ctx.storage.store(new Blob([new Uint8Array(pdf)], { type: "application/pdf" }));
      const applied: boolean = await ctx.runMutation(internal.intakeAuthorizations.finishInternal, { authorizationId, fileId });
      if (!applied) await ctx.storage.delete(fileId);
    } catch (error) {
      // Local rendering is safe to retry; publication is atomic and idempotent.
      // Do not delete after an ambiguous finish: the stored file may be published.
      console.error("Authorization PDF generation failed", authorizationId, error instanceof Error ? error.name : "Error");
      await ctx.runMutation(internal.intakeAuthorizations.failInternal, { authorizationId });
    }
    return null;
  },
});
