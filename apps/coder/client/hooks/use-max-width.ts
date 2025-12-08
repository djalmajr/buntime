import { useEffect, useState } from "react";

export function useMaxWidth(breakpoint: number) {
  const [isMaxWidth, setIsMaxWidth] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = () => setIsMaxWidth(window.innerWidth < breakpoint);
    mql.addEventListener("change", onChange);
    setIsMaxWidth(window.innerWidth < breakpoint);
    return () => mql.removeEventListener("change", onChange);
  }, [breakpoint]);

  return !!isMaxWidth;
}
