/** Web addresses in plain text: `http(s)://…` or `www.…`. */
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"'[\]]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?'"*_]+$/;

export type TextLink = { start: number; end: number; href: string };

/**
 * The links in `text` with their offsets. Sentence punctuation after a link
 * stays outside it, as does a closing parenthesis the link did not open.
 */
export function findTextLinks(text: string): TextLink[] {
  const links: TextLink[] = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    let url = match[0];
    for (;;) {
      const trimmed = url.replace(TRAILING_PUNCTUATION, "");
      const unopened =
        trimmed.endsWith(")") &&
        trimmed.split(")").length > trimmed.split("(").length;
      const next = unopened ? trimmed.slice(0, -1) : trimmed;
      if (next === url) break;
      url = next;
    }
    if (!/[^.]\.[a-z]/i.test(url.replace(/^(?:https?:\/\/)/i, ""))) continue;
    links.push({
      start: match.index,
      end: match.index + url.length,
      href: /^www\./i.test(url) ? `https://${url}` : url,
    });
  }
  return links;
}
