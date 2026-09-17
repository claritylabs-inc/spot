import { normalizeDeclarationValue } from "./declarationFacts";

export function clientIdentity(name: string) {
  return { name: name.trim().replace(/\s+/g, " ") };
}

export function clientIdentityMatches(
  current: { name: string },
  proposedName: string,
) {
  return (
    normalizeDeclarationValue(current.name) ===
    normalizeDeclarationValue(proposedName)
  );
}

export const CLIENT_PROFILE_GUIDANCE = `When importing or updating a client, read its identity and company .md document first. Use the evidenced operating name as the client name. Keep company details—including legal names and relationships, industry, mailing address, entity type, tax identifiers, operations, dated revenue/headcount, locations, products, and preferences—in the company Markdown. Preserve existing facts and human edits; report conflicts. Never infer subsidiaries from additional named insureds. Policy facts stay on the policy; certificates use the policy's operations description and insured details, never company narrative. Public web research is required for intake: identify and verify the official website and contribute cited facts to the company Markdown. Search only public identity terms, never tax IDs or private source content. Unknown facts stay unknown with an explicit research outcome; a queued or failed research run is not a completed import. Read back the identity, companyResearch status, and wiki before reporting completion.`;
