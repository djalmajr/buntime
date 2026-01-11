/**
 * Terminal utilities for managing terminal state
 *
 * Uses alternate screen buffer so the TUI doesn't "dirty" the terminal.
 * When the app exits, the terminal returns to its previous state.
 */

import { useEffect, useState } from "react";

export interface TerminalSize {
  columns: number;
  rows: number;
}

/**
 * Hook to get current terminal size and update on resize
 */
export function useTerminalSize(): TerminalSize {
  const [size, setSize] = useState<TerminalSize>({
    columns: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
  });

  useEffect(() => {
    const handleResize = () => {
      setSize({
        columns: process.stdout.columns ?? 80,
        rows: process.stdout.rows ?? 24,
      });
    };

    process.stdout.on("resize", handleResize);
    return () => {
      process.stdout.off("resize", handleResize);
    };
  }, []);

  return size;
}

/**
 * Reset terminal to its original state
 * - Switches back to main screen buffer
 * - Shows cursor
 * - Resets text attributes
 */
export function resetTerminal(): void {
  // ESC[?1049l - Switch back to main screen buffer
  // ESC[?25h - Show cursor
  // ESC[0m - Reset all attributes
  process.stdout.write("\x1b[?1049l\x1b[?25h\x1b[0m");
}

/**
 * Setup terminal for TUI mode
 * - Switches to alternate screen buffer (clean slate)
 * - Hides cursor for cleaner UI
 */
export function setupTerminal(): void {
  // ESC[?1049h - Switch to alternate screen buffer
  // ESC[?25l - Hide cursor
  process.stdout.write("\x1b[?1049h\x1b[?25l");
}
