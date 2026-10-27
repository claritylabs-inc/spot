import { z } from "zod";

const standaloneEmailAddressSchema = z.string().trim().toLowerCase().email();

export function normalizeEmailAddress(email: string): string {
  return email.toLowerCase().trim();
}

export function extractEmailAddress(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const openingBracket = trimmed.lastIndexOf("<");
  const closingBracket = trimmed.indexOf(">", openingBracket + 1);
  const candidate =
    openingBracket >= 0 && closingBracket > openingBracket
      ? trimmed.slice(openingBracket + 1, closingBracket)
      : trimmed;
  const parsed = standaloneEmailAddressSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/** The bare lowercase address of a possibly display-named value; the trimmed lowercase input when it holds no valid address. */
export function canonicalAddress(value: string): string {
  return extractEmailAddress(value) ?? value.trim().toLowerCase();
}

/**
 * Reply-To is stored as one string; operator drafts keep a comma-separated
 * list of bare addresses. A value with a display name stays a single address.
 */
export function parseReplyToAddresses(value: string | undefined): string[] {
  if (!value) return [];
  if (value.includes("<")) return [value];
  return value
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
}

export function parseStandaloneEmailAddress(value: string): string | null {
  let candidate = value.trim();
  while ([".", "!", "?"].includes(candidate.at(-1) ?? "")) {
    candidate = candidate.slice(0, -1).trimEnd();
  }
  if (candidate.startsWith("<") && candidate.endsWith(">")) {
    candidate = candidate.slice(1, -1).trim();
  }
  const parsed = standaloneEmailAddressSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
