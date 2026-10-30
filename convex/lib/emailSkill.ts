/**
 * Spot's email skill: the writing rules every drafted email follows, whether a
 * model writes it (provider outreach, inbox auto-drafts, agent drafts) or a
 * deterministic template does. Prompts include the rule lists; templates use
 * the fixed sentences so both produce the same copy.
 *
 * Operators can change the introduction, nudge, signature and rules in
 * Settings → Email (`emailPrompts`); `DEFAULT_EMAIL_PROMPTS` applies until they
 * do. Callers load the saved values with `loadEmailPrompts`.
 */

/** The quote ask closing every provider nudge. */
export const PROVIDER_QUOTE_ASK =
  "Could you let us know if you can quote us or if there's more information needed?";

/** Tone rules for every email, including ones the client agent writes for a company. */
export const EMAIL_SKILL_TONE = [
  "Be concise and direct: short paragraphs, plain language, no filler.",
  'Greet the specific person you are writing to by first name ("Hey Emerson,"). When no person is known, greet their company ("Hey Acme Insurance,").',
  'Skip excessive politeness: never write "kindly", "just checking in" or "please", never apologize for following up, and do not repeat thanks.',
] as const;

const bullets = (rules: readonly string[]) => rules.map((rule) => `- ${rule}`).join("\n");

export const EMAIL_PROMPT_KEYS = [
  "provider_introduction",
  "provider_nudge",
  "signature",
  "provider_signature_note",
  "writing_rules",
  "provider_rules",
] as const;
export type EmailPromptKey = (typeof EMAIL_PROMPT_KEYS)[number];
export type EmailPrompts = Record<EmailPromptKey, string>;

/** The keys an operator can set for themselves, applied alongside the shared ones. */
export const PERSONAL_EMAIL_PROMPT_KEYS = ["signature", "writing_rules"] as const satisfies readonly EmailPromptKey[];
export type PersonalEmailPromptKey = (typeof PERSONAL_EMAIL_PROMPT_KEYS)[number];

export const MAX_EMAIL_PROMPT_CHARS = 4000;

export const DEFAULT_EMAIL_PROMPTS: EmailPrompts = {
  provider_introduction:
    "This is {{sender_first_name}}. {{company}} hired us at Spot to help buy their commercial insurance.",
  provider_nudge: `Following up on our earlier request for {{company}}. ${PROVIDER_QUOTE_ASK}`,
  signature: "{{sender_name}}\nSpot\n{{sender_email}}",
  provider_signature_note:
    "What's Spot? Companies hire Spot to help them with their insurance procurement. Learn more at https://spot.insure",
  writing_rules: bullets([
    ...EMAIL_SKILL_TONE,
    'Use we, us and our for the client\'s insurance request: "Can you quote us?", "What else do you need from us?" Never claim Spot is the insured.',
    "The actual sender's signature is added after you. Never write your own signature, a Spot description, or sign as the Spot team.",
  ]),
  provider_rules: bullets([
    "Never email a Do Not Contact provider.",
    "Cold provider (no prior interaction with us): open with our introduction. Active Relationship: skip the introduction and go straight to the quote request.",
    "Ask for a quote explicitly and directly, in one sentence that names every requested coverage line with its known limits. They can ask for more information if they need it.",
    "Give the business facts as short factual bullets: business, location, operations, revenue, coverage and relevant history.",
    "Make the application link obvious and say they can click it for the full application and more information.",
    "Automated nudges stop once someone replies; answer the reply instead of nudging again.",
  ]),
};

/** `{{variable}}` placeholders each prompt fills in. */
export const EMAIL_PROMPT_VARIABLES: Record<EmailPromptKey, readonly string[]> = {
  provider_introduction: ["sender_first_name", "company"],
  provider_nudge: ["company"],
  signature: ["sender_name", "sender_email"],
  provider_signature_note: [],
  writing_rules: [],
  provider_rules: [],
};

const VARIABLE_PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Fills `{{variable}}` placeholders; unknown ones stay as written. */
export function fillEmailPrompt(template: string, values: Record<string, string>): string {
  return template.replace(VARIABLE_PATTERN, (token, key: string) => values[key] ?? token);
}

/** Placeholders in `text` that `key` does not fill in. */
export function unknownEmailPromptVariables(key: EmailPromptKey, text: string): string[] {
  const known = new Set(EMAIL_PROMPT_VARIABLES[key]);
  return [...new Set([...text.matchAll(VARIABLE_PATTERN)].map((match) => match[1]))].filter(
    (name) => !known.has(name),
  );
}

/**
 * The prompts in effect: saved shared values over the defaults, then an
 * operator's own signature in place of the shared one and their writing
 * preferences after the shared rules.
 */
export function resolveEmailPrompts(
  shared: Partial<EmailPrompts>,
  personal: Partial<Record<PersonalEmailPromptKey, string>> = {},
): EmailPrompts {
  const prompts = { ...DEFAULT_EMAIL_PROMPTS, ...shared };
  const preferences = personal.writing_rules?.trim();
  return {
    ...prompts,
    signature: personal.signature?.trim() ? personal.signature : prompts.signature,
    writing_rules: preferences
      ? `${prompts.writing_rules}\nThe sending operator's own preferences, followed unless they conflict with the rules above:\n${preferences}`
      : prompts.writing_rules,
  };
}

function firstNameOf(name: string) {
  return name.replace(/\s+/g, " ").trim().split(" ")[0] || "the team";
}

/** Cold-provider introduction of the sender and our role. */
export function spotIntroduction(
  prompts: Pick<EmailPrompts, "provider_introduction">,
  args: { senderName: string; clientName: string },
): string {
  return fillEmailPrompt(prompts.provider_introduction, {
    sender_first_name: firstNameOf(args.senderName),
    company: args.clientName,
  }).trim();
}

export function providerNudge(prompts: Pick<EmailPrompts, "provider_nudge">, company: string): string {
  return fillEmailPrompt(prompts.provider_nudge, { company }).trim();
}

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

/** The skill as a prompt section; `provider` adds the provider outreach rules. */
export function emailSkillPrompt(prompts: EmailPrompts, options: { provider?: boolean } = {}): string {
  const sections = [`EMAIL WRITING RULES:\n${prompts.writing_rules.trim()}`];
  if (options.provider) {
    const introduction = fillEmailPrompt(prompts.provider_introduction, {
      sender_first_name: "{sender first name}",
      company: "{client}",
    }).trim();
    sections.push(
      `PROVIDER RULES:\n${prompts.provider_rules.trim()}`,
      `- Our introduction for cold providers: "${introduction}"`,
      `- Keep nudges short: "${providerNudge(prompts, "{client}")}"`,
    );
  }
  return sections.join("\n");
}
