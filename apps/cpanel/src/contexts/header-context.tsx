import { createContext, type ReactNode, useContext, useState } from "react";

interface HeaderState {
  actions?: ReactNode;
  description?: string;
  title?: ReactNode;
}

interface HeaderContextValue {
  header: HeaderState | null;
  setHeader: (header: HeaderState | null) => void;
}

const HeaderContext = createContext<HeaderContextValue | undefined>(undefined);

export function HeaderProvider({ children }: { children: ReactNode }) {
  const [header, setHeader] = useState<HeaderState | null>(null);

  return <HeaderContext.Provider value={{ header, setHeader }}>{children}</HeaderContext.Provider>;
}

export function useHeader() {
  const context = useContext(HeaderContext);
  if (!context) {
    throw new Error("useHeader must be used within HeaderProvider");
  }
  return context;
}
