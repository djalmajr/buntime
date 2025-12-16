import * as React from "react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "../../components/ui/command";
import { Icon } from "../../components/ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { Separator } from "../../components/ui/separator";
import { cn } from "../../utils/cn";
import type { Option } from "./data-table-types";

export interface DataTableComboFilterLabels {
  clearFilters?: string;
  noResultsFound?: string;
}

interface DataTableComboFilterSingleProps {
  labels?: DataTableComboFilterLabels;
  maxBadges?: number;
  multiple?: false;
  options: Option[];
  title: string;
  value?: string;
  onValueChange: (value: string | undefined) => void;
}

interface DataTableComboFilterMultipleProps {
  labels?: DataTableComboFilterLabels;
  maxBadges?: number;
  multiple: true;
  options: Option[];
  title: string;
  value?: string[];
  onValueChange: (value: string[] | undefined) => void;
}

type DataTableComboFilterProps =
  | DataTableComboFilterMultipleProps
  | DataTableComboFilterSingleProps;

export function DataTableComboFilter(props: DataTableComboFilterProps) {
  const { labels, maxBadges = 1, multiple, options, title } = props;
  const [open, setOpen] = React.useState(false);

  // Normalize value to Set for easier handling
  const selectedValues = React.useMemo(() => {
    if (multiple) {
      return new Set(props.value ?? []);
    }
    return new Set(props.value ? [props.value] : []);
  }, [multiple, props.value]);

  const selectedOptions = React.useMemo(
    () => options.filter((option) => selectedValues.has(option.value)),
    [options, selectedValues],
  );

  const visibleBadges = selectedOptions.slice(0, maxBadges);
  const hiddenCount = Math.max(0, selectedOptions.length - maxBadges);

  const onItemSelect = React.useCallback(
    (option: Option, isSelected: boolean) => {
      if (multiple) {
        const newSelectedValues = new Set(selectedValues);
        if (isSelected) {
          newSelectedValues.delete(option.value);
        } else {
          newSelectedValues.add(option.value);
        }
        const filterValues = Array.from(newSelectedValues);
        (props as DataTableComboFilterMultipleProps).onValueChange(
          filterValues.length ? filterValues : undefined,
        );
      } else {
        (props as DataTableComboFilterSingleProps).onValueChange(
          isSelected ? undefined : option.value,
        );
        setOpen(false);
      }
    },
    [multiple, props, selectedValues],
  );

  const onReset = React.useCallback(
    (event?: React.MouseEvent) => {
      event?.stopPropagation();
      if (multiple) {
        (props as DataTableComboFilterMultipleProps).onValueChange(undefined);
      } else {
        (props as DataTableComboFilterSingleProps).onValueChange(undefined);
      }
    },
    [multiple, props],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button className="border-dashed font-normal" size="sm" variant="outline">
          {selectedValues.size > 0 ? (
            // biome-ignore lint/a11y/useSemanticElements: we already have a button in parent
            <span
              aria-label={`Clear ${title} filter`}
              className="rounded-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              role="button"
              tabIndex={0}
              onClick={onReset}
              onKeyDown={(evt) => {
                if (evt.key === "Enter" || evt.code === "Space") {
                  evt.preventDefault();
                  onReset();
                }
              }}
            >
              <Icon icon="lucide:x-circle" />
            </span>
          ) : (
            <Icon icon="lucide:plus-circle" />
          )}
          {title}
          {selectedValues.size > 0 && (
            <>
              <Separator
                className="mx-0.5 data-[orientation=vertical]:h-4"
                orientation="vertical"
              />
              {multiple && (
                <Badge className="rounded-sm px-1 font-normal lg:hidden" variant="secondary">
                  {selectedValues.size}
                </Badge>
              )}
              <div className={cn("items-center gap-1", multiple ? "hidden lg:flex" : "flex")}>
                {visibleBadges.map((option) => (
                  <Badge
                    key={option.value}
                    className="rounded-sm px-1 font-normal"
                    variant="secondary"
                  >
                    {option.label}
                  </Badge>
                ))}
                {hiddenCount > 0 && (
                  <Badge className="rounded-sm px-1 font-normal" variant="secondary">
                    +{hiddenCount}
                  </Badge>
                )}
              </div>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-50 p-0">
        <Command>
          <CommandInput placeholder={title} />
          <CommandList className="max-h-full">
            <CommandEmpty>{labels?.noResultsFound ?? "No results found."}</CommandEmpty>
            <CommandGroup className="max-h-[300px] scroll-py-1 overflow-y-auto overflow-x-hidden">
              {options.map((option) => {
                const isSelected = selectedValues.has(option.value);

                return (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    onSelect={() => onItemSelect(option, isSelected)}
                  >
                    <div
                      className={cn(
                        "flex size-4 items-center justify-center rounded-sm border border-primary",
                        isSelected ? "bg-primary" : "opacity-50 [&_svg]:invisible",
                      )}
                    >
                      <Icon icon="lucide:check" />
                    </div>
                    {option.icon && <option.icon className="size-4" />}
                    <span className="truncate">{option.label}</span>
                    {option.count != null && (
                      <span className="ml-auto font-mono text-xs">{option.count}</span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {selectedValues.size > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem className="justify-center text-center" onSelect={() => onReset()}>
                    {labels?.clearFilters ?? "Clear filters"}
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
