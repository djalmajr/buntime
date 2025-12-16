import type {
  ColumnDef,
  ColumnFiltersState,
  RowSelectionState,
  SortingState,
  Table,
  VisibilityState,
} from "@tanstack/react-table";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "../../utils/cn";
import { PAGE_SIZE_OPTIONS } from "../data-table/data-table-pagination";
import { Checkbox } from "./checkbox";
import { Icon } from "./icon";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationFirst,
  PaginationItem,
  PaginationLast,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "./pagination";
import { ScrollArea } from "./scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { Skeleton } from "./skeleton";

interface ListTableLabels {
  emptyText?: string;
  errorText?: string;
  itemsCount?: string;
  page?: string;
  selected?: string;
}

interface ListTablePagination {
  total?: number;
  totalPages?: number;
}

export interface ListTableProps<T> {
  children?: React.ReactNode | ((table: Table<T>) => React.ReactNode);
  className?: string;
  columns: ColumnDef<T>[];
  data?: T[];
  emptyText?: string;
  enableRowSelection?: boolean;
  errorText?: string;
  getRowId?: (row: T) => string;
  isLoading: boolean;
  labels?: ListTableLabels;
  limit?: number;
  page?: number;
  pagination?: ListTablePagination;
  onLimitChange?: (limit: number) => void;
  onPageChange?: (page: number) => void;
  onRowClick?: (row: T) => void;
  onSelectionChange?: (rows: T[]) => void;
}

const MAX_VISIBLE_PAGES = 7;

/**
 * Get visible page numbers for pagination (fixed size with ellipsis).
 * Returns array of exactly `maxVisible` items (numbers or null for ellipsis).
 * First item is always 1, last item is always totalPages.
 */
function getPageRange(
  currentPage: number,
  totalPages: number,
  maxVisible: number,
): (number | null)[] {
  const rIdx = maxVisible - 1;
  const mIdx = Math.floor(maxVisible / 2);

  // Low range: [1, 2, 3, 4, 5, 6, 7]
  const lowRange = Array.from({ length: maxVisible }, (_, i) => i + 1);

  // High range: [N-6, N-5, N-4, N-3, N-2, N-1, N]
  const highRange = Array.from({ length: maxVisible }, (_, i) => totalPages - rIdx + i);

  // Mid range: centered on currentPage
  const midRange = Array.from({ length: maxVisible }, (_, i) => currentPage - mIdx + i);

  // Pick range based on middle value position
  const range: (number | null)[] =
    midRange[mIdx]! < lowRange[mIdx]!
      ? [...lowRange]
      : midRange[mIdx]! > highRange[mIdx]!
        ? [...highRange]
        : [...midRange];

  // Fix first and last positions
  range[0] = 1;
  range[rIdx] = totalPages;

  // Add ellipsis where there's a gap
  if ((range[1] as number) - (range[0] as number) > 1) {
    range[1] = null; // ellipsis
  }
  if ((range[rIdx] as number) - (range[rIdx - 1] as number) > 1) {
    range[rIdx - 1] = null; // ellipsis
  }

  return range;
}

