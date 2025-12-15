import type { KvEntry, KvKey } from "@buntime/keyval";
import { useCallback, useState } from "react";
import { kv } from "~/helpers/kv";

export function useKvGrid(prefix: KvKey) {
  const [entries, setEntries] = useState<KvEntry[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);

  const loadEntries = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const results: KvEntry[] = [];
      for await (const entry of kv.list(prefix)) {
        results.push(entry);
      }
      setEntries(results);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [prefix]);

  const updateEntry = useCallback(
    async (key: KvKey, value: unknown) => {
      await kv.set(key, value);
      await loadEntries();
    },
    [loadEntries],
  );

  const deleteEntry = useCallback(
    async (key: KvKey) => {
      await kv.delete(key, { exact: true });
      await loadEntries();
    },
    [loadEntries],
  );

  const deleteMultiple = useCallback(
    async (keys: KvKey[]) => {
      for (const key of keys) {
        await kv.delete(key, { exact: true });
      }
      await loadEntries();
    },
    [loadEntries],
  );

  return {
    deleteEntry,
    deleteMultiple,
    entries,
    error,
    loading,
    loadEntries,
    updateEntry,
  };
}
