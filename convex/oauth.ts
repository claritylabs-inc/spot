import { ConvexError, v } from "convex/values";
import dayjs from "dayjs";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireCurrentOrgAccess as requireOrgAccess } from "./lib/access";
import { getActiveOperatorProfile } from "./lib/operatorIdentity";
import {
  normalizeRequestedScopes,
  parseScopesFromToken,
  stringifyScopes,
} from "./lib/apiAuth";

// ── Helpers ──

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function normalizeMcpResource(resource: string | undefined) {
  if (!resource) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(resource);
  } catch {
    throw new Error("invalid_target: invalid resource");
  }
  const isLocalDevelopmentResource =
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  if (
    (parsed.protocol !== "https:" && !isLocalDevelopmentResource) ||
    parsed.pathname !== "/mcp"
  ) {
    throw new Error(
      "invalid_target: resource must be an HTTPS MCP endpoint (HTTP localhost is allowed for development)",
    );
  }
  if (parsed.search || parsed.hash) {
    throw new Error(
      "invalid_target: resource must not contain a query or fragment",
    );
  }
  const normalizedResource = `${parsed.origin}/mcp`;
  const configuredSiteUrl = process.env.CONVEX_SITE_URL?.trim();
  if (configuredSiteUrl) {
    let configuredOrigin: string;
    try {
      configuredOrigin = new URL(configuredSiteUrl).origin;
    } catch {
      throw new Error("server_error: CONVEX_SITE_URL is invalid");
    }
    if (normalizedResource !== `${configuredOrigin}/mcp`) {
      throw new Error(
        "invalid_target: resource must be this authorization server's MCP endpoint",
      );
    }
  }
  return normalizedResource;
}

async function resolveOAuthPrincipal(
  ctx: Parameters<typeof requireOrgAccess>[0],
) {
  const operator = await getActiveOperatorProfile(ctx);
  if (operator) {
    return {
      principalKind: "operator" as const,
      userId: operator.userId,
      orgId: undefined,
    };
  }

  const { userId, orgId } = await requireOrgAccess(ctx);
  return {
    principalKind: "organization" as const,
    userId,
    orgId,
  };
}

// ── Internal functions (called by HTTP actions) ──

export const registerClient = internalMutation({
  args: {
    clientName: v.string(),
    redirectUris: v.array(v.string()),
    tokenEndpointAuthMethod: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const clientId = crypto.randomUUID();
    await ctx.db.insert("oauthClients", {
      clientId,
      clientName: args.clientName,
      redirectUris: args.redirectUris,
      tokenEndpointAuthMethod: args.tokenEndpointAuthMethod ?? "none",
      createdAt: dayjs().valueOf(),
    });
    return {
      client_id: clientId,
      client_name: args.clientName,
      redirect_uris: args.redirectUris,
      token_endpoint_auth_method: args.tokenEndpointAuthMethod ?? "none",
    };
  },
});

export const exchangeAuthCode = internalMutation({
  args: {
    codeRaw: v.string(),
    clientId: v.string(),
    redirectUri: v.string(),
    codeVerifier: v.string(),
    resource: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const codeHash = await sha256Hex(args.codeRaw);
    const codeRecord = await ctx.db
      .query("oauthAuthCodes")
      .withIndex("code", (q) => q.eq("codeHash", codeHash))
      .first();

    if (!codeRecord) throw new ConvexError("invalid_grant");
    if (codeRecord.usedAt) throw new ConvexError("invalid_grant");
    if (codeRecord.expiresAt < dayjs().valueOf())
      throw new ConvexError("invalid_grant");
    if (codeRecord.clientId !== args.clientId) throw new ConvexError("invalid_grant");
    if (codeRecord.redirectUri !== args.redirectUri)
      throw new ConvexError("invalid_grant");
    const resource = normalizeMcpResource(args.resource);
    if (codeRecord.resource && resource !== codeRecord.resource) {
      throw new ConvexError("invalid_grant");
    }

    // PKCE S256 verification
    const encoder = new TextEncoder();
    const verifierBuffer = await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(args.codeVerifier),
    );
    const computedChallenge = base64UrlEncode(verifierBuffer);
    if (computedChallenge !== codeRecord.codeChallenge) {
      throw new ConvexError("invalid_grant");
    }

    const now = dayjs().valueOf();
    const scopes = parseScopesFromToken(codeRecord.scopes, codeRecord.scope);
    await ctx.db.patch(codeRecord._id, { usedAt: now });

    const accessTokenRaw = "prsm_at_" + randomHex(48);
    const refreshTokenRaw = "prsm_rt_" + randomHex(48);
    const tokenHash = await sha256Hex(accessTokenRaw);
    const refreshTokenHash = await sha256Hex(refreshTokenRaw);

    await ctx.db.insert("oauthTokens", {
      tokenHash,
      refreshTokenHash,
      clientId: args.clientId,
      userId: codeRecord.userId,
      ...(codeRecord.orgId ? { orgId: codeRecord.orgId } : {}),
      principalKind: codeRecord.principalKind ?? "organization",
      ...(codeRecord.resource ? { resource: codeRecord.resource } : {}),
      scope: stringifyScopes(scopes),
      scopes,
      expiresAt: now + 60 * 60 * 1000,
      refreshExpiresAt: now + 30 * 24 * 60 * 60 * 1000,
      createdAt: now,
    });

    return {
      access_token: accessTokenRaw,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: refreshTokenRaw,
    };
  },
});

