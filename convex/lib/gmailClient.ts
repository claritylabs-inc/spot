"use node";

import { google, type gmail_v1 } from "googleapis";
import type { ActionCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { decryptPassword } from "./imapMailbox";
import { gmailOAuthClient, isInvalidGrant } from "./operatorGmailOAuth";
import { ResendInboxError } from "./resendInbox";

const RECONNECT_MESSAGE = "Reconnect your Gmail in Profile to send from it.";

const needsReconnect = () =>
  new ResendInboxError("blocked", "gmail", RECONNECT_MESSAGE, {
    code: "gmail_needs_reconnect",
  });

/** Authorised Gmail client for a connected address; blocks unless the connection is active. */
export async function gmailFor(
  ctx: ActionCtx,
  address: string,
): Promise<{
  gmail: gmail_v1.Gmail;
  connection: Doc<"operatorGmailConnections">;
}> {
  const connection = await ctx.runQuery(
    internal.operatorGmail.getActiveByAddressInternal,
    { address },
  );
  if (!connection) throw needsReconnect();
  const auth = gmailOAuthClient();
  auth.setCredentials({
    refresh_token: decryptPassword(connection.encryptedRefreshToken),
  });
  try {
    await auth.getAccessToken();
  } catch (error) {
    if (!isInvalidGrant(error))
      throw new ResendInboxError(
        "transient",
        "gmail",
        "Could not reach Google to authorise Gmail.",
      );
    await ctx.runMutation(internal.operatorGmail.markNeedsReconnectInternal, {
      connectionId: connection._id,
      error: RECONNECT_MESSAGE,
    });
    throw needsReconnect();
  }
  return { gmail: google.gmail({ version: "v1", auth }), connection };
}
