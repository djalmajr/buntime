import { useCallback, useState } from "react";
import { Icon } from "~/components/icon";
import { Input } from "~/components/ui/input";

interface SearchPanelProps {
  onSearch?: (query: string) => void;
}

export function SearchPanel({ onSearch }: SearchPanelProps) {
  const [query, setQuery] = useState("");

  const handleSearch = useCallback(
    (value: string) => {
      setQuery(value);
      onSearch?.(value);
    },
    [onSearch],
  );

  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="relative">
        <Icon
          className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-zinc-500"
          name="lucide:search"
        />
        <Input
          className="h-8 border-zinc-600 bg-zinc-800 pl-8 text-sm"
          placeholder="Search files..."
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
        />
      </div>
      {query && <div className="text-sm text-zinc-500">Search functionality coming soon...</div>}
    </div>
  );
}