export const validateAccessTokenWithScopes = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    const token = await ctx.db
      .query("oauthTokens")
      .withIndex("token", (q) => q.eq("tokenHash", args.tokenHash))
      .first();

    if (!token) return null;
    if (token.revokedAt) return null;
    if (token.expiresAt < dayjs().valueOf()) return null;

    const principalKind = token.principalKind ?? "organization";
    let operatorRole: "operator" | "owner" | undefined;
    if (principalKind === "operator") {
      const [user, profile] = await Promise.all([
        ctx.db.get(token.userId),
        ctx.db
          .query("operatorProfiles")
          .withIndex("user", (q) => q.eq("userId", token.userId))
          .first(),
      ]);
      if (
        !user ||
        user.accountKind !== "operator" ||
        !profile ||
        profile.status !== "active"
      ) {
        return null;
      }
      operatorRole = profile.role;
    } else if (!token.orgId) {
      return null;
    }

    return {
      userId: token.userId,
      orgId: token.orgId,
      principalKind,
      operatorRole,
      resource: token.resource,
      clientId: token.clientId,
      tokenId: token._id,
      scopes: parseScopesFromToken(token.scopes, token.scope),
    };
  },
});

export const refreshAccessToken = internalMutation({
  args: {
    refreshTokenRaw: v.string(),
    clientId: v.string(),
    resource: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const refreshHash = await sha256Hex(args.refreshTokenRaw);
    const token = await ctx.db
      .query("oauthTokens")
      .withIndex("refresh_token", (q) => q.eq("refreshTokenHash", refreshHash))
      .first();

    if (!token) throw new ConvexError("invalid_grant");
    if (token.revokedAt) throw new ConvexError("invalid_grant");
    const now = dayjs().valueOf();
    if (token.refreshExpiresAt && token.refreshExpiresAt < now) {
      throw new ConvexError("invalid_grant");
    }
    if (token.clientId !== args.clientId) throw new ConvexError("invalid_grant");
    const resource = normalizeMcpResource(args.resource);
    if (token.resource && resource !== token.resource) {
      throw new ConvexError("invalid_grant");
    }

    const scopes = parseScopesFromToken(token.scopes, token.scope);
    await ctx.db.patch(token._id, { revokedAt: now });

    const accessTokenRaw = "prsm_at_" + randomHex(48);
    const refreshTokenRaw = "prsm_rt_" + randomHex(48);
    const tokenHash = await sha256Hex(accessTokenRaw);
    const refreshTokenHash = await sha256Hex(refreshTokenRaw);

    await ctx.db.insert("oauthTokens", {
      tokenHash,
      refreshTokenHash,
      clientId: args.clientId,
      userId: token.userId,
      ...(token.orgId ? { orgId: token.orgId } : {}),
      principalKind: token.principalKind ?? "organization",
      ...(token.resource ? { resource: token.resource } : {}),
      scope: stringifyScopes(scopes),
      scopes,
      expiresAt: now + 60 * 60 * 1000,
      refreshExpiresAt: now + 30 * 24 * 60 * 60 * 1000,
      createdAt: now,
    });

    return {
      access_token: accessTokenRaw,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: refreshTokenRaw,
    };
  },
});

