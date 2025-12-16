import { useEffect, useRef, useState } from "react";
import { useDebounce } from "../../hooks/use-debounce";
import { Button } from "./button";
import { Icon } from "./icon";
import { Input } from "./input";

interface InputSearchProps {
  defaultValue?: string;
  placeholder?: string;
  onSearch: (value: string) => void;
}

export function InputSearch({
  defaultValue = "",
  placeholder = "Search...",
  onSearch,
}: InputSearchProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const query = useDebounce(value, 500);
  const prevQueryRef = useRef(query);

  const handleClear = () => {
    setValue("");
    onSearch("");
    setTimeout(() => inputRef.current?.focus(), 30);
  };

  const handleSubmit = (evt: React.FormEvent) => {
    evt.preventDefault();
    onSearch(value.trim());
  };

  // Sync with external defaultValue changes
  useEffect(() => {
    setValue(defaultValue);
  }, [defaultValue]);

  // Call onSearch when debounced value changes
  useEffect(() => {
    if (query !== prevQueryRef.current) {
      prevQueryRef.current = query;
      onSearch(query.trim());
    }
  }, [query, onSearch]);

  return (
    <div className="flex items-center">
      <form className="relative w-40 lg:w-64" onSubmit={handleSubmit}>
        <Input
          ref={inputRef}
          className="px-9 text-sm"
          placeholder={placeholder}
          value={value}
          onChange={(evt) => setValue(evt.target.value)}
        />
        <Button
          className="absolute top-1/2 left-0.5 size-8 -translate-y-1/2"
          size="icon"
          type="submit"
          variant="ghost"
        >
          <Icon className="size-4" icon="lucide:search" />
        </Button>
        {!!value.trim() && (
          <Button
            className="absolute top-1/2 right-0.5 size-8 -translate-y-1/2"
            size="icon"
            type="button"
            variant="ghost"
            onClick={handleClear}
          >
            <Icon className="size-4" icon="lucide:x" />
          </Button>
        )}
      </form>
    </div>
  );
}
