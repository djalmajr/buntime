import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { defaultTheme, type Theme, themes } from "~/libs/themes";

// Simple external store for theme state
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
  for (const listener of listeners) {
    listener();
  }
}

export function useThemeState() {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("theme-id");
      if (stored && themes[stored]) {
        return themes[stored];
      }
    }
    return defaultTheme;
  });

  useEffect(() => {
    const root = document.documentElement;

    // Apply CSS variables
    root.style.setProperty("--theme-bg", theme.colors.bg);
    root.style.setProperty("--theme-bg-secondary", theme.colors.bgSecondary);
    root.style.setProperty("--theme-bg-tertiary", theme.colors.bgTertiary);
    root.style.setProperty("--theme-border", theme.colors.border);
    root.style.setProperty("--theme-border-secondary", theme.colors.borderSecondary);
    root.style.setProperty("--theme-text", theme.colors.text);
    root.style.setProperty("--theme-text-secondary", theme.colors.textSecondary);
    root.style.setProperty("--theme-text-muted", theme.colors.textMuted);
    root.style.setProperty("--theme-accent", theme.colors.accent);
    root.style.setProperty("--theme-accent-hover", theme.colors.accentHover);
    root.style.setProperty("--theme-selection", theme.colors.selection);
    root.style.setProperty("--theme-selection-text", theme.colors.selectionText);
    root.style.setProperty("--theme-error", theme.colors.error);
    root.style.setProperty("--theme-warning", theme.colors.warning);
    root.style.setProperty("--theme-success", theme.colors.success);

    // Set theme type class for potential dark/light specific styles
    root.classList.remove("light", "dark");
    root.classList.add(theme.type);

    // Save to localStorage
    localStorage.setItem("theme-id", theme.id);
  }, [theme]);

  const setTheme = useCallback((themeId: string) => {
    if (themes[themeId]) {
      const newTheme = themes[themeId];
      setThemeState(newTheme);
      setGlobalTheme(newTheme);
    }
  }, []);

  // Sync global state on mount
  useEffect(() => {
    setGlobalTheme(theme);
  }, [theme]);

  return { setTheme, theme };
}

/**
 * Hook for components that need to read/toggle theme
 * without managing theme state (that's done by useThemeState in root)
 */
export function useTheme() {
  const theme = useSyncExternalStore(subscribeToTheme, getThemeSnapshot, getThemeSnapshot);

  const toggleTheme = useCallback(() => {
    // Toggle between current dark theme and github-light
    const newThemeId = theme.type === "dark" ? "github-light" : "github-dark";
    const newTheme = themes[newThemeId];
    setGlobalTheme(newTheme);

    // Apply CSS variables and save to localStorage
    const root = document.documentElement;
    root.style.setProperty("--theme-bg", newTheme.colors.bg);
    root.style.setProperty("--theme-bg-secondary", newTheme.colors.bgSecondary);
    root.style.setProperty("--theme-bg-tertiary", newTheme.colors.bgTertiary);
    root.style.setProperty("--theme-border", newTheme.colors.border);
    root.style.setProperty("--theme-border-secondary", newTheme.colors.borderSecondary);
    root.style.setProperty("--theme-text", newTheme.colors.text);
    root.style.setProperty("--theme-text-secondary", newTheme.colors.textSecondary);
    root.style.setProperty("--theme-text-muted", newTheme.colors.textMuted);
    root.style.setProperty("--theme-accent", newTheme.colors.accent);
    root.style.setProperty("--theme-accent-hover", newTheme.colors.accentHover);
    root.style.setProperty("--theme-selection", newTheme.colors.selection);
    root.style.setProperty("--theme-selection-text", newTheme.colors.selectionText);
    root.style.setProperty("--theme-error", newTheme.colors.error);
    root.style.setProperty("--theme-warning", newTheme.colors.warning);
    root.style.setProperty("--theme-success", newTheme.colors.success);
    root.classList.remove("light", "dark");
    root.classList.add(newTheme.type);
    localStorage.setItem("theme-id", newTheme.id);
  }, [theme.type]);

  return { theme: theme.type, toggleTheme };
}
