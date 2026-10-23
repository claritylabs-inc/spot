"use client";

import {
  useTableSort as useSharedTableSort,
  type TableSort,
  type TableSortValue,
} from "@claritylabs-inc/ui/hooks/use-table-sort";

import { useFollowedState } from "@/hooks/use-followed-state";

export type { TableSort, TableSortValue };

/** The shared click-to-sort hook, with the sort followed by teammates. */
export function useTableSort<Row, Key extends string>(
  followKey: string,
  rows: readonly Row[],
  columns: Record<Key, (row: Row) => TableSortValue>,
  initial: NoInfer<TableSort<Key>> = null,
) {
  const state = useFollowedState<TableSort<Key>>(`${followKey}:sort`, initial);
  return useSharedTableSort(rows, columns, { initial, state });
}
