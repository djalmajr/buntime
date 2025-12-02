import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

type ValueOrFn<T> = T | ((prev: T) => T);

type SetValue<T> = (value: ValueOrFn<T>) => void;

type Result<T> = [T, SetValue<T>];

/**
 * A hook to manage query parameters state using @tanstack/react-router
 * Inspired by nuqs but implemented with TanStack Router
 * @param key - The query parameter key
 * @param init - The default value
 * @param keep - Whether to keep the query parameter in the URL even when the value is equal to the default
 */
export function useQueryState<T>(key: string, init: T, keep = false): Result<T> {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as Record<string, string>;
  const value = useMemo(() => search[key] ?? init, [search, key, init]);
  const setValue = useCallback(
    (val: ValueOrFn<T>) => {
      const next = typeof val === "function" ? (val as (prev: T) => T)(value as T) : (val ?? init);
      navigate({
        search: (prev) => ({ ...prev, [key]: next === init && !keep ? void 0 : next }) as never,
        replace: true,
      });
    },
    [init, keep, key, value, navigate],
  );
  return [value as T, setValue];
}

/**
 * A hook to manage string query parameters
 * @param key - The query parameter key
 * @param init - The default value
 * @param keep - Whether to keep the query parameter in the URL even when the value is equal to the default
 */
export function useQueryString(key: string, init = "", keep = false): Result<string> {
  return useQueryState(key, init, keep);
}

/**
 * A hook to manage number query parameters
 * @param key - The query parameter key
 * @param init - The default value
 * @param keep - Whether to keep the query parameter in the URL even when the value is equal to the default
 */
export function useQueryNumber(key: string, init = 0, keep = false): Result<number> {
  return useQueryState(key, init, keep);
}

/**
 * A hook to manage boolean query parameters
 * @param key - The query parameter key
 * @param init - The default value
 * @param keep - Whether to keep the query parameter in the URL even when the value is equal to the default
 */
export function useQueryBoolean(key: string, init = false, keep = false): Result<boolean> {
  return useQueryState(key, init, keep);
}
