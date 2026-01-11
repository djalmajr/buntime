import { Box, Text } from "ink";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useTerminalSize } from "../lib/terminal.js";
import { Theme } from "../lib/theme.js";

interface ScrollableListProps<T> {
  /** Height per item (in lines) */
  itemHeight?: number;
  /** Items to render */
  items: T[];
  /** Maximum visible items (overrides calculated value) */
  maxVisibleItems?: number;
  /** Render function for each item */
  renderItem: (item: T, index: number, isSelected: boolean) => ReactNode;
  /** Height reserved for header, footer, and other UI elements */
  reservedHeight?: number;
  /** Currently selected index */
  selectedIndex: number;
}

export function ScrollableList<T>({
  items,
  itemHeight = 2,
  maxVisibleItems,
  renderItem,
  reservedHeight = 12,
  selectedIndex,
}: ScrollableListProps<T>) {
  const { rows: terminalHeight } = useTerminalSize();
  const [scrollOffset, setScrollOffset] = useState(0);

  // Calculate how many items can fit based on terminal height
  const availableHeight = Math.max(terminalHeight - reservedHeight, 3);
  const calculatedVisibleCount = Math.max(Math.floor(availableHeight / itemHeight), 1);

  // Use maxVisibleItems if provided, otherwise use calculated value
  const visibleItemCount = maxVisibleItems
    ? Math.min(maxVisibleItems, calculatedVisibleCount)
    : calculatedVisibleCount;

  // Adjust scroll offset when selection changes
  useEffect(() => {
    // If selected item is above the visible window, scroll up
    if (selectedIndex < scrollOffset) {
      setScrollOffset(selectedIndex);
    }
    // If selected item is below the visible window, scroll down
    else if (selectedIndex >= scrollOffset + visibleItemCount) {
      setScrollOffset(selectedIndex - visibleItemCount + 1);
    }
  }, [selectedIndex, scrollOffset, visibleItemCount]);

  // Get visible items
  const visibleItems = useMemo(() => {
    return items.slice(scrollOffset, scrollOffset + visibleItemCount);
  }, [items, scrollOffset, visibleItemCount]);

  const hasItemsAbove = scrollOffset > 0;
  const hasItemsBelow = scrollOffset + visibleItemCount < items.length;

  if (items.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column">
      <Box justifyContent="center" marginBottom={1}>
        <Text color={Theme.text.muted}>{hasItemsAbove ? `▲ ${scrollOffset} more` : " "}</Text>
      </Box>
      {visibleItems.map((item, visibleIndex) => {
        const actualIndex = scrollOffset + visibleIndex;
        const isSelected = actualIndex === selectedIndex;
        return (
          <Box key={actualIndex} flexDirection="column">
            {renderItem(item, actualIndex, isSelected)}
          </Box>
        );
      })}
      <Box justifyContent="center">
        <Text color={Theme.text.muted}>
          {hasItemsBelow ? `▼ ${items.length - scrollOffset - visibleItemCount} more` : " "}
        </Text>
      </Box>
    </Box>
  );
}
