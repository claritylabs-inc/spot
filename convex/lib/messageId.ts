/** RFC Message-ID spellings: bracketed (`<id>`), bare (`id`) and comparison keys. */
const MAX_MESSAGE_ID_CHARS = 500;

/** The Message-ID without its angle brackets. */
export const bareRfcId = (messageId: string) =>
  messageId.trim().replace(/^<|>$/g, "").trim();

/** The bracketed form, as Spot records its own sends. */
export const asRfcId = (messageId: string) =>
  messageId.startsWith("<") ? messageId : `<${messageId}>`;

/** Case-insensitive key for comparing the same Message-ID across spellings. */
export const comparableRfcId = (messageId: string | null | undefined) =>
  (messageId ? bareRfcId(messageId).toLowerCase() : "") || null;

/**
 * Every stored spelling an RFC Message-ID may take: Spot records its own sends
 * bracketed, Resend reports the header as it arrived (bracketed or bare, and
 * possibly re-cased). Each form is a candidate for a `by_messageId` lookup.
 */
export function messageIdForms(messageId: string) {
  const bare = bareRfcId(messageId);
  if (!bare) return [];
  return [
    ...new Set(
      [bare, bare.toLowerCase()].flatMap((form) => [`<${form}>`, form]),
    ),
  ].map((form) => form.slice(0, MAX_MESSAGE_ID_CHARS));
}
