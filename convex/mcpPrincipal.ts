import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { assertCustomerUser } from "./lib/operatorIdentity";

/**
 * Resolves whether an organization-bound MCP principal is a client or broker,
 * rechecking that the user is a customer with a live membership so a stale
 * token cannot keep a catalog after access changes.
 */
export const getPrincipalKind = internalQuery({
  args: { userId: v.id("users"), orgId: v.id("organizations") },
  handler: async (ctx, args): Promise<"client" | "broker"> => {
    await assertCustomerUser(ctx, args.userId);
    const [org, membership] = await Promise.all([
      ctx.db.get(args.orgId),
      ctx.db
        .query("orgMemberships")
        .withIndex("organization_user", (q) =>
          q.eq("orgId", args.orgId).eq("userId", args.userId),
        )
        .first(),
    ]);
    if (
      !org ||
      org.deletedAt !== undefined ||
      (org.type !== "client" && org.type !== "broker") ||
      !membership
    ) {
      throw new Error("Organization access is no longer valid");
    }
    return org.type;
  },
});
