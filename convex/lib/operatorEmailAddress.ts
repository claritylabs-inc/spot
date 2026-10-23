import { DEFAULT_AGENT_DOMAIN } from "./agentEmailDomains";

export const OPERATOR_EMAIL_DOMAIN = DEFAULT_AGENT_DOMAIN;
export const OPERATOR_EMAIL_ADDRESS = `operator@${OPERATOR_EMAIL_DOMAIN}`;

const OPERATOR_LOCALPART = /^operator(?:\+([a-z0-9]+))?$/;

/**
 * Parses `operator` / `operator+<thread token>` on one of `agentDomains`
 * (pass `getAgentDomains()`: configured, canonical and legacy agent domains).
 * Only the exact localpart pattern matches; a domain outside the list never does.
 */
function parseOperatorRecipient(
  email: string,
  agentDomains: readonly string[],
): { token?: string } | null {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || normalized.indexOf("@") !== at) return null;
  const domain = normalized.slice(at + 1);
  if (
    !agentDomains.some(
      (candidate) => candidate.trim().toLowerCase().replace(/^@/, "") === domain,
    )
  ) {
    return null;
  }
  const match = OPERATOR_LOCALPART.exec(normalized.slice(0, at));
  return match ? { token: match[1] } : null;
}

export function isOperatorEmailRecipient(
  email: string,
  agentDomains: readonly string[],
) {
  return parseOperatorRecipient(email, agentDomains) !== null;
}

export function operatorEmailThreadToken(
  email: string,
  agentDomains: readonly string[],
) {
  return parseOperatorRecipient(email, agentDomains)?.token;
}
