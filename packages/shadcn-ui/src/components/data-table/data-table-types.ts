import type { ColumnSort, Row, RowData } from "@tanstack/react-table";
import type { DataTableConfig } from "./data-table-config";
import type { FilterItemSchema } from "./data-table-parsers";

declare module "@tanstack/react-table" {
  // biome-ignore lint/correctness/noUnusedVariables: TData is used in the TableMeta interface
  interface TableMeta<TData extends RowData> {
    queryKeys?: QueryKeys;
  }

  // biome-ignore lint/correctness/noUnusedVariables: TData and TValue are used in the ColumnMeta interface
  interface ColumnMeta<TData extends RowData, TValue> {
    icon?: React.FC<React.SVGProps<SVGSVGElement>>;
    label?: string;
    maxBadges?: number;
    options?: Option[];
    placeholder?: string;
    range?: [number, number];
    unit?: string;
    variant?: FilterVariant;
  }
}

export interface QueryKeys {
  filters: string;
  joinOperator: string;
  page: string;
  perPage: string;
  sort: string;
}

export interface Option {
  count?: number;
  icon?: React.FC<React.SVGProps<SVGSVGElement>>;
  label: string;
  value: string;
}

export type FilterOperator = DataTableConfig["operators"][number];
export type FilterVariant = DataTableConfig["filterVariants"][number];
export type JoinOperator = DataTableConfig["joinOperators"][number];

export interface ExtendedColumnSort<TData> extends Omit<ColumnSort, "id"> {
  id: Extract<keyof TData, string>;
}

export interface ExtendedColumnFilter<TData> extends FilterItemSchema {
  id: Extract<keyof TData, string>;
}

export interface DataTableRowAction<TData> {
  row: Row<TData>;
  variant: "update" | "delete";
}
