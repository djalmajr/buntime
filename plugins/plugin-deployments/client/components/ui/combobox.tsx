import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "~/components/icon";
import { cn } from "~/utils/cn";
import { Button } from "./button";
import { Input } from "./input";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

interface ComboboxOption {
  label: string;
  value: string;
}

interface ComboboxProps {
  className?: string;
  disabled?: boolean;
  onSelect: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  value: string;
}

export function Combobox({
  className,
  disabled,
  onSelect,
  options,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  value,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  const filteredOptions = useMemo(() => {
    if (!search.trim()) return options;
    const term = search.toLowerCase().trim();
    return options.filter((opt) => opt.label.toLowerCase().includes(term));
  }, [options, search]);

  const handleSelect = useCallback(
    (optValue: string) => {
      onSelect(optValue);
      setOpen(false);
      setSearch("");
    },
    [onSelect],
  );

  // Focus input when popover opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          aria-expanded={open}
          className={cn("justify-between font-normal", className)}
          disabled={disabled}
          role="combobox"
          variant="outline"
        >
          <span className="flex items-center gap-2 truncate">
            <Icon className="size-4 shrink-0" icon="lucide:folder" />
            {selectedOption?.label || placeholder}
          </span>
          <Icon
            className={cn("ml-2 size-4 shrink-0 transition-transform", open && "rotate-180")}
            icon="lucide:chevron-down"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
        <div className="p-2">
          <Input
            className="h-8"
            placeholder={searchPlaceholder}
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="max-h-60 overflow-y-auto">
          {filteredOptions.length === 0 ? (
            <div className="px-3 py-2 text-center text-sm text-muted-foreground">
              No results found
            </div>
          ) : (
            filteredOptions.map((opt) => (
              <button
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
                  value === opt.value && "bg-accent",
                )}
                key={opt.value}
                type="button"
                onClick={() => handleSelect(opt.value)}
              >
                <Icon
                  className={cn(
                    "size-4 shrink-0",
                    value === opt.value ? "opacity-100" : "opacity-0",
                  )}
                  icon="lucide:check"
                />
                <Icon className="size-4 shrink-0" icon="lucide:folder" />
                <span className="truncate">{opt.label}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
