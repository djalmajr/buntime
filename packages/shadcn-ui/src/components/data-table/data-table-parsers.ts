import { isEqual } from "es-toolkit";
import { useCallback, useMemo, useRef } from "react";
import z from "zod/v4";
import { useQueryState } from "../../hooks/use-query-state";
import { dataTableConfig } from "./data-table-config";
import type { ExtendedColumnFilter, ExtendedColumnSort, JoinOperator } from "./data-table-types";

const sortingItemSchema = z.object({
  id: z.string(),
  desc: z.boolean(),
});

/**
 * Parse sorting state from URL query string
 */
export function parseSortingState<TData>(
  value: string | null | undefined,
  columnIds?: string[] | Set<string>,
): ExtendedColumnSort<TData>[] {
  if (!value) return [];

  const validKeys = columnIds ? (columnIds instanceof Set ? columnIds : new Set(columnIds)) : null;

  try {
    const parsed = JSON.parse(value);
    const result = z.array(sortingItemSchema).safeParse(parsed);

    if (!result.success) return [];

    if (validKeys && result.data.some((item) => !validKeys.has(item.id))) {
      return [];
    }

    return result.data as ExtendedColumnSort<TData>[];
  } catch {
    return [];
  }
}

/**
 * Serialize sorting state to URL query string
 */
export function serializeSortingState<TData>(value: ExtendedColumnSort<TData>[]): string {
  return JSON.stringify(value);
}

const filterItemSchema = z.object({
  filterId: z.string(),
  id: z.string(),
  operator: z.enum(dataTableConfig.operators),
  value: z.union([z.string(), z.array(z.string())]),
  variant: z.enum(dataTableConfig.filterVariants),
});

export type FilterItemSchema = z.infer<typeof filterItemSchema>;

/**
 * Parse filters state from URL query string
 */
export function parseFiltersState<TData>(
  value: string | null | undefined,
  columnIds?: string[] | Set<string>,
): ExtendedColumnFilter<TData>[] {
  if (!value) return [];

  const validKeys = columnIds ? (columnIds instanceof Set ? columnIds : new Set(columnIds)) : null;

  try {
    const parsed = JSON.parse(value);
    const result = z.array(filterItemSchema).safeParse(parsed);

    if (!result.success) return [];

    if (validKeys && result.data.some((item) => !validKeys.has(item.id))) {
      return [];
    }

    return result.data as ExtendedColumnFilter<TData>[];
  } catch {
    return [];
  }
}

/**
 * Serialize filters state to URL query string
 */
export function serializeFiltersState<TData>(value: ExtendedColumnFilter<TData>[]): string {
  return JSON.stringify(value);
}

type ValueOrFn<T> = T | ((prev: T) => T);

type SetFiltersState<TData> = (value: ValueOrFn<ExtendedColumnFilter<TData>[]>) => void;

type FiltersResult<TData> = [ExtendedColumnFilter<TData>[], SetFiltersState<TData>];

interface UseFiltersStateOptions {
  columnIds?: string[];
  key?: string;
}

/**
 * Hook to manage filters state in URL query params
 */
export function useFiltersState<TData>(options: UseFiltersStateOptions = {}): FiltersResult<TData> {
  const { columnIds, key = "filters" } = options;
  const [raw, setRaw] = useQueryState(key, "");
  const prevFilters = useRef<ExtendedColumnFilter<TData>[]>([]);

  const filters = useMemo(() => {
    const parsed = parseFiltersState<TData>(raw, columnIds);
    if (isEqual(prevFilters.current, parsed)) return prevFilters.current;
    prevFilters.current = parsed;
    return parsed;
  }, [raw, columnIds]);

  const setFilters = useCallback(
    (value: ValueOrFn<ExtendedColumnFilter<TData>[]>) => {
      const next = typeof value === "function" ? value(filters) : value;
      setRaw(next.length > 0 ? serializeFiltersState(next) : "");
    },
    [filters, setRaw],
  );

  return [filters, setFilters];
}

type SetJoinOperatorState = (value: JoinOperator) => void;

type JoinOperatorResult = [JoinOperator, SetJoinOperatorState];

/**
 * Hook to manage join operator state in URL query params
 */
export function useJoinOperatorState(key = "joinOperator"): JoinOperatorResult {
  const [raw, setRaw] = useQueryState(key, "and");

  const joinOperator = useMemo<JoinOperator>(() => (raw === "or" ? "or" : "and"), [raw]);

  const setJoinOperator = useCallback((value: JoinOperator) => setRaw(value), [setRaw]);

  return [joinOperator, setJoinOperator];
}

type SetSortingState<TData> = (value: ValueOrFn<ExtendedColumnSort<TData>[]>) => void;

type SortingResult<TData> = [ExtendedColumnSort<TData>[], SetSortingState<TData>];

interface UseSortingStateOptions {
  columnIds?: string[];
  key?: string;
}

/**
 * Hook to manage sorting state in URL query params
 */
export function useSortingState<TData>(options: UseSortingStateOptions = {}): SortingResult<TData> {
  const { columnIds, key = "sorting" } = options;
  const [raw, setRaw] = useQueryState(key, "");
  const prevSorting = useRef<ExtendedColumnSort<TData>[]>([]);

  const sorting = useMemo(() => {
    const parsed = parseSortingState<TData>(raw, columnIds);
    if (isEqual(prevSorting.current, parsed)) return prevSorting.current;
    prevSorting.current = parsed;
    return parsed;
  }, [raw, columnIds]);

  const setSorting = useCallback(
    (value: ValueOrFn<ExtendedColumnSort<TData>[]>) => {
      const next = typeof value === "function" ? value(sorting) : value;
      setRaw(next.length > 0 ? serializeSortingState(next) : "");
    },
    [sorting, setRaw],
  );

  return [sorting, setSorting];
}
