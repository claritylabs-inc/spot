import { escapeHtml } from "@claritylabs-inc/ui/lib/email";
import { buildOperatorSignature } from "./teamEmail";
import type { ComposedOutreachEmail } from "./providerOutreachEmail";

/**
 * Client information-request email composition. The first email is the
 * operator's own subject and text; follow-ups are deterministic nudges on the
 * same thread. No model call: client-facing wording stays the operator's.
 */

export type ClientOutreachEmailInput = {
  kind: "initial" | "follow_up";
  isFinal: boolean;
  recipientName?: string;
  /** The sender's full name, as signed. */
  operator: { name: string };
  message: { subject: string; text: string };
};

function firstName(name: string | undefined) {
  return name?.replace(/\s+/g, " ").trim().split(" ")[0] || undefined;
}

function body(input: ClientOutreachEmailInput) {
  if (input.kind === "initial") return input.message.text.trim();
  const ask =
    "Following up on my note below. When you have a moment, could you send over the information I asked for? You can reply to this email with answers or attachments.";
  return input.isFinal
    ? `${ask}\n\nThis is my last reminder. If anything is unavailable or unclear, just let me know and we can work around it.`
    : ask;
}

export function composeClientOutreachEmail(
  input: ClientOutreachEmailInput,
): ComposedOutreachEmail {
  const subject =
    input.kind === "initial" || /^re:/i.test(input.message.subject)
      ? input.message.subject
      : `Re: ${input.message.subject}`;
  const greeting = `Hi ${firstName(input.recipientName) ?? "there"},`;
  const signature = buildOperatorSignature(input.operator);
  const paragraphs = [greeting, ...body(input).split(/\n{2,}/), "Thanks,"];
  return {
    subject,
    text: [...paragraphs, signature.text].join("\n\n"),
    html:
      paragraphs
        .map(
          (value) =>
            `<p style="margin:0 0 16px">${escapeHtml(value).replace(/\n/g, "<br>")}</p>`,
        )
        .join("") + signature.html,
    source: input.kind === "initial" ? "operator" : "template",
  };
}
