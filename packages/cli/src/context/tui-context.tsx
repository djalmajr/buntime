import { useApp, useInput } from "ink";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ApiClient } from "../lib/api-client.js";
import type { ResolvedConnection } from "../lib/connection.js";

/**
 * Screen types for navigation
 */
export type Screen =
  | { type: "add_server"; prefillName?: string; prefillUrl?: string }
  | { type: "app_install" }
  | { type: "app_list" }
  | { type: "app_remove" }
  | { type: "apps" }
  | { type: "connection_error"; error: string; errorType: string }
  | { type: "main_menu" }
  | { type: "plugin_install" }
  | { type: "plugin_list" }
  | { type: "plugin_remove" }
  | { type: "plugins" }
  | { type: "select_server" }
  | { type: "settings" }
  | { serverId: number; type: "settings_edit" }
  | { type: "testing_connection" }
  | { type: "token_prompt"; message?: string };

/**
 * State that can be persisted across navigation
 */
export interface ScreenState {
  selectedIndex?: number;
}

/**
 * Navigation history entry
 */
interface HistoryEntry {
  screen: Screen;
  state?: ScreenState;
}

/**
 * TUI context value
 */
interface TuiContextValue {
  api: ApiClient | null;
  clearConnection: () => void;
  connection: ResolvedConnection | null;
  currentScreen: Screen;
  currentState: ScreenState | undefined;
  exitPending: boolean;
  goBack: () => void;
  history: HistoryEntry[];
  navigate: (screen: Screen) => void;
  replace: (screen: Screen) => void;
  resetNavigation: (screen: Screen) => void;
  setApi: (api: ApiClient) => void;
  setConnection: (connection: ResolvedConnection) => void;
  updateScreenState: (state: ScreenState) => void;
}

const TuiContext = createContext<TuiContextValue | null>(null);

interface TuiProviderProps {
  children: ReactNode;
  initialConnection?: ResolvedConnection | null;
  initialScreen: Screen;
}

export function TuiProvider({ children, initialConnection, initialScreen }: TuiProviderProps) {
  const { exit } = useApp();
  const [history, setHistory] = useState<HistoryEntry[]>([{ screen: initialScreen }]);
  const [api, setApi] = useState<ApiClient | null>(null);
  const [connection, setConnection] = useState<ResolvedConnection | null>(
    initialConnection ?? null,
  );
  const [exitPending, setExitPending] = useState(false);
  const exitTimeoutRef = useRef<Timer | null>(null);

  // Handle Ctrl+C for double-press exit
  useInput(
    (_input, key) => {
      if (key.ctrl && _input === "c") {
        if (exitPending) {
          exit();
        } else {
          setExitPending(true);
          // Clear pending after 2 seconds
          if (exitTimeoutRef.current) {
            clearTimeout(exitTimeoutRef.current);
          }
          exitTimeoutRef.current = setTimeout(() => {
            setExitPending(false);
          }, 2000);
        }
      } else if (exitPending) {
        // Any other key cancels exit pending
        setExitPending(false);
        if (exitTimeoutRef.current) {
          clearTimeout(exitTimeoutRef.current);
        }
      }
    },
    { isActive: true },
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (exitTimeoutRef.current) {
        clearTimeout(exitTimeoutRef.current);
      }
    };
  }, []);

  const currentEntry = history[history.length - 1]!;
  const currentScreen = currentEntry.screen;
  const currentState = currentEntry.state;

  const updateScreenState = useCallback((state: ScreenState) => {
    setHistory((prev) => {
      const lastEntry = prev[prev.length - 1]!;
      // Check if state actually changed to avoid unnecessary re-renders
      const currentState = lastEntry.state ?? {};
      const hasChanges = Object.entries(state).some(
        ([key, value]) => currentState[key as keyof ScreenState] !== value,
      );
      if (!hasChanges) return prev;

      const newHistory = [...prev];
      newHistory[newHistory.length - 1] = { ...lastEntry, state: { ...lastEntry.state, ...state } };
      return newHistory;
    });
  }, []);

  const navigate = useCallback((screen: Screen) => {
    setHistory((prev) => [...prev, { screen }]);
  }, []);

  const replace = useCallback((screen: Screen) => {
    setHistory((prev) => {
      const newHistory = [...prev];
      newHistory[newHistory.length - 1] = { screen };
      return newHistory;
    });
  }, []);

  const goBack = useCallback(() => {
    setHistory((prev) => {
      if (prev.length <= 1) return prev;
      return prev.slice(0, -1);
    });
  }, []);

  const resetNavigation = useCallback((screen: Screen) => {
    setHistory([{ screen }]);
  }, []);

  const clearConnection = useCallback(() => {
    setConnection(null);
    setApi(null);
  }, []);

  const value: TuiContextValue = {
    api,
    clearConnection,
    connection,
    currentScreen,
    currentState,
    exitPending,
    goBack,
    history,
    navigate,
    replace,
    resetNavigation,
    setApi,
    setConnection,
    updateScreenState,
  };

  return <TuiContext.Provider value={value}>{children}</TuiContext.Provider>;
}

export function useTui(): TuiContextValue {
  const context = useContext(TuiContext);
  if (!context) {
    throw new Error("useTui must be used within a TuiProvider");
  }
  return context;
}

/**
 * Get breadcrumb path from screen
 */
export function getBreadcrumb(screen: Screen): string[] {
  switch (screen.type) {
    case "add_server":
      return ["Add Server"];
    case "app_install":
      return ["Apps", "Install"];
    case "app_list":
      return ["Apps", "List"];
    case "app_remove":
      return ["Apps", "Remove"];
    case "apps":
      return ["Apps"];
    case "connection_error":
      return [];
    case "main_menu":
      return [];
    case "plugin_install":
      return ["Plugins", "Install"];
    case "plugin_list":
      return ["Plugins", "List"];
    case "plugin_remove":
      return ["Plugins", "Remove"];
    case "plugins":
      return ["Plugins"];
    case "select_server":
      return [];
    case "settings":
      return ["Settings"];
    case "settings_edit":
      return ["Settings", "Edit"];
    case "testing_connection":
      return [];
    case "token_prompt":
      return [];
  }
}
