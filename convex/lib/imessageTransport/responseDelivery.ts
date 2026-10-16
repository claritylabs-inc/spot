const RESPONSE_SEGMENT_MAX_CHARS = 520;

function hardSplitToken(token: string): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const codePoint of token) {
    if (
      current &&
      current.length + codePoint.length > RESPONSE_SEGMENT_MAX_CHARS
    ) {
      chunks.push(current);
      current = "";
    }
    current += codePoint;
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitLongTextLine(line: string): string[] {
  if (line.length <= RESPONSE_SEGMENT_MAX_CHARS) return [line];

  const chunks: string[] = [];
  let current = "";
  for (const word of line.split(/\s+/).filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= RESPONSE_SEGMENT_MAX_CHARS) {
      current = next;
      continue;
    }
    if (current) chunks.push(current);
    const wordChunks = hardSplitToken(word);
    chunks.push(...wordChunks.slice(0, -1));
    current = wordChunks.at(-1) ?? "";
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitBlock(block: string): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const rawLine of block.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    for (const part of splitLongTextLine(line)) {
      const next = current ? `${current}\n${part}` : part;
      if (next.length <= RESPONSE_SEGMENT_MAX_CHARS) {
        current = next;
        continue;
      }
      if (current) chunks.push(current);
      current = part;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

export function splitImessageResponse(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .trim()
    .split(/\n{2,}/)
    .flatMap((block) => splitBlock(block))
    .filter(Boolean);
}

export type ImessageResponseDeliveryResult = {
  mode: "none" | "thread" | "chat";
  deliveredSegments: number;
  expectedSegments: number;
  complete: boolean;
  error?: unknown;
};

/**
 * Attempts every response bubble in one reply operation so the provider
 * binds them all to the same source message. Ordinary chat delivery is used
 * when the reply operation reports that it sent zero bubbles, or when the
 * caller recognizes a provider rejection that happened before delivery.
 */
export async function deliverImessageResponse(args: {
  segments: string[];
  replyAll: (segments: string[]) => Promise<number>;
  sendChat: (segment: string) => Promise<void>;
  canFallbackAfterReplyError?: (error: unknown) => boolean;
}): Promise<ImessageResponseDeliveryResult> {
  const expectedSegments = args.segments.length;
  if (expectedSegments === 0) {
    return {
      mode: "none",
      deliveredSegments: 0,
      expectedSegments,
      complete: true,
    };
  }

  let deliveredSegments: number;
  try {
    deliveredSegments = Math.max(
      0,
      Math.min(expectedSegments, await args.replyAll(args.segments)),
    );
  } catch (error) {
    if (args.canFallbackAfterReplyError?.(error)) {
      for (const segment of args.segments) {
        await args.sendChat(segment);
      }
      return {
        mode: "chat",
        deliveredSegments: expectedSegments,
        expectedSegments,
        complete: true,
        error,
      };
    }
    return {
      mode: "thread",
      deliveredSegments: 0,
      expectedSegments,
      complete: false,
      error,
    };
  }

  if (deliveredSegments > 0) {
    return {
      mode: "thread",
      deliveredSegments,
      expectedSegments,
      complete: deliveredSegments === expectedSegments,
    };
  }

  for (const segment of args.segments) {
    await args.sendChat(segment);
  }
  return {
    mode: "chat",
    deliveredSegments: expectedSegments,
    expectedSegments,
    complete: true,
  };
}
