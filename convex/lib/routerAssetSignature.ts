const encoder = new TextEncoder();

export function routerAssetSigningConfiguration(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): { secret: string; siteUrl: string } {
  const secret = environment.CL_ROUTER_SECRET?.trim();
  const siteUrl = environment.CONVEX_SITE_URL?.trim().replace(/\/+$/, "");
  if (!secret || !siteUrl)
    throw new Error("Router asset signing is not configured");
  const site = new URL(siteUrl);
  const exactOrigin =
    site.pathname === "/" && site.search === "" && site.hash === "";
  const spotEnvironment = environment.SPOT_ENV?.trim().toLowerCase() ?? "local";
  const canonical =
    spotEnvironment === "production"
      ? site.protocol === "https:" &&
        site.hostname === "actions.spot.insure" &&
        site.port === "" &&
        !site.username &&
        !site.password &&
        exactOrigin
      : spotEnvironment === "dev"
        ? site.protocol === "https:" &&
          site.hostname === "acoustic-caiman-755.convex.site" &&
          site.port === "" &&
          !site.username &&
          !site.password &&
          exactOrigin
        : site.protocol === "http:" &&
          ["localhost", "127.0.0.1", "::1", "[::1]"].includes(site.hostname) &&
          !site.username &&
          !site.password &&
          exactOrigin;
  if (!canonical)
    throw new Error("CONVEX_SITE_URL is not the canonical router asset host");
  return { secret, siteUrl };
}

function encoded(value: string): ArrayBuffer {
  const bytes = encoder.encode(value);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function payload(assetId: string, expiresAt: number): ArrayBuffer {
  return encoded(`${assetId}.${expiresAt}`);
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoded(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    return Uint8Array.from(atob(padded), (character) =>
      character.charCodeAt(0),
    );
  } catch {
    return null;
  }
}

export async function signRouterAsset(
  assetId: string,
  expiresAt: number,
  secret: string,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    payload(assetId, expiresAt),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function verifyRouterAssetSignature(
  assetId: string,
  expiresAt: number,
  signature: string,
  secret: string,
): Promise<boolean> {
  const bytes = base64UrlToBytes(signature);
  if (!bytes) return false;
  return crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer,
    payload(assetId, expiresAt),
  );
}
