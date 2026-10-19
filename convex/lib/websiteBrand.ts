"use node";

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";
import { convertIndexedToRgb, decode } from "fast-png";
import { Agent, fetch as undiciFetch } from "undici";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { CarrierIdentityAccentColorSource } from "./carrierIdentity";

const USER_AGENT = "Mozilla/5.0 (compatible; SpotBot/1.0)";
const MAX_HTML_BYTES = 1_000_000;
const MAX_STYLESHEET_BYTES = 750_000;
const MAX_IMAGE_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const MAX_COLOR_CANDIDATES = 8;
const MAX_STYLESHEETS = 2;
const ICON_SAMPLE_SIZE = 64;
const ICON_COLOR_BUCKET_SIZE = 16;
const MAX_PNG_DIMENSION = 2_048;
const MAX_PNG_PIXELS = 1_048_576;
const MAX_ICO_ENTRIES = 64;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

type WebsiteBrandSignals = {
  website: string;
  title?: string;
  siteName?: string;
  identityEvidence?: string;
  primaryColor?: string;
  primaryColorSource?: CarrierIdentityAccentColorSource;
  colorCandidates: string[];
};

type WebsiteBrandColorSignal = {
  color: string;
  source: CarrierIdentityAccentColorSource;
};

function isPublicIpv4(hostname: string) {
  const parts = hostname.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) =>
      !Number.isInteger(part) || part < 0 || part > 255
    )
  ) {
    return false;
  }
  const [a, b, c] = parts;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function unbracketHostname(hostname: string) {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function parseIpv6Hextets(hostname: string) {
  if (hostname.includes(".")) return undefined;
  const halves = hostname.toLowerCase().split("::");
  if (halves.length > 2) return undefined;
  const parseHalf = (value: string) =>
    value
      ? value.split(":").map((part) => Number.parseInt(part, 16))
      : [];
  const left = parseHalf(halves[0]);
  const right = parseHalf(halves[1] ?? "");
  if (
    [...left, ...right].some((part) =>
      !Number.isInteger(part) || part < 0 || part > 0xffff
    )
  ) {
    return undefined;
  }
  if (halves.length === 1) {
    return left.length === 8 ? left : undefined;
  }
  const omitted = 8 - left.length - right.length;
  return omitted > 0
    ? [...left, ...Array<number>(omitted).fill(0), ...right]
    : undefined;
}

function isPublicIpv6(hostname: string) {
  const hextets = parseIpv6Hextets(hostname);
  if (!hextets) return false;
  const [first, second] = hextets;
  if (first < 0x2000 || first > 0x3fff) return false;
  const first32 = (first * 0x10000 + second) >>> 0;
  if (
    (first32 >= 0x20010000 && first32 <= 0x200101ff) ||
    first32 === 0x20010db8 ||
    first === 0x2002 ||
    (first === 0x3fff && (second & 0xf000) === 0)
  ) {
    return false;
  }
  return true;
}

export function normalizePublicWebsiteUrl(rawUrl: string) {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const parsed = new URL(withProtocol);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only public http(s) websites are supported");
  }
  const hostname = unbracketHostname(parsed.hostname.toLowerCase());
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "metadata.google.internal"
  ) {
    throw new Error("Local and metadata websites are not supported");
  }
  const ipVersion = isIP(hostname);
  if (
    (ipVersion === 4 && !isPublicIpv4(hostname)) ||
    (ipVersion === 6 && !isPublicIpv6(hostname))
  ) {
    throw new Error("Private network websites are not supported");
  }
  parsed.hash = "";
  return parsed.toString();
}

type DnsAddress = {
  address: string;
  family: number;
};

type DnsResolver = (hostname: string) => Promise<DnsAddress[]>;
type PublicResponse =
  | Response
  | Awaited<ReturnType<typeof undiciFetch>>;

const resolveDnsAddresses: DnsResolver = async (hostname) =>
  await dnsLookup(hostname, {
    all: true,
    order: "verbatim",
  });

