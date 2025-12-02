import type {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
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
import { useState } from "react";
import { Icon } from "~/components/icon";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "~/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/utils/cn";

interface DataTableProps<TData, TValue> {
  canNextPage?: boolean;
  canPreviousPage?: boolean;
  className?: string;
  columns: ColumnDef<TData, TValue>[];
  currentPage?: number;
  data: TData[];
  emptyText?: string;
  isLoading?: boolean;
  itemsPerPage?: number;
  labels?: { itemsCount?: string; page?: string };
  totalItems?: number;
  totalPages?: number;
  onItemsPerPageChange?: (value: number) => void;
  onNextPage?: () => void;
  onPageChange?: (page: number) => void;
  onPreviousPage?: () => void;
  onRowClick?: (row: TData) => void;
}

export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

export function DataTable<TData, TValue>({
  canNextPage,
  canPreviousPage,
  className,
  columns,
  currentPage = 1,
  data,
  emptyText = "No results.",
  isLoading = false,
  itemsPerPage = PAGE_SIZE_OPTIONS[0],
  labels,
  totalItems,
  totalPages,
  onItemsPerPageChange,
  onNextPage,
  onPageChange,
  onPreviousPage,
  onRowClick,
}: DataTableProps<TData, TValue>) {
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState({});
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    columns,
    data,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: true,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    pageCount: totalPages || -1,
    state: {
      columnFilters,
      columnVisibility,
      pagination: {
        pageIndex: currentPage - 1,
        pageSize: itemsPerPage || 10,
      },
      rowSelection,
      sorting,
    },
  });

  return (
    <div className={cn("flex flex-1 flex-col", className)}>
      <div className="flex flex-1 flex-col overflow-hidden rounded-md border">
        <div className="relative overflow-hidden">
          <div className="h-full overflow-auto">
            <table className="w-full caption-bottom text-sm">
              <thead className="sticky top-0 z-10 bg-background after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[1px] after:bg-border">
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr
                    className="border-b border-border transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted"
                    key={headerGroup.id}
                  >
                    {headerGroup.headers.map((header) => (
                      <th
                        className="h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0"
                        key={header.id}
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
                      className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted"
                      key={`skeleton-row-${idx}`}
                    >
                      {columns.map((column, colIdx) => (
                        <td
                          className="px-4 py-2 align-middle [&:has([role=checkbox])]:pr-0"
                          key={`skeleton-cell-${column.id || colIdx}-${idx}`}
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
                        className={cn(
                          "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
                          onRowClick && "cursor-pointer",
                        )}
                        data-state={row.getIsSelected() && "selected"}
                        key={row.id}
                        onClick={() => onRowClick?.(row.original)}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <td
                            className="px-4 py-2 align-middle [&:has([role=checkbox])]:pr-0"
                            key={cell.id}
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
                      {emptyText}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 py-2">
        <div className="mr-auto flex-1 text-xs text-muted-foreground">
          {totalItems !== undefined
            ? (labels?.itemsCount ?? "{{count}} of {{total}} items")
                .replace("{{count}}", String((currentPage - 1) * itemsPerPage + data.length))
                .replace("{{total}}", String(totalItems))
            : (labels?.page ?? "Page {{page}}").replace("{{page}}", String(currentPage))}
        </div>
        {(totalPages && totalPages > 1) || onItemsPerPageChange ? (
          <>
            <Pagination className="mx-0 w-fit">
              <PaginationContent className="gap-1">
                {totalPages && totalPages > 1 ? (
                  <>
                    <PaginationItem>
                      <PaginationPrevious
                        className={`size-8 p-0 ${
                          (
                            canPreviousPage !== undefined
                              ? !canPreviousPage
                              : !table.getCanPreviousPage()
                          ) || isLoading
                            ? "pointer-events-none opacity-50"
                            : ""
                        }`}
                        onClick={onPreviousPage || (() => table.previousPage())}
                      />
                    </PaginationItem>
                    {onPageChange && totalPages > 1 && (
                      <>
                        {currentPage > 2 && (
                          <PaginationItem>
                            <PaginationLink
                              className="size-8 p-0"
                              isActive={currentPage === 1}
                              onClick={() => onPageChange(1)}
                            >
                              1
                            </PaginationLink>
                          </PaginationItem>
                        )}
                        {currentPage > 3 && (
                          <PaginationItem>
                            <PaginationEllipsis className="size-8 p-0" />
                          </PaginationItem>
                        )}
                        {currentPage > 1 && (
                          <PaginationItem>
                            <PaginationLink
                              className="size-8 p-0"
                              onClick={() => onPageChange(currentPage - 1)}
                            >
                              {currentPage - 1}
                            </PaginationLink>
                          </PaginationItem>
                        )}
                        <PaginationItem>
                          <PaginationLink className="size-8 p-0" isActive>
                            {currentPage}
                          </PaginationLink>
                        </PaginationItem>
                        {currentPage < totalPages && (
                          <PaginationItem>
                            <PaginationLink
                              className="size-8 p-0"
                              onClick={() => onPageChange(currentPage + 1)}
                            >
                              {currentPage + 1}
                            </PaginationLink>
                          </PaginationItem>
                        )}
                        {currentPage < totalPages - 2 && (
                          <PaginationItem>
                            <PaginationEllipsis className="size-8 p-0" />
                          </PaginationItem>
                        )}
                        {currentPage < totalPages - 1 && (
                          <PaginationItem>
                            <PaginationLink
                              className="size-8 p-0"
                              isActive={currentPage === totalPages}
                              onClick={() => onPageChange(totalPages)}
                            >
                              {totalPages}
                            </PaginationLink>
                          </PaginationItem>
                        )}
                      </>
                    )}
                    <PaginationItem>
                      <PaginationNext
                        className={`size-8 p-0 ${
                          (canNextPage !== undefined ? !canNextPage : !table.getCanNextPage()) ||
                          isLoading
                            ? "pointer-events-none opacity-50"
                            : ""
                        }`}
                        onClick={onNextPage || (() => table.nextPage())}
                      />
                    </PaginationItem>
                  </>
                ) : (
                  <PaginationItem>
                    <PaginationLink className="size-8 p-0" isActive>
                      {currentPage}
                    </PaginationLink>
                  </PaginationItem>
                )}
              </PaginationContent>
            </Pagination>
            {onItemsPerPageChange && (
              <div className="flex items-center">
                <Select
                  disabled={isLoading}
                  value={String(itemsPerPage)}
                  onValueChange={(value) => onItemsPerPageChange(Number(value))}
                >
                  <SelectTrigger className="h-8! w-[70px] px-2">
                    <SelectValue placeholder={itemsPerPage} />
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
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
