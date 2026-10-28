"use node";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { syncGoogleMailbox } from "../lib/googleMailboxTransport";
import {
  SENDING_ADDRESSES,
  mailboxConnectionsAllowed,
} from "../lib/sendingMailbox";

export const syncAll = internalAction({
  args: {},
  handler: async (ctx) => {
    if (!mailboxConnectionsAllowed()) return;
    for (const address of SENDING_ADDRESSES) {
      try {
        await syncGoogleMailbox(ctx, address);
      } catch {
        const box = await ctx.runQuery(
          internal.operatorSendingMailboxes.connection,
          { address },
        );
        if (box)
          await ctx.runMutation(internal.operatorSendingMailboxes.saveSync, {
            mailboxId: box._id,
            error:
              "Mailbox sync failed. Recheck mailbox credentials and access.",
          });
      }
    }
  },
});
