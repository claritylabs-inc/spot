export const OPERATOR_BATCH_LIMIT = 50;

/** Validate every item before applying any writes. Preparation must be read-only. */
export async function prepareOperatorBatch<T, Prepared>(
  items: readonly T[],
  key: (item: T) => string,
  prepare: (item: T, index: number) => Promise<Prepared>,
): Promise<Prepared[]> {
  if (items.length < 1 || items.length > OPERATOR_BATCH_LIMIT) {
    throw new Error(`A batch must contain 1–${OPERATOR_BATCH_LIMIT} items`);
  }
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    const id = key(item);
    if (seen.has(id))
      throw new Error(`Item ${index + 1} (${id}): duplicate target`);
    seen.add(id);
  }
  const prepared: Prepared[] = [];
  for (const [index, item] of items.entries()) {
    try {
      prepared.push(await prepare(item, index));
    } catch (error) {
      throw new Error(
        `Item ${index + 1} (${key(item)}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return prepared;
}

/** Call inside a nested mutation so a caller catching errors cannot commit a partial batch. */
export async function applyOperatorBatch<T, Result>(
  prepared: readonly T[],
  applyAndAudit: (item: T, index: number) => Promise<Result>,
): Promise<{ results: Result[] }> {
  const results: Result[] = [];
  for (const [index, item] of prepared.entries()) {
    results.push(await applyAndAudit(item, index));
  }
  return { results };
}
