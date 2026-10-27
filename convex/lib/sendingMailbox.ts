import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
export const SENDING_DOMAIN = "insurewithspot.com";
export const SENDING_ADDRESSES = [
  "zac",
  "terence",
  "terry",
  "dan",
  "adyan",
].map((name) => `${name}@${SENDING_DOMAIN}`);
export const MAILBOX_PREFIX = "gmail:";
export function isGoogleMailbox(id: string) {
  return id.startsWith(MAILBOX_PREFIX);
}
export async function sendingMailboxFor(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
) {
  const rows = await ctx.db
    .query("operatorSendingMailboxes")
    .withIndex("by_ownerUserId", (q) => q.eq("ownerUserId", userId))
    .take(2);
  if (rows.length > 1)
    throw new Error(
      "Multiple sending mailboxes assigned. Review Email health.",
    );
  return rows[0] ?? null;
}
