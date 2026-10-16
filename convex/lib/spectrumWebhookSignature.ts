import dayjs from "dayjs";

/**
 * Native Spectrum webhook signing (Photon Stable docs, Webhooks → Verifying
 * signatures): `X-Spectrum-Signature: v0=<hex HMAC-SHA256(secret,
 * "v0:" + timestamp + ":" + rawBody)>` with `X-Spectrum-Timestamp` in unix
 * seconds and a five-minute replay window. Always computed over raw bytes.
 */
export const SPECTRUM_SIGNATURE_HEADER = "x-spectrum-signature";
export const SPECTRUM_TIMESTAMP_HEADER = "x-spectrum-timestamp";

const SIGNATURE_PREFIX = "v0=";
const REPLAY_TOLERANCE_SECONDS = 300;

export type SpectrumSignatureVerification =
  | "ok"
  | "missing-headers"
  | "expired"
  | "signature-mismatch";

function signatureBase(
  timestamp: string,
  body: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const prefix = new TextEncoder().encode(`v0:${timestamp}:`);
  const base = new Uint8Array(prefix.length + body.length);
  base.set(prefix, 0);
  base.set(body, prefix.length);
  return base;
}

async function hmacKey(secret: string, usage: "sign" | "verify") {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  const bytes = new Uint8Array(32);
  for (let index = 0; index < 32; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export async function verifySpectrumWebhookSignature(args: {
  secret: string;
  body: Uint8Array<ArrayBuffer>;
  signature: string | null;
  timestamp: string | null;
}): Promise<SpectrumSignatureVerification> {
  const timestamp = args.timestamp?.trim();
  const signature = args.signature?.trim();
  if (!timestamp || !signature) return "missing-headers";
  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return "missing-headers";
  if (Math.abs(dayjs().unix() - timestampSeconds) > REPLAY_TOLERANCE_SECONDS) {
    return "expired";
  }
  const provided = hexToBytes(
    signature.startsWith(SIGNATURE_PREFIX)
      ? signature.slice(SIGNATURE_PREFIX.length)
      : signature,
  );
  if (!provided) return "signature-mismatch";
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(args.secret, "verify"),
    provided,
    signatureBase(timestamp, args.body),
  );
  return valid ? "ok" : "signature-mismatch";
}

export async function signSpectrumWebhook(
  secret: string,
  body: Uint8Array<ArrayBuffer>,
): Promise<Record<string, string>> {
  const timestamp = String(dayjs().unix());
  const digest = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      await hmacKey(secret, "sign"),
      signatureBase(timestamp, body),
    ),
  );
  const hex = Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return {
    [SPECTRUM_SIGNATURE_HEADER]: `${SIGNATURE_PREFIX}${hex}`,
    [SPECTRUM_TIMESTAMP_HEADER]: timestamp,
  };
}
