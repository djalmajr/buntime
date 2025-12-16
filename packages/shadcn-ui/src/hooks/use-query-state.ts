import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

type SearchParams = Record<string, unknown>;

type ValueOrFn<T> = T | ((prev: T) => T) | undefined;

type SetValue<T> = (value: ValueOrFn<T>) => void;

type Result<T> = [T, SetValue<T>];

interface QueryStateOptions<T> {
  /** Whether to keep the query parameter in the URL even when the value is equal to the default */
  keep?: boolean;
  /** Parse function to convert the raw URL value to the desired type */
  parse?: (raw: unknown, init: T) => T;
}

/**
 * A hook to manage query parameters state using @tanstack/react-router
 * Inspired by nuqs but implemented with TanStack Router
 * @param key - The query parameter key
 * @param init - The default value
 * @param options - Configuration options (keep, parse)
 */
export function useQueryState<T>(
  key: string,
  init: T,
  options: QueryStateOptions<T> = {},
): Result<T> {
  const { keep = false, parse } = options;
  const navigate = useNavigate();
  const search = useSearch({ strict: false, structuralSharing: false }) as SearchParams;

  const value = useMemo(() => {
    const raw = search[key];
    if (parse) return parse(raw, init);
    return (raw as T) ?? init;
  }, [search, key, init, parse]);

  const setValue = useCallback(
    (val: ValueOrFn<T>) => {
      const next = typeof val === "function" ? (val as (prev: T) => T)(value) : (val ?? init);
      navigate({
        to: ".",
        search: (prev: SearchParams) => ({
          ...prev,
          [key]: next === init && !keep ? undefined : next,
        }),
        replace: true,
      });
    },
    [init, keep, key, value, navigate],
  );

  return [value, setValue];
}

/**
 * A hook to manage string query parameters
 * @param key - The query parameter key
 * @param init - The default value
 * @param keep - Whether to keep the query parameter in the URL even when the value is equal to the default
 */
export function useQueryString(key: string, init = "", keep = false): Result<string> {
  return useQueryState(key, init, { keep });
}

const parseNumber = (raw: unknown, init: number): number => {
  if (raw === undefined || raw === null) return init;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return Number.isNaN(parsed) ? init : parsed;
};

/**
 * A hook to manage number query parameters
 * @param key - The query parameter key
 * @param init - The default value
 * @param keep - Whether to keep the query parameter in the URL even when the value is equal to the default
 */
export function useQueryNumber(key: string, init = 0, keep = false): Result<number> {
  return useQueryState(key, init, { keep, parse: parseNumber });
}

/**
 * A hook to manage boolean query parameters
 * @param key - The query parameter key
 * @param init - The default value
 * @param keep - Whether to keep the query parameter in the URL even when the value is equal to the default
 */
export function useQueryBoolean(key: string, init = false, keep = false): Result<boolean> {
  return useQueryState(key, init, { keep });
}

const parseArray = (raw: unknown, init: string[]): string[] => {
  if (raw === undefined || raw === null) return init;
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === "string") return raw.split(",").filter(Boolean);
  return init;
};

/**
 * A hook to manage array query parameters (comma-separated in URL)
 * @param key - The query parameter key
 * @param init - The default value (empty array)
 * @param keep - Whether to keep the query parameter in the URL even when the value is equal to the default
 */
export function useQueryArray(key: string, init: string[] = [], keep = false): Result<string[]> {
  const navigate = useNavigate();
  const search = useSearch({ strict: false, structuralSharing: false }) as SearchParams;
  const value = useMemo(() => parseArray(search[key], init), [search, key, init]);

  const setValue = useCallback(
    (val: ValueOrFn<string[]>) => {
      const next = typeof val === "function" ? (val as (prev: string[]) => string[])(value) : val;
      const isEmpty = !next || next.length === 0;
      const isDefault = JSON.stringify(next) === JSON.stringify(init);
      navigate({
        to: ".",
        search: (prev: SearchParams) => ({
          ...prev,
          [key]: isEmpty || (isDefault && !keep) ? undefined : next.join(","),
        }),
        replace: true,
      });
    },
    [init, keep, key, value, navigate],
  );

  return [value, setValue];
}
