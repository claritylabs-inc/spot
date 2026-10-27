import { v } from "convex/values";

import { internalQuery } from "./_generated/server";
import { getTeamThreadDetails } from "./lib/teamInboxProjection";

/**
 * One team thread's detail as its own function run. The detail read paginates
 * its messages and Convex allows one paginated query per function, so a bulk
 * read gives each thread its own run.
 */
export const teamThreadDetailsInternal = internalQuery({
  args: { threadId: v.id("teamEmailThreads"), viewerUserId: v.id("users") },
  handler: async (ctx, args) =>
    await getTeamThreadDetails(ctx, {
      threadId: args.threadId,
      viewerUserId: args.viewerUserId,
    }),
});
