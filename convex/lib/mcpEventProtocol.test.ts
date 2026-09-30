import { describe, expect, test } from "vitest";
import {
  canonicalMcpEventArguments,
  McpEventProtocolError,
  mcpEventRefreshBefore,
  mcpEventSubscriptionIdentity,
  parseMcpEventRequest,
} from "./mcpEventProtocol";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MINIMUM_TTL_MS = 60 * 1000;
const MAXIMUM_TTL_MS = 7 * DAY_MS;

const subscription = {
  name: "comment.created",
  arguments: { document_id: "doc_123", include: ["author", "body"] },
  delivery: {
    mode: "webhook" as const,
    url: "https://receiver.example.com/mcp-events/callback_123",
    secret: "whsec_test-secret",
  },
};

function expectProtocolError(callback: () => unknown) {
  expect(callback).toThrow(McpEventProtocolError);
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(McpEventProtocolError);
    expect((error as McpEventProtocolError).code).toBe(-32602);
  }
}

describe("canonicalMcpEventArguments", () => {
  test("sorts object keys recursively while preserving array order", () => {
    expect(
      canonicalMcpEventArguments({
        z: [{ b: 2, a: 1 }],
        a: { z: null, b: "value" },
      }),
    ).toBe('{"a":{"b":"value","z":null},"z":[{"a":1,"b":2}]}');

    expect(canonicalMcpEventArguments({ first: [1, 2] })).not.toBe(
      canonicalMcpEventArguments({ first: [2, 1] }),
    );
  });

  test("rejects values that are not JSON-safe", () => {
    const unsafeValues: unknown[] = [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      BigInt(1),
      () => "function",
      Symbol("symbol"),
      new Date("2026-01-01T00:00:00.000Z"),
      { nested: undefined },
    ];

    for (const value of unsafeValues) {
      expectProtocolError(() => canonicalMcpEventArguments({ value }));
    }

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expectProtocolError(() => canonicalMcpEventArguments(cyclic));
  });
});

describe("mcpEventSubscriptionIdentity", () => {
  test("is stable for repeated requests and object key order", async () => {
    const first = await mcpEventSubscriptionIdentity({
      principalKey: "tenant:user-1",
      name: subscription.name,
      arguments: { document_id: "doc_123", include: ["author", "body"] },
      url: subscription.delivery.url,
    });
    const reordered = await mcpEventSubscriptionIdentity({
      principalKey: "tenant:user-1",
      name: subscription.name,
      arguments: { include: ["author", "body"], document_id: "doc_123" },
      url: subscription.delivery.url,
    });

    expect(first).toMatch(/^sub_[0-9a-f]{64}$/);
    expect(reordered).toBe(first);
  });

  test("separates tenant/principal, event, filters, and callback URL", async () => {
    const base = {
      principalKey: "tenant:user-1",
      name: subscription.name,
      arguments: subscription.arguments,
      url: subscription.delivery.url,
    };
    const variants = [
      { ...base, principalKey: "tenant:user-2" },
      { ...base, name: "message.created" },
      { ...base, arguments: { document_id: "doc_456" } },
      { ...base, url: "https://other.example.com/callback" },
    ];
    const identities = await Promise.all([
      mcpEventSubscriptionIdentity(base),
      ...variants.map((variant) => mcpEventSubscriptionIdentity(variant)),
    ]);

    expect(new Set(identities).size).toBe(identities.length);
  });
});

