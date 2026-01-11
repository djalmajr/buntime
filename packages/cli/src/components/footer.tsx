import { Box, Text } from "ink";
import { useMemo } from "react";
import { useTui } from "../context/tui-context.js";
import { useTerminalSize } from "../lib/terminal.js";
import { Theme } from "../lib/theme.js";
import { Label } from "./label.js";

export interface Shortcut {
  action: string;
  key: string;
}

interface FooterProps {
  shortcuts?: Shortcut[];
}

// Default shortcuts shown on all screens (common ones first to minimize layout shift)
const defaultShortcuts: Shortcut[] = [
  { action: "back", key: "Esc" },
  { action: "navigate", key: "↑↓" },
  { action: "select", key: "Enter" },
];

export function Footer({ shortcuts = [] }: FooterProps) {
  const { columns: width } = useTerminalSize();
  const { exitPending } = useTui();

  // Combine default shortcuts with screen-specific ones (defaults first for consistency)
  const allShortcuts = useMemo(() => {
    return [...defaultShortcuts, ...shortcuts];
  }, [shortcuts]);

  // Calculate shortcut widths and organize into rows
  const rows = useMemo(() => {
    const result: Shortcut[][] = [];
    let currentRow: Shortcut[] = [];
    let currentWidth = 0;
    const padding = 2; // paddingX on container
    const gap = 2; // gap between items
    const availableWidth = width - padding * 2;

    for (const shortcut of allShortcuts) {
      // Format: [key] action + gap
      const itemWidth = `[${shortcut.key}] ${shortcut.action}`.length + gap;

      if (currentWidth + itemWidth > availableWidth && currentRow.length > 0) {
        result.push(currentRow);
        currentRow = [shortcut];
        currentWidth = itemWidth;
      } else {
        currentRow.push(shortcut);
        currentWidth += itemWidth;
      }
    }

    if (currentRow.length > 0) {
      result.push(currentRow);
    }

    return result;
  }, [allShortcuts, width]);

  return (
    <Box backgroundColor={Theme.bg} flexDirection="column" paddingBottom={1} width={width}>
      <Text color={Theme.border}>{"─".repeat(width)}</Text>
      {exitPending ? (
        <Box justifyContent="center" paddingX={1}>
          <Text color="yellow">Press Ctrl+C again to exit</Text>
        </Box>
      ) : (
        rows.map((row, rowIndex) => (
          <Box gap={2} key={rowIndex} paddingX={1}>
            {row.map((shortcut, index) => (
              <Label key={index}>
                [{shortcut.key}]<Label muted> {shortcut.action}</Label>
              </Label>
            ))}
          </Box>
        ))
      )}
    </Box>
  );
}
