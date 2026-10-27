"use node";

import { randomBytes } from "node:crypto";
import { Auth } from "googleapis";
import { ConvexError, v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { getAuthSiteUrl } from "../lib/domains";
import { decryptPassword, encryptPassword } from "../lib/imapMailbox";
import { allowedGmailDomains, GMAIL_SCOPES } from "../lib/operatorGmail";
import { gmailOAuthClient, gmailOAuthConfigured } from "../lib/operatorGmailOAuth";
import { oauthStateHash } from "../lib/operatorMcpOAuth";
import { mailboxConnectionsAllowed } from "../lib/sendingMailbox";

/** Scopes Google may drop when the user unticks them on the consent screen. */
const REQUIRED_SCOPES = GMAIL_SCOPES.filter((scope) => scope.includes("/auth/gmail."));

class GmailOAuthError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

export const start = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    const userId = await ctx.runQuery(internal.operatorGmail.authorizeInternal, {});
    if (!mailboxConnectionsAllowed())
      throw new ConvexError("Gmail connections are disabled in capture mode.");
    const domains = allowedGmailDomains();
    if (!gmailOAuthConfigured() || !domains.length)
      throw new ConvexError("Gmail connections are not configured.");
    const client = gmailOAuthClient();
    const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
    const state = randomBytes(32).toString("base64url");
    await ctx.runMutation(internal.operatorGmail.createOAuthStateInternal, {
      userId,
      stateHash: oauthStateHash(state),
      codeVerifier,
    });
    const url = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: true,
      scope: GMAIL_SCOPES,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: Auth.CodeChallengeMethod.S256,
      hd: domains.length === 1 ? domains[0] : undefined,
    });
    return { url };
  },
});

export const callback = internalAction({
  args: {
    state: v.string(),
    code: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<string> => {
    const redirect = new URL("/operator/profile", getAuthSiteUrl());
    try {
      if (args.state.length > 200 || (args.code?.length ?? 0) > 4000)
        throw new GmailOAuthError("invalid_request");
      const saved = await ctx.runMutation(
        internal.operatorGmail.consumeOAuthStateInternal,
        { stateHash: oauthStateHash(args.state) },
      );
      if (!saved) throw new GmailOAuthError("expired");
      if (args.error || !args.code) throw new GmailOAuthError("denied");
      const client = gmailOAuthClient();
      const { tokens } = await client.getToken({
        code: args.code,
        codeVerifier: saved.codeVerifier,
      });
      if (!tokens.id_token) throw new GmailOAuthError("failed");
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: process.env.GOOGLE_OAUTH_CLIENT_ID,
      });
      const claims = ticket.getPayload();
      const address = claims?.email?.trim().toLowerCase();
      const domain = address?.split("@")[1];
      const hostedDomain = claims?.hd?.toLowerCase();
      const allowed = allowedGmailDomains();
      if (
        !claims?.sub ||
        !address ||
        !claims.email_verified ||
        !domain ||
        !hostedDomain ||
        !allowed.includes(domain) ||
        !allowed.includes(hostedDomain)
      )
        throw new GmailOAuthError("domain_not_allowed");
      const scopes = (tokens.scope ?? "").split(" ").filter(Boolean);
      if (!REQUIRED_SCOPES.every((scope) => scopes.includes(scope)))
        throw new GmailOAuthError("missing_scopes");
      if (!tokens.refresh_token) throw new GmailOAuthError("no_refresh_token");
      const result = await ctx.runMutation(
        internal.operatorGmail.upsertConnectionInternal,
        {
          userId: saved.userId,
          address,
          googleSub: claims.sub,
          encryptedRefreshToken: encryptPassword(tokens.refresh_token),
          scopes,
        },
      );
      if (!result.ok) throw new GmailOAuthError(result.reason);
      redirect.searchParams.set("gmail", "connected");
    } catch (error) {
      redirect.searchParams.set("gmail", "error");
      redirect.searchParams.set(
        "reason",
        error instanceof GmailOAuthError ? error.reason : "failed",
      );
    }
    return redirect.toString();
  },
});

export const disconnect = action({
  args: {},
  handler: async (ctx): Promise<void> => {
    const userId = await ctx.runQuery(internal.operatorGmail.authorizeInternal, {});
    const connection = await ctx.runQuery(internal.operatorGmail.getByOwnerInternal, {
      userId,
    });
    if (!connection || connection.status === "disconnected") return;
    if (connection.encryptedRefreshToken) {
      try {
        await gmailOAuthClient().revokeToken(
          decryptPassword(connection.encryptedRefreshToken),
        );
      } catch {
        // Best effort: the token may already be revoked or the key rotated.
      }
    }
    await ctx.runMutation(internal.operatorGmail.disconnectInternal, {
      connectionId: connection._id,
    });
  },
});
