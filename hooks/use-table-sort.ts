"use client";

import {
  useTableSort as useSharedTableSort,
  type TableSort,
  type TableSortValue,
} from "@claritylabs-inc/ui/hooks/use-table-sort";

import { useSavedFollowedState } from "@/hooks/use-saved-followed-state";

export type { TableSort, TableSortValue };

/** The shared click-to-sort hook, with the sort followed by teammates and remembered by this browser. */
export function useTableSort<Row, Key extends string>(
  followKey: string,
  rows: readonly Row[],
  columns: Record<Key, (row: Row) => TableSortValue>,
  initial: NoInfer<TableSort<Key>> = null,
  { persist = true }: { persist?: boolean } = {},
) {
  const state = useSavedFollowedState<TableSort<Key>>(
    `${followKey}:sort`,
    initial,
    { persist },
  );
  return useSharedTableSort(rows, columns, { initial, state });
}
