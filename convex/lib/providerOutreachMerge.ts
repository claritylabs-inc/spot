import { escapeHtml } from "@claritylabs-inc/ui/lib/email";
import { spotIntroduction, type EmailPrompts } from "./emailSkill";

/**
 * Mail merge for provider outreach. One email template, with `{{variable}}`
 * placeholders, is sent to each provider individually with that provider's
 * values filled in. Pure and shared: the composer, the agent tools, the launch
 * preview and the send step all resolve a template through these functions, so
 * what is previewed and approved is what is sent.
 *
 * `{{application_link}}` stays a placeholder until the send step, which fills
 * in the provider's own secure packet link minted at launch.
 */

export const MERGE_VARIABLES = [
  { key: "first_name", label: "First name", description: "The contact's first name, or the provider's name when no person is known" },
  { key: "provider", label: "Provider", description: "The provider's company name" },
  { key: "company", label: "Company", description: "The client's company name" },
  { key: "introduction", label: "Introduction", description: "Our one-sentence introduction for providers without an active relationship; empty for active relationships" },
  { key: "sender_first_name", label: "Sender first name", description: "The sending operator's first name" },
  { key: "application_link", label: "Application link", description: "The provider's own secure link to the application and documents" },
] as const;

export type MergeVariable = (typeof MERGE_VARIABLES)[number]["key"];
export type MergeValues = Record<Exclude<MergeVariable, "application_link">, string>;

export const APPLICATION_LINK = "{{application_link}}";
export const MAX_PROVIDER_EMAIL_SUBJECT_CHARS = 200;
export const MAX_PROVIDER_EMAIL_BODY_CHARS = 10_000;

const VARIABLE_PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/g;
const BLANK_PATTERN = /\[needs:\s*([^\]]+)\]/g;
const KNOWN = new Set<string>(MERGE_VARIABLES.map((variable) => variable.key));

export function mergeVariableLabel(key: string) {
  return MERGE_VARIABLES.find((variable) => variable.key === key)?.label ?? key;
}

/** The `[needs: …]` facts still to fill in. */
export function emailBlanks(text: string) {
  return [...text.matchAll(BLANK_PATTERN)].map((match) => match[1].trim());
}

/** Placeholders in `text` that are not merge variables. */
export function unknownMergeVariables(text: string) {
  return [...new Set([...text.matchAll(VARIABLE_PATTERN)].map((match) => match[1]))].filter(
    (key) => !KNOWN.has(key),
  );
}

function clean(value: string | null | undefined, max: number) {
  const text = value
    ?.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return text || undefined;
}

/** A person's first name; routing labels and the provider's own name are not people. */
export function contactFirstName(name: string | null | undefined, providerName?: string | null) {
  const contact = clean(name, 160)?.split(/\s+[—–-]\s+/)[0].trim();
  if (
    !contact ||
    contact.toLowerCase() === clean(providerName, 160)?.toLowerCase() ||
    /\b(?:general|inquiry|inquiries|routing|reception|support|sales|service|desk|team|department|advisors?|office|contact)\b/i.test(contact)
  )
    return undefined;
  return contact.split(" ")[0];
}

/** One provider's values. The introduction is skipped for an active relationship. */
export function providerMergeValues(args: {
  providerName: string;
  recipientName: string | null | undefined;
  clientName: string;
  senderName: string;
  activeRelationship: boolean;
  prompts: Pick<EmailPrompts, "provider_introduction">;
}): MergeValues {
  const provider = clean(args.providerName, 160) ?? "there";
  return {
    first_name: contactFirstName(args.recipientName, args.providerName) ?? provider,
    provider,
    company: clean(args.clientName, 160) ?? "our client",
    introduction: args.activeRelationship
      ? ""
      : spotIntroduction(args.prompts, { senderName: clean(args.senderName, 160) ?? "", clientName: args.clientName }),
    sender_first_name: clean(args.senderName, 160)?.split(" ")[0] ?? "",
  };
}

/**
 * Fills in every variable except the application link. A paragraph left empty
 * (an introduction skipped for an active relationship) is dropped.
 */
export function applyMergeValues(text: string, values: MergeValues) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(VARIABLE_PATTERN, (token, key: string) =>
      key === "application_link" ? APPLICATION_LINK : key in values ? values[key as keyof MergeValues] : token,
    )
    .split(/\n{2,}/)
    .filter((paragraph) => paragraph.trim())
    .join("\n\n")
    .trim();
}

export type ProviderEmail = { subject: string; body: string };

/** Why this template or email cannot be sent as written, or null. */
export function providerEmailProblem(email: ProviderEmail): string | null {
  const subject = email.subject.replace(/\s+/g, " ").trim();
  const body = email.body.trim();
  if (!subject) return "Add a subject.";
  if (subject.length > MAX_PROVIDER_EMAIL_SUBJECT_CHARS) return "The subject is too long.";
  if (!body) return "Write the email.";
  if (body.length > MAX_PROVIDER_EMAIL_BODY_CHARS) return "The email is too long.";
  const unknown = unknownMergeVariables(`${subject}\n${body}`);
  if (unknown.length) return `Unknown variable ${unknown.map((key) => `{{${key}}}`).join(", ")}.`;
  if (subject.includes(APPLICATION_LINK)) return "The application link can only go in the email body.";
  if (!body.includes(APPLICATION_LINK)) return "Add the application link so the provider can open the application.";
  const blanks = emailBlanks(`${subject}\n${body}`);
  if (blanks.length) return `Fill ${blanks.length} blank${blanks.length === 1 ? "" : "s"} before sending.`;
  return null;
}

/** Paragraphs, with all-bullet blocks as lists and `Label: value` bullets bolded. */
export function outreachBodyHtml(body: string): string {
  return body
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split("\n");
      return lines.every((line) => line.startsWith("- "))
        ? `<ul style="margin:0 0 16px;padding-left:24px">${lines
            .map((line) => {
              const separator = line.indexOf(": ", 2);
              const content =
                separator > 2
                  ? `<strong>${escapeHtml(line.slice(2, separator + 1))}</strong> ${escapeHtml(line.slice(separator + 2))}`
                  : escapeHtml(line.slice(2));
              return `<li style="margin:0 0 8px">${content}</li>`;
            })
            .join("")}</ul>`
        : `<p style="margin:0 0 16px">${escapeHtml(block).replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
}

/**
 * The exact email for one provider: its merged subject and body with the packet
 * link filled in, then the sender's signature.
 */
export function renderProviderEmail(args: {
  subject: string;
  /** Merged body that still holds `{{application_link}}`. */
  body: string;
  packetUrl: string;
  signature: { text: string; html: string };
}) {
  const url = new URL(args.packetUrl);
  if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("Packet link must be https");
  const link = url.toString();
  const anchor = `<a href="${escapeHtml(link)}">Review the full application and supporting documents</a>`;
  return {
    subject: args.subject.replace(/\s+/g, " ").trim(),
    text: `${args.body.replaceAll(APPLICATION_LINK, link)}\n\n${args.signature.text}`,
    html: `${outreachBodyHtml(args.body).replaceAll(escapeHtml(APPLICATION_LINK), anchor)}${args.signature.html}`,
  };
}
