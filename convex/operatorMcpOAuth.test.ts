/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { encryptPassword } from "./lib/imapMailbox";
import { readOAuthData } from "./lib/operatorMcpOAuth";

const oauthFetch = vi.hoisted(() => vi.fn());
const toolCall = vi.hoisted(() => vi.fn());
vi.mock("./lib/operatorMcpClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/operatorMcpClient")>()),
  mcpOAuthFetch: oauthFetch,
  withMcpClient: async (
    _url: string,
    token: string,
    run: (client: unknown) => Promise<unknown>,
  ) => {
    expect(token).toMatch(/^access-/);
    return run({
      listTools: async () => ({
        tools: [{ name: "read_record", inputSchema: { type: "object" } }],
      }),
      callTool: toolCall,
    });
  },
}));
const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  vi.stubEnv("CONVEX_SITE_URL", "https://spot.example.test");
  vi.stubEnv("AUTH_SITE_URL", "https://portal.example.test");
  vi.stubEnv("EMAIL_CONNECTIONS_ENCRYPTION_KEY", "test-only-encryption-key");
  oauthFetch.mockImplementation(
    async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("oauth-protected-resource"))
        return Response.json({
          resource: "https://8.8.8.8/mcp",
          authorization_servers: ["https://8.8.4.4"],
          scopes_supported: ["read"],
        });
      if (
        url.includes("oauth-authorization-server") ||
        url.includes("openid-configuration")
      )
        return Response.json({
          issuer: "https://8.8.4.4",
          authorization_endpoint: "https://8.8.4.4/authorize",
          token_endpoint: "https://8.8.4.4/token",
          registration_endpoint: "https://8.8.4.4/register",
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
        });
      if (url.endsWith("/register"))
        return Response.json(
          { ...JSON.parse(String(init?.body)), client_id: "registered-client" },
          { status: 201 },
        );
      if (url.endsWith("/token")) {
        const body = new URLSearchParams(init?.body as URLSearchParams);
        return Response.json({
          access_token:
            body.get("grant_type") === "refresh_token"
              ? "access-refreshed"
              : "access-initial",
          refresh_token: "refresh-rotated",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      throw new Error(`Unexpected OAuth request: ${url}`);
    },
  );
  toolCall.mockResolvedValue({ content: [{ type: "text", text: "record" }] });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      accountKind: "operator",
      email: "terry@claritylabs.inc",
    });
    const profileId = await ctx.db.insert("operatorProfiles", {
      userId,
      email: "terry@claritylabs.inc",
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    return { userId, profileId };
  });
  const viewer = t.withIdentity({ subject: `${ids.userId}|session` });
  const serverId = await viewer.action(api.actions.operatorMcp.save, {
    name: "OAuth fixture",
    url: "https://8.8.8.8/mcp",
    authType: "oauth",
    enabled: false,
  });
  return { t, viewer, serverId, ...ids };
}

async function connect(f: Awaited<ReturnType<typeof fixture>>) {
  const { authorizationUrl } = await f.viewer.action(
    api.actions.operatorMcpOAuth.connect,
    { serverId: f.serverId },
  );
  const url = new URL(authorizationUrl);
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("redirect_uri")).toBe(
    "https://spot.example.test/operator-mcp/oauth/callback",
  );
  const state = url.searchParams.get("state")!;
  expect(state.length).toBeGreaterThan(30);
  const redirect = await f.t.action(
    internal.actions.operatorMcpOAuth.callback,
    { state, code: "authorization-code", issuer: "https://8.8.4.4" },
  );
  expect(redirect).toBe(
    "https://portal.example.test/operator/settings?mcp=connected",
  );
  return { state, url };
}

test("OAuth dynamically registers, uses PKCE, hides credentials, and consumes callbacks once", async () => {
  const f = await fixture();
  const { state, url } = await connect(f);
  const exchange = oauthFetch.mock.calls.find(([input]) =>
    String(input).endsWith("/token"),
  );
  const body = new URLSearchParams(exchange?.[1]?.body as URLSearchParams);
  expect(body.get("code")).toBe("authorization-code");
  expect(
    createHash("sha256").update(body.get("code_verifier")!).digest("base64url"),
  ).toBe(url.searchParams.get("code_challenge"));
  const servers = await f.viewer.query(api.operatorMcpServers.list, {});
  expect(servers[0]).toMatchObject({
    enabled: true,
    hasOAuth: true,
    toolCount: 1,
    revision: 2,
  });
  expect(servers[0]).not.toHaveProperty("encryptedOAuth");
  expect(JSON.stringify(servers)).not.toContain("access-initial");
  const replay = await f.t.action(internal.actions.operatorMcpOAuth.callback, {
    state,
    code: "authorization-code",
  });
  expect(replay).toContain("mcp=oauth_error");
  expect(
    oauthFetch.mock.calls.filter(([input]) => String(input).endsWith("/token")),
  ).toHaveLength(1);
});

