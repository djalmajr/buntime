import { useCallback, useEffect, useRef, useState } from "react";

export function useDebounceFn<T extends (...args: Parameters<T>) => ReturnType<T>>(
  callback: T,
  delay = 300,
) {
  const idRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  return useCallback(
    (...args: Parameters<T>) => {
      if (idRef.current) clearTimeout(idRef.current);
      idRef.current = setTimeout(callback, delay, ...args);
    },
    [callback, delay],
  );
}

export const useDebounce = <T>(value: T, delay: number): T => {
  const [val, setVal] = useState<T>(value);

  useEffect(() => {
    const tId = setTimeout(setVal, delay, value);
    return () => clearTimeout(tId);
  }, [value, delay]);

  return val;
};
