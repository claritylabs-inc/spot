"use node";
import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { syncGoogleMailbox } from "../lib/googleMailboxTransport";
import {
  SENDING_ADDRESSES,
  mailboxConnectionsAllowed,
} from "../lib/sendingMailbox";

export const sync = action({
  args: { address: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean; message: string }> => {
    await ctx.runQuery(internal.operatorSendingMailboxes.authorize, {});
    if (!SENDING_ADDRESSES.includes(args.address))
      throw new Error("Unknown mailbox");
    if (!mailboxConnectionsAllowed())
      return {
        ok: false,
        message: "Local capture mode: external mailbox sync is disabled.",
      };
    try {
      const connected = await syncGoogleMailbox(ctx, args.address);
      return connected
        ? { ok: true, message: "Mailbox checked for replies." }
        : { ok: false, message: "This mailbox is not connected." };
    } catch {
      return {
        ok: false,
        message: "Mailbox sync failed. Check the connection before sending.",
      };
    }
  },
});
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
