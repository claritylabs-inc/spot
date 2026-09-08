/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import http from "./http";
import dayjs from "dayjs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const createAuthorizationCodeFn = api.oauth.createAuthorizationCode;
const exchangeAuthCodeFn = internal.oauth.exchangeAuthCode;
const refreshAccessTokenFn = internal.oauth.refreshAccessToken;
const registerClientFn = internal.oauth.registerClient;
const validateAccessTokenWithScopesFn = internal.oauth.validateAccessTokenWithScopes;
const REDIRECT_URI = "https://app.example/callback";

async function sha256Hex(input: string) {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function pkceChallenge(verifier: string) {
  const data = new TextEncoder().encode(verifier);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hashBuffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function seedOAuthClientAndUser() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", {
      name: "Acme",
      type: "client",
    });
    const userId = await ctx.db.insert("users", {
      email: "alice@example.com",
    });
    await ctx.db.insert("orgMemberships", {
      orgId,
      userId,
      role: "admin",
    });
    return { orgId, userId };
  });

  const client = await t.mutation(registerClientFn, {
    clientName: "Test OAuth App",
    redirectUris: [REDIRECT_URI],
  });

  return {
    t,
    ...ids,
    clientId: client.client_id as string,
    verifier: "test-code-verifier",
    codeChallenge: await pkceChallenge("test-code-verifier"),
  };
}

type OAuthTestHandle = Awaited<ReturnType<typeof seedOAuthClientAndUser>>["t"];

function sessionFor(userId: Id<"users">) {
  return { subject: `${userId}|session` };
}

async function createCode(options: {
  t: OAuthTestHandle;
  userId: Id<"users">;
  clientId: string;
  codeChallenge: string;
  scope?: string;
  resource?: string;
}) {
  return options.t
    .withIdentity(sessionFor(options.userId))
    .mutation(createAuthorizationCodeFn, {
      clientId: options.clientId,
      redirectUri: REDIRECT_URI,
      codeChallenge: options.codeChallenge,
      scope: options.scope,
      resource: options.resource,
    });
}

async function getAuthCodeRecord(t: OAuthTestHandle, codeRaw: string) {
  const codeHash = await sha256Hex(codeRaw);
  return t.run(async (ctx) =>
    ctx.db
      .query("oauthAuthCodes")
      .withIndex("code", (q) => q.eq("codeHash", codeHash))
      .first(),
  );
}

async function validateRawAccessToken(t: OAuthTestHandle, accessToken: string) {
  return t.query(validateAccessTokenWithScopesFn, {
    tokenHash: await sha256Hex(accessToken),
  });
}

describe("oauth scopes", () => {
  test("defaults missing requested scope to read-only through exchange", async () => {
    const { t, userId, clientId, codeChallenge, verifier } =
      await seedOAuthClientAndUser();

    const codeRaw = await createCode({ t, userId, clientId, codeChallenge });
    const codeRecord = await getAuthCodeRecord(t, codeRaw);
    expect(codeRecord).toMatchObject({
      scope: "read",
      scopes: ["read"],
    });

    const exchanged = await t.mutation(exchangeAuthCodeFn, {
      codeRaw,
      clientId,
      redirectUri: REDIRECT_URI,
      codeVerifier: verifier,
    });
    const token = await validateRawAccessToken(t, exchanged.access_token);

    expect(token?.scopes).toEqual(["read"]);
  });

  test("preserves read write scopes through exchange and refresh", async () => {
    const { t, userId, clientId, codeChallenge, verifier } =
      await seedOAuthClientAndUser();

    const codeRaw = await createCode({
      t,
      userId,
      clientId,
      codeChallenge,
      scope: "read write read",
    });
    const codeRecord = await getAuthCodeRecord(t, codeRaw);
    expect(codeRecord).toMatchObject({
      scope: "read write",
      scopes: ["read", "write"],
    });

    const exchanged = await t.mutation(exchangeAuthCodeFn, {
      codeRaw,
      clientId,
      redirectUri: REDIRECT_URI,
      codeVerifier: verifier,
    });
    const firstToken = await validateRawAccessToken(t, exchanged.access_token);
    expect(firstToken?.scopes).toEqual(["read", "write"]);

    const refreshed = await t.mutation(refreshAccessTokenFn, {
      refreshTokenRaw: exchanged.refresh_token,
      clientId,
    });
    const refreshedToken = await validateRawAccessToken(
      t,
      refreshed.access_token,
    );

    expect(refreshedToken?.scopes).toEqual(["read", "write"]);
  });

  test("rejects unsupported requested scopes", async () => {
    const { t, userId, clientId, codeChallenge } =
      await seedOAuthClientAndUser();

    await expect(
      createCode({
        t,
        userId,
        clientId,
        codeChallenge,
        scope: "read delete",
      }),
    ).rejects.toThrow("invalid_scope: unsupported scope delete");

    const codes = await t.run(async (ctx) =>
      ctx.db.query("oauthAuthCodes").collect(),
    );
    expect(codes).toHaveLength(0);
  });

});