describe("mcpEventRefreshBefore", () => {
  const nowMs = 1_800_000_000_000;

  test("uses the default, minimum, requested, and maximum lifetimes", () => {
    expect(mcpEventRefreshBefore(undefined, nowMs)).toBe(nowMs + DAY_MS);
    expect(mcpEventRefreshBefore(null, nowMs)).toBe(nowMs + MAXIMUM_TTL_MS);
    expect(mcpEventRefreshBefore(1, nowMs)).toBe(nowMs + MINIMUM_TTL_MS);
    expect(mcpEventRefreshBefore(MINIMUM_TTL_MS, nowMs)).toBe(nowMs + MINIMUM_TTL_MS);
    expect(mcpEventRefreshBefore(2 * DAY_MS, nowMs)).toBe(nowMs + 2 * DAY_MS);
    expect(mcpEventRefreshBefore(8 * DAY_MS, nowMs)).toBe(nowMs + MAXIMUM_TTL_MS);
  });

  test("rejects malformed TTLs and invalid dates", () => {
    for (const ttlMs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "60000", false, {}]) {
      expectProtocolError(() => mcpEventRefreshBefore(ttlMs, nowMs));
    }
    expectProtocolError(() => mcpEventRefreshBefore(undefined, Number.NaN));
  });
});

describe("parseMcpEventRequest", () => {
  test("accepts subscribe and unsubscribe protocol shapes", () => {
    expect(
      parseMcpEventRequest(
        {
          ...subscription,
          ttlMs: 120_000,
          cursor: null,
          _meta: { trace: "ignored-by-protocol-helper" },
        },
        "subscribe",
      ),
    ).toEqual({
      name: subscription.name,
      arguments: subscription.arguments,
      delivery: subscription.delivery,
      ttlMs: 120_000,
      cursor: null,
    });

    expect(
      parseMcpEventRequest(
        {
          name: subscription.name,
          arguments: subscription.arguments,
          delivery: {
            mode: "webhook",
            url: subscription.delivery.url,
          },
        },
        "unsubscribe",
      ),
    ).toEqual({
      name: subscription.name,
      arguments: subscription.arguments,
      delivery: {
        mode: "webhook",
        url: subscription.delivery.url,
      },
      cursor: null,
    });
  });

  test("rejects unsupported modes, replay cursors, and unknown fields", () => {
    expectProtocolError(() =>
      parseMcpEventRequest({ ...subscription, delivery: { ...subscription.delivery, mode: "polling" } }, "subscribe"),
    );
    expectProtocolError(() => parseMcpEventRequest({ ...subscription, cursor: "resume-token" }, "subscribe"));
    expectProtocolError(() => parseMcpEventRequest({ ...subscription, unexpected: true }, "subscribe"));
    expectProtocolError(() =>
      parseMcpEventRequest(
        { ...subscription, delivery: { ...subscription.delivery, extra: true } },
        "subscribe",
      ),
    );
  });

  test("rejects malformed and oversized parameters", () => {
    expectProtocolError(() => parseMcpEventRequest([], "subscribe"));
    expectProtocolError(() => parseMcpEventRequest({ ...subscription, name: "" }, "subscribe"));
    expectProtocolError(() => parseMcpEventRequest({ ...subscription, name: "n".repeat(257) }, "subscribe"));
    expectProtocolError(() =>
      parseMcpEventRequest({ ...subscription, arguments: { value: "x".repeat(8 * 1024) } }, "subscribe"),
    );
    expectProtocolError(() =>
      parseMcpEventRequest(
        { ...subscription, delivery: { ...subscription.delivery, url: `https://${"a".repeat(2045)}` } },
        "subscribe",
      ),
    );
    expectProtocolError(() => parseMcpEventRequest({ ...subscription, delivery: undefined }, "subscribe"));
    expectProtocolError(() =>
      parseMcpEventRequest({ ...subscription, delivery: { ...subscription.delivery, secret: "" } }, "subscribe"),
    );
    expectProtocolError(() => parseMcpEventRequest({ ...subscription, ttlMs: "forever" }, "subscribe"));
    expectProtocolError(() => parseMcpEventRequest({ ...subscription, arguments: [] }, "subscribe"));
    expectProtocolError(() => parseMcpEventRequest({ ...subscription, delivery: [] }, "subscribe"));
    expectProtocolError(() => parseMcpEventRequest({ ...subscription, delivery: { mode: "webhook" } }, "subscribe"));
    expectProtocolError(() =>
      parseMcpEventRequest({ ...subscription, delivery: { ...subscription.delivery, url: "http://insecure.test" } }, "subscribe"),
    );
  });
});
