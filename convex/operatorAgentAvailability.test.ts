/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { afterEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.unstubAllEnvs());

test("each operator step advertises only currently permitted and configured tools", async () => {
  for (const name of [
    "GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON",
    "MAPBOX_ACCESS_TOKEN",
    "NEXT_PUBLIC_MAPBOX_TOKEN",
    "SLACK_WORKER_URL",
    "SLACK_WORKER_SECRET",
    "SLACK_CLARITY_TEAM_ID",
  ])
    vi.stubEnv(name, "");
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = dayjs().valueOf();
    const operatorUserId = await ctx.db.insert("users", {
      accountKind: "operator",
      email: "ops@spot.insure",
    });
    const profileId = await ctx.db.insert("operatorProfiles", {
      userId: operatorUserId,
      email: "ops@spot.insure",
      role: "operator",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const threadId = await ctx.db.insert("operatorAgentThreads", {
      ownerUserId: operatorUserId,
      visibility: "private",
      channel: "chat",
      title: "Availability",
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const userMessageId = await ctx.db.insert("operatorAgentMessages", {
      threadId,
      ownerUserId: operatorUserId,
      channel: "chat",
      role: "user",
      content: "Help",
      createdAt: now,
      updatedAt: now,
    });
    const agentMessageId = await ctx.db.insert("operatorAgentMessages", {
      threadId,
      ownerUserId: operatorUserId,
      channel: "chat",
      role: "agent",
      content: "",
      createdAt: now,
      updatedAt: now,
    });
    const runId = await ctx.db.insert("operatorAgentRuns", {
      threadId,
      operatorUserId,
      userMessageId,
      agentMessageId,
      objective: "Help",
      status: "running",
      createdAt: now,
      updatedAt: now,
    });
    const workspaceId = await ctx.db.insert("operatorGoogleWorkspaceConfig", {
      key: "default",
      enabled: true,
      mailboxMode: "manual",
      mailboxes: ["ops@example.test"],
      updatedBy: operatorUserId,
      updatedAt: now,
    });
    const serverId = await ctx.db.insert("operatorMcpServers", {
      name: "Test",
      url: "https://mcp.example.test",
      enabled: false,
      toolsJson: "[]",
      revision: 1,
      updatedBy: operatorUserId,
      updatedAt: now,
    });
    return { operatorUserId, profileId, runId, workspaceId, serverId };
  });
  const context = () =>
    t.query(internal.operatorAgent.getRunContextInternal, { runId: ids.runId });
  const initial = await context();
  expect(initial?.toolNames).toContain("lookup_policy");
  expect(initial?.toolNames).toContain("update_client_wiki");
  for (const name of [
    "clear_all_agent_memory",
    "list_company_mailboxes",
    "lookup_address",
    "send_operator_slack_message",
    "list_mcp_tools",
    "call_mcp_tool",
  ])
    expect(initial?.toolNames).not.toContain(name);

  vi.stubEnv(
    "GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON",
    JSON.stringify({
      type: "service_account",
      client_email: "test@example.iam.gserviceaccount.com",
      client_id: "12345",
      private_key:
        "-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----",
    }),
  );
  vi.stubEnv("MAPBOX_ACCESS_TOKEN", "mapbox-fixture");
  vi.stubEnv("SLACK_WORKER_URL", "https://slack.example.test");
  vi.stubEnv("SLACK_WORKER_SECRET", "slack-fixture");
  vi.stubEnv("SLACK_CLARITY_TEAM_ID", "T-FIXTURE");
  await t.run(async (ctx) => {
    await ctx.db.patch(ids.profileId, { role: "owner" });
    await ctx.db.patch(ids.serverId, { enabled: true });
  });
  const enabled = await context();
  for (const name of [
    "clear_all_agent_memory",
    "list_company_mailboxes",
    "search_company_email",
    "lookup_address",
    "send_operator_slack_message",
    "list_mcp_tools",
    "call_mcp_tool",
  ])
    expect(enabled?.toolNames).toContain(name);

  await t.run(async (ctx) => {
    await ctx.db.patch(ids.profileId, { role: "operator" });
    await ctx.db.patch(ids.workspaceId, { enabled: false });
    await ctx.db.patch(ids.serverId, { authType: "oauth" });
    const orgId = await ctx.db.insert("organizations", {
      name: "Client",
      type: "client",
    });
    await ctx.db.insert("operatorImpersonationSessions", {
      operatorUserId: ids.operatorUserId,
      targetOrgId: orgId,
      targetRole: "admin",
      status: "active",
      createdAt: dayjs().valueOf(),
    });
  });
  const restricted = await context();
  expect(restricted?.toolNames).toContain("lookup_policy");
  for (const name of [
    "clear_all_agent_memory",
    "update_client_wiki",
    "list_company_mailboxes",
    "send_operator_slack_message",
    "list_mcp_tools",
    "call_mcp_tool",
  ])
    expect(restricted?.toolNames).not.toContain(name);
  await t.run((ctx) => ctx.db.patch(ids.profileId, { status: "disabled" }));
  await expect(context()).rejects.toThrow();
});
