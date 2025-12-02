import { createContext, type ReactNode, useContext, useState } from "react";

interface HeaderAction {
  href?: string;
  label: string;
  onClick?: () => void;
}

interface HeaderContextValue {
  action: HeaderAction | null;
  setAction: (action: HeaderAction | null) => void;
}

const HeaderContext = createContext<HeaderContextValue | undefined>(undefined);

export function HeaderProvider({ children }: { children: ReactNode }) {
  const [action, setAction] = useState<HeaderAction | null>(null);

  return <HeaderContext.Provider value={{ action, setAction }}>{children}</HeaderContext.Provider>;
}

export function useHeader() {
  const context = useContext(HeaderContext);
  if (!context) {
    throw new Error("useHeader must be used within HeaderProvider");
  }
  return context;
}
