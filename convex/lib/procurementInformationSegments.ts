export type EmailSegment = { start: number; end: number; text: string };

const MAX_SEGMENT_CHARS = 1500;
const LIST_ITEM = /^\s*(?:[-*•]|\(?\d{1,3}[.)]|\(?[a-z][.)])\s+/i;

function pieces(text: string, start: number, pattern: RegExp) {
  const result: EmailSegment[] = [];
  let from = 0;
  for (const match of text.matchAll(pattern)) {
    const end = (match.index ?? 0) + match[0].length;
    result.push({
      start: start + from,
      end: start + end,
      text: text.slice(from, end),
    });
    from = end;
  }
  if (from < text.length)
    result.push({
      start: start + from,
      end: start + text.length,
      text: text.slice(from),
    });
  return result;
}

/** Splits a long piece at sentence boundaries without exceeding the segment size. */
function bySentence(piece: EmailSegment) {
  if (piece.text.length <= MAX_SEGMENT_CHARS) return [piece];
  const result: EmailSegment[] = [];
  for (const sentence of pieces(piece.text, piece.start, /[.?!]\s+/g)) {
    const last = result.at(-1);
    if (last && last.text.length + sentence.text.length <= MAX_SEGMENT_CHARS)
      result[result.length - 1] = {
        start: last.start,
        end: sentence.end,
        text: last.text + sentence.text,
      };
    else if (sentence.text.length <= MAX_SEGMENT_CHARS) result.push(sentence);
    else
      for (
        let offset = 0;
        offset < sentence.text.length;
        offset += MAX_SEGMENT_CHARS
      )
        result.push({
          start: sentence.start + offset,
          end: Math.min(
            sentence.end,
            sentence.start + offset + MAX_SEGMENT_CHARS,
          ),
          text: sentence.text.slice(offset, offset + MAX_SEGMENT_CHARS),
        });
  }
  return result;
}

/** Splits list blocks into one segment per item; continuation lines stay with their item. */
function byListItem(block: EmailSegment) {
  const lines = pieces(block.text, block.start, /\n/g);
  if (lines.filter((line) => LIST_ITEM.test(line.text)).length < 2)
    return [block];
  const result: EmailSegment[] = [];
  for (const line of lines) {
    const last = result.at(-1);
    if (last && !LIST_ITEM.test(line.text))
      result[result.length - 1] = {
        start: last.start,
        end: line.end,
        text: last.text + line.text,
      };
    else result.push(line);
  }
  return result;
}

/**
 * Deterministic paragraph, list-item and sentence segments with source offsets,
 * so each segment can be judged independently and quotes map back to one segment.
 */
export function emailSegments(body: string): EmailSegment[] {
  return pieces(body, 0, /\n\s*\n/g)
    .flatMap(byListItem)
    .flatMap(bySentence)
    .map((segment) => {
      const leading = segment.text.length - segment.text.trimStart().length;
      const text = segment.text.trim();
      return {
        start: segment.start + leading,
        end: segment.start + leading + text.length,
        text,
      };
    })
    .filter((segment) => segment.text.length > 0);
}

/** Index of the segment containing the start of `quote`, or -1. */
export function segmentForQuote(
  segments: EmailSegment[],
  body: string,
  quote: string,
) {
  const index = body.indexOf(quote);
  if (index < 0) return -1;
  return segments.findIndex(
    (segment) => index >= segment.start && index < segment.end,
  );
}

/** Contiguous runs of `indexes` (sorted), each within the character budget. */
export function contiguousGroups(
  segments: EmailSegment[],
  indexes: number[],
  maxChars: number,
) {
  const groups: number[][] = [];
  let size = 0;
  for (const index of indexes) {
    const group = groups.at(-1);
    const length = segments[index].text.length;
    if (group && group.at(-1) === index - 1 && size + length <= maxChars) {
      group.push(index);
      size += length;
    } else {
      groups.push([index]);
      size = length;
    }
  }
  return groups;
}
