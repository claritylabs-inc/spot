export function requireZero(result, ...keys) {
  for (const key of keys) {
    if (typeof result[key] !== "number" || !Number.isFinite(result[key])) {
      throw new Error(`Verification omitted numeric ${key}`);
    }
    if (result[key] !== 0)
      throw new Error(`Migration has residual ${key}: ${result[key]}`);
  }
}

export function createMigrationRunner({
  run,
  checkpoint = () => {},
  log = () => {},
}) {
  function pages(name, args = {}, { optionalCursor = false } = {}) {
    let cursor = null;
    const totals = {};
    const seen = new Set();
    let metrics;
    for (let page = 0; page < 10_000; page += 1) {
      const result = run(name, {
        ...args,
        ...(cursor === null && optionalCursor ? {} : { cursor }),
      });
      if (!result || typeof result !== "object" || Array.isArray(result))
        throw new Error(`${name} returned an invalid page`);
      metrics ??= Object.keys(result).filter(
        (key) => typeof result[key] === "number" && key !== "checkedAt",
      );
      for (const key of metrics)
        if (typeof result[key] !== "number")
          throw new Error(`${name} omitted numeric ${key} on page ${page}`);
      for (const [key, value] of Object.entries(result)) {
        if (typeof value === "number" && key !== "checkedAt") {
          if (!Number.isFinite(value) || value < 0)
            throw new Error(`${name} returned an invalid ${key}`);
          totals[key] = (totals[key] ?? 0) + value;
        }
      }
      const done = result.isDone ?? result.complete;
      if (
        typeof done !== "boolean" ||
        (typeof result.isDone === "boolean" &&
          typeof result.complete === "boolean" &&
          result.isDone !== result.complete)
      ) {
        throw new Error(`${name} omitted or contradicted its completion flag`);
      }
      const next = result.cursor ?? result.continueCursor ?? result.nextCursor;
      checkpoint({
        name,
        args,
        page,
        cursor,
        nextCursor: next ?? null,
        done,
        totals: { ...totals },
        result,
      });
      if (result.conflicts?.length)
        throw new Error(
          `${name} found ambiguous existing records; reconcile them before continuing`,
        );
      if (done) {
        log(`${name} ${JSON.stringify(args)}`, totals);
        return totals;
      }
      if (
        typeof next !== "string" ||
        !next ||
        next === cursor ||
        seen.has(next)
      )
        throw new Error(`${name} did not advance its cursor`);
      seen.add(next);
      cursor = next;
    }
    throw new Error(
      `${name} exceeded the bounded page budget; review its checkpoint before resuming`,
    );
  }

  function batches(name, args = {}) {
    let affected = 0;
    for (let page = 0; page < 10_000; page += 1) {
      const result = run(name, args);
      const count = result.deleted ?? result.migrated;
      if (
        !Number.isInteger(count) ||
        count < 0 ||
        typeof result.complete !== "boolean"
      )
        throw new Error(`${name} returned an invalid batch`);
      affected += count;
      checkpoint({ name, args, page, result, affected });
      if (result.complete) {
        log(`${name} ${JSON.stringify(args)}`, { affected });
        return;
      }
      if (!count) throw new Error(`${name} did not make progress`);
    }
    throw new Error(`${name} exceeded the bounded page budget`);
  }
  return { pages, batches };
}
