import type { ReactNode } from "react";

interface ScrollAreaProps {
  children: ReactNode;
  className?: string;
}

export function ScrollArea({ children, className = "h-full" }: ScrollAreaProps) {
  return <div className={className}>{children}</div>;
}
