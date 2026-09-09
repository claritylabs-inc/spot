/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = dayjs().valueOf();
    const operatorUserId = await ctx.db.insert("users", {
      name: "Operator",
      email: "operator@example.com",
      accountKind: "operator",
    });
    const clientUserId = await ctx.db.insert("users", {
      name: "Client",
      email: "client@example.com",
      accountKind: "customer",
    });
    await ctx.db.insert("operatorProfiles", {
      userId: operatorUserId,
      email: "operator@example.com",
      role: "operator",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    return { operatorUserId, clientUserId };
  });
  return {
    t,
    operator: t.withIdentity({
      subject: `${ids.operatorUserId}|session`,
    }),
    client: t.withIdentity({
      subject: `${ids.clientUserId}|session`,
    }),
  };
}

describe("operator task intents", () => {
  test("returns contextual starters without exposing unrelated tasks", async () => {
    const f = await fixture();

    const global = await f.operator.query(api.operatorAgent.listIntents, {});
    expect(global.map((intent) => intent.id)).toEqual([
      "find_account_or_policy",
      "check_system_health",
      "search_company_email",
      "investigate_recent_failures",
    ]);

    const contextual = await f.operator.query(api.operatorAgent.listIntents, {
      pageContext: {
        pageType: "operator_client",
        entityId: "client-id",
        summary: "Cove",
      },
    });
    expect(contextual.map((intent) => intent.id)).toEqual([
      "review_client",
      "update_client",
      "start_procurement",
    ]);
  });

  test("starts a governed thread with immutable context and intent provenance", async () => {
    const f = await fixture();
    const pageContext = {
      pageType: "policy",
      entityId: "policy-id",
      summary: "Current policy",
    };
    const emptyThreadId = await f.operator.mutation(
      api.operatorAgent.createThread,
      { initialContext: pageContext },
    );

    const result = await f.operator.mutation(api.operatorAgent.startIntent, {
      intentId: "investigate_policy",
      pageContext,
      emptyThreadId,
    });

    expect(result).toMatchObject({ threadId: emptyThreadId, duplicate: false });
    const persisted = await f.t.run(async (ctx) => {
      const thread = await ctx.db.get(emptyThreadId);
      const messages = await ctx.db
        .query("operatorAgentMessages")
        .withIndex("thread", (index) => index.eq("threadId", emptyThreadId))
        .collect();
      const runs = await ctx.db
        .query("operatorAgentRuns")
        .withIndex("thread_status", (index) =>
          index.eq("threadId", emptyThreadId),
        )
        .collect();
      return { thread, messages, runs };
    });

    expect(persisted.thread).toMatchObject({
      title: "Investigate this policy",
      initialContext: pageContext,
    });
    expect(persisted.messages).toHaveLength(2);
    expect(persisted.messages[0]).toMatchObject({
      role: "user",
      toolArtifacts: [
        {
          type: "operator_intent",
          data: { id: "investigate_policy", version: 1 },
        },
      ],
    });
    expect(persisted.runs).toEqual([
      expect.objectContaining({
        status: "queued",
        executionKind: "goal",
        userMessageId: result.messageId,
      }),
    ]);
  });

  test("rejects unauthorized or out-of-context task launches", async () => {
    const f = await fixture();

    await expect(
      f.client.query(api.operatorAgent.listIntents, {}),
    ).rejects.toThrow();
    await expect(
      f.operator.mutation(api.operatorAgent.startIntent, {
        intentId: "prepare_certificate",
        pageContext: {
          pageType: "operator_client_wiki",
          entityId: "client-id",
        },
      }),
    ).rejects.toThrow("not available for this page");
    await expect(
      f.operator.mutation(api.operatorAgent.startIntent, {
        intentId: "prepare_certificate",
        pageContext: { pageType: "policy" },
      }),
    ).rejects.toThrow("requires record context");
  });
});
