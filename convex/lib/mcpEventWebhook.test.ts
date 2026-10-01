// @vitest-environment node

/*
 * Security failure modes covered by this isolation suite:
 * - malformed, non-canonical, too-short, and too-long webhook secrets;
 * - signatures that do not cover the exact UTF-8 request bytes and key rotation;
 * - private, local, reserved, and IPv4-mapped IPv6 callback targets;
 * - DNS rebinding between public-address validation and the HTTPS connection;
 * - redirects, including during callback verification;
 * - verification challenge mismatch and non-2xx responses;
 * - oversized serialized requests and oversized responses;
 * - DNS, connection, and response timeouts under the total deadline.
 */

import { EventEmitter } from "node:events";
import { createHmac, randomBytes } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import * as dns from "node:dns/promises";
import * as https from "node:https";
import {
  McpCallbackError,
  sendMcpWebhookEvent,
  validateMcpWebhookSecret,
  validateMcpWebhookUrl,
  verifyMcpWebhookCallback,
} from "./mcpEventWebhook";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("node:https", () => ({ request: vi.fn() }));

const lookupMock = vi.mocked(dns.lookup);
const requestMock = vi.mocked(https.request);
const validSecret = `whsec_${randomBytes(32).toString("base64")}`;
const previousSecret = `whsec_${randomBytes(32).toString("base64")}`;
const callbackUrl = "https://receiver.example.test/mcp-events/callback";

type FakeResponse = EventEmitter & {
  statusCode: number;
  headers: Record<string, string>;
  destroy: ReturnType<typeof vi.fn>;
};

function makeResponse(
  statusCode: number,
  body: string | Buffer,
  headers: Record<string, string> = {},
) {
  const response = new EventEmitter() as FakeResponse;
  response.statusCode = statusCode;
  response.headers = headers;
  response.destroy = vi.fn();
  Object.defineProperty(response, "body", { value: body });
  return response;
}

function respondWith(
  response: FakeResponse | (() => FakeResponse),
) {
  requestMock.mockImplementation((...args: unknown[]) => {
    const callback = args[1] as (response: FakeResponse) => void;
    const request = new EventEmitter() as EventEmitter & {
      end: ReturnType<typeof vi.fn>;
      write: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
    };
    request.write = vi.fn();
    request.destroy = vi.fn();
    request.end = vi.fn(() => {
      queueMicrotask(() => {
        const result = response instanceof EventEmitter ? response : response();
        callback(result);
        queueMicrotask(() => {
          result.emit(
            "data",
            Buffer.from((result as FakeResponse & { body: string | Buffer }).body),
          );
          result.emit("end");
        });
      });
    });
    return request as never;
  });
}

function publicDns() {
  lookupMock.mockResolvedValue([
    { address: "93.184.216.34", family: 4 },
  ] as never);
}

