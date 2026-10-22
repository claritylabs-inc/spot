import dayjs from "dayjs";
import { generateHOTP } from "@oslojs/otp";
import { sha256 } from "@oslojs/crypto/sha2";
import { constantTimeEqual } from "@oslojs/crypto/subtle";
import { encodeHexLowerCase } from "@oslojs/encoding";

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_ISSUER = "Spot Operator";
export const RECOVERY_CODE_COUNT = 10;

const encoder = new TextEncoder();

/** The 30-second step a code was issued for, allowing one step of clock drift. */
export function matchTotpCounter(key: Uint8Array, code: string) {
  const normalized = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return null;
  const current = Math.floor(dayjs().unix() / TOTP_PERIOD_SECONDS);
  for (const counter of [current, current - 1, current + 1]) {
    const expected = generateHOTP(key, BigInt(counter), TOTP_DIGITS);
    if (constantTimeEqual(encoder.encode(expected), encoder.encode(normalized)))
      return counter;
  }
  return null;
}

export function normalizeRecoveryCode(code: string) {
  return code.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Recovery codes carry 50 random bits, so an unsalted digest is sufficient. */
export function hashRecoveryCode(code: string) {
  return encodeHexLowerCase(sha256(encoder.encode(normalizeRecoveryCode(code))));
}
