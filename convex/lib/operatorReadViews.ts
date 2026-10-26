/**
 * Compact projections for operator read tools. Bulk reads default to these so a
 * ten-item call stays small; `view: "full"` returns the complete document.
 */

export const MAX_BULK_READ_IDS = 10;

const COMPACT_THREAD_MESSAGES = 5;
const COMPACT_BODY_CHARS = 1_200;
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
>(details: T) {
  const { readAt: _readAt, messages, ...rest } = details;
  const shown = messages.slice(-COMPACT_THREAD_MESSAGES);
  return {
    ...rest,
    messages: shown.map((message) => {
      const { files, unfiledFiles, currentText, ...fields } = message;
      return {
        ...fields,
        currentText: currentText.slice(0, COMPACT_BODY_CHARS),
        currentTextTruncated: currentText.length > COMPACT_BODY_CHARS,
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