export function ListTable<T>({
  children,
  className,
  columns: userColumns,
  data = [],
  emptyText,
  enableRowSelection = false,
  errorText,
  getRowId,
  isLoading,
  labels,
  limit = PAGE_SIZE_OPTIONS[0] ?? 25,
  page = 1,
  pagination,
  onLimitChange,
  onPageChange,
  onRowClick,
  onSelectionChange,
}: ListTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const handleNextPage = useCallback(() => {
    if (page < (pagination?.totalPages ?? 0)) onPageChange?.(page + 1);
  }, [page, pagination, onPageChange]);

  const handlePreviousPage = useCallback(() => {
    if (page > 1) onPageChange?.(page - 1);
  }, [page, onPageChange]);

  const handleItemsPerPageChange = useCallback(
    (newLimit: number) => {
      onLimitChange?.(newLimit);
      onPageChange?.(1);
    },
    [onLimitChange, onPageChange],
  );

  // Create checkbox column if row selection is enabled
  const checkboxColumn: ColumnDef<T> = useMemo(
    () => ({
      id: "select",
      header: ({ table }) => (
        <Checkbox
          aria-label="Select all"
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label="Select row"
          checked={row.getIsSelected()}
          onClick={(e) => e.stopPropagation()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
        />
      ),
      enableHiding: false,
      enableSorting: false,
      size: 40,
    }),
    [],
  );

  const columns = useMemo(
    () => (enableRowSelection ? [checkboxColumn, ...userColumns] : userColumns),
    [checkboxColumn, enableRowSelection, userColumns],
  );

  // Notify parent of selection changes
  useEffect(() => {
    if (onSelectionChange) {
      const selectedIds = Object.keys(rowSelection).filter((key) => rowSelection[key]);
      const selectedRows = data.filter((row, index) => {
        const rowId = getRowId ? getRowId(row) : String(index);
        return selectedIds.includes(rowId);
      });
      onSelectionChange(selectedRows);
    }
  }, [rowSelection, data, getRowId, onSelectionChange]);

  const table = useReactTable({
    columns,
    data,
    enableRowSelection,
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
    manualPagination: true,
    pageCount: pagination?.totalPages || -1,
    state: {
      columnFilters,
      columnVisibility,
      pagination: {
        pageIndex: page - 1,
        pageSize: limit || 10,
      },
      rowSelection,
      sorting,
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
  });

  const canNextPage = pagination ? page < pagination.totalPages! : false;
  const canPreviousPage = page > 1;
  const totalPages = pagination?.totalPages;
  const totalItems = pagination?.total;

  return (
    <div className={cn("flex flex-1 flex-col gap-4 overflow-hidden", className)}>
      {typeof children === "function" ? children(table) : children}
      <div className="overflow-hidden rounded-md border">
        <div className="h-full relative overflow-hidden">
          <ScrollArea className="h-full" orientation="both">
            <table className="w-full caption-bottom text-sm">
              <thead className="sticky top-0 z-10 bg-background after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:bg-border">
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr
                    key={headerGroup.id}
                    className="border-b border-border transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted"
                  >
                    {headerGroup.headers.map((header) => (
                      <th
                        key={header.id}
                        className="h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0"
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody className="relative [&_tr:last-child]:border-0">
                {isLoading && !table.getRowModel().rows?.length ? (
                  Array.from({ length: 6 }).map((_, idx) => (
                    <tr
                      key={`skeleton-row-${idx}`}
                      className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted"
                    >
                      {columns.map((column, colIdx) => (
                        <td
                          key={`skeleton-cell-${column.id || colIdx}-${idx}`}
                          className="px-4 py-2 align-middle [&:has([role=checkbox])]:pr-0"
                        >
                          <Skeleton className="h-4 w-full" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : table.getRowModel().rows?.length ? (
                  <>
                    {table.getRowModel().rows.map((row) => (
                      <tr
                        key={row.id}
                        className={cn(
                          "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
                          onRowClick && "cursor-pointer",
                        )}
                        data-state={row.getIsSelected() && "selected"}
                        onClick={(evt) => {
                          const target = evt.target as HTMLElement;
                          const query = `a, button, input, [role=button], [role=menuitem], [data-no-row-click]`;
                          if (!target.closest(query)) onRowClick?.(row.original);
                        }}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <td
                            key={cell.id}
                            className="px-4 py-2 align-middle [&:has([role=checkbox])]:pr-0"
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {isLoading && (
                      <tr className="absolute inset-0 flex items-center justify-center bg-background/65">
                        <td>
                          <Icon
                            className="size-8 animate-spin text-muted-foreground"
                            icon="lucide:loader"
                          />
                        </td>
                      </tr>
                    )}
                  </>
                ) : (
                  <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                    <td
                      className="h-24 px-4 py-2 text-center align-middle [&:has([role=checkbox])]:pr-0"
                      colSpan={columns.length}
                    >
                      {isLoading
                        ? (errorText ?? labels?.errorText ?? "Error loading data")
                        : (emptyText ?? labels?.emptyText ?? "No results.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </ScrollArea>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="mr-auto flex-1 text-xs text-muted-foreground">
          {totalItems !== undefined
            ? (labels?.itemsCount ?? "{{count}} of {{total}} items")
                .replace("{{count}}", String((page - 1) * limit + data.length))
                .replace("{{total}}", String(totalItems))
            : (labels?.page ?? "Page {{page}}").replace("{{page}}", String(page))}
        </div>
        {pagination || onLimitChange ? (
          <>
            <Pagination className="mx-0 w-fit">
              <PaginationContent className="gap-1">
                {totalPages && totalPages > 1 ? (
                  totalPages > MAX_VISIBLE_PAGES ? (
                    <>
                      <PaginationItem>
                        <PaginationFirst
                          className={cn(
                            "size-8 p-0",
                            (page === 1 || isLoading) && "pointer-events-none opacity-50",
                          )}
                          onClick={() => onPageChange?.(1)}
                        />
                      </PaginationItem>
                      <PaginationItem>
                        <PaginationPrevious
                          className={cn(
                            "size-8 p-0",
                            (!canPreviousPage || isLoading) && "pointer-events-none opacity-50",
                          )}
                          onClick={handlePreviousPage}
                        />
                      </PaginationItem>
                      {getPageRange(page, totalPages, MAX_VISIBLE_PAGES).map((p, idx) =>
                        p === null ? (
                          <PaginationItem key={`ellipsis-${idx}`}>
                            <PaginationEllipsis className="size-8 p-0" />
                          </PaginationItem>
                        ) : (
                          <PaginationItem key={p}>
                            <PaginationLink
                              className="size-8 p-0"
                              isActive={p === page}
                              onClick={() => p !== page && onPageChange?.(p)}
                            >
                              {p}
                            </PaginationLink>
                          </PaginationItem>
                        ),
                      )}
                      <PaginationItem>
                        <PaginationNext
                          className={cn(
                            "size-8 p-0",
                            (!canNextPage || data.length < limit || isLoading) &&
                              "pointer-events-none opacity-50",
                          )}
                          onClick={handleNextPage}
                        />
                      </PaginationItem>
                      <PaginationItem>
                        <PaginationLast
                          className={cn(
                            "size-8 p-0",
                            (page === totalPages || isLoading) && "pointer-events-none opacity-50",
                          )}
                          onClick={() => onPageChange?.(totalPages)}
                        />
                      </PaginationItem>
                    </>
                  ) : (
                    Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                      <PaginationItem key={p}>
                        <PaginationLink
                          className="size-8 p-0"
                          isActive={p === page}
                          onClick={() => p !== page && onPageChange?.(p)}
                        >
                          {p}
                        </PaginationLink>
                      </PaginationItem>
                    ))
                  )
                ) : (
                  <>
                    <PaginationItem>
                      <PaginationPrevious
                        className={cn(
                          "size-8 p-0",
                          (!canPreviousPage || isLoading) && "pointer-events-none opacity-50",
                        )}
                        onClick={handlePreviousPage}
                      />
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationLink
                        className={cn(
                          "size-8 p-0",
                          (totalPages ?? 0) <= 1 && "pointer-events-none opacity-50",
                        )}
                        isActive
                      >
                        {page}
                      </PaginationLink>
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationNext
                        className={cn(
                          "size-8 p-0",
                          (!canNextPage || isLoading) && "pointer-events-none opacity-50",
                        )}
                        onClick={handleNextPage}
                      />
                    </PaginationItem>
                  </>
                )}
              </PaginationContent>
            </Pagination>
            <div className="flex items-center">
              <Select
                disabled={isLoading || (totalPages ?? 0) <= 1}
                value={String(limit)}
                onValueChange={(value) => handleItemsPerPageChange(Number(value))}
              >
                <SelectTrigger className="h-8! w-[70px] px-2">
                  <SelectValue placeholder={limit} />
                </SelectTrigger>
                <SelectContent side="top">
                  {PAGE_SIZE_OPTIONS.map((pageSize) => (
                    <SelectItem key={pageSize} value={String(pageSize)}>
                      {pageSize}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
