/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { parseOperatorAgentToolInput } from "./lib/operatorAgentToolRegistry";

const remoteCall = vi.hoisted(() => vi.fn());
vi.mock("./lib/operatorMcpClient", () => ({
  withMcpClient: async (
    _url: string,
    _token: string | undefined,
    run: (client: unknown) => Promise<unknown>,
  ) => run({ callTool: remoteCall }),
}));
afterEach(() => remoteCall.mockReset());

const modules = import.meta.glob("./**/*.ts");
async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const operatorUserId = await ctx.db.insert("users", {
      accountKind: "operator",
      email: "person@claritylabs.inc",
    });
    const profileId = await ctx.db.insert("operatorProfiles", {
      userId: operatorUserId,
      email: "person@claritylabs.inc",
      role: "operator",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    const customerId = await ctx.db.insert("users", {
      accountKind: "customer",
    });
    const orgId = await ctx.db.insert("organizations", {
      name: "Client",
      type: "client",
    });
    return { operatorUserId, profileId, customerId, orgId };
  });
  const serverId = await t.mutation(internal.operatorMcpServers.saveInternal, {
    operatorUserId: ids.operatorUserId,
    name: "Example",
    url: "https://example.com/mcp",
    enabled: true,
    encryptedToken: "ciphertext",
    toolsJson: JSON.stringify([
      { name: "create_issue", inputSchema: { type: "object" } },
    ]),
  });
  return {
    t,
    ...ids,
    serverId,
    viewer: t.withIdentity({ subject: `${ids.operatorUserId}|session` }),
  };
}

test("MCP settings hide credentials and reject customers, impersonation, and stale changes", async () => {
  const f = await fixture();
  const servers = await f.viewer.query(api.operatorMcpServers.list, {});
  expect(servers[0]).toMatchObject({ hasToken: true, revision: 1 });
  expect(servers[0]).not.toHaveProperty("encryptedToken");
  await expect(f.t.query(api.operatorMcpServers.list, {})).rejects.toThrow();
  const customer = f.t.withIdentity({ subject: `${f.customerId}|session` });
  await expect(
    customer.query(api.operatorMcpServers.list, {}),
  ).rejects.toThrow();
  await expect(
    customer.mutation(api.operatorMcpServers.remove, {
      serverId: f.serverId,
      revision: 1,
    }),
  ).rejects.toThrow();
  await expect(
    f.viewer.mutation(api.operatorMcpServers.remove, {
      serverId: f.serverId,
      revision: 2,
    }),
  ).rejects.toThrow("Server changed");
  await f.t.run((ctx) =>
    ctx.db.insert("operatorImpersonationSessions", {
      operatorUserId: f.operatorUserId,
      targetOrgId: f.orgId,
      targetRole: "admin",
      status: "active",
      createdAt: 1,
    }),
  );
  await expect(
    f.viewer.mutation(api.operatorMcpServers.remove, {
      serverId: f.serverId,
      revision: 1,
    }),
  ).rejects.toThrow();
  await expect(
    f.t.query(internal.operatorMcpServers.catalog, {
      operatorUserId: f.operatorUserId,
    }),
  ).rejects.toThrow();
});

test("remote calls require exact approval and stale or disabled servers cannot obtain a new approval", async () => {
  const f = await fixture();
  const invoke = (key: string, serverRevision = 1) =>
    f.t.action(internal.operatorAgent.invokeRegisteredToolInternal, {
      operatorUserId: f.operatorUserId,
      channel: "mcp",
      conversationKey: key,
      idempotencyKey: key,
      toolName: "call_mcp_tool",
      input: {
        serverId: f.serverId,
        serverRevision,
        toolName: "create_issue",
        arguments: { body: null },
      },
    });
  const pending = await invoke("first");
  expect(pending.outcome.status).toBe("confirmation_required");
  expect((await invoke("stale", 2)).outcome.status).toBe("failed");
  await f.t.run((ctx) =>
    ctx.db.patch(f.serverId, { enabled: false, revision: 2 }),
  );
  expect((await invoke("disabled", 2)).outcome.status).toBe("failed");
  if (pending.outcome.status !== "confirmation_required")
    throw new Error("Expected approval");
  const confirmation = await f.t.run((ctx) =>
    ctx.db.query("operatorAgentConfirmations").first(),
  );
  if (!confirmation) throw new Error("Missing confirmation");
  const approved = await f.viewer.mutation(api.operatorAgent.confirmAction, {
    threadId: confirmation.threadId,
    confirmationId: confirmation._id,
    decision: "approve",
  });
  expect(approved.status).toBe("failed");
  expect(remoteCall).not.toHaveBeenCalled();
  expect(
    await f.t.query(internal.operatorMcpServers.catalog, {
      operatorUserId: f.operatorUserId,
    }),
  ).toEqual([]);
  await f.t.run((ctx) => ctx.db.patch(f.profileId, { status: "disabled" }));
  await expect(
    f.t.query(internal.operatorMcpServers.configuration, {
      operatorUserId: f.operatorUserId,
      serverId: f.serverId,
    }),
  ).rejects.toThrow();
});

test("remote arguments preserve explicit nulls for exact approval and execution", () => {
  expect(
    parseOperatorAgentToolInput("call_mcp_tool", {
      serverId: "server",
      serverRevision: 1,
      toolName: "update",
      arguments: { cleared: null, nested: { value: null } },
    }),
  ).toMatchObject({ arguments: { cleared: null, nested: { value: null } } });
});

test("approved remote execution is audited once and unknown failures are not replayed", async () => {
  const f = await fixture();
  await f.t.run((ctx) =>
    ctx.db.patch(f.serverId, { encryptedToken: undefined }),
  );
  await f.viewer.mutation(api.operator.setApproveAll, { approveAll: true });
  remoteCall.mockResolvedValue({
    content: [{ type: "text", text: "created" }],
  });
  const args = {
    operatorUserId: f.operatorUserId,
    channel: "mcp" as const,
    toolName: "call_mcp_tool",
    idempotencyKey: "remote-once",
    input: {
      serverId: f.serverId,
      serverRevision: 1,
      toolName: "create_issue",
      arguments: { body: null },
    },
  };
  const first = await f.t.action(
    internal.operatorAgent.invokeRegisteredToolInternal,
    args,
  );
  expect(first.outcome).toMatchObject({
    status: "succeeded",
    result: { content: [{ text: "created" }] },
  });
  expect(remoteCall).toHaveBeenCalledWith(
    { name: "create_issue", arguments: { body: null } },
    undefined,
    { timeout: 60_000 },
  );
  await f.t.action(internal.operatorAgent.invokeRegisteredToolInternal, args);
  expect(remoteCall).toHaveBeenCalledOnce();
  remoteCall.mockRejectedValueOnce(
    new Error("Connection lost after submission"),
  );
  const failedArgs = { ...args, idempotencyKey: "remote-unknown" };
  const failed = await f.t.action(
    internal.operatorAgent.invokeRegisteredToolInternal,
    failedArgs,
  );
  expect(failed.outcome).toMatchObject({
    status: "failed",
    failure: { writeState: "unknown", recoverable: false },
  });
  await f.t.action(
    internal.operatorAgent.invokeRegisteredToolInternal,
    failedArgs,
  );
  expect(remoteCall).toHaveBeenCalledTimes(2);
});
