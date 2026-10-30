/**
 * A thread's origin (`initialContext`) never changes; its page context is what
 * the agent uses and can be removed or replaced mid-thread. `null` means
 * removed; `undefined` (threads created before the split) falls back to the
 * origin.
 */
export function threadPageContext<T>(thread: {
  initialContext?: T;
  pageContext?: T | null;
}): T | undefined {
  return thread.pageContext === undefined
    ? thread.initialContext
    : (thread.pageContext ?? undefined);
}

const MAX_RELATED = 10;
const RELATED_KIND = /^[a-z][a-z_]{1,39}$/;

/** Trims and bounds a client-supplied operator page context. */
export function normalizeOperatorPageContext(
  context:
    | {
        pageType: string;
        entityId?: string;
        summary?: string;
        href?: string;
        related?: Array<{ kind: string; id: string; label?: string }>;
      }
    | undefined,
) {
  if (!context) return undefined;
  const pageType = context.pageType.trim();
  const entityId = context.entityId?.trim() || undefined;
  const summary = context.summary?.trim() || undefined;
  const href = context.href?.trim() || undefined;
  if (!pageType || pageType.length > 100) {
    throw new Error("Operator page type must be 1–100 characters");
  }
  if (entityId && entityId.length > 200) {
    throw new Error("Operator page entity ID must be at most 200 characters");
  }
  if (summary && summary.length > 500) {
    throw new Error("Operator page summary must be at most 500 characters");
  }
  if (href && href.length > 2000) {
    throw new Error("Operator page URL must be at most 2000 characters");
  }
  // Order is kept. A malformed entry is dropped, never rejected, so a bad
  // chip cannot block sending a message.
  const related = (context.related ?? [])
    .map((entry) => ({
      kind: entry.kind.trim(),
      id: entry.id.trim(),
      label: entry.label?.trim().slice(0, 200) || undefined,
    }))
    .filter(
      (entry) =>
        RELATED_KIND.test(entry.kind) && entry.id && entry.id.length <= 200,
    )
    .slice(0, MAX_RELATED);
  return {
    pageType,
    ...(entityId ? { entityId } : {}),
    ...(summary ? { summary } : {}),
    ...(href ? { href } : {}),
    ...(related.length > 0
      ? {
          related: related.map(({ kind, id, label }) => ({
            kind,
            id,
            ...(label ? { label } : {}),
          })),
        }
      : {}),
  };
}
