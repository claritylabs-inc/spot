"use node";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import type { LookupFunction } from "node:net";
import * as https from "node:https";
import type { IncomingMessage, RequestOptions } from "node:http";
import dayjs from "dayjs";

const WEBHOOK_SECRET_PREFIX = "whsec_";
const MAX_EVENT_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

export type McpCallbackErrorReason =
  | "invalid_secret"
  | "invalid_url"
  | "dns_failed"
  | "private_address"
  | "network_error"
  | "timeout"
  | "redirect"
  | "request_too_large"
  | "response_too_large"
  | "challenge_failed"
  | "invalid_event";

export class McpCallbackError extends Error {
  readonly reason: McpCallbackErrorReason;

  constructor(reason: McpCallbackErrorReason) {
    super(`MCP callback ${reason}`);
    this.name = "McpCallbackError";
    this.reason = reason;
  }
}

const blockedAddresses = new BlockList();

for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedAddresses.addSubnet(address, prefix, "ipv4");
}

for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedAddresses.addSubnet(address, prefix, "ipv6");
}

function fail(reason: McpCallbackErrorReason): never {
  throw new McpCallbackError(reason);
}

function decodeWebhookSecret(secret: string): Buffer {
  if (!secret.startsWith(WEBHOOK_SECRET_PREFIX)) {
    fail("invalid_secret");
  }

  const encoded = secret.slice(WEBHOOK_SECRET_PREFIX.length);
  if (
    encoded.length === 0 ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  ) {
    fail("invalid_secret");
  }

  let decoded: Buffer;
  try {
    decoded = Buffer.from(encoded, "base64");
  } catch {
    fail("invalid_secret");
  }

  if (
    decoded.length < 24 ||
    decoded.length > 64 ||
    decoded.toString("base64") !== encoded
  ) {
    fail("invalid_secret");
  }
  return decoded;
}

export function validateMcpWebhookSecret(secret: string): void {
  if (typeof secret !== "string") {
    fail("invalid_secret");
  }
  decodeWebhookSecret(secret);
}

function withoutBrackets(hostname: string) {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function ipv6FirstHextet(address: string): number | undefined {
  const normalized = address.toLowerCase();
  if (normalized.includes(".")) return undefined;
  const sections = normalized.split("::");
  if (sections.length > 2) return undefined;
  const left = sections[0] ? sections[0].split(":") : [];
  const right = sections[1] ? sections[1].split(":") : [];
  const hextets = [...left, ...right];
  if (
    hextets.some(
      (hextet) =>
        !/^[0-9a-f]{1,4}$/.test(hextet) ||
        Number.parseInt(hextet, 16) < 0 ||
        Number.parseInt(hextet, 16) > 0xffff,
    )
  ) {
    return undefined;
  }
  if (sections.length === 1 && hextets.length !== 8) return undefined;
  if (sections.length === 2 && left.length + right.length >= 8) return undefined;
  return Number.parseInt(left[0] ?? "0", 16);
}

function isBlockedAddress(address: string): boolean {
  const normalized = withoutBrackets(address.toLowerCase());
  const family = isIP(normalized);
  if (family === 0) return true;
  if (family === 4) return blockedAddresses.check(normalized, "ipv4");

  const firstHextet = ipv6FirstHextet(normalized);
  if (firstHextet === undefined || firstHextet < 0x2000 || firstHextet > 0x3fff) {
    return true;
  }
  return blockedAddresses.check(normalized, "ipv6");
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = withoutBrackets(hostname.toLowerCase());
  if (isIP(normalized) !== 0) return isBlockedAddress(normalized);
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized === "metadata.google.internal"
  );
}

export function validateMcpWebhookUrl(url: string): string {
  if (typeof url !== "string" || /[\u0000-\u001f\u007f]/.test(url)) {
    fail("invalid_url");
  }

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    fail("invalid_url");
  }

  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    isBlockedHostname(parsed.hostname)
  ) {
    fail("invalid_url");
  }

  return parsed.toString();
}

type ResolvedAddress = { address: string; family: 4 | 6 };

async function resolveCallbackAddress(hostname: string): Promise<ResolvedAddress> {
  const normalizedHostname = withoutBrackets(hostname);
  const literalFamily = isIP(normalizedHostname);
  if (literalFamily === 4 || literalFamily === 6) {
    if (isBlockedAddress(normalizedHostname)) fail("private_address");
    return { address: normalizedHostname, family: literalFamily };
  }

  let answers: Array<{ address: string; family: number }>;
  try {
    answers = await dnsLookup(normalizedHostname, {
      all: true,
      verbatim: true,
    });
  } catch {
    fail("dns_failed");
  }

  if (
    answers.length === 0 ||
    answers.some(
      (answer) =>
        (answer.family !== 4 && answer.family !== 6) ||
        isIP(withoutBrackets(answer.address)) !== answer.family ||
        isBlockedAddress(answer.address),
    )
  ) {
    fail("private_address");
  }

  const first = answers[0];
  if (!first) fail("dns_failed");
  return {
    address: withoutBrackets(first.address),
    family: first.family as 4 | 6,
  };
}

function signedHeader(args: {
  eventId: string;
  timestamp: string;
  body: string;
  secret: string;
  previousSecret?: string;
}): string {
  const signedPayload = `${args.eventId}.${args.timestamp}.${args.body}`;
  const secrets = args.previousSecret
    ? [args.secret, args.previousSecret]
    : [args.secret];
  return secrets
    .map((secret) => {
      const digest = createHmac("sha256", decodeWebhookSecret(secret))
        .update(signedPayload, "utf8")
        .digest("base64");
      return `v1,${digest}`;
    })
    .join(" ");
}

