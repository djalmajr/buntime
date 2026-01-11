import { Box, measureElement, Text } from "ink";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Theme } from "../lib/theme.js";

interface BorderBoxProps {
  backgroundColor?: string;
  borderColor?: string;
  children: ReactNode;
  paddingX?: number;
  paddingY?: number;
  width?: number;
}

const BORDER = {
  bottomLeft: "╰",
  bottomRight: "╯",
  horizontal: "─",
  topLeft: "╭",
  topRight: "╮",
  vertical: "│",
} as const;

export function BorderBox({
  backgroundColor = Theme.bgSurface,
  borderColor = Theme.text.muted,
  children,
  paddingX = 2,
  paddingY = 1,
  width,
}: BorderBoxProps) {
  const contentRef = useRef(null);
  const [measured, setMeasured] = useState({ height: 1, width: 0 });

  // Measure content - always measure height, measure width only for auto-width mode
  useEffect(() => {
    if (contentRef.current) {
      const dims = measureElement(contentRef.current);
      // Only update if dimensions actually changed to avoid infinite loop
      setMeasured((prev) => {
        if (prev.height !== dims.height || prev.width !== dims.width) {
          return { height: dims.height, width: dims.width };
        }
        return prev;
      });
    }
  });

  // Fixed width mode: use width prop
  // Auto width mode: use measured content width (already includes padding from Box)
  const innerWidth = width !== undefined ? width - 2 : measured.width;
  const contentHeight = measured.height;

  // Build vertical border string for multi-line content
  const verticalBorder =
    contentHeight > 1
      ? Array.from({ length: contentHeight }, () => BORDER.vertical).join("\n")
      : BORDER.vertical;

  const horizontalLine = BORDER.horizontal.repeat(Math.max(0, innerWidth));

  return (
    <Box flexDirection="column" width={width}>
      {/* Top border */}
      <Text backgroundColor={backgroundColor} color={borderColor}>
        {BORDER.topLeft}
        {horizontalLine}
        {BORDER.topRight}
      </Text>

      {/* Content area with side borders */}
      <Box>
        <Text backgroundColor={backgroundColor} color={borderColor}>
          {verticalBorder}
        </Text>
        <Box
          ref={contentRef}
          backgroundColor={backgroundColor}
          flexDirection="column"
          flexGrow={1}
          paddingX={paddingX}
          paddingY={paddingY}
        >
          {children}
        </Box>
        <Text backgroundColor={backgroundColor} color={borderColor}>
          {verticalBorder}
        </Text>
      </Box>

      {/* Bottom border */}
      <Text backgroundColor={backgroundColor} color={borderColor}>
        {BORDER.bottomLeft}
        {horizontalLine}
        {BORDER.bottomRight}
      </Text>
    </Box>
  );
}
