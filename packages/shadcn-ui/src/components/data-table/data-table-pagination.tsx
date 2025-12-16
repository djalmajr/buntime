import type { Table } from "@tanstack/react-table";
import { Button } from "../../components/ui/button";
import { Icon } from "../../components/ui/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { cn } from "../../utils/cn";

export interface DataTablePaginationLabels {
  goToFirstPage?: string;
  goToLastPage?: string;
  goToNextPage?: string;
  goToPreviousPage?: string;
  page?: string;
  pageOf?: string;
  rowsPerPage?: string;
  rowsSelected?: string;
}

const defaultLabels: Required<DataTablePaginationLabels> = {
  goToFirstPage: "Go to first page",
  goToLastPage: "Go to last page",
  goToNextPage: "Go to next page",
  goToPreviousPage: "Go to previous page",
  page: "Page",
  pageOf: "of",
  rowsPerPage: "Rows per page",
  rowsSelected: "{selected} of {total} row(s) selected.",
};

interface DataTablePaginationProps<TData> extends React.ComponentProps<"div"> {
  labels?: DataTablePaginationLabels;
  pageSizeOptions?: number[];
  table: Table<TData>;
}

export const PAGE_SIZE_OPTIONS = [25, 50, 100];

export function DataTablePagination<TData>({
  className,
  labels: labelsProp,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  table,
  ...props
}: DataTablePaginationProps<TData>) {
  const labels = { ...defaultLabels, ...labelsProp };
  const hasSelectColumn = table.getAllColumns().some((col) => col.id === "select");
  const selected = table.getFilteredSelectedRowModel().rows.length;
  const total = table.getFilteredRowModel().rows.length;
  const rowsSelectedText = labels.rowsSelected
    .replace("{selected}", String(selected))
    .replace("{total}", String(total));

  return (
    <div
      className={cn(
        "flex w-full flex-col-reverse items-center justify-between gap-4 overflow-auto p-1 sm:flex-row sm:gap-8",
        className,
      )}
      {...props}
    >
      <div className="flex-1 whitespace-nowrap text-muted-foreground text-sm">
        {hasSelectColumn ? rowsSelectedText : null}
      </div>
      <div className="flex flex-col-reverse items-center gap-4 sm:flex-row sm:gap-6 lg:gap-8">
        <div className="flex items-center space-x-2">
          <p className="whitespace-nowrap font-medium text-sm">{labels.rowsPerPage}</p>
          <Select
            value={`${table.getState().pagination.pageSize}`}
            onValueChange={(value) => {
              table.setPageSize(Number(value));
            }}
          >
            <SelectTrigger className="h-8 w-20">
              <SelectValue placeholder={table.getState().pagination.pageSize} />
            </SelectTrigger>
            <SelectContent side="top">
              {pageSizeOptions.map((pageSize) => (
                <SelectItem key={pageSize} value={`${pageSize}`}>
                  {pageSize}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-center font-medium text-sm">
          {labels.page} {table.getState().pagination.pageIndex + 1} {labels.pageOf}{" "}
          {table.getPageCount()}
        </div>
        <div className="flex items-center space-x-2">
          <Button
            aria-label={labels.goToFirstPage}
            className="hidden size-8 lg:flex"
            disabled={!table.getCanPreviousPage()}
            size="icon"
            variant="outline"
            onClick={() => table.setPageIndex(0)}
          >
            <Icon icon="lucide:chevrons-left" />
          </Button>
          <Button
            aria-label={labels.goToPreviousPage}
            className="size-8"
            disabled={!table.getCanPreviousPage()}
            size="icon"
            variant="outline"
            onClick={() => table.previousPage()}
          >
            <Icon icon="lucide:chevron-left" />
          </Button>
          <Button
            aria-label={labels.goToNextPage}
            className="size-8"
            disabled={!table.getCanNextPage()}
            size="icon"
            variant="outline"
            onClick={() => table.nextPage()}
          >
            <Icon icon="lucide:chevron-right" />
          </Button>
          <Button
            aria-label={labels.goToLastPage}
            className="hidden size-8 lg:flex"
            disabled={!table.getCanNextPage()}
            size="icon"
            variant="outline"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
          >
            <Icon icon="lucide:chevrons-right" />
          </Button>
        </div>
      </div>
    </div>
  );
}