function isPublicIpAddress(address: string) {
  const normalized = unbracketHostname(address.toLowerCase());
  const version = isIP(normalized);
  return version === 4
    ? isPublicIpv4(normalized)
    : version === 6 && isPublicIpv6(normalized);
}

export async function resolvePublicAddress(
  hostname: string,
  resolver: DnsResolver = resolveDnsAddresses,
) {
  const normalized = unbracketHostname(hostname.toLowerCase());
  const literalFamily = isIP(normalized);
  if (literalFamily) {
    if (!isPublicIpAddress(normalized)) {
      throw new Error("Private network websites are not supported");
    }
    return { address: normalized, family: literalFamily };
  }

  const addresses = await resolver(normalized);
  if (
    addresses.length === 0 ||
    addresses.some((answer) => !isPublicIpAddress(answer.address))
  ) {
    throw new Error("Private network websites are not supported");
  }
  return addresses[0];
}

const responseDispatchers = new WeakMap<object, Agent>();

async function releaseResponseDispatcher(response: PublicResponse) {
  const dispatcher = responseDispatchers.get(response);
  if (!dispatcher) return;
  responseDispatchers.delete(response);
  await dispatcher.close();
}

async function discardPublicResponse(response: PublicResponse) {
  try {
    await response.body?.cancel();
  } finally {
    await releaseResponseDispatcher(response);
  }
}

async function fetchPinned(url: string) {
  const hostname = unbracketHostname(new URL(url).hostname);
  const address = await resolvePublicAddress(hostname);
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    callback(
      null,
      options.all ? [address] : address.address,
      options.all ? undefined : address.family,
    );
  };
  const dispatcher = new Agent({
    connect: { lookup: pinnedLookup },
    connectTimeout: 10_000,
    headersTimeout: 30_000,
    bodyTimeout: 30_000,
    pipelining: 0,
  });
  try {
    const response = await undiciFetch(url, {
      redirect: "manual",
      headers: {
        "User-Agent": USER_AGENT,
      },
      dispatcher,
    });
    responseDispatchers.set(response, dispatcher);
    return response;
  } catch (error) {
    await dispatcher.close();
    throw error;
  }
}

async function fetchPublic(
  rawUrl: string,
  redirectsRemaining = MAX_REDIRECTS,
): Promise<PublicResponse> {
  const url = normalizePublicWebsiteUrl(rawUrl);
  const response = await fetchPinned(url);
  if (response.status < 300 || response.status >= 400) return response;
  const location = response.headers.get("location");
  if (!location || redirectsRemaining <= 0) {
    await discardPublicResponse(response);
    throw new Error("Website redirected too many times");
  }
  await discardPublicResponse(response);
  return await fetchPublic(
    new URL(location, url).toString(),
    redirectsRemaining - 1,
  );
}

function normalizedHex(value: string) {
  const hex = value.trim().toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(hex)) return hex;
  if (/^#[0-9A-F]{3}$/.test(hex)) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return null;
}

function isUsefulBrandColor(hex: string) {
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
  const luminance = (red * 0.299 + green * 0.587 + blue * 0.114) / 255;
  return spread >= 24 && luminance >= 0.12 && luminance <= 0.88;
}

