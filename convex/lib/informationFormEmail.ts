import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** The newest live conversation that asked the client to complete this form, if any. */
export async function informationFormThread(
  ctx: QueryCtx | MutationCtx,
  formId: Id<"procurementInformationForms">,
): Promise<Doc<"teamEmailThreads"> | null> {
  const threads = await ctx.db
    .query("teamEmailThreads")
    .withIndex("by_informationFormId", (q) => q.eq("informationFormId", formId))
    .order("desc")
    .take(5);
  return threads.find((thread) => thread.deletedAt === undefined) ?? null;
}