export const revokeTokenInternal = internalMutation({
  args: { tokenHash: v.string(), clientId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const token =
      (await ctx.db
        .query("oauthTokens")
        .withIndex("token", (q) => q.eq("tokenHash", args.tokenHash))
        .first()) ??
      (await ctx.db
        .query("oauthTokens")
        .withIndex("refresh_token", (q) =>
          q.eq("refreshTokenHash", args.tokenHash),
        )
        .first());
    if (token && args.clientId !== undefined && token.clientId !== args.clientId)
      return false;
    if (token && !token.revokedAt) {
      await ctx.db.patch(token._id, { revokedAt: dayjs().valueOf() });
    }
    return true;
  },
});

// ── Public functions (called by authorize page) ──

export const getClientInfo = query({
  args: {
    clientId: v.string(),
    redirectUri: v.string(),
  },
  handler: async (ctx, args) => {
    // Requires auth (Convex query context provides it)
    const principal = await resolveOAuthPrincipal(ctx);

    const client = await ctx.db
      .query("oauthClients")
      .withIndex("client", (q) => q.eq("clientId", args.clientId))
      .first();

    if (!client) return null;

    // Validate redirect_uri is registered
    if (!client.redirectUris.includes(args.redirectUri)) return null;

    return {
      clientName: client.clientName,
      clientId: client.clientId,
      principalKind: principal.principalKind,
    };
  },
});

export const createAuthorizationCode = mutation({
  args: {
    clientId: v.string(),
    redirectUri: v.string(),
    codeChallenge: v.string(),
    scope: v.optional(v.string()),
    resource: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { principalKind, userId, orgId } = await resolveOAuthPrincipal(ctx);
    const scopes = normalizeRequestedScopes(args.scope);
    const resource = normalizeMcpResource(args.resource);
    if (principalKind === "operator" && !resource) {
      throw new Error(
        "invalid_target: operator authorization requires an MCP resource",
      );
    }

    // Verify client exists and redirect_uri matches
    const client = await ctx.db
      .query("oauthClients")
      .withIndex("client", (q) => q.eq("clientId", args.clientId))
      .first();

    if (!client) throw new Error("Invalid client");
    if (!client.redirectUris.includes(args.redirectUri)) {
      throw new Error("Invalid redirect_uri");
    }

    const codeRaw = randomHex(32); // 64 hex chars
    const codeHash = await sha256Hex(codeRaw);

    await ctx.db.insert("oauthAuthCodes", {
      codeHash,
      clientId: args.clientId,
      userId,
      ...(orgId ? { orgId } : {}),
      principalKind,
      ...(resource ? { resource } : {}),
      redirectUri: args.redirectUri,
      codeChallenge: args.codeChallenge,
      scope: stringifyScopes(scopes),
      scopes,
      expiresAt: dayjs().add(10, "minute").valueOf(),
    });

    return codeRaw;
  },
});

// ── Connected Apps (for settings page) ──

export const listConnectedApps = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireOrgAccess(ctx);

    const tokens = await ctx.db
      .query("oauthTokens")
      .withIndex("user", (q) => q.eq("userId", userId))
      .collect();

    // Group by clientId, show only active (non-revoked) tokens
    const activeByClient = new Map<
      string,
      {
        clientId: string;
        createdAt: number;
        expiresAt: number;
        tokenId: Id<"oauthTokens">;
      }
    >();

    for (const t of tokens) {
      if (t.revokedAt) continue;
      const existing = activeByClient.get(t.clientId);
      if (!existing || t.createdAt > existing.createdAt) {
        activeByClient.set(t.clientId, {
          clientId: t.clientId,
          createdAt: t.createdAt,
          expiresAt: t.expiresAt,
          tokenId: t._id,
        });
      }
    }

    // Resolve client names
    const apps = [];
    for (const [clientId, info] of activeByClient) {
      const client = await ctx.db
        .query("oauthClients")
        .withIndex("client", (q) => q.eq("clientId", clientId))
        .first();
      apps.push({
        tokenId: info.tokenId,
        clientName: client?.clientName ?? "Unknown App",
        clientId,
        connectedAt: info.createdAt,
      });
    }

    return apps.sort((a, b) => b.connectedAt - a.connectedAt);
  },
});

export const revokeApp = mutation({
  args: { clientId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireOrgAccess(ctx);

    // Revoke all tokens for this user + client
    const tokens = await ctx.db
      .query("oauthTokens")
      .withIndex("user", (q) => q.eq("userId", userId))
      .collect();

    const now = dayjs().valueOf();
    for (const t of tokens) {
      if (t.clientId === args.clientId && !t.revokedAt) {
        await ctx.db.patch(t._id, { revokedAt: now });
      }
    }
  },
});
