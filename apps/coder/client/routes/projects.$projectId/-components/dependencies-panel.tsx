import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "~/components/icon";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cn } from "~/libs/cn";
import type { Dependency, NpmPackageInfo } from "../-hooks/use-dependencies";

interface DependenciesPanelProps {
  dependencies: Dependency[];
  isSearching: boolean;
  searchResults: NpmPackageInfo[];
  onAddDependency: (name: string, version?: string) => void;
  onClearSearch: () => void;
  onRemoveDependency: (name: string) => void;
  onSearch: (query: string) => void;
}

export function DependenciesPanel({
  dependencies,
  isSearching,
  searchResults,
  onAddDependency,
  onClearSearch,
  onRemoveDependency,
  onSearch,
}: DependenciesPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showSearch && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showSearch]);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchQuery(value);

      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }

      if (value.trim()) {
        searchTimeoutRef.current = setTimeout(() => {
          onSearch(value);
        }, 300);
      } else {
        onClearSearch();
      }
    },
    [onClearSearch, onSearch],
  );

  const handleAddPackage = useCallback(
    (pkg: NpmPackageInfo) => {
      onAddDependency(pkg.name, pkg.version);
      setSearchQuery("");
      setShowSearch(false);
      onClearSearch();
    },
    [onAddDependency, onClearSearch],
  );

  const handleCloseSearch = useCallback(() => {
    setSearchQuery("");
    setShowSearch(false);
    onClearSearch();
  }, [onClearSearch]);

  return (
    <div className="flex flex-col">
      {showSearch ? (
        <div className="relative px-2 py-1">
          <Icon
            className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
            name="lucide:search"
          />
          <Input
            className="h-8 border-zinc-600 bg-zinc-800 pl-8 pr-8 text-sm"
            placeholder="Search packages..."
            ref={inputRef}
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") handleCloseSearch();
            }}
          />
          <button
            type="button"
            className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200"
            onClick={handleCloseSearch}
          >
            <Icon className="size-4" name="lucide:x" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="mx-2 my-1 flex items-center gap-2 rounded border border-dashed border-zinc-600 px-2 py-1.5 text-sm text-zinc-400 hover:border-zinc-500 hover:text-zinc-300"
          onClick={() => setShowSearch(true)}
        >
          <Icon className="size-4" name="lucide:plus" />
          Add dependency
        </button>
      )}

      {showSearch && searchQuery && (
        <div className="max-h-48 overflow-y-auto border-t border-zinc-700">
          {isSearching ? (
            <div className="px-3 py-2 text-sm text-zinc-400">Searching...</div>
          ) : searchResults.length > 0 ? (
            searchResults.map((pkg) => {
              const isInstalled = dependencies.some((d) => d.name === pkg.name);
              return (
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-700/50",
                    isInstalled && "opacity-50",
                  )}
                  disabled={isInstalled}
                  key={pkg.name}
                  onClick={() => handleAddPackage(pkg)}
                >
                  <div className="flex-1 truncate">
                    <div className="font-medium">{pkg.name}</div>
                    {pkg.description && (
                      <div className="truncate text-xs text-zinc-400">{pkg.description}</div>
                    )}
                  </div>
                  <span className="ml-2 text-xs text-zinc-500">{pkg.version}</span>
                </button>
              );
            })
          ) : (
            <div className="px-3 py-2 text-sm text-zinc-400">No packages found</div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {dependencies.map((dep) => (
          <div
            className="group flex items-center justify-between px-3 py-1.5 hover:bg-zinc-700/30"
            key={dep.name}
          >
            <div className="flex items-center gap-2">
              <Icon className="size-4 text-zinc-500" name="lucide:package" />
              <span className="text-sm">{dep.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">{dep.version}</span>
              <Button
                className="size-6 opacity-0 group-hover:opacity-100"
                size="icon"
                variant="ghost"
                onClick={() => onRemoveDependency(dep.name)}
              >
                <Icon className="size-3 text-red-400" name="lucide:trash-2" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
