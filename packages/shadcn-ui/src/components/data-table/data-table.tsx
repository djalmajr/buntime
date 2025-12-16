import type { Table as TanstackTable } from "@tanstack/react-table";
import { flexRender } from "@tanstack/react-table";
import type * as React from "react";
import { cn } from "../../utils/cn";
import { Icon } from "../ui/icon";
import { ScrollArea } from "../ui/scroll-area";
import { Skeleton } from "../ui/skeleton";
import { DataTablePagination, type DataTablePaginationLabels } from "./data-table-pagination";
import { getCommonPinningStyles } from "./data-table-utils";

export interface DataTableLabels extends DataTablePaginationLabels {
  noResults?: string;
}

interface DataTableProps<TData> extends React.ComponentProps<"div"> {
  actionBar?: React.ReactNode;
  isLoading?: boolean;
  labels?: DataTableLabels;
  showPagination?: boolean;
  table: TanstackTable<TData>;
  onRowClick?: (row: TData) => void;
}

export function DataTable<TData>({
  actionBar,
  children,
  className,
  isLoading = false,
  labels,
  showPagination = true,
  table,
  onRowClick,
  ...props
}: DataTableProps<TData>) {
  const columns = table.getAllColumns();

  return (
    <div className={cn("flex w-full flex-col gap-2.5 overflow-hidden", className)} {...props}>
      {children}
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
                    {headerGroup.headers.map((header) => {
                      const size = header.column.getSize();
                      const hasCustomSize = header.column.columnDef.size !== undefined;
                      return (
                        <th
                          key={header.id}
                          colSpan={header.colSpan}
                          className="text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]"
                          style={{
                            ...(hasCustomSize && { width: size, maxWidth: size }),
                            ...getCommonPinningStyles({ column: header.column }),
                          }}
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
              <tbody className="relative [&_tr:last-child]:border-0">
                {isLoading && !table.getRowModel().rows?.length ? (
                  Array.from({ length: 6 }).map((_, idx) => (
                    <tr
                      key={`skeleton-row-${idx}`}
                      className="hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors"
                    >
                      {columns.map((column, colIdx) => (
                        <td
                          key={`skeleton-cell-${column.id || colIdx}-${idx}`}
                          className="p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]"
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
                          "hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors",
                          onRowClick && "cursor-pointer",
                        )}
                        data-state={row.getIsSelected() && "selected"}
                        onClick={(evt) => {
                          if (!onRowClick) return;
                          const target = evt.target as HTMLElement;
                          const query = `a, button, input, [role=button], [role=menuitem], [data-no-row-click]`;
                          if (!target.closest(query)) onRowClick(row.original);
                        }}
                      >
                        {row.getVisibleCells().map((cell) => {
                          const size = cell.column.getSize();
                          const hasCustomSize = cell.column.columnDef.size !== undefined;
                          return (
                            <td
                              key={cell.id}
                              className="p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]"
                              style={{
                                ...(hasCustomSize && { width: size, maxWidth: size }),
                                ...getCommonPinningStyles({ column: cell.column }),
                              }}
                            >
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </td>
                          );
                        })}
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
                  <tr className="hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors">
                    <td
                      className="h-24 p-2 text-center align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]"
                      colSpan={columns.length}
                    >
                      {labels?.noResults ?? "No results."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </ScrollArea>
        </div>
      </div>
      {(showPagination || actionBar) && (
        <div className="flex flex-col gap-2.5">
          {showPagination && <DataTablePagination labels={labels} table={table} />}
          {actionBar && table.getFilteredSelectedRowModel().rows.length > 0 && actionBar}
        </div>
      )}
    </div>
  );
}
