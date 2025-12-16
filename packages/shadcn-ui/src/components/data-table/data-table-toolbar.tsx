import type { Column, Table } from "@tanstack/react-table";
import * as React from "react";
import { Button } from "../../components/ui/button";
import { Icon } from "../../components/ui/icon";
import { Input } from "../../components/ui/input";
import { cn } from "../../utils/cn";
import { DataTableComboFilter } from "./data-table-combo-filter";
import { DataTableDateFilter } from "./data-table-date-filter";
import { DataTableSliderFilter } from "./data-table-slider-filter";

interface DataTableToolbarLabels {
  clearFilters?: string;
  noResultsFound?: string;
  reset?: string;
}

interface DataTableToolbarProps<TData> extends React.ComponentProps<"div"> {
  actions?: React.ReactNode;
  hasSearch?: boolean;
  labels?: DataTableToolbarLabels;
  table: Table<TData>;
  onClearSearch?: () => void;
}

export function DataTableToolbar<TData>({
  actions,
  children,
  className,
  hasSearch,
  labels,
  table,
  onClearSearch,
  ...props
}: DataTableToolbarProps<TData>) {
  const state = table.getState();
  const hasFilters = state.columnFilters.length > 0;
  const hasSorting = state.sorting.length > 0;
  const isFiltered = hasFilters || hasSorting || hasSearch;

  const columns = React.useMemo(
    () => table.getAllColumns().filter((column) => column.getCanFilter()),
    [table],
  );

  const onReset = React.useCallback(() => {
    table.resetColumnFilters();
    table.resetSorting();
    onClearSearch?.();
  }, [table, onClearSearch]);

  const facetedFilterLabels = React.useMemo(
    () => ({
      clearFilters: labels?.clearFilters,
      noResultsFound: labels?.noResultsFound,
    }),
    [labels?.clearFilters, labels?.noResultsFound],
  );

  return (
    <div
      role="toolbar"
      aria-orientation="horizontal"
      className={cn("flex w-full items-center justify-between gap-2 p-1", className)}
      {...props}
    >
      <div className="flex flex-1 items-center gap-2">
        {children}
        {columns.map((column) => (
          <DataTableToolbarFilter key={column.id} column={column} labels={facetedFilterLabels} />
        ))}
        {isFiltered && (
          <Button
            aria-label="Reset filters"
            variant="outline"
            size="sm"
            className="border-dashed"
            onClick={onReset}
          >
            <Icon icon="lucide:x" />
            {labels?.reset ?? "Reset"}
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">{actions}</div>
    </div>
  );
}
interface FacetedFilterLabels {
  clearFilters?: string;
  noResultsFound?: string;
}

interface DataTableToolbarFilterProps<TData> {
  column: Column<TData>;
  labels?: FacetedFilterLabels;
}

function DataTableToolbarFilter<TData>({ column, labels }: DataTableToolbarFilterProps<TData>) {
  {
    const columnMeta = column.columnDef.meta;

    const onFilterRender = React.useCallback(() => {
      if (!columnMeta?.variant) return null;

      switch (columnMeta.variant) {
        case "text":
          return (
            <Input
              placeholder={columnMeta?.placeholder ?? columnMeta?.label}
              value={(column.getFilterValue() as string) ?? ""}
              onChange={(event) => column.setFilterValue(event.target.value)}
              className="h-8 w-40 lg:w-56"
            />
          );

        case "number":
          return (
            <div className="relative">
              <Input
                type="number"
                inputMode="numeric"
                placeholder={columnMeta?.placeholder ?? columnMeta?.label}
                value={(column.getFilterValue() as string) ?? ""}
                onChange={(event) => column.setFilterValue(event.target.value)}
                className={cn("h-8 w-[120px]", columnMeta?.unit && "pr-8")}
              />
              {columnMeta?.unit && (
                <span className="absolute top-0 right-0 bottom-0 flex items-center rounded-r-md bg-accent px-2 text-muted-foreground text-sm">
                  {columnMeta.unit}
                </span>
              )}
            </div>
          );

        case "range":
          return <DataTableSliderFilter column={column} title={columnMeta?.label ?? column.id} />;

        case "date":
        case "dateRange":
          return (
            <DataTableDateFilter
              column={column}
              title={columnMeta?.label ?? column.id}
              multiple={columnMeta?.variant === "dateRange"}
            />
          );

        case "select":
          return (
            <DataTableComboFilter
              labels={labels}
              options={columnMeta?.options ?? []}
              title={columnMeta?.label ?? column.id}
              value={(column.getFilterValue() as string) ?? undefined}
              onValueChange={(value) => column.setFilterValue(value)}
            />
          );

        case "multiSelect":
          return (
            <DataTableComboFilter
              labels={labels}
              multiple
              options={columnMeta?.options ?? []}
              title={columnMeta?.label ?? column.id}
              value={(column.getFilterValue() as string[]) ?? undefined}
              onValueChange={(value) => column.setFilterValue(value)}
            />
          );

        default:
          return null;
      }
    }, [column, columnMeta, labels]);

    return onFilterRender();
  }
}
