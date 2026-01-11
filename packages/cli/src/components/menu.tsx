import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { useTerminalSize } from "../lib/terminal.js";
import { Theme } from "../lib/theme.js";
import { Label } from "./label.js";

export interface MenuItem {
  description?: string;
  label: string;
  separator?: boolean;
  value: string;
}

interface MenuProps {
  items: MenuItem[];
  layout?: "horizontal" | "vertical";
  onSelect: (value: string) => void;
  title?: string;
}

export function Menu({ items, layout = "vertical", onSelect, title }: MenuProps) {
  const { columns: width } = useTerminalSize();
  const selectableItems = items.filter((item) => !item.separator);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    const len = selectableItems.length;
    if (key.upArrow || input === "k") {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow || input === "j") {
      setSelectedIndex((prev) => Math.min(len - 1, prev + 1));
    } else if (key.return) {
      const item = selectableItems[selectedIndex];
      if (item) {
        onSelect(item.value);
      }
    }
  });

  let selectableIndex = 0;
  const separatorWidth = Math.min(50, width - 4);

  return (
    <Box flexDirection="column" paddingX={1}>
      {title && (
        <Box marginBottom={1}>
          <Label bold wrap="wrap">
            {title}
          </Label>
        </Box>
      )}
      {items.map((item, index) => {
        if (item.separator) {
          return (
            <Box key={`sep-${index}`} marginY={0}>
              <Text color={Theme.border}>{"─".repeat(separatorWidth)}</Text>
            </Box>
          );
        }

        const isSelected = selectableIndex === selectedIndex;
        selectableIndex++;

        if (layout === "horizontal") {
          return (
            <Box gap={2} key={item.value}>
              <Label selected={isSelected} wrap="wrap">
                {isSelected ? "▸" : " "} {item.label}
              </Label>
              {item.description && (
                <Label muted wrap="wrap">
                  {item.description}
                </Label>
              )}
            </Box>
          );
        }

        return (
          <Box flexDirection="column" key={item.value} marginBottom={item.description ? 1 : 0}>
            <Label selected={isSelected} wrap="wrap">
              {isSelected ? "▸" : " "} {item.label}
            </Label>
            {item.description && (
              <Box marginLeft={2}>
                <Label muted wrap="wrap">
                  {item.description}
                </Label>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
