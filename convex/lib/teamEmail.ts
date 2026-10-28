import { escapeHtml } from "./emailTemplate";
import { canonicalAddress } from "./emailAddress";

/**
 * Pure identity rules for operator team email (no Convex context, no network).
 * It must not import `resend.ts`, which imports it.
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

function normalizeDomain(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/^@/, "");
}

function configuredTeamEmailDomains(): { team: string | null; outreach: string | null } {
  return {
    team: normalizeDomain(process.env.TEAM_EMAIL_DOMAIN) || null,
    outreach: normalizeDomain(process.env.PROVIDER_OUTREACH_EMAIL_DOMAIN) || null,
  };
}

/** `TEAM_EMAIL_DOMAIN`, else `PROVIDER_OUTREACH_EMAIL_DOMAIN` (the pre-cutover outreach domain). */
export function getTeamEmailDomain(): string {
  const { team, outreach } = configuredTeamEmailDomains();
  const domain = team ?? outreach;
  if (!domain) {
    throw new TeamEmailError("not_configured", "TEAM_EMAIL_DOMAIN not set");
  }
  return domain;
}

/**
 * Domains whose mailboxes Spot owns for team email: the team domain and the
 * outreach domain, so old outreach addresses stay Spot-owned during cutover.
 */
export function teamOwnedDomains(): string[] {
  const { team, outreach } = configuredTeamEmailDomains();
  return Array.from(new Set([team, outreach, "insurewithspot.com"].filter((d): d is string => d !== null)));
}

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
 * Resend Inboxes allow letters, numbers and `. _ % -` (max 64, no leading,
 * trailing or double dots) and reject `+`. Spot also refuses `%` and the
 * reserved list. The result is lowercased.
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

/** Default localpart from the login email (`+` tags and rejected characters dropped); throws when unusable or reserved. */
export function deriveOperatorLocalpart(operatorEmail: string): string {
  const full = canonicalAddress(operatorEmail);
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

export function operatorTeamAddress(
  localpart: string,
  domain: string = getTeamEmailDomain(),
): string {
  return `${assertTeamLocalpart(localpart)}@${normalizeDomain(domain)}`;
}

/** The operator's address: the saved team localpart, else one derived from their login email. */
export function operatorTeamAddressFor(operator: {
  email: string | null;
  teamEmailLocalpart: string | null;
}): string {
  if (operator.teamEmailLocalpart) {
    return operatorTeamAddress(operator.teamEmailLocalpart);
  }
  if (!operator.email) {
    throw new TeamEmailError(
      "invalid_localpart",
      "Your account has no email; set a team address in Profile",
    );
  }
  return operatorTeamAddress(deriveOperatorLocalpart(operator.email));
}

/** The shared command-channel inbox, stored with `kind: "agent"`. */
export function agentInboxAddress(domain: string = getTeamEmailDomain()): string {
  return `agent@${normalizeDomain(domain)}`;
}

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

/** Resend `from_name`: the full name without `: < >` or line breaks, at most 78 characters. */
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

/** Unstyled operator signature, using the same address as the email's From header. */
export function buildOperatorSignature(operator: {
  name: string | null | undefined;
  address: string;
}): {
  text: string;
  html: string;
} {
  const name = requirePersonName(operator.name).slice(0, MAX_SIGNATURE_NAME_LENGTH);
  const lines = [name, "Spot", operator.address];
  const text = lines.join("\n");
  const html = `<p>${lines.map(escapeHtml).join("<br>")}</p>`;
  return { text, html };
}
