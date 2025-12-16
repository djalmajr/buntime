import type { Table } from "@tanstack/react-table";
import * as React from "react";
import { Button } from "../../components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../../components/ui/command";
import { Icon } from "../../components/ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { cn } from "../../utils/cn";

interface DataTableViewOptionsLabels {
  button?: string;
  noColumnsFound?: string;
  searchPlaceholder?: string;
}

interface DataTableViewOptionsProps<TData> extends React.ComponentProps<typeof PopoverContent> {
  labels?: DataTableViewOptionsLabels;
  table: Table<TData>;
}

export function DataTableViewOptions<TData>({
  labels,
  table,
  ...props
}: DataTableViewOptionsProps<TData>) {
  const columns = React.useMemo(
    () =>
      table
        .getAllColumns()
        .filter((column) => typeof column.accessorFn !== "undefined" && column.getCanHide()),
    [table],
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          aria-label="Toggle columns"
          role="combobox"
          variant="outline"
          size="sm"
          className="ml-auto hidden h-8 font-normal lg:flex"
        >
          <Icon className="text-muted-foreground" icon="lucide:settings-2" />
          {labels?.button ?? "View"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-44 p-0" {...props}>
        <Command>
          <CommandInput placeholder={labels?.searchPlaceholder ?? "Search columns..."} />
          <CommandList>
            <CommandEmpty>{labels?.noColumnsFound ?? "No columns found."}</CommandEmpty>
            <CommandGroup>
              {columns.map((column) => (
                <CommandItem
                  key={column.id}
                  onSelect={() => column.toggleVisibility(!column.getIsVisible())}
                >
                  <span className="truncate">{column.columnDef.meta?.label ?? column.id}</span>
                  <Icon
                    className={cn(
                      "ml-auto size-4 shrink-0",
                      column.getIsVisible() ? "opacity-100" : "opacity-0",
                    )}
                    icon="lucide:check"
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
