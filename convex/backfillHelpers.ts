import { internalQuery } from "./_generated/server";

/** Get all policies with a PDF that need re-extraction. */
export const getAllPoliciesWithPdf = internalQuery({
  handler: async (ctx) => {
    const policies = await ctx.db.query("policies").collect();
    return policies
      .filter((p) => p.pdfStorageId && p.status === "ready")
      .map((p) => ({
        _id: p._id,
        userId: p.userId,
        pdfStorageId: p.pdfStorageId!,
      }));
  },
});
