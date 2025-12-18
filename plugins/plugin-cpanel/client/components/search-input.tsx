import {
  Button,
  Icon,
  Input,
  useDebounce,
  useQueryNumber,
  useQueryString,
} from "@buntime/shadcn-ui";
import { useEffect, useRef, useState } from "react";

interface SearchInputProps {
  name?: string;
  placeholder?: string;
}

export const SearchInput = ({ name = "search", placeholder = "Search..." }: SearchInputProps) => {
  const [search, setSearch] = useQueryString(name);
  const [value, setValue] = useState(search);
  const [, setPage] = useQueryNumber("page", 1);
  const inputRef = useRef<HTMLInputElement>(null);
  const query = useDebounce(value, 500);

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
};
