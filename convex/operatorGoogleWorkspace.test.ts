/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import {
  GOOGLE_WORKSPACE_DIRECTORY_USER_READONLY_SCOPE,
  GOOGLE_WORKSPACE_GMAIL_READONLY_SCOPE,
} from "./lib/googleWorkspace";
import { googleWorkspaceCredentialEnvelope } from "./lib/googleWorkspaceCredentials";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function credential(keyId: string) {
  return JSON.stringify({
    type: "service_account",
    client_email: "spot-reader@example.iam.gserviceaccount.com",
    client_id: "1234567890",
    private_key_id: keyId,
    private_key: `-----BEGIN PRIVATE KEY-----\n${keyId}\n-----END PRIVATE KEY-----\n`,
  });
}

async function fixture() {
  const t = convexTest(schema, modules);
  const now = dayjs().valueOf();
  const ids = await t.run(async (ctx) => {
    const operatorUserId = await ctx.db.insert("users", {
      email: "operator@example.com",
      accountKind: "operator",
    });
    await ctx.db.insert("operatorProfiles", {
      userId: operatorUserId,
      email: "operator@example.com",
      role: "operator",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const otherOperatorUserId = await ctx.db.insert("users", {
      email: "other-operator@example.com",
      accountKind: "operator",
    });
    await ctx.db.insert("operatorProfiles", {
      userId: otherOperatorUserId,
      email: "other-operator@example.com",
      role: "operator",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const customerUserId = await ctx.db.insert("users", {
      email: "customer@example.com",
      accountKind: "customer",
    });
    const threadId = await ctx.db.insert("operatorAgentThreads", {
      ownerUserId: operatorUserId,
      visibility: "private",
      channel: "chat",
      title: "Company email",
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const targetOrgId = await ctx.db.insert("organizations", {
      name: "Target Client",
      type: "client",
    });
    return {
      operatorUserId,
      otherOperatorUserId,
      customerUserId,
      threadId,
      targetOrgId,
    };
  });
  return {
    t,
    ids,
    operator: t.withIdentity({ subject: `${ids.operatorUserId}|session` }),
    customer: t.withIdentity({ subject: `${ids.customerUserId}|session` }),
  };
}

describe("operator Google Workspace settings", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("normalizes settings, advances revisions monotonically, and redacts credentials", async () => {
    const { t, operator } = await fixture();
    vi.stubEnv("GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON", credential("key-1"));
    const first = await operator.mutation(
      api.operatorGoogleWorkspace.updateSettings,
      {
        enabled: true,
        mailboxMode: "manual",
        mailboxes: [" First@Example.com ", "first@example.com"],
      },
    );
    const second = await operator.mutation(
      api.operatorGoogleWorkspace.updateSettings,
      {
        enabled: true,
        mailboxMode: "directory",
        mailboxes: [],
        directoryAdminEmail: " Admin@Example.com ",
      },
    );
    expect(second?.updatedAt).toBeGreaterThan(first?.updatedAt ?? 0);
    expect(second).toMatchObject({
      mailboxMode: "directory",
      directoryAdminEmail: "admin@example.com",
    });

    const status = await operator.query(
      api.operatorGoogleWorkspace.getStatus,
      {},
    );
    expect(status).toEqual({
      config: second,
      credentials: {
        present: true,
        serviceAccountEmail: "spot-reader@example.iam.gserviceaccount.com",
        clientId: "1234567890",
      },
      requiredScopes: [
        GOOGLE_WORKSPACE_GMAIL_READONLY_SCOPE,
        GOOGLE_WORKSPACE_DIRECTORY_USER_READONLY_SCOPE,
      ],
      savedVerification: null,
    });
    expect(JSON.stringify(status)).not.toMatch(/PRIVATE KEY|key-1/);
    const audits = await t.run((ctx) =>
      ctx.db.query("operatorAuditEvents").collect(),
    );
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits)).not.toMatch(/PRIVATE KEY|client_id|key-1/);
  });

  it("invalidates saved verification on both settings and credential revision changes", async () => {
    const { operator, ids, t } = await fixture();
    vi.stubEnv("GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON", credential("key-1"));
    const config = await operator.mutation(
      api.operatorGoogleWorkspace.updateSettings,
      {
        enabled: true,
        mailboxMode: "manual",
        mailboxes: ["first@example.com"],
      },
    );
    const credentialRevision = (
      await googleWorkspaceCredentialEnvelope(credential("key-1"))
    ).revision!;
    const verification = {
      status: "verified" as const,
      completeness: "complete" as const,
      verifiedAt: dayjs().valueOf(),
      configUpdatedAt: config!.updatedAt,
      checkedMailboxCount: 1,
      totalMailboxCount: 1,
      maxMailboxChecks: 100,
      directory: {
        status: "not_required" as const,
        adminEmail: null,
        discoveredMailboxCount: 1,
        totalMailboxCount: 1,
        hasMore: false,
        error: null,
      },
      mailboxes: [
        {
          mailbox: "first@example.com",
          status: "verified" as const,
          error: null,
        },
      ],
    };
    await t.mutation(
      internal.operatorGoogleWorkspace.saveVerificationInternal,
      {
        operatorUserId: ids.operatorUserId,
        credentialRevision,
        result: verification,
      },
    );
    await expect(
      operator.query(api.operatorGoogleWorkspace.getStatus, {}),
    ).resolves.toMatchObject({ savedVerification: verification });

    vi.stubEnv("GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON", credential("key-2"));
    await expect(
      operator.query(api.operatorGoogleWorkspace.getStatus, {}),
    ).resolves.toMatchObject({ savedVerification: null });

    vi.stubEnv("GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON", credential("key-1"));
    await operator.mutation(api.operatorGoogleWorkspace.updateSettings, {
      enabled: true,
      mailboxMode: "manual",
      mailboxes: ["second@example.com"],
    });
    await expect(
      operator.query(api.operatorGoogleWorkspace.getStatus, {}),
    ).resolves.toMatchObject({ savedVerification: null });
  });

  it("blocks customer access and operator writes during active impersonation", async () => {
    const { customer, ids, operator, t } = await fixture();
    await expect(
      customer.query(api.operatorGoogleWorkspace.getStatus, {}),
    ).rejects.toThrow("Spot operators");
    await t.run((ctx) =>
      ctx.db.insert("operatorImpersonationSessions", {
        operatorUserId: ids.operatorUserId,
        targetOrgId: ids.targetOrgId,
        targetRole: "admin",
        status: "active",
        createdAt: dayjs().valueOf(),
      }),
    );
    await expect(
      operator.mutation(api.operatorGoogleWorkspace.updateSettings, {
        enabled: false,
        mailboxMode: "manual",
        mailboxes: [],
      }),
    ).rejects.toThrow("impersonation is read-only");
  });

  it("preserves authorized thread continuation across ingress channels", async () => {
    const { ids, t } = await fixture();
    await expect(
      t.query(internal.operatorGoogleWorkspace.getActionContextInternal, {
        operatorUserId: ids.operatorUserId,
        threadId: ids.threadId,
        channel: "mcp",
      }),
    ).resolves.toEqual({ config: null });
    await expect(
      t.query(internal.operatorGoogleWorkspace.getActionContextInternal, {
        operatorUserId: ids.otherOperatorUserId,
        threadId: ids.threadId,
        channel: "chat",
      }),
    ).rejects.toThrow("Operator agent thread not found");
  });

  it("fails closed before provider access when disabled or unconfigured", async () => {
    const { customer, ids, operator, t } = await fixture();
    await operator.mutation(api.operatorGoogleWorkspace.updateSettings, {
      enabled: false,
      mailboxMode: "manual",
      mailboxes: [],
    });
    await expect(
      t.action(internal.actions.operatorGoogleWorkspace.runToolInternal, {
        operatorUserId: ids.operatorUserId,
        threadId: ids.threadId,
        toolName: "list_company_mailboxes",
        input: {},
        channel: "mcp",
      }),
    ).rejects.toThrow("access is disabled");

    await operator.mutation(api.operatorGoogleWorkspace.updateSettings, {
      enabled: true,
      mailboxMode: "manual",
      mailboxes: ["first@example.com"],
    });
    vi.stubEnv("GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON", "");
    await expect(
      operator.action(api.actions.operatorGoogleWorkspace.verifyConnection, {}),
    ).resolves.toMatchObject({
      status: "failed",
      completeness: "partial",
      checkedMailboxCount: 0,
      totalMailboxCount: 1,
      error: "Google Workspace service-account credentials are not configured.",
    });
    await expect(
      customer.action(api.actions.operatorGoogleWorkspace.verifyConnection, {}),
    ).rejects.toThrow("Spot operators");
    await expect(
      t.action(internal.actions.operatorGoogleWorkspace.runToolInternal, {
        operatorUserId: ids.operatorUserId,
        threadId: ids.threadId,
        toolName: "list_company_mailboxes",
        input: {},
        channel: "mcp",
      }),
    ).rejects.toThrow("credentials are not configured");

    vi.stubEnv(
      "GOOGLE_WORKSPACE_SERVICE_ACCOUNT_JSON",
      "invalid-SENSITIVE-MARKER",
    );
    const failed = await operator.action(
      api.actions.operatorGoogleWorkspace.verifyConnection,
      {},
    );
    expect(failed).toMatchObject({
      status: "failed",
      checkedMailboxCount: 0,
      error: "Google Workspace service-account credentials are invalid.",
    });
    expect(JSON.stringify(failed)).not.toContain("SENSITIVE-MARKER");
    const status = await operator.query(
      api.operatorGoogleWorkspace.getStatus,
      {},
    );
    expect(status.savedVerification?.error).toBe(failed.error);
  });
});
