import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

export type AppearanceMode = "dark" | "light" | "system";

// Simple external store for appearance state
let currentMode: AppearanceMode = "dark";
let resolvedMode: "dark" | "light" = "dark";
let cachedSnapshot = { mode: currentMode, resolvedMode };
const listeners = new Set<() => void>();

function getAppearanceSnapshot() {
  return cachedSnapshot;
}

function updateSnapshot() {
  cachedSnapshot = { mode: currentMode, resolvedMode };
}

function subscribeToAppearance(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function notifyListeners() {
  for (const listener of listeners) {
    listener();
  }
}

function getSystemPreference(): "dark" | "light" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyAppearance(mode: "dark" | "light") {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(mode);
  resolvedMode = mode;
  updateSnapshot();
}

function setGlobalAppearance(mode: AppearanceMode) {
  currentMode = mode;
  const resolved = mode === "system" ? getSystemPreference() : mode;
  applyAppearance(resolved); // This calls updateSnapshot()
  localStorage.setItem("appearance-mode", mode);
  notifyListeners();
}

/**
 * Hook to initialize and manage app appearance (light/dark mode)
 * Should be used once at root level
 */
export function useAppearanceState() {
  const [mode, setModeState] = useState<AppearanceMode>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("appearance-mode") as AppearanceMode | null;
      if (stored && ["dark", "light", "system"].includes(stored)) {
        return stored;
      }
    }
    return "dark";
  });

  // Initialize on mount
  useEffect(() => {
    currentMode = mode;
    const resolved = mode === "system" ? getSystemPreference() : mode;
    applyAppearance(resolved);
    notifyListeners();
  }, [mode]);

  // Listen for system preference changes
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      if (currentMode === "system") {
        applyAppearance(getSystemPreference());
        notifyListeners();
      }
    };
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  const setMode = useCallback((newMode: AppearanceMode) => {
    setModeState(newMode);
    setGlobalAppearance(newMode);
  }, []);

  return { mode, resolvedMode: mode === "system" ? getSystemPreference() : mode, setMode };
}

/**
 * Hook to read and toggle appearance mode from any component
 */
export function useAppearance() {
  const state = useSyncExternalStore(
    subscribeToAppearance,
    getAppearanceSnapshot,
    getAppearanceSnapshot,
  );

  const toggleMode = useCallback(() => {
    const newMode = state.resolvedMode === "dark" ? "light" : "dark";
    setGlobalAppearance(newMode);
  }, [state.resolvedMode]);

  const setMode = useCallback((mode: AppearanceMode) => {
    setGlobalAppearance(mode);
  }, []);

  return {
    isDark: state.resolvedMode === "dark",
    mode: state.mode,
    resolvedMode: state.resolvedMode,
    setMode,
    toggleMode,
  };
}
