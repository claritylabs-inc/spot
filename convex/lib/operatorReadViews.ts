import { z } from "zod";

/**
 * Compact projections for operator read tools. Bulk reads default to these so a
 * large call stays inside the bounded tool output; `view: "full"` returns the
 * complete document.
 */

/**
 * Bulk exact-ID cap for reads that run each item in its own query or are
 * cheap per item. Heavier reads pass a lower per-tool cap.
 */
export const MAX_BULK_READ_IDS = 50;

/** A bulk ID list whose overflow error states the cap, so the model splits the call. */
export function bulkReadIds<T extends z.ZodType>(
  id: T,
  max: number = MAX_BULK_READ_IDS,
) {
  return z
    .array(id)
    .min(1)
    .max(max, `At most ${max} IDs per call; split the rest into another call.`);
}

const COMPACT_THREAD_MESSAGES = 5;
const COMPACT_BODY_CHARS = 1_200;
// Bulk thread excerpts share this text budget so every thread fits the
// bounded tool output; large batches show the newest two messages.
const COMPACT_BULK_TEXT_CHARS = 16_000;
const COMPACT_BULK_MIN_BODY_CHARS = 200;
const OFFER_SUMMARY_FIELDS = [
  "carrier",
  "quoteNumber",
  "insuredName",
  "premium",
  "proposedEffectiveDate",
  "proposedExpirationDate",
  "quoteExpirationDate",
] as const;

/** De-duplicated ids, so a repeated id is read and reported once. */
export function uniqueIds(ids: string[]) {
  return [...new Set(ids)];
}

/** Reads each id independently; an invalid or missing one is reported, never fails the batch. */
export async function readMany<T>(
  ids: string[],
  read: (id: string) => Promise<T | null>,
) {
  const rows = await Promise.all(ids.map(read));
  return {
    items: rows.flatMap((row) => (row === null ? [] : [row])),
    notFound: ids.filter((_, index) => rows[index] === null),
  };
}

type ProposalDocument = { url?: unknown };
type ProposalLike = {
  extractedOffer?: unknown;
  sectionHeadings?: unknown;
  documents: ProposalDocument[];
};

/** Keeps the readable `proposalMarkdown` and scalar offer headlines; drops the raw offer tree and file URLs. */
export function compactProposal<T extends ProposalLike>(proposal: T) {
  const {
    extractedOffer,
    sectionHeadings: _sectionHeadings,
    documents,
    ...rest
  } = proposal;
  const offer =
    extractedOffer && typeof extractedOffer === "object"
      ? (extractedOffer as Record<string, unknown>)
      : null;
  return {
    ...rest,
    extractedOffer: offer
      ? Object.fromEntries(
          OFFER_SUMMARY_FIELDS.filter((key) => offer[key] !== undefined).map(
            (key) => [key, offer[key]],
          ),
        )
      : undefined,
    documents: documents.map(({ url: _url, ...document }) => document),
  };
}

type ThreadMessageLike = {
  currentText: string;
  files: Array<{ url?: unknown } | null>;
  unfiledFiles: Array<{ url?: unknown; storageId?: unknown }>;
};
type ThreadLike<M extends ThreadMessageLike> = {
  messages: M[];
  messagesTruncated: boolean;
  readAt?: unknown;
};

/** Newest messages with trimmed bodies and attachment names only; the count of omitted messages is explicit. */
export function compactTeamThread<
  M extends ThreadMessageLike,
  T extends ThreadLike<M>,
>(details: T, batchSize = 1) {
  const { readAt: _readAt, messages, ...rest } = details;
  const messageCount = batchSize > 10 ? 2 : COMPACT_THREAD_MESSAGES;
  const bodyChars =
    batchSize > 1
      ? Math.min(
          COMPACT_BODY_CHARS,
          Math.max(
            COMPACT_BULK_MIN_BODY_CHARS,
            Math.floor(COMPACT_BULK_TEXT_CHARS / (batchSize * messageCount)),
          ),
        )
      : COMPACT_BODY_CHARS;
  const shown = messages.slice(-messageCount);
  return {
    ...rest,
    messages: shown.map((message) => {
      const { files, unfiledFiles, currentText, ...fields } = message;
      return {
        ...fields,
        currentText: currentText.slice(0, bodyChars),
        currentTextTruncated: currentText.length > bodyChars,
        files: files.map((file) => {
          if (!file) return null;
          const { url: _url, ...named } = file;
          return named;
        }),
        unfiledFiles: unfiledFiles.map(
          ({ url: _url, storageId: _storageId, ...named }) => named,
        ),
      };
    }),
    messagesTruncated:
      details.messagesTruncated || messages.length > shown.length,
    messagesOmitted: messages.length - shown.length,
  };
}
