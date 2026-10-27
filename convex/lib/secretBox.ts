"use node";

// AES-256-GCM encryption for secrets stored at rest (mailbox passwords, OAuth
// refresh tokens, MCP credentials, second-factor secrets).
// Uses Node.js built-ins, so import this module only from "use node" action files.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function encryptionKey() {
  const secret = process.env.EMAIL_CONNECTIONS_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("EMAIL_CONNECTIONS_ENCRYPTION_KEY is not configured");
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: ciphertext.toString("base64"),
  });
}

export function decryptSecret(encrypted: string): string {
  const parsed = JSON.parse(encrypted) as { iv: string; tag: string; data: string };
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(parsed.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(parsed.data, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Aliases kept for the original IMAP-password call sites. */
export const encryptPassword = encryptSecret;
export const decryptPassword = decryptSecret;