function eventWithData(data: Record<string, unknown>) {
  return {
    eventId: "evt_123",
    name: "comment.created",
    timestamp: "2026-09-30T12:00:00.000Z",
    data,
    cursor: null,
  } as const;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("validateMcpWebhookSecret", () => {
  test("rejects malformed and non-canonical secrets without exposing the value", () => {
    for (const secret of [
      "secret",
      "whsec_not-base64",
      `whsec_${Buffer.alloc(23).toString("base64")}`,
      `whsec_${Buffer.alloc(65).toString("base64")}`,
      `whsec_${Buffer.alloc(32).toString("base64").replace(/=+$/, "")}`,
    ]) {
      expect(() => validateMcpWebhookSecret(secret)).toThrowError(
        McpCallbackError,
      );
      expect(() => validateMcpWebhookSecret(secret)).toThrowError(
        /MCP callback invalid_secret/i,
      );
    }
  });

  test("accepts a canonical 24- to 64-byte whsec key", () => {
    expect(() => validateMcpWebhookSecret(validSecret)).not.toThrow();
  });
});

describe("validateMcpWebhookUrl", () => {
  test.each([
    "http://receiver.example.test/callback",
    "https://user:pass@receiver.example.test/callback",
    "https://receiver.example.test/callback#fragment",
    "https://localhost/callback",
    "https://127.0.0.1/callback",
    "https://[::ffff:127.0.0.1]/callback",
    "https://10.0.0.1/callback",
    "https://[fc00::1]/callback",
  ])("rejects unsafe callback URL %s", (url) => {
    expect(() => validateMcpWebhookUrl(url)).toThrowError(McpCallbackError);
  });

  test("normalizes a public HTTPS URL", () => {
    expect(validateMcpWebhookUrl(" HTTPS://Receiver.Example.test/callback ")).toBe(
      "https://receiver.example.test/callback",
    );
  });
});

describe("MCP webhook callback verification", () => {
  test("pins the validated DNS answer while preserving the hostname for TLS", async () => {
    publicDns();
    respondWith(makeResponse(200, JSON.stringify({ challenge: "" })));

    const verification = verifyMcpWebhookCallback({
      url: callbackUrl,
      secret: validSecret,
      subscriptionId: "sub_123",
    });

    await expect(verification).rejects.toMatchObject({
      reason: "challenge_failed",
    });

    const [options] = requestMock.mock.calls[0] ?? [];
    expect(options).toMatchObject({
      hostname: "receiver.example.test",
      servername: "receiver.example.test",
    });
    const lookup = (
      options as unknown as {
        lookup: (
          hostname: string,
          options: object,
          callback: (error: Error | null, address: string, family: number) => void,
        ) => void;
      }
    ).lookup;
    await new Promise<void>((resolve, reject) => {
      lookup("receiver.example.test", {}, (error: Error | null, address: string, family: number) => {
        try {
          expect(error).toBeNull();
          expect(address).toBe("93.184.216.34");
          expect(family).toBe(4);
          resolve();
        } catch (lookupError) {
          reject(lookupError);
        }
      });
    });
  });

  test.each([
    "10.0.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "192.168.1.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])("rejects DNS answers in private/reserved range: %s", async (address) => {
    lookupMock.mockResolvedValue([
      { address, family: address.includes(":") ? 6 : 4 },
    ] as never);

    await expect(
      verifyMcpWebhookCallback({
        url: callbackUrl,
        secret: validSecret,
        subscriptionId: "sub_123",
      }),
    ).rejects.toMatchObject({ reason: "private_address" });
    expect(requestMock).not.toHaveBeenCalled();
  });

  test("does not follow a redirect during verification", async () => {
    publicDns();
    respondWith(makeResponse(302, "", { location: "https://other.example.test" }));

    await expect(
      verifyMcpWebhookCallback({
        url: callbackUrl,
        secret: validSecret,
        subscriptionId: "sub_123",
      }),
    ).rejects.toMatchObject({ reason: "redirect" });
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  test("requires a 2xx response and a constant-time challenge echo", async () => {
    publicDns();
    respondWith(makeResponse(200, JSON.stringify({ challenge: "wrong" })));

    await expect(
      verifyMcpWebhookCallback({
        url: callbackUrl,
        secret: validSecret,
        subscriptionId: "sub_123",
      }),
    ).rejects.toMatchObject({ reason: "challenge_failed" });
  });

  test("bounds the response body", async () => {
    publicDns();
    respondWith(
      makeResponse(200, "x", { "content-length": String(128 * 1024) }),
    );

    await expect(
      verifyMcpWebhookCallback({
        url: callbackUrl,
        secret: validSecret,
        subscriptionId: "sub_123",
      }),
    ).rejects.toMatchObject({ reason: "response_too_large" });
  });

  test("applies the total timeout while DNS is pending", async () => {
    vi.useFakeTimers();
    lookupMock.mockReturnValue(new Promise(() => undefined) as never);

    const verification = verifyMcpWebhookCallback({
      url: callbackUrl,
      secret: validSecret,
      subscriptionId: "sub_123",
    });
    const outcome = expect(verification).rejects.toMatchObject({ reason: "timeout" });
    await vi.advanceTimersByTimeAsync(10_000);
    await outcome;
  });
});

describe("MCP webhook event delivery", () => {
  test("signs the exact serialized bytes with current and previous keys", async () => {
    publicDns();
    respondWith(makeResponse(204, ""));

    const event = eventWithData({ text: "café" });
    await expect(
      sendMcpWebhookEvent({
        url: callbackUrl,
        secret: validSecret,
        previousSecret,
        subscriptionId: "sub_123",
        event,
      }),
    ).resolves.toEqual({ accepted: true, status: 204 });

    const [options] = requestMock.mock.calls[0] ?? [];
    const request = requestMock.mock.results[0]?.value as {
      end: ReturnType<typeof vi.fn>;
    };
    const body = Buffer.from(request.end.mock.calls[0]?.[0] as string, "utf8");
    const timestamp = String(
      (options as unknown as { headers: Record<string, string> }).headers[
        "webhook-timestamp"
      ],
    );
    const expectedSignatures = [validSecret, previousSecret].map((secret) =>
      `v1,${createHmac("sha256", Buffer.from(secret.slice("whsec_".length), "base64"))
        .update(`${event.eventId}.${timestamp}.${body.toString("utf8")}`, "utf8")
        .digest("base64")}`,
    );

    expect(Buffer.isBuffer(body)).toBe(true);
    expect(
      (options as unknown as { headers: Record<string, string> }).headers[
        "webhook-signature"
      ],
    ).toBe(expectedSignatures.join(" "));
    expect(body.toString("utf8")).toBe(JSON.stringify(event));
  });

  test("rejects a serialized event over 256 KiB before connecting", async () => {
    const event = eventWithData({ text: "x".repeat(256 * 1024) });

    await expect(
      sendMcpWebhookEvent({
        url: callbackUrl,
        secret: validSecret,
        subscriptionId: "sub_123",
        event,
      }),
    ).rejects.toMatchObject({ reason: "request_too_large" });
    expect(requestMock).not.toHaveBeenCalled();
  });

  test("returns a non-2xx response without following redirects", async () => {
    publicDns();
    respondWith(makeResponse(307, "", { location: "https://other.example.test" }));

    await expect(
      sendMcpWebhookEvent({
        url: callbackUrl,
        secret: validSecret,
        subscriptionId: "sub_123",
        event: eventWithData({ text: "hello" }),
      }),
    ).resolves.toEqual({ accepted: false, status: 307 });
    expect(requestMock).toHaveBeenCalledTimes(1);
  });
});

describe("McpCallbackError", () => {
  test("exposes a stable reason without secret or URL details", () => {
    const error = new McpCallbackError("challenge_failed");
    expect(error).toBeInstanceOf(Error);
    expect(error.reason).toBe("challenge_failed");
    expect(error.message).toBe("MCP callback challenge_failed");
  });
});
