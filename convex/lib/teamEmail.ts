import { buildSpotEmailIconHtml, escapeHtml } from "./emailTemplate";
import { extractEmailAddress } from "./emailAddress";

/**
 * Identity primitives for operator team email: one team mail domain
 * (`TEAM_EMAIL_DOMAIN`), one Resend inbox per operator, every message sent
 * from and signed by a specific person. Transport lives in `resendInbox.ts`;
 * inbox lifecycle lives in `operatorInbox.ts`. This module is pure (no Convex
 * context, no network) and must not import `resend.ts`, which imports it.
 */

export type TeamEmailErrorCode =
  | "not_configured"
  | "name_required"
  | "invalid_localpart"
  | "reserved_localpart"
  | "invalid_always_cc";

export class TeamEmailError extends Error {
  readonly code: TeamEmailErrorCode;

  constructor(code: TeamEmailErrorCode, message: string) {
    super(message);
    this.name = "TeamEmailError";
    this.code = code;
  }
}

export function isTeamEmailError(error: unknown): error is TeamEmailError {
  return error instanceof TeamEmailError;
}

// --- Domain ------------------------------------------------------------------

function normalizeDomain(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/^@/, "");
}

/** The configured team domain, or null. Never throws. */
function configuredTeamEmailDomain(): string | null {
  return (
    normalizeDomain(process.env.TEAM_EMAIL_DOMAIN) ||
    normalizeDomain(process.env.PROVIDER_OUTREACH_EMAIL_DOMAIN) ||
    null
  );
}

/**
 * `TEAM_EMAIL_DOMAIN`, falling back to `PROVIDER_OUTREACH_EMAIL_DOMAIN` so
 * deployments configured for per-operator outreach inboxes keep working.
 */
export function getTeamEmailDomain(): string {
  const domain = configuredTeamEmailDomain();
  if (!domain) {
    throw new TeamEmailError("not_configured", "TEAM_EMAIL_DOMAIN not set");
  }
  return domain;
}

/** Domains whose mailboxes Spot owns for team email; empty when unconfigured. */
export function teamOwnedDomains(): string[] {
  const domain = configuredTeamEmailDomain();
  return domain ? [domain] : [];
}

// --- Localparts and addresses -------------------------------------------------

const MAX_LOCALPART_LENGTH = 64;

const RESERVED_LOCALPARTS: ReadonlySet<string> = new Set([
  "abuse",
  "admin",
  "administrator",
  "agent",
  "agents",
  "billing",
  "daemon",
  "hello",
  "hostmaster",
  "info",
  "mailer-daemon",
  "no-reply",
  "noreply",
  "notification",
  "notifications",
  "operator",
  "operators",
  "postmaster",
  "root",
  "security",
  "spot",
  "support",
  "system",
  "team",
  "webmaster",
]);

const RESERVED_LOCALPART_PREFIXES = ["req-", "procurement"] as const;

export function isReservedTeamLocalpart(localpart: string): boolean {
  const value = localpart.toLowerCase();
  return (
    RESERVED_LOCALPARTS.has(value) ||
    RESERVED_LOCALPART_PREFIXES.some((prefix) => value.startsWith(prefix))
  );
}

export type TeamLocalpartValidation =
  | { ok: true; localpart: string }
  | { ok: false; code: "invalid_localpart" | "reserved_localpart"; message: string };

/**
 * Resend Inboxes allow only letters, numbers and `. _ % -` (max 64, no
 * leading/trailing/double dots) and reject `+`. Spot additionally refuses `%`
 * (unsafe in paths) and the reserved list above. The result is lowercased.
 */
export function validateTeamLocalpart(input: string): TeamLocalpartValidation {
  const localpart = input.trim().toLowerCase();
  if (!localpart) {
    return { ok: false, code: "invalid_localpart", message: "Enter a team address" };
  }
  if (localpart.length > MAX_LOCALPART_LENGTH) {
    return {
      ok: false,
      code: "invalid_localpart",
      message: `Team address must be at most ${MAX_LOCALPART_LENGTH} characters`,
    };
  }
  if (!/^[a-z0-9._-]+$/.test(localpart)) {
    return {
      ok: false,
      code: "invalid_localpart",
      message: "Use only letters, numbers, dots, dashes and underscores",
    };
  }
  if (/^\.|\.$|\.\./.test(localpart)) {
    return {
      ok: false,
      code: "invalid_localpart",
      message: "Dots cannot lead, trail or repeat",
    };
  }
  if (isReservedTeamLocalpart(localpart)) {
    return {
      ok: false,
      code: "reserved_localpart",
      message: `"${localpart}" is reserved; choose another team address`,
    };
  }
  return { ok: true, localpart };
}

