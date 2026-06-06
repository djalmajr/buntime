import type { Table as TanstackTable } from "@tanstack/react-table";
import { flexRender } from "@tanstack/react-table";
import type * as React from "react";
import { Icon } from "~/components/ui/icon";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/utils/cn";
import { DataTablePagination, type DataTablePaginationLabels } from "./data-table-pagination";

export interface DataTableLabels extends DataTablePaginationLabels {
  noResults?: string;
}

interface DataTableProps<TData> extends React.ComponentProps<"div"> {
  isLoading?: boolean;
  labels?: DataTableLabels;
  table: TanstackTable<TData>;
  onRowClick?: (row: TData) => void;
  /**
   * Max height of the scrollable rows region. Grows with content up to this
   * height (viewport-relative by default), then scrolls only the rows while
   * the header stays pinned and the pagination bar stays visible.
   */
  maxHeight?: string;
}

/**
 * Robust data table: sticky header, sortable headers, client-side pagination
 * and a native scroll region that adapts to the available window height.
 * Adapted from the shared `@tmwork/ui` data-table.
 */
export function DataTable<TData>({
  children,
  className,
  isLoading = false,
  labels,
  table,
  onRowClick,
  maxHeight = "calc(100vh - 22rem)",
  ...props
}: DataTableProps<TData>) {
  const columns = table.getAllColumns();

  return (
    <div className={cn("flex w-full flex-col gap-2.5", className)} {...props}>
      {children}
      <div className="overflow-auto rounded-md border" style={{ maxHeight }}>
        <table className="w-full caption-bottom text-sm">
          <thead className="sticky top-0 z-10 bg-background after:absolute after:right-0 after:bottom-0 after:left-0 after:h-px after:bg-border">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-border">
                {headerGroup.headers.map((header) => {
                  const size = header.column.columnDef.size;
                  const hasFixedSize = size !== undefined && size > 0;
                  return (
                    <th
                      key={header.id}
                      colSpan={header.colSpan}
                      className="h-10 px-2 text-left align-middle font-medium text-foreground whitespace-nowrap"
                      style={hasFixedSize ? { width: size, maxWidth: size } : undefined}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="[&_tr:last-child]:border-0">
            {isLoading && !table.getRowModel().rows?.length ? (
              Array.from({ length: 6 }).map((_, idx) => (
                <tr key={`skeleton-row-${idx}`} className="border-b">
                  {columns.map((column, colIdx) => (
                    <td key={`skeleton-cell-${column.id || colIdx}-${idx}`} className="p-2">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    "border-b transition-colors hover:bg-muted/50",
                    onRowClick && "cursor-pointer",
                  )}
                  onClick={(evt) => {
                    if (!onRowClick) return;
                    const target = evt.target as HTMLElement;
                    if (!target.closest("a, button, input, [role=button], [data-no-row-click]")) {
                      onRowClick(row.original);
                    }
                  }}
                >
                  {row.getVisibleCells().map((cell) => {
                    const size = cell.column.columnDef.size;
                    const hasFixedSize = size !== undefined && size > 0;
                    return (
                      <td
                        key={cell.id}
                        className="p-2 align-middle"
                        style={hasFixedSize ? { width: size, maxWidth: size } : undefined}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              ))
            ) : (
              <tr>
                <td className="h-24 p-2 text-center text-muted-foreground" colSpan={columns.length}>
                  {isLoading ? (
                    <Icon className="mx-auto size-6 animate-spin" icon="lucide:loader" />
                  ) : (
                    (labels?.noResults ?? "No results.")
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <DataTablePagination labels={labels} table={table} />
    </div>
  );
}
