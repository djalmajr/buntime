import { useEffect, useRef, useState } from "react";
import { useDebounce } from "../../hooks/use-debounce";
import { useQueryNumber, useQueryString } from "../../hooks/use-query-state";
import { Button } from "./button";
import { Icon } from "./icon";
import { Input } from "./input";

interface SearchInputProps {
  debounceMs?: number;
  name?: string;
  placeholder?: string;
}

export function SearchInput({
  debounceMs = 500,
  name = "search",
  placeholder = "Search...",
}: SearchInputProps) {
  const [search, setSearch] = useQueryString(name);
  const [value, setValue] = useState(search);
  const [, setPage] = useQueryNumber("page", 1);
  const inputRef = useRef<HTMLInputElement>(null);
  const query = useDebounce(value, debounceMs);

  const handleClear = () => {
    setValue("");
    setSearch("");
    setTimeout(() => inputRef.current?.focus(), 30);
  };

  const handleSubmit = (evt: React.FormEvent) => {
    evt.preventDefault();
    setSearch(value.trim());
    setPage(1);
  };

  useEffect(() => {
    if (query !== search) {
      setSearch(query.trim());
      setPage(1);
    }
  }, [query, search, setSearch, setPage]);

  return (
    <div className="flex flex-1 items-center justify-center">
      <form className="relative w-full" onSubmit={handleSubmit}>
        <Input
          className="px-9 text-sm"
          placeholder={placeholder}
          ref={inputRef}
          value={value}
          onChange={(evt) => setValue(evt.target.value)}
        />
        <Button
          className="absolute left-0.5 top-1/2 size-8 -translate-y-1/2"
          size="icon"
          type="submit"
          variant="ghost"
        >
          <Icon className="size-4" icon="lucide:search" />
        </Button>
        {!!value.trim() && (
          <Button
            className="absolute right-0.5 top-1/2 size-8 -translate-y-1/2"
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
