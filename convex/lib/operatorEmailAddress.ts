import { DEFAULT_AGENT_DOMAIN } from "./agentEmailDomains";

export const OPERATOR_EMAIL_DOMAIN = DEFAULT_AGENT_DOMAIN;
export const OPERATOR_EMAIL_ADDRESS = `operator@${OPERATOR_EMAIL_DOMAIN}`;

const OPERATOR_RECIPIENT = /^operator(?:\+([a-z0-9]+))?@agent\.spot\.insure$/i;

export function isOperatorEmailRecipient(email: string) {
  return OPERATOR_RECIPIENT.test(email.trim());
}

export function operatorEmailThreadToken(email: string) {
  return OPERATOR_RECIPIENT.exec(email.trim())?.[1]?.toLowerCase();
}
