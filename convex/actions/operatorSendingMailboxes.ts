"use node";
import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { encryptPassword, withClient } from "../lib/imapMailbox";
import {
  smtpFor,
  imapFor,
  syncGoogleMailbox,
} from "../lib/googleMailboxTransport";
import { SENDING_ADDRESSES } from "../lib/sendingMailbox";
import { getEmailDeliveryMode } from "../lib/resend";

export const connect = action({
  args: { address: v.string(), appPassword: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean; message: string }> => {
    const ownerUserId = await ctx.runQuery(
      internal.operatorSendingMailboxes.authorize,
      {},
    );
    const address = args.address.trim().toLowerCase();
    if (!SENDING_ADDRESSES.includes(address))
      throw new Error("Choose an insurewithspot.com mailbox.");
    if (getEmailDeliveryMode() === "capture")
      return {
        ok: false,
        message:
          "Local capture mode: no external connection was made. Configure and verify this mailbox in the approved live environment.",
      };
    const password = args.appPassword.replace(/\s/g, "");
    if (!/^[a-zA-Z]{16}$/.test(password))
      throw new Error("Enter the mailbox’s 16-character Google app password.");
    const encryptedPassword = encryptPassword(password);
    const transport = smtpFor(address, encryptedPassword);
    try {
      await transport.verify();
      await withClient(imapFor(address, encryptedPassword), async () => null);
    } catch {
      return {
        ok: false,
        message:
          "Google rejected the SMTP or IMAP connection. Check the app password and mailbox access.",
      };
    } finally {
      transport.close();
    }
    await ctx.runMutation(internal.operatorSendingMailboxes.saveConnection, {
      address,
      ownerUserId,
      encryptedPassword,
    });
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
            "Connection verified, but initial reply sync failed. Check replies before enabling sending.",
        });
      return {
        ok: true,
        message:
          "Connection verified and saved paused. Initial reply sync failed; check replies before enabling sending.",
      };
    }
    return {
      ok: true,
      message:
        "Connection verified. Review sending limits, then resume this mailbox to use it for new emails.",
    };
  },
});
export const sync = action({
  args: { address: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean; message: string }> => {
    await ctx.runQuery(internal.operatorSendingMailboxes.authorize, {});
    if (!SENDING_ADDRESSES.includes(args.address))
      throw new Error("Unknown mailbox");
    if (getEmailDeliveryMode() === "capture")
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
    if (getEmailDeliveryMode() === "capture") return;
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