function readResponse(response: IncomingMessage): Promise<Buffer> {
  const contentLength = response.headers["content-length"];
  if (typeof contentLength === "string") {
    const length = Number(contentLength);
    if (!Number.isFinite(length) || length < 0 || length > MAX_RESPONSE_BYTES) {
      response.destroy();
      fail("response_too_large");
    }
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    response.on("data", (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        response.destroy();
        reject(new McpCallbackError("response_too_large"));
        return;
      }
      chunks.push(bytes);
    });
    response.once("end", () => resolve(Buffer.concat(chunks)));
    response.once("error", reject);
  });
}

async function requestPinned(args: {
  normalizedUrl: string;
  headers: Record<string, string>;
  body: string;
}): Promise<{ status: number; body: Buffer }> {
  const parsed = new URL(args.normalizedUrl);
  const hostname = withoutBrackets(parsed.hostname);
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const operation = (async () => {
    const resolved = await resolveCallbackAddress(hostname);
    const lookup: LookupFunction = (_hostname, options, callback) => {
      if (options.all) {
        callback(null, [{ address: resolved.address, family: resolved.family }]);
      } else {
        callback(null, resolved.address, resolved.family);
      }
    };
    const requestOptions: RequestOptions = {
      protocol: "https:",
      hostname,
      port: parsed.port ? Number(parsed.port) : 443,
      path: `${parsed.pathname}${parsed.search}`,
      method: "POST",
      headers: {
        ...args.headers,
        "Content-Length": String(Buffer.byteLength(args.body, "utf8")),
      },
      lookup,
      ...(isIP(hostname) === 0 ? { servername: hostname } : {}),
      signal: controller.signal,
    };

    return await new Promise<{ status: number; body: Buffer }>((resolve, reject) => {
      let responseSeen = false;
      const request = https.request(requestOptions, (response) => {
        responseSeen = true;
        const status = response.statusCode ?? 0;
        Promise.resolve()
          .then(() => readResponse(response))
          .then((body) => resolve({ status, body }))
          .catch(reject);
      });
      request.once("error", (error) => {
        if (!responseSeen) reject(error);
      });
      request.end(args.body);
    });
  })();

  const deadline = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(new McpCallbackError("timeout"));
    }, REQUEST_TIMEOUT_MS);
  });

  try {
    return await Promise.race([operation, deadline]);
  } catch (error) {
    if (error instanceof McpCallbackError) throw error;
    throw new McpCallbackError("network_error");
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function constantTimeStringEqual(left: string, right: string): boolean {
  const leftDigest = createHmac("sha256", Buffer.alloc(0)).update(left, "utf8").digest();
  const rightDigest = createHmac("sha256", Buffer.alloc(0)).update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export async function verifyMcpWebhookCallback(args: {
  url: string;
  secret: string;
  subscriptionId: string;
}): Promise<void> {
  const normalizedUrl = validateMcpWebhookUrl(args.url);
  validateMcpWebhookSecret(args.secret);
  const challenge = randomBytes(32).toString("base64url");
  const body = JSON.stringify({ type: "verification", challenge });
  const timestamp = String(dayjs().unix());
  const webhookId = `msg_verification_${randomBytes(16).toString("hex")}`;
  const response = await requestPinned({
    normalizedUrl,
    headers: {
      "Content-Type": "application/json",
      "webhook-id": webhookId,
      "webhook-timestamp": timestamp,
      "webhook-signature": signedHeader({
        eventId: webhookId,
        timestamp,
        body,
        secret: args.secret,
      }),
      "X-MCP-Subscription-Id": args.subscriptionId,
    },
    body,
  });

  if (response.status >= 300 && response.status < 400) fail("redirect");
  if (response.status < 200 || response.status >= 300) fail("challenge_failed");

  let payload: unknown;
  try {
    payload = JSON.parse(response.body.toString("utf8"));
  } catch {
    fail("challenge_failed");
  }
  const echoedChallenge =
    typeof payload === "object" && payload !== null && "challenge" in payload
      ? (payload as { challenge?: unknown }).challenge
      : undefined;
  if (typeof echoedChallenge !== "string" || !constantTimeStringEqual(challenge, echoedChallenge)) {
    fail("challenge_failed");
  }
}

export async function sendMcpWebhookEvent(args: {
  url: string;
  secret: string;
  previousSecret?: string;
  subscriptionId: string;
  event: {
    eventId: string;
    name: string;
    timestamp: string;
    data: Record<string, unknown>;
    cursor: null;
  };
}): Promise<{ accepted: boolean; status: number }> {
  const normalizedUrl = validateMcpWebhookUrl(args.url);
  validateMcpWebhookSecret(args.secret);
  if (args.previousSecret !== undefined) {
    validateMcpWebhookSecret(args.previousSecret);
  }

  let body: string;
  try {
    const serialized = JSON.stringify(args.event);
    if (typeof serialized !== "string") fail("invalid_event");
    body = serialized;
  } catch {
    fail("invalid_event");
  }
  if (Buffer.byteLength(body, "utf8") > MAX_EVENT_BYTES) {
    fail("request_too_large");
  }

  const timestamp = String(dayjs().unix());
  const response = await requestPinned({
    normalizedUrl,
    headers: {
      "Content-Type": "application/json",
      "webhook-id": args.event.eventId,
      "webhook-timestamp": timestamp,
      "webhook-signature": signedHeader({
        eventId: args.event.eventId,
        timestamp,
        body,
        secret: args.secret,
        previousSecret: args.previousSecret,
      }),
      "X-MCP-Subscription-Id": args.subscriptionId,
    },
    body,
  });

  return {
    accepted: response.status >= 200 && response.status < 300,
    status: response.status,
  };
}
