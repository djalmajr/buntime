import { useCallback, useState } from "react";

export interface Dependency {
  name: string;
  version: string;
}

export interface NpmPackageInfo {
  description?: string;
  name: string;
  version: string;
}

const DEFAULT_DEPENDENCIES: Dependency[] = [
  { name: "react", version: "19.0.0" },
  { name: "react-dom", version: "19.0.0" },
];

export function useDependencies(initialDependencies?: Dependency[]) {
  const [dependencies, setDependencies] = useState<Dependency[]>(
    initialDependencies || DEFAULT_DEPENDENCIES,
  );
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<NpmPackageInfo[]>([]);

  const addDependency = useCallback(async (name: string, version?: string) => {
    // Check if already exists
    setDependencies((prev) => {
      if (prev.some((d) => d.name === name)) {
        // Update version if already exists
        return prev.map((d) => (d.name === name ? { ...d, version: version || d.version } : d));
      }
      return [...prev, { name, version: version || "latest" }];
    });

    // If no version provided, fetch latest
    if (!version) {
      try {
        const response = await fetch(`https://registry.npmjs.org/${name}/latest`);
        if (response.ok) {
          const data = await response.json();
          setDependencies((prev) =>
            prev.map((d) => (d.name === name ? { ...d, version: data.version } : d)),
          );
        }
      } catch {
        // Keep "latest" as version if fetch fails
      }
    }
  }, []);

  const removeDependency = useCallback((name: string) => {
    setDependencies((prev) => prev.filter((d) => d.name !== name));
  }, []);

  const updateDependencyVersion = useCallback((name: string, version: string) => {
    setDependencies((prev) => prev.map((d) => (d.name === name ? { ...d, version } : d)));
  }, []);

  const searchPackages = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const response = await fetch(
        `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=10`,
      );
      if (response.ok) {
        const data = await response.json();
        const results: NpmPackageInfo[] = data.objects.map(
          (obj: { package: { name: string; version: string; description?: string } }) => ({
            description: obj.package.description,
            name: obj.package.name,
            version: obj.package.version,
          }),
        );
        setSearchResults(results);
      }
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const clearSearch = useCallback(() => {
    setSearchResults([]);
  }, []);

  const getPackageVersions = useCallback(async (name: string): Promise<string[]> => {
    try {
      const response = await fetch(`https://registry.npmjs.org/${name}`);
      if (response.ok) {
        const data = await response.json();
        const versions = Object.keys(data.versions || {});
        // Return last 10 versions, newest first
        return versions.slice(-10).reverse();
      }
    } catch {
      // Ignore errors
    }
    return [];
  }, []);

  return {
    addDependency,
    clearSearch,
    dependencies,
    getPackageVersions,
    isSearching,
    removeDependency,
    searchPackages,
    searchResults,
    updateDependencyVersion,
  };
}
