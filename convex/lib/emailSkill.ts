/**
 * Spot's email skill: the writing rules every drafted email follows, whether a
 * model writes it (provider outreach, inbox auto-drafts, agent drafts) or a
 * deterministic template does. Prompts include the rule lists; templates use
 * the fixed sentences so both produce the same copy.
 */

/** The quote ask closing every provider nudge. */
export const PROVIDER_QUOTE_ASK =
  "Could you let us know if you can quote us or if there's more information needed?";

export function providerNudge(company: string): string {
  return `Following up on our earlier request for ${company}. ${PROVIDER_QUOTE_ASK}`;
}

/** Cold-provider introduction of our role. */
export function spotIntroduction(clientName: string): string {
  return `${clientName} hired us at Spot to help buy their commercial insurance.`;
}

/** Tone rules for every email, including ones the client agent writes for a company. */
export const EMAIL_SKILL_TONE = [
  "Be concise and direct: short paragraphs, plain language, no filler.",
  'Greet the specific person you are writing to by first name ("Hey Emerson,"). When no person is known, greet their company ("Hey Acme Insurance,").',
  'Skip excessive politeness: never write "kindly", "just checking in" or "please", never apologize for following up, and do not repeat thanks.',
] as const;

/** Rules for every email Spot operators send. */
export const EMAIL_SKILL_GENERAL = [
  ...EMAIL_SKILL_TONE,
  'Use we, us and our for the client\'s insurance request: "Can you quote us?", "What else do you need from us?" Never claim Spot is the insured.',
  "The actual sender's signature is added after you. Never write your own signature, a Spot description, or sign as the Spot team.",
] as const;

/** How a reply-box draft ends: the operator's signature and quoted history are added on send. */
export const REPLY_DRAFT_SIGN_OFF =
  'End with a one-word sign-off line such as "Thanks," and nothing after it: no name, title or signature.';

/**
 * Drops a name the model wrote under the sign-off ("Thanks,\nTerry"); the
 * operator's signature already carries it.
 */
export function stripNameAfterSignOff(reply: string): string {
  const match = /\n([A-Za-z ]{1,30},)\s*\n\s*([A-Z][\w.'-]*(?: [A-Z][\w.'-]*){0,2})\s*$/.exec(reply);
  return match ? reply.slice(0, match.index + 1 + match[1].length) : reply;
}

/** Extra rules for emails to insurance providers (brokers, carriers, wholesalers). */
export const EMAIL_SKILL_PROVIDER = [
  "Never email a Do Not Contact provider.",
  'Cold provider (no prior interaction with us): explain our role in one sentence first, e.g. "Celsius Home Services hired us at Spot to help buy their commercial insurance." Active Relationship: skip the introduction and go straight to the quote request.',
  "Ask for a quote explicitly and directly, in one sentence that names every requested coverage line with its known limits. They can ask for more information if they need it.",
  "Give the business facts as short factual bullets: business, location, operations, revenue, coverage and relevant history.",
  "Make the application link obvious and say they can click it for the full application and more information.",
  `Keep nudges short: "${providerNudge("{company}")}"`,
  "Automated nudges stop once someone replies; answer the reply instead of nudging again.",
] as const;

/** The general Spot explanation under the sender's signature. */
export const SPOT_SIGNATURE_DESCRIPTION =
  "What's Spot? Companies hire Spot to help them with their insurance procurement.";

/** The skill as a prompt section; `provider` adds the provider outreach rules. */
export function emailSkillPrompt(options: { provider?: boolean } = {}): string {
  const rules = [...EMAIL_SKILL_GENERAL, ...(options.provider ? EMAIL_SKILL_PROVIDER : [])];
  return `EMAIL WRITING RULES:\n${rules.map((rule) => `- ${rule}`).join("\n")}`;
}
