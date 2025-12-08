import { useCallback, useState, useSyncExternalStore } from "react";
import { defaultTheme, type Theme, themes, themeList } from "~/libs/themes";

// Simple external store for editor theme state
let currentTheme: Theme = defaultTheme;
const listeners = new Set<() => void>();

function getThemeSnapshot() {
  return currentTheme;
}

function subscribeToTheme(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function setGlobalTheme(theme: Theme) {
  currentTheme = theme;
  localStorage.setItem("editor-theme-id", theme.id);
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Hook to initialize and manage editor theme
 * Should be used where the editor is mounted
 */
export function useEditorThemeState() {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("editor-theme-id");
      if (stored && themes[stored]) {
        return themes[stored];
      }
    }
    return defaultTheme;
  });

  const setTheme = useCallback((themeId: string) => {
    if (themes[themeId]) {
      const newTheme = themes[themeId];
      setThemeState(newTheme);
      setGlobalTheme(newTheme);
    }
  }, []);

  return { setTheme, theme };
}

/**
 * Hook for components that need to read editor theme
 */
export function useEditorTheme() {
  const theme = useSyncExternalStore(subscribeToTheme, getThemeSnapshot, getThemeSnapshot);

  const setTheme = useCallback((themeId: string) => {
    if (themes[themeId]) {
      setGlobalTheme(themes[themeId]);
    }
  }, []);

  return { setTheme, theme };
}

/**
 * Get all available editor themes
 */
export function getEditorThemes() {
  return {
    all: themeList,
    dark: themeList.filter((t) => t.type === "dark"),
    light: themeList.filter((t) => t.type === "light"),
  };
}