/** Validated localpart, or a `TeamEmailError`. */
export function assertTeamLocalpart(input: string): string {
  const result = validateTeamLocalpart(input);
  if (!result.ok) throw new TeamEmailError(result.code, result.message);
  return result.localpart;
}

/**
 * The default localpart for an operator, taken from their login email: `+`
 * tags dropped, characters Resend rejects removed. Throws when nothing usable
 * remains or the result is reserved; the operator then sets a team address in
 * Profile (`operatorProfiles.teamEmailLocalpart`).
 */
export function deriveOperatorLocalpart(operatorEmail: string): string {
  const full =
    extractEmailAddress(operatorEmail) ?? operatorEmail.trim().toLowerCase();
  const raw = full.split("@")[0]?.split("+")[0] ?? "";
  const local = raw
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, MAX_LOCALPART_LENGTH)
    .replace(/\.+$/g, "");
  const result = validateTeamLocalpart(local);
  if (!result.ok) {
    throw new TeamEmailError(
      result.code,
      local
        ? `Your login email cannot be used as a team address (${result.message}); set a team address in Profile`
        : "Your login email has no usable team address; set one in Profile",
    );
  }
  return result.localpart;
}

/** `local@team-domain`; the localpart is validated. */
export function operatorTeamAddress(
  localpart: string,
  domain: string = getTeamEmailDomain(),
): string {
  return `${assertTeamLocalpart(localpart)}@${normalizeDomain(domain)}`;
}

/** The shared command-channel inbox (`agent@team…`), recorded with `kind: "agent"`. */
export function agentInboxAddress(domain: string = getTeamEmailDomain()): string {
  return `agent@${normalizeDomain(domain)}`;
}

// --- Names and signature --------------------------------------------------------

const MAX_FROM_NAME_LENGTH = 78;
const MAX_SIGNATURE_NAME_LENGTH = 80;

/** The operator's name with whitespace collapsed; null when unset or just "Spot". */
function cleanedPersonName(name: string | null | undefined): string | null {
  const cleaned = (name ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned && cleaned.toLowerCase() !== "spot" ? cleaned : null;
}

function requirePersonName(name: string | null | undefined): string {
  const cleaned = cleanedPersonName(name);
  if (!cleaned) {
    throw new TeamEmailError(
      "name_required",
      "Set your name in Profile before sending email",
    );
  }
  return cleaned;
}

/**
 * The Resend `from_name`: the operator's full name without characters Resend
 * rejects (`: < >`, line breaks), at most 78 characters. A missing name is an
 * error that asks the operator to set it in Profile.
 */
export function operatorFromName(name: string | null | undefined): string {
  const sanitized = requirePersonName(name)
    .replace(/[:<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_FROM_NAME_LENGTH)
    .trim();
  if (!sanitized) {
    throw new TeamEmailError(
      "name_required",
      "Set your name in Profile before sending email",
    );
  }
  return sanitized;
}

/** `Name <local@team-domain>` for a pending email's From header. */
export function operatorFromHeader(
  name: string | null | undefined,
  address: string,
): string {
  return `${operatorFromName(name)} <${address}>`;
}

/**
 * Person signature for every operator email: Spot mark, the operator's name,
 * "Spot". No address line; replies reach the operator through the sending
 * address itself.
 */
export function buildOperatorSignature(operator: { name: string | null | undefined }): {
  text: string;
  html: string;
} {
  const name = requirePersonName(operator.name).slice(0, MAX_SIGNATURE_NAME_LENGTH);
  const text = `${name}\nSpot`;
  const lines = [
    `<strong style="color:#111111;font-weight:600">${escapeHtml(name)}</strong>`,
    `<span style="color:#6b6b6b">Spot</span>`,
  ];
  const html = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 0;border-collapse:collapse"><tr><td style="padding:2px 10px 0 0;vertical-align:top">${buildSpotEmailIconHtml({ size: 32, borderRadius: 8 })}</td><td style="font-size:13px;line-height:19px;vertical-align:top">${lines.join("<br>")}</td></tr></table>`;
  return { text, html };
}
