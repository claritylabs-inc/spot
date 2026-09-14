export const DEFAULT_AGENT_DOMAIN = "agent.spot.insure";
export const LEGACY_AGENT_DOMAINS = [
  "spot.insure",
  "glass.insure",
  "glass.claritylabs.inc",
  "spot.claritylabs.inc",
  "dev.claritylabs.inc",
];

export function canonicalAgentDomain(configured?: string): string {
  const domain = configured?.trim().toLowerCase().replace(/^@/, "");
  return !domain || LEGACY_AGENT_DOMAINS.includes(domain)
    ? DEFAULT_AGENT_DOMAIN
    : domain;
}

export function canonicalAgentAddress(address: string): string {
  const at = address.lastIndexOf("@");
  if (at <= 0) return address;
  const domain = address.slice(at + 1).toLowerCase();
  return LEGACY_AGENT_DOMAINS.includes(domain)
    ? `${address.slice(0, at)}@${DEFAULT_AGENT_DOMAIN}`
    : address;
}

export function agentAddressAliases(address: string): string[] {
  const at = address.lastIndexOf("@");
  if (at <= 0) return [address];
  const domain = address.slice(at + 1).toLowerCase();
  if (domain !== DEFAULT_AGENT_DOMAIN && !LEGACY_AGENT_DOMAINS.includes(domain)) {
    return [address];
  }
  return [DEFAULT_AGENT_DOMAIN, ...LEGACY_AGENT_DOMAINS].map(
    (alias) => `${address.slice(0, at)}@${alias}`,
  );
}
