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
