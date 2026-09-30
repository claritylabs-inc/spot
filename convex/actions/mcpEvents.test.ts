import { afterEach, expect, test, vi } from "vitest";
import { ConvexError } from "convex/values";
import type { ActionCtx } from "../_generated/server";
import { handleMcpEventRequest } from "../lib/mcpEventHttp";
import { decryptMcpEventSecret, encryptMcpEventSecret } from "./mcpEvents";

const previousKey = process.env.MCP_EVENTS_ENCRYPTION_KEY;
afterEach(() => {
  if (previousKey === undefined) delete process.env.MCP_EVENTS_ENCRYPTION_KEY;
  else process.env.MCP_EVENTS_ENCRYPTION_KEY = previousKey;
});

test("encrypted callback secrets require a dedicated canonical 32-byte key", () => {
  delete process.env.MCP_EVENTS_ENCRYPTION_KEY;
  expect(() => encryptMcpEventSecret("secret", "sub_one")).toThrow();
  process.env.MCP_EVENTS_ENCRYPTION_KEY = "invalid";
  expect(() => encryptMcpEventSecret("secret", "sub_one")).toThrow();
  process.env.MCP_EVENTS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  const encrypted = encryptMcpEventSecret("secret", "sub_one");
  expect(encrypted).not.toContain("secret");
  expect(decryptMcpEventSecret(encrypted, "sub_one")).toBe("secret");
});

test("encryption authenticates the subscription identity and rejects tampering", () => {
  process.env.MCP_EVENTS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  const encrypted = encryptMcpEventSecret("secret", "sub_one");
  expect(() => decryptMcpEventSecret(encrypted, "sub_two")).toThrow();
  const bytes = Buffer.from(encrypted, "base64");
  bytes[bytes.length - 1] ^= 1;
  expect(() => decryptMcpEventSecret(bytes.toString("base64"), "sub_one")).toThrow();
});

test("callback verification errors preserve the protocol code and safe reason", async () => {
  const ctx: Pick<ActionCtx, "runQuery" | "runMutation" | "runAction" | "storage"> = {
    runAction: async () => { throw new ConvexError({ code: -32015, reason: "timeout" }); },
    runQuery: vi.fn(),
    runMutation: vi.fn(),
    storage: { get: vi.fn(), getUrl: vi.fn(), getMetadata: vi.fn(), store: vi.fn(), delete: vi.fn(), generateUploadUrl: vi.fn() },
  };
  await expect(handleMcpEventRequest(ctx, { principalKind: "organization", userId: "user", orgId: "org" }, "events/subscribe", {
    name: "policy.ready", arguments: {}, delivery: { mode: "webhook", url: "https://receiver.example/callback", secret: `whsec_${Buffer.alloc(32, 7).toString("base64")}` },
  })).rejects.toMatchObject({ code: -32015, data: { kind: "callback", reason: "timeout" } });
});