function extractWebsiteBrandColorSignals(
  content: string,
  source: "html" | "stylesheet",
): WebsiteBrandColorSignal[] {
  const priorityColors: string[] = [];
  if (source === "html") {
    const metaMatches = content.matchAll(
      /<meta[^>]+(?:name|property)=["'](?:theme-color|msapplication-TileColor)["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
    );
    for (const match of metaMatches) priorityColors.push(match[1]);
    const reverseMetaMatches = content.matchAll(
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:theme-color|msapplication-TileColor)["'][^>]*>/gi,
    );
    for (const match of reverseMetaMatches) priorityColors.push(match[1]);
  }

  const counts = new Map<string, number>();
  for (const match of content.matchAll(/#[0-9a-f]{3}(?:[0-9a-f]{3})?\b/gi)) {
    const color = normalizedHex(match[0]);
    if (!color || !isUsefulBrandColor(color)) continue;
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }

  const signals = [
    ...priorityColors.map((color) => ({
      color,
      source: "theme_meta" as const,
    })),
    ...Array.from(counts.entries())
      .sort((left, right) => right[1] - left[1])
      .map(([color]) => ({ color, source })),
  ];
  const seen = new Set<string>();
  return signals.flatMap((signal): WebsiteBrandColorSignal[] => {
    const color = normalizedHex(signal.color);
    if (!color || !isUsefulBrandColor(color) || seen.has(color)) return [];
    seen.add(color);
    return [{ color, source: signal.source }];
  }).slice(0, MAX_COLOR_CANDIDATES);
}

export function extractWebsiteBrandColors(html: string) {
  return extractWebsiteBrandColorSignals(html, "html").map(
    (signal) => signal.color,
  );
}

export function hasSafePngDimensions(bytes: Uint8Array) {
  if (bytes.byteLength < 24) return false;
  if (!PNG_SIGNATURE.every((value, index) => bytes[index] === value)) {
    return false;
  }
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  const isHeader =
    view.getUint32(8) === 13 &&
    bytes[12] === 73 &&
    bytes[13] === 72 &&
    bytes[14] === 68 &&
    bytes[15] === 82;
  if (!isHeader) return false;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return (
    width > 0 &&
    height > 0 &&
    width <= MAX_PNG_DIMENSION &&
    height <= MAX_PNG_DIMENSION &&
    width * height <= MAX_PNG_PIXELS
  );
}

function startsWithPngSignature(bytes: Uint8Array) {
  return PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

function hasSafeIconArea(width: number, height: number) {
  return (
    width > 0 &&
    height > 0 &&
    width <= MAX_PNG_DIMENSION &&
    height <= MAX_PNG_DIMENSION &&
    width * height <= MAX_PNG_PIXELS
  );
}

export function hasSafeFaviconDimensions(bytes: Uint8Array) {
  if (startsWithPngSignature(bytes)) return hasSafePngDimensions(bytes);
  if (bytes.byteLength < 22) return false;
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  const entryCount = view.getUint16(4, true);
  if (
    view.getUint16(0, true) !== 0 ||
    view.getUint16(2, true) !== 1 ||
    entryCount === 0 ||
    entryCount > MAX_ICO_ENTRIES ||
    6 + entryCount * 16 > bytes.byteLength
  ) {
    return false;
  }

  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = 6 + index * 16;
    const declaredWidth = bytes[entryOffset] || 256;
    const declaredHeight = bytes[entryOffset + 1] || 256;
    const byteLength = view.getUint32(entryOffset + 8, true);
    const imageOffset = view.getUint32(entryOffset + 12, true);
    if (
      !hasSafeIconArea(declaredWidth, declaredHeight) ||
      byteLength === 0 ||
      imageOffset + byteLength > bytes.byteLength
    ) {
      return false;
    }

    const image = bytes.subarray(imageOffset, imageOffset + byteLength);
    if (startsWithPngSignature(image)) {
      if (!hasSafePngDimensions(image)) return false;
      continue;
    }
    if (image.byteLength < 12) return false;
    const imageView = new DataView(
      image.buffer,
      image.byteOffset,
      image.byteLength,
    );
    const headerSize = imageView.getUint32(0, true);
    const width = headerSize === 12
      ? imageView.getUint16(4, true)
      : headerSize >= 40 && image.byteLength >= 40
        ? Math.abs(imageView.getInt32(4, true))
        : 0;
    const storedHeight = headerSize === 12
      ? imageView.getUint16(6, true)
      : headerSize >= 40 && image.byteLength >= 40
        ? Math.abs(imageView.getInt32(8, true))
        : 0;
    const height = storedHeight % 2 === 0
      ? storedHeight / 2
      : storedHeight;
    if (!hasSafeIconArea(width, height)) return false;
  }
  return true;
}

function safeFaviconMimeType(bytes: Uint8Array) {
  if (!hasSafeFaviconDimensions(bytes)) return undefined;
  return startsWithPngSignature(bytes) ? "image/png" : "image/x-icon";
}

export async function extractImageBrandColors(input: Uint8Array | ArrayBuffer) {
  try {
    const bytes =
      input instanceof ArrayBuffer ? new Uint8Array(input) : input;
    const svgText = new TextDecoder().decode(bytes.subarray(0, 8_192));
    if (/<svg[\s>]/i.test(svgText)) {
      return extractWebsiteBrandColors(svgText).slice(0, 4);
    }

    const pngOffset = bytes.findIndex((_, index) =>
      PNG_SIGNATURE.every((value, offset) => bytes[index + offset] === value),
    );
    if (pngOffset < 0) return [];

    const pngBytes = bytes.subarray(pngOffset);
    if (!hasSafePngDimensions(pngBytes)) return [];
    const decoded = decode(pngBytes);
    const data = decoded.palette
      ? convertIndexedToRgb(decoded)
      : decoded.data;
    const channels = decoded.palette?.[0]?.length ?? decoded.channels;
    if (channels < 3) return [];
    const maxChannelValue = decoded.depth === 16 ? 65_535 : 255;
    const totalPixels = decoded.width * decoded.height;
    const sampleStep = Math.max(
      1,
      Math.ceil(totalPixels / ICON_SAMPLE_SIZE ** 2),
    );
    const buckets = new Map<
      string,
      { red: number; green: number; blue: number; count: number }
    >();
    for (
      let pixelIndex = 0;
      pixelIndex < totalPixels;
      pixelIndex += sampleStep
    ) {
      const index = pixelIndex * channels;
      const channel = (offset: number) =>
        Math.round((data[index + offset] / maxChannelValue) * 255);
      const red = channel(0);
      const green = channel(1);
      const blue = channel(2);
      const alpha = channels === 4 ? channel(3) : 255;
      if (alpha < 128) continue;
      const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
      const luminance = (red * 0.299 + green * 0.587 + blue * 0.114) / 255;
      if (spread < 28 || luminance < 0.07 || luminance > 0.92) continue;
      const key = [red, green, blue]
        .map((channel) =>
          Math.min(
            255,
            Math.round(channel / ICON_COLOR_BUCKET_SIZE) *
              ICON_COLOR_BUCKET_SIZE,
          ),
        )
        .join("-");
      const bucket = buckets.get(key) ?? {
        red: 0,
        green: 0,
        blue: 0,
        count: 0,
      };
      bucket.red += red;
      bucket.green += green;
      bucket.blue += blue;
      bucket.count += 1;
      buckets.set(key, bucket);
    }
    return Array.from(buckets.values())
      .sort((left, right) => right.count - left.count)
      .slice(0, 4)
      .map((bucket) => {
        const channel = (value: number) =>
          Math.round(value / bucket.count)
            .toString(16)
            .padStart(2, "0")
            .toUpperCase();
        return `#${channel(bucket.red)}${channel(bucket.green)}${channel(bucket.blue)}`;
      });
  } catch {
    return [];
  }
}

function extractTitle(html: string) {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1]?.replace(/\s+/g, " ").trim().slice(0, 160) || undefined;
}

export function extractWebsiteSiteName(html: string) {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const key = tag.match(/\b(?:name|property)=["']([^"']+)["']/i)?.[1];
    if (!key || !/^(?:og:site_name|application-name)$/i.test(key)) continue;
    const content = tag.match(/\bcontent=["']([^"']+)["']/i)?.[1];
    const siteName = content?.replace(/\s+/g, " ").trim().slice(0, 120);
    if (siteName) return siteName;
  }
  return undefined;
}