test("server edits and revoked operators invalidate outstanding OAuth consent", async () => {
  const f = await fixture();
  const start = await f.viewer.action(api.actions.operatorMcpOAuth.connect, {
    serverId: f.serverId,
  });
  await f.t.run((ctx) => ctx.db.patch(f.serverId, { revision: 2 }));
  expect(
    await f.t.action(internal.actions.operatorMcpOAuth.callback, {
      state: new URL(start.authorizationUrl).searchParams.get("state")!,
      code: "code",
    }),
  ).toContain("oauth_error");
  const next = await f.viewer.action(api.actions.operatorMcpOAuth.connect, {
    serverId: f.serverId,
  });
  await f.t.run((ctx) => ctx.db.patch(f.profileId, { status: "disabled" }));
  expect(
    await f.t.action(internal.actions.operatorMcpOAuth.callback, {
      state: new URL(next.authorizationUrl).searchParams.get("state")!,
      code: "code",
    }),
  ).toContain("oauth_error");
  expect(
    oauthFetch.mock.calls.filter(([input]) => String(input).endsWith("/token")),
  ).toHaveLength(0);
  await expect(
    f.viewer.action(api.actions.operatorMcpOAuth.connect, {
      serverId: f.serverId,
    }),
  ).rejects.toThrow();
});

test("OAuth refresh rotates tokens without changing exact-call revisions and serializes refresh claims", async () => {
  const f = await fixture();
  await connect(f);
  let server = await f.t.run((ctx) => ctx.db.get(f.serverId));
  const data = readOAuthData(server!.encryptedOAuth!);
  data.expiresAt = dayjs().subtract(1, "minute").valueOf();
  data.tokens!.refresh_token = "refresh-original";
  const expired = encryptPassword(JSON.stringify(data));
  await f.t.run((ctx) => ctx.db.patch(f.serverId, { encryptedOAuth: expired }));
  await f.t.action(internal.actions.operatorMcp.run, {
    operatorUserId: f.userId,
    toolName: "call_mcp_tool",
    input: {
      serverId: f.serverId,
      serverRevision: 2,
      toolName: "read_record",
      arguments: {},
    },
  });
  const exchange = oauthFetch.mock.calls
    .filter(([input]) => String(input).endsWith("/token"))
    .at(-1);
  const body = new URLSearchParams(exchange?.[1]?.body as URLSearchParams);
  expect(body.get("grant_type")).toBe("refresh_token");
  expect(body.get("refresh_token")).toBe("refresh-original");
  server = await f.t.run((ctx) => ctx.db.get(f.serverId));
  expect(server?.revision).toBe(2);
  expect(readOAuthData(server!.encryptedOAuth!).tokens).toMatchObject({
    access_token: "access-refreshed",
    refresh_token: "refresh-rotated",
  });
  const claim = {
    operatorUserId: f.userId,
    serverId: f.serverId,
    revision: 2,
    expectedEncrypted: server!.encryptedOAuth!,
  };
  await f.t.mutation(internal.operatorMcpOAuth.claimRefresh, {
    ...claim,
    lease: "first",
  });
  await expect(
    f.t.mutation(internal.operatorMcpOAuth.claimRefresh, {
      ...claim,
      lease: "second",
    }),
  ).rejects.toThrow("in progress");
  await f.viewer.action(api.actions.operatorMcp.save, {
    serverId: f.serverId,
    revision: 2,
    name: "OAuth fixture",
    url: "https://8.8.8.8/mcp",
    authType: "oauth",
    enabled: false,
  });
  await f.t.mutation(internal.operatorMcpOAuth.finishRefresh, {
    serverId: f.serverId,
    lease: "first",
    encryptedOAuth: server!.encryptedOAuth!,
  });
  expect(await f.t.run((ctx) => ctx.db.get(f.serverId))).toMatchObject({
    enabled: false,
    revision: 3,
    encryptedOAuth: server!.encryptedOAuth!,
  });
  expect(toolCall).toHaveBeenCalledOnce();
});

test("pre-registered clients keep secrets private and expired consent cannot exchange codes", async () => {
  const f = await fixture();
  await f.viewer.action(api.actions.operatorMcp.save, {
    serverId: f.serverId,
    revision: 1,
    name: "OAuth fixture",
    url: "https://8.8.8.8/mcp",
    authType: "oauth",
    enabled: false,
    oauthClientId: "existing-client",
    oauthClientSecret: "private-client-secret",
  });
  await expect(
    f.viewer.action(api.actions.operatorMcp.save, {
      serverId: f.serverId,
      revision: 2,
      name: "OAuth fixture",
      url: "https://other.example/mcp",
      authType: "oauth",
      enabled: false,
      oauthClientId: "existing-client",
    }),
  ).rejects.toThrow("Re-enter the OAuth client secret");
  const start = await f.viewer.action(api.actions.operatorMcpOAuth.connect, {
    serverId: f.serverId,
  });
  expect(new URL(start.authorizationUrl).searchParams.get("client_id")).toBe(
    "existing-client",
  );
  const servers = await f.viewer.query(api.operatorMcpServers.list, {});
  expect(servers[0]).toMatchObject({ hasOAuthClientSecret: true });
  expect(JSON.stringify(servers)).not.toContain("private-client-secret");
  await f.t.run(async (ctx) => {
    const session = await ctx.db.query("operatorMcpOAuthSessions").first();
    await ctx.db.patch(session!._id, {
      expiresAt: dayjs().subtract(1, "minute").valueOf(),
    });
  });
  expect(
    await f.t.action(internal.actions.operatorMcpOAuth.callback, {
      state: new URL(start.authorizationUrl).searchParams.get("state")!,
      code: "code",
    }),
  ).toContain("oauth_error");
  expect(
    oauthFetch.mock.calls.some(
      ([input]) =>
        String(input).endsWith("/register") || String(input).endsWith("/token"),
    ),
  ).toBe(false);
  await connect(f);
  expect(
    oauthFetch.mock.calls.some(([input]) =>
      String(input).endsWith("/register"),
    ),
  ).toBe(false);
});
