import {
  PAGE_SIZE_OPTIONS,
  DataTable as Table,
  Tabs,
  TabsList,
  TabsTrigger,
  useQueryNumber,
  useQueryString,
} from "@buntime/shadcn-ui";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback } from "react";
import { SearchInput } from "~/components/search-input";

export interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data?: T[];
  emptyText?: string;
  errorText?: string;
  filterOptions?: readonly { label: string; value: string }[];
  filterQueryParam?: string;
  isLoading: boolean;
  labels?: {
    emptyText?: string;
    errorText?: string;
    itemsCount?: string;
    page?: string;
    searchPlaceholder?: string;
  };
  pagination?: { total?: number; totalPages?: number };
  onRowClick?: (row: T) => void;
}

export function DataTable<T>({
  columns,
  data,
  emptyText,
  errorText,
  filterOptions,
  filterQueryParam = "filter",
  isLoading,
  labels,
  pagination,
  onRowClick,
}: DataTableProps<T>) {
  const [filter, setFilter] = useQueryString(filterQueryParam, filterOptions?.[0]?.value ?? "all");
  const [limit, setLimit] = useQueryNumber("limit", PAGE_SIZE_OPTIONS[0]);
  const [page, setPage] = useQueryNumber("page", 1);

  const handleNextPage = useCallback(() => {
    if (page < (pagination?.totalPages ?? 0)) setPage(page + 1);
  }, [page, pagination, setPage]);

  const handlePreviousPage = useCallback(() => {
    if (page > 1) setPage(page - 1);
  }, [page, setPage]);

  const handleItemsPerPageChange = useCallback(
    (newLimit: number) => {
      setLimit(newLimit);
      setPage(1);
    },
    [setLimit, setPage],
  );

  return (
    <div className="flex flex-col gap-4 overflow-hidden">
      <div className="flex items-center justify-between">
        <div className="relative max-w-[16rem]">
          <SearchInput placeholder={labels?.searchPlaceholder ?? "Search..."} />
        </div>
        {filterOptions && filterOptions.length > 0 && (
          <div className="flex items-center gap-4">
            <Tabs value={filter} onValueChange={setFilter}>
              <TabsList>
                {filterOptions.map((option) => (
                  <TabsTrigger key={option.value} value={option.value}>
                    {option.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        )}
      </div>
      <Table
        canNextPage={pagination ? page < pagination.totalPages! : false}
        canPreviousPage={page > 1}
        className="overflow-hidden"
        columns={columns}
        currentPage={page}
        data={data || []}
        emptyText={
          isLoading
            ? (errorText ?? labels?.errorText ?? "Error loading data")
            : (emptyText ?? labels?.emptyText ?? "No results.")
        }
        isLoading={isLoading}
        itemsPerPage={limit}
        labels={{
          itemsCount: labels?.itemsCount,
          page: labels?.page,
        }}
        totalItems={pagination?.total}
        totalPages={pagination?.totalPages}
        onItemsPerPageChange={handleItemsPerPageChange}
        onNextPage={handleNextPage}
        onPageChange={setPage}
        onPreviousPage={handlePreviousPage}
        onRowClick={onRowClick}
      />
    </div>
  );
}