describe("OAuth token revocation", () => {
  test.each(["access_token", "refresh_token", "bearer"] as const)(
    "revokes the access/refresh pair through HTTP using %s",
    async (kind) => {
      const { t, userId, clientId, codeChallenge, verifier } =
        await seedOAuthClientAndUser();
      const codeRaw = await createCode({ t, userId, clientId, codeChallenge });
      const tokens = await t.mutation(exchangeAuthCodeFn, {
        codeRaw,
        clientId,
        redirectUri: REDIRECT_URI,
        codeVerifier: verifier,
      });
      expect(await validateRawAccessToken(t, tokens.access_token)).not.toBeNull();

      const response = await t.fetch("/oauth/revoke", {
        method: "POST",
        ...(kind === "bearer"
          ? { headers: { Authorization: `Bearer ${tokens.access_token}` } }
          : {
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                token: tokens[kind],
                client_id: clientId,
                token_type_hint: "ignored-hint",
              }).toString(),
            }),
      });
      expect(response.status).toBe(200);
      expect(await validateRawAccessToken(t, tokens.access_token)).toBeNull();
      await expect(
        t.mutation(refreshAccessTokenFn, {
          refreshTokenRaw: tokens.refresh_token,
          clientId,
        }),
      ).rejects.toThrow("invalid_grant");

    },
  );

  test("maps a structured invalid grant from the mutation to an OAuth client error", async () => {
    const t = convexTest(schema, modules);
    const route = http.lookup("/oauth/token", "POST");
    if (!route) throw new Error("Missing OAuth token route");
    const action = route[0] as typeof route[0] & {
      _handler: (ctx: ActionCtx, request: Request) => Promise<Response>;
    };
    // Supply the SDK-decoded error: convex-test retains serialized error data
    // when its HTTP action directly invokes a mutation.
    const result = await t.action(async (ctx) => {
      const response = await action._handler(
        {
          ...ctx,
          runMutation: vi.fn().mockRejectedValue(new ConvexError("invalid_grant")),
        },
        new Request("https://spot.example/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "grant_type=refresh_token&refresh_token=revoked&client_id=qa",
        }),
      );
      return { status: response.status, body: await response.json() };
    });
    expect(result).toEqual({ status: 400, body: { error: "invalid_grant" } });
  });

  test("rejects a mismatched client without revoking its token; unknown tokens are idempotent", async () => {
    const { t, userId, clientId, codeChallenge, verifier } =
      await seedOAuthClientAndUser();
    const codeRaw = await createCode({ t, userId, clientId, codeChallenge });
    const tokens = await t.mutation(exchangeAuthCodeFn, {
      codeRaw,
      clientId,
      redirectUri: REDIRECT_URI,
      codeVerifier: verifier,
    });
    const response = await t.fetch("/oauth/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: tokens.refresh_token,
        client_id: "another-client",
      }).toString(),
    });
    expect(response.status).toBe(400);
    expect(await validateRawAccessToken(t, tokens.access_token)).not.toBeNull();

    const unknown = () =>
      t.fetch("/oauth/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "token=unknown-token",
      });
    expect((await unknown()).status).toBe(200);
    expect((await unknown()).status).toBe(200);
    expect(await validateRawAccessToken(t, tokens.access_token)).not.toBeNull();
    expect((await t.fetch("/oauth/revoke", { method: "POST" })).status).toBe(400);
  });
});

describe("operator oauth principals", () => {
  beforeEach(() => {
    vi.stubEnv("CONVEX_SITE_URL", "https://spot.example");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("issues an operator token bound to the MCP resource and revalidates status", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "operator@example.com",
        accountKind: "operator",
      });
      await ctx.db.insert("operatorProfiles", {
        userId,
        email: "operator@example.com",
        role: "owner",
        status: "active",
        createdAt: dayjs().valueOf(),
        updatedAt: dayjs().valueOf(),
      });
      return userId;
    });
    const client = await t.mutation(registerClientFn, {
      clientName: "Operator MCP",
      redirectUris: [REDIRECT_URI],
    });
    const verifier = "operator-code-verifier";
    const resource = "https://spot.example/mcp";
    const codeRaw = await createCode({
      t,
      userId,
      clientId: client.client_id,
      codeChallenge: await pkceChallenge(verifier),
      scope: "read write",
      resource,
    });

    const exchanged = await t.mutation(exchangeAuthCodeFn, {
      codeRaw,
      clientId: client.client_id,
      redirectUri: REDIRECT_URI,
      codeVerifier: verifier,
      resource,
    });
    const token = await validateRawAccessToken(t, exchanged.access_token);
    expect(token).toMatchObject({
      principalKind: "operator",
      operatorRole: "owner",
      resource,
      scopes: ["read", "write"],
    });
    expect(token?.orgId).toBeUndefined();

    await t.run(async (ctx) => {
      const profile = await ctx.db
        .query("operatorProfiles")
        .withIndex("user", (q) => q.eq("userId", userId))
        .unique();
      if (!profile) throw new Error("Missing operator profile");
      await ctx.db.patch(profile._id, {
        status: "disabled",
        updatedAt: dayjs().valueOf(),
      });
    });

    expect(await validateRawAccessToken(t, exchanged.access_token)).toBeNull();
  });

  test("rejects exchanging a resource-bound code for another MCP server", async () => {
    const { t, userId, clientId, codeChallenge, verifier } =
      await seedOAuthClientAndUser();
    const codeRaw = await createCode({
      t,
      userId,
      clientId,
      codeChallenge,
      resource: "https://spot.example/mcp",
    });

    await expect(
      t.mutation(exchangeAuthCodeFn, {
        codeRaw,
        clientId,
        redirectUri: REDIRECT_URI,
        codeVerifier: verifier,
        resource: "https://attacker.example/mcp",
      }),
    ).rejects.toThrow("invalid_target");
  });
});
