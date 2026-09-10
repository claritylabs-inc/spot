/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("reads paginated owned and shared operator conversations, preserving full messages and enforcing current visibility on replay", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = dayjs().valueOf();
    const owner = await ctx.db.insert("users", {
      email: "operator@example.com",
      accountKind: "operator",
    });
    const other = await ctx.db.insert("users", {
      email: "other@example.com",
      accountKind: "operator",
    });
    const profileId = await ctx.db.insert("operatorProfiles", {
      userId: owner,
      email: "operator@example.com",
      role: "operator",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const makeThread = (
      ownerUserId: Id<"users">,
      title: string,
      visibility: "private" | "shared",
      archived = false,
    ) =>
      ctx.db.insert("operatorAgentThreads", {
        ownerUserId,
        title,
        visibility,
        channel: "chat",
        archivedAt: archived ? now : undefined,
        archiveState: archived ? "archived" : undefined,
        lastMessageAt: now,
        createdAt: now,
        updatedAt: now,
      });
    const own = await makeThread(
      owner,
      "Earlier own research",
      "private",
      true,
    );
    const shared = await makeThread(
      other,
      "Shared market research",
      "shared",
      true,
    );
    const privateThread = await makeThread(
      other,
      "Other private research",
      "private",
      true,
    );
    for (const threadId of [own, shared, privateThread]) {
      for (const content of [
        "First research result",
        "Evidence ".repeat(1500),
        "Latest research result",
      ]) {
        await ctx.db.insert("operatorAgentMessages", {
          threadId,
          ownerUserId: threadId === own ? owner : other,
          channel: "chat",
          role: "user",
          content,
          userName: "Researcher",
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    return { owner, profileId, own, shared, privateThread };
  });
  const threadId = await t
    .withIdentity({ subject: `${ids.owner}|session` })
    .mutation(api.operatorAgent.createThread, {});
  const invoke = (
    toolName: string,
    input: Record<string, unknown>,
    key: string,
  ) =>
    t.action(internal.operatorAgent.invokeRegisteredToolInternal, {
      operatorUserId: ids.owner,
      threadId,
      channel: "mcp",
      toolName,
      input,
      idempotencyKey: key,
    });
  const owned = await invoke(
    "list_operator_conversations",
    { scope: "owned", archived: true },
    "owned",
  );
  expect(owned.outcome).toMatchObject({
    status: "succeeded",
    result: { conversations: [{ threadId: ids.own }] },
  });
  const shared = await invoke(
    "list_operator_conversations",
    { scope: "shared", archived: true },
    "shared",
  );
  expect(shared.outcome).toMatchObject({
    status: "succeeded",
    result: { conversations: [{ threadId: ids.shared }] },
  });
  const first = await invoke(
    "read_operator_conversation",
    { operatorThreadId: ids.shared, limit: 1 },
    "read-first",
  );
  if (first.outcome.status !== "succeeded")
    throw new Error("Expected shared conversation");
  const firstPage = first.outcome.result as {
    messages: Array<{ content: string }>;
    nextCursor: string;
  };
  expect(firstPage.messages[0].content).toBe("Latest research result");
  const second = await invoke(
    "read_operator_conversation",
    { operatorThreadId: ids.shared, limit: 1, cursor: firstPage.nextCursor },
    "read-second",
  );
  if (second.outcome.status !== "succeeded")
    throw new Error("Expected older message");
  const secondPage = second.outcome.result as {
    messages: Array<{ content: string }>;
  };
  expect(secondPage.messages[0].content).toHaveLength(13_500);
  const replay = await invoke(
    "read_operator_conversation",
    { operatorThreadId: ids.shared, limit: 1, cursor: firstPage.nextCursor },
    "read-second",
  );
  expect(replay.outcome).toMatchObject({
    status: "succeeded",
    result: second.outcome.result,
  });
  expect(
    (
      await invoke(
        "read_operator_conversation",
        { operatorThreadId: ids.privateThread },
        "private",
      )
    ).outcome.status,
  ).toBe("failed");
  await t.run((ctx) => ctx.db.patch(ids.shared, { visibility: "private" }));
  await expect(
    invoke(
      "read_operator_conversation",
      { operatorThreadId: ids.shared, limit: 1 },
      "read-first",
    ),
  ).rejects.toThrow(/not found/);
  const hidden = await invoke(
    "list_operator_conversations",
    { scope: "shared", archived: true },
    "shared",
  );
  expect(hidden.outcome).toMatchObject({
    status: "succeeded",
    result: { conversations: [] },
  });
  expect((await t.run((ctx) => ctx.db.get(threadId)))?.channel).toBe("chat");
  await t.run((ctx) => ctx.db.patch(ids.profileId, { status: "disabled" }));
  await expect(
    invoke(
      "read_operator_conversation",
      { operatorThreadId: ids.own },
      "disabled",
    ),
  ).rejects.toThrow();
});
