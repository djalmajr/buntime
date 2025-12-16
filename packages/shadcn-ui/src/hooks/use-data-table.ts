import {
  type ColumnFiltersState,
  getCoreRowModel,
  getFacetedMinMaxValues,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
  type TableOptions,
  type TableState,
  type Updater,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import * as React from "react";
import { PAGE_SIZE_OPTIONS } from "../components/data-table/data-table-pagination";
import {
  parseSortingState,
  serializeSortingState,
} from "../components/data-table/data-table-parsers";
import type { ExtendedColumnSort, QueryKeys } from "../components/data-table/data-table-types";
import { useDebouncedCallback } from "./use-debounced-callback";
import { useQueryNumber, useQueryString } from "./use-query-state";

const PAGE_KEY = "page";
const PER_PAGE_KEY = "perPage";
const SORT_KEY = "sort";
const DEBOUNCE_MS = 300;

interface UseDataTableProps<TData>
  extends Omit<
    TableOptions<TData>,
    | "state"
    | "pageCount"
    | "getCoreRowModel"
    | "manualFiltering"
    | "manualPagination"
    | "manualSorting"
  > {
  pageCount?: number;
  initialState?: Omit<Partial<TableState>, "sorting"> & {
    sorting?: ExtendedColumnSort<TData>[];
  };
  queryKeys?: Partial<QueryKeys>;
  debounceMs?: number;
  enableAdvancedFilter?: boolean;
}

export function useDataTable<TData>(props: UseDataTableProps<TData>) {
  const {
    columns,
    data,
    pageCount: providedPageCount,
    initialState,
    queryKeys,
    debounceMs = DEBOUNCE_MS,
    enableAdvancedFilter = false,
    ...tableProps
  } = props;

  const pageKey = queryKeys?.page ?? PAGE_KEY;
  const perPageKey = queryKeys?.perPage ?? PER_PAGE_KEY;
  const sortKey = queryKeys?.sort ?? SORT_KEY;

  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>(
    initialState?.rowSelection ?? {},
  );
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(
    initialState?.columnVisibility ?? {},
  );

  const [page, setPage] = useQueryNumber(pageKey, 1);
  const [perPage, setPerPage] = useQueryNumber(
    perPageKey,
    initialState?.pagination?.pageSize ?? PAGE_SIZE_OPTIONS[0],
  );
  const [sortString, setSortString] = useQueryString(sortKey, "");

  const columnIds = React.useMemo(() => {
    return new Set(columns.map((column) => column.id).filter(Boolean) as string[]);
  }, [columns]);

  const sorting = React.useMemo<SortingState>(() => {
    if (sortString) {
      return parseSortingState<TData>(sortString, columnIds);
    }
    return initialState?.sorting ?? [];
  }, [sortString, columnIds, initialState?.sorting]);

  const pagination: PaginationState = React.useMemo(() => {
    return {
      pageIndex: page - 1,
      pageSize: perPage,
    };
  }, [page, perPage]);

  // Server-side pagination when pageCount is provided, client-side otherwise
  const isServerSide = providedPageCount !== undefined && providedPageCount >= 0;

  const pageCount = React.useMemo(() => {
    if (isServerSide) {
      return providedPageCount;
    }
    return Math.ceil((data?.length ?? 0) / perPage) || 1;
  }, [isServerSide, providedPageCount, data?.length, perPage]);

  const onPaginationChange = React.useCallback(
    (updaterOrValue: Updater<PaginationState>) => {
      if (typeof updaterOrValue === "function") {
        const newPagination = updaterOrValue(pagination);
        setPage(newPagination.pageIndex + 1);
        setPerPage(newPagination.pageSize);
      } else {
        setPage(updaterOrValue.pageIndex + 1);
        setPerPage(updaterOrValue.pageSize);
      }
    },
    [pagination, setPage, setPerPage],
  );

  const onSortingChange = React.useCallback(
    (updaterOrValue: Updater<SortingState>) => {
      const newSorting =
        typeof updaterOrValue === "function" ? updaterOrValue(sorting) : updaterOrValue;
      const serialized = serializeSortingState(newSorting as ExtendedColumnSort<TData>[]);
      setSortString(serialized === "[]" ? "" : serialized);
    },
    [sorting, setSortString],
  );

  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);

  const debouncedSetPage = useDebouncedCallback((newPage: number) => {
    setPage(newPage);
  }, debounceMs);

  const onColumnFiltersChange = React.useCallback(
    (updaterOrValue: Updater<ColumnFiltersState>) => {
      if (enableAdvancedFilter) return;

      setColumnFilters((prev) => {
        const next = typeof updaterOrValue === "function" ? updaterOrValue(prev) : updaterOrValue;
        debouncedSetPage(1);
        return next;
      });
    },
    [debouncedSetPage, enableAdvancedFilter],
  );

  const table = useReactTable({
    ...tableProps,
    columns,
    data,
    initialState,
    pageCount,
    state: {
      columnFilters,
      columnVisibility,
      pagination,
      rowSelection,
      sorting,
    },
    defaultColumn: {
      ...tableProps.defaultColumn,
    },
    enableColumnFilters: true,
    enableRowSelection: true,
    manualPagination: isServerSide,
    getCoreRowModel: getCoreRowModel(),
    getFacetedMinMaxValues: getFacetedMinMaxValues(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onColumnFiltersChange,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange,
    onRowSelectionChange: setRowSelection,
    onSortingChange,
    meta: {
      ...tableProps.meta,
      queryKeys: {
        filters: "filters",
        joinOperator: "joinOperator",
        page: pageKey,
        perPage: perPageKey,
        sort: sortKey,
      },
    },
  });

  return { table, columnFilters, debounceMs, page, perPage };
}
