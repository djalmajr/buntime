import { Box, type BoxProps } from "ink";
import type { ReactNode } from "react";
import { Theme } from "../lib/theme.js";

interface FlexProps extends Omit<BoxProps, "borderColor" | "borderStyle"> {
  /** Add rounded border with theme color */
  bordered?: boolean;
  /** Border color override (only when bordered=true) */
  borderColor?: string;
  children?: ReactNode;
}

/**
 * Flex component - Box with theme defaults
 *
 * @example
 * // Basic usage (has theme background)
 * <Flex>Content</Flex>
 *
 * @example
 * // With border
 * <Flex bordered paddingX={2}>Content</Flex>
 *
 * @example
 * // With custom border color
 * <Flex bordered borderColor="red">Error content</Flex>
 */
export function Flex({ bordered, borderColor, children, ...props }: FlexProps) {
  return (
    <Box
      backgroundColor={Theme.bg}
      {...(bordered && {
        borderColor: borderColor ?? Theme.border,
        borderStyle: "round" as const,
      })}
      {...props}
    >
      {children}
    </Box>
  );
}
