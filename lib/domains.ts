import { canonicalAgentDomain } from "../convex/lib/agentEmailDomains";

export function getPublicAgentDomain(): string {
  return canonicalAgentDomain(process.env.NEXT_PUBLIC_AGENT_DOMAIN);
}
