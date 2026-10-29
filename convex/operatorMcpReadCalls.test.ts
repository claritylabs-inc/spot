/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("MCP read invocations accept the channel the HTTP route sends", async () => {
  const t = convexTest(schema, modules);
  const operatorUserId = await t.run((ctx) => ctx.db.insert("users", {}));
  const call = t.action(internal.operatorMcpReadCalls.invoke, {
    operatorUserId,
    conversationKey: "mcp:test",
    channel: "mcp",
    toolName: "get_platform_status",
    input: {},
    idempotencyKey: "mcp:test:1",
  });
  const error = await call.then(() => null, (e: unknown) => String(e));
  expect(error).not.toMatch(/channel/);
});
