import { paginationOptsValidator } from "convex/server";
import { internalQuery } from "./_generated/server";

export const listPageInternal = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const page = await ctx.db.query("policies").paginate(paginationOpts);
    return {
      ...page,
      page: page.page.map((policy) => ({
        id: policy._id,
        needsExtraction:
          policy.sourceTreeVersion !== "v3" ||
          policy.extractionDataStage !== "final",
        canExtract: !policy.deletedAt && Boolean(policy.orgId && policy.fileId),
      })),
    };
  },
});
