import { v } from "convex/values";
import { query } from "./_generated/server";

// Deprecated: the pre-release PDF panel's query. Returning null hides its
// editor while an older frontend is still open; remove after this release.
export const getForDocument = query({
  args: { source: v.string() },
  returns: v.null(),
  handler: async () => null,
});