export function extractWebsiteIdentityEvidence(html: string) {
  const text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  const snippets: string[] = [];
  const relationship =
    /\b(?:trading name|doing business as|d\s*[/.-]\s*b\s*[/.-]\s*a|dba|operating as|operates under|managed by|on behalf of|parent company|subsidiary of|part of|member of)\b/gi;
  for (const match of text.matchAll(relationship)) {
    const start = Math.max(0, (match.index ?? 0) - 240);
    const end = Math.min(text.length, (match.index ?? 0) + 440);
    snippets.push(text.slice(start, end).trim());
    if (snippets.length >= 4) break;
  }
  return snippets.length > 0
    ? Array.from(new Set(snippets)).join("\n").slice(0, 2_400)
    : undefined;
}

function extractIconCandidates(html: string, website: string) {
  const candidates: string[] = [];
  for (const match of html.matchAll(
    /<link[^>]+rel=["']([^"']*icon[^"']*)["'][^>]*href=["']([^"']+)["']/gi,
  )) {
    candidates.push(match[2]);
  }
  for (const match of html.matchAll(
    /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']([^"']*icon[^"']*)["']/gi,
  )) {
    candidates.push(match[1]);
  }
  candidates.push("/apple-touch-icon.png", "/favicon.ico");
  const hostname = new URL(website).hostname;
  candidates.push(
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=128`,
  );
  return Array.from(
    new Set(
      candidates.map((candidate) => new URL(candidate, website).toString()),
    ),
  );
}

export function extractWebsiteStylesheetUrls(html: string, website: string) {
  const candidates: string[] = [];
  for (const match of html.matchAll(
    /<link[^>]+rel=["'][^"']*stylesheet[^"']*["'][^>]*href=["']([^"']+)["']/gi,
  )) {
    candidates.push(match[1]);
  }
  for (const match of html.matchAll(
    /<link[^>]+href=["']([^"']+)["'][^>]*rel=["'][^"']*stylesheet[^"']*["']/gi,
  )) {
    candidates.push(match[1]);
  }
  return Array.from(
    new Set(
      candidates.map((candidate) => new URL(candidate, website).toString()),
    ),
  ).slice(0, MAX_STYLESHEETS);
}

export async function readResponseBytesWithinLimit(
  response: PublicResponse,
  maxBytes: number,
) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await discardPublicResponse(response);
    throw new Error(`Website response exceeded ${maxBytes} bytes`);
  }
  if (!response.body) {
    try {
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > maxBytes) {
        throw new Error(`Website response exceeded ${maxBytes} bytes`);
      }
      return new Uint8Array(buffer);
    } finally {
      await releaseResponseDispatcher(response);
    }
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error(`Website response exceeded ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
    await releaseResponseDispatcher(response);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readResponseTextWithinLimit(
  response: PublicResponse,
  maxBytes: number,
) {
  return new TextDecoder().decode(
    await readResponseBytesWithinLimit(response, maxBytes),
  );
}

async function fetchWebsiteHtml(rawUrl: string) {
  const response = await fetchPublic(rawUrl);
  if (!response.ok) {
    await discardPublicResponse(response);
    throw new Error(`Website returned ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    await discardPublicResponse(response);
    throw new Error("Website did not return HTML");
  }
  const html = await readResponseTextWithinLimit(response, MAX_HTML_BYTES);
  return {
    html,
    website: normalizePublicWebsiteUrl(response.url || rawUrl),
  };
}

/** Final response headers and bounded HTML, including non-2xx pages such as bot challenges. */
export async function readWebsitePage(rawUrl: string) {
  const response = await fetchPublic(rawUrl);
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name.toLowerCase()] = value;
  });
  const url = response.url || normalizePublicWebsiteUrl(rawUrl);
  if (!(response.headers.get("content-type") ?? "").includes("text/html")) {
    await discardPublicResponse(response);
    return { url, status: response.status, headers, html: "" };
  }
  // Large app shells are common; the leading bytes carry the script and meta tags we need.
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const reader = response.body?.getReader();
  try {
    while (reader && totalBytes < MAX_HTML_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalBytes += value.byteLength;
    }
    await reader?.cancel();
  } finally {
    reader?.releaseLock();
    await releaseResponseDispatcher(response);
  }
  const decoder = new TextDecoder();
  const html = chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join("");
  return { url, status: response.status, headers, html };
}

async function readStylesheetBrandColors(html: string, website: string) {
  const stylesheets = await Promise.all(
    extractWebsiteStylesheetUrls(html, website).map(async (url) => {
      try {
        const response = await fetchPublic(url);
        if (!response.ok) {
          await discardPublicResponse(response);
          return [];
        }
        const contentType = response.headers.get("content-type") ?? "";
        if (
          !contentType.includes("text/css") &&
          !new URL(response.url || url).pathname.endsWith(".css")
        ) {
          await discardPublicResponse(response);
          return [];
        }
        const css = await readResponseTextWithinLimit(
          response,
          MAX_STYLESHEET_BYTES,
        );
        return extractWebsiteBrandColorSignals(css, "stylesheet");
      } catch {
        return [];
      }
    }),
  );
  const seen = new Set<string>();
  return stylesheets.flat().filter((signal) => {
    if (seen.has(signal.color)) return false;
    seen.add(signal.color);
    return true;
  });
}

export async function readWebsiteBrandSignals(
  rawUrl: string,
): Promise<WebsiteBrandSignals> {
  const { html, website } = await fetchWebsiteHtml(rawUrl);
  const [stylesheetColorSignals, favicon] = await Promise.all([
    readStylesheetBrandColors(html, website),
    fetchFaviconFromHtml(html, website),
  ]);
  const faviconColors = favicon
    ? await extractImageBrandColors(await favicon.arrayBuffer())
    : [];
  const colorSignals: WebsiteBrandColorSignal[] = [
    ...faviconColors.map((color) => ({ color, source: "favicon" as const })),
    ...stylesheetColorSignals,
    ...extractWebsiteBrandColorSignals(html, "html"),
  ];
  const seenColors = new Set<string>();
  const distinctColorSignals = colorSignals.filter((signal) => {
    if (seenColors.has(signal.color)) return false;
    seenColors.add(signal.color);
    return true;
  }).slice(0, MAX_COLOR_CANDIDATES);
  const primaryColor = distinctColorSignals[0];
  return {
    website,
    title: extractTitle(html),
    siteName: extractWebsiteSiteName(html),
    identityEvidence: extractWebsiteIdentityEvidence(html),
    primaryColor: primaryColor?.color,
    primaryColorSource: primaryColor?.source,
    colorCandidates: distinctColorSignals.map((signal) => signal.color),
  };
}

export async function fetchWebsiteFavicon(
  rawUrl: string,
): Promise<Blob | null> {
  const website = normalizePublicWebsiteUrl(rawUrl);
  try {
    const page = await fetchWebsiteHtml(website);
    return await fetchFaviconFromHtml(page.html, page.website);
  } catch {
    return await fetchFaviconFromHtml("", website);
  }
}

async function fetchFaviconFromHtml(html: string, website: string) {
  for (const candidate of extractIconCandidates(html, website)) {
    try {
      const response = await fetchPublic(candidate);
      if (!response.ok) {
        await discardPublicResponse(response);
        continue;
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (
        !contentType.startsWith("image/") &&
        !new URL(candidate).pathname.endsWith(".ico")
      ) {
        await discardPublicResponse(response);
        continue;
      }
      const bytes = await readResponseBytesWithinLimit(
        response,
        MAX_IMAGE_BYTES,
      );
      if (bytes.byteLength < 64) {
        continue;
      }
      const safeMimeType = safeFaviconMimeType(bytes);
      if (!safeMimeType) continue;
      return new Blob([bytes], { type: safeMimeType });
    } catch {
      continue;
    }
  }
  return null;
}

export async function readWebsiteFaviconSignals(rawUrl: string) {
  const favicon = await fetchWebsiteFavicon(rawUrl);
  return {
    favicon,
    colorCandidates: favicon
      ? await extractImageBrandColors(await favicon.arrayBuffer())
      : [],
  };
}

export async function storeWebsiteFavicon(
  ctx: ActionCtx,
  rawUrl: string,
): Promise<Id<"_storage"> | null> {
  const icon = await fetchWebsiteFavicon(rawUrl);
  return icon ? await ctx.storage.store(icon) : null;
}
