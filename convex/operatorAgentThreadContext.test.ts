/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import dayjs from "dayjs";
import { expect, test } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("page context can be removed and replaced without changing the thread origin, and each message records its context", async () => {
  const t = convexTest(schema, modules);
  const operatorUserId = await t.run(async (ctx) => {
    const now = dayjs().valueOf();
    const userId = await ctx.db.insert("users", {
      name: "Operator",
      email: "operator@example.com",
      accountKind: "operator",
    });
    await ctx.db.insert("operatorProfiles", {
      userId,
      email: "operator@example.com",
      role: "operator",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    return userId;
  });
  const operator = t.withIdentity({ subject: `${operatorUserId}|session` });
  const origin = { pageType: "operator_brokers", summary: "Insurance providers" };
  const replacement = { pageType: "operator_channels", summary: "Agent channels" };

  const threadId = await operator.mutation(api.operatorAgent.createThread, {
    initialContext: origin,
  });
  const created = await operator.query(api.operatorAgent.getThread, { threadId });
  expect(created.thread).toMatchObject({ initialContext: origin, pageContext: origin });

  await operator.mutation(api.operatorAgent.clearThreadContext, { threadId });
  const cleared = await operator.query(api.operatorAgent.getThread, { threadId });
  expect(cleared.thread).toMatchObject({ initialContext: origin, pageContext: null });

  await operator.mutation(api.operatorAgent.sendMessage, {
    threadId,
    content: "Check this page",
    pageContext: replacement,
  });
  const reattached = await operator.query(api.operatorAgent.getThread, { threadId });
  expect(reattached.thread).toMatchObject({
    initialContext: origin,
    pageContext: replacement,
  });

  await operator.mutation(api.operatorAgent.clearThreadContext, { threadId });
  await operator.mutation(api.operatorAgent.sendMessage, {
    threadId,
    content: "Without a page",
  });
  const final = await operator.query(api.operatorAgent.getThread, { threadId });
  const userMessages = final.messages.filter((message) => message.role === "user");
  expect(userMessages.map((message) => message.pageContext)).toEqual([
    replacement,
    undefined,
  ]);
});
