// Where quoted reply history starts, for clients whose markup or text the
// server's reply parser does not recognize (for example "October 29 at
// 11:25 AM, Name <a@b.c> wrote:" without a leading "On").

const WROTE = /wrote:\s*$/i;
// An attribution names an address, a time or a year, so ordinary prose ending in "wrote:" is kept.
const ATTRIBUTION_DETAIL = /<[^<>\s]+@[^<>\s]+>|\d{1,2}:\d{2}|\b(?:19|20)\d{2}\b/;
const ORIGINAL_MESSAGE = /^-{2,}\s*Original Message\s*-{2,}$/i;
const HEADER_FROM = /^From:\s+\S/i;
const HEADER_NEXT = /^(?:Sent|Date|To|Subject):\s/i;

export function isQuoteAttribution(text: string) {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length <= 400 && WROTE.test(line) && ATTRIBUTION_DETAIL.test(line);
}

/** Outlook's "From: … Sent: …" header block or "-----Original Message-----". */
export function isQuotedHeaderBlock(text: string) {
  const value = text.replace(/\s+/g, " ").trim();
  return (
    ORIGINAL_MESSAGE.test(value) ||
    (value.length <= 1000 && HEADER_FROM.test(value) && /\b(?:Sent|Date):\s/i.test(value))
  );
}

const normalized = (text: string) => text.replace(/\s+/g, " ").trim();

/** Whether `text` is the stored model-detected first line of quoted history. */
export function isHistoryStartLine(text: string, historyStart: string | null | undefined) {
  return Boolean(historyStart && normalized(text) === normalized(historyStart));
}

/**
 * Splits plain text into the new message and its quoted history, if any. Known
 * markers come first; `historyStart` is the line Jev found when none matched.
 */
export function splitQuotedText(
  text: string,
  historyStart?: string | null,
): { current: string; quoted: string | null } {
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    let start = -1;
    if (ORIGINAL_MESSAGE.test(line)) start = index;
    else if (
      HEADER_FROM.test(line) &&
      lines.slice(index + 1, index + 4).some((next) => HEADER_NEXT.test(next.trim()))
    )
      start = index;
    else if (WROTE.test(line)) {
      // Clients wrap long attributions onto a second line.
      if (isQuoteAttribution(line)) start = index;
      else if (index > 0 && isQuoteAttribution(`${lines[index - 1]} ${line}`)) start = index - 1;
    }
    if (start < 0) continue;
    return split(text, lines, start);
  }
  const hinted = lines.findIndex((line, index) => index > 0 && isHistoryStartLine(line, historyStart));
  return hinted > 0 ? split(text, lines, hinted) : { current: text, quoted: null };
}

function split(text: string, lines: string[], start: number) {
  const current = lines.slice(0, start).join("\n").trim();
  // A message that is only history keeps it visible.
  if (!current) return { current: text, quoted: null };
  return { current, quoted: lines.slice(start).join("\n").trim() };
}
