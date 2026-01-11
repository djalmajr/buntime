import { Box, Text, useInput } from "ink";
import { useRef } from "react";
import { Theme } from "../lib/theme.js";
import { BorderBox } from "./border-box.js";

interface TextInputProps {
  focused?: boolean;
  label: string;
  mask?: boolean;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  value: string;
  width?: number;
}

export function TextInput({
  focused = true,
  label,
  mask = false,
  onChange,
  onSubmit,
  placeholder = "",
  value,
  width,
}: TextInputProps) {
  // Use ref for cursor to avoid race conditions with fast typing
  const cursorRef = useRef(value.length);

  // Keep cursor in bounds when value changes externally
  if (cursorRef.current > value.length) {
    cursorRef.current = value.length;
  }

  const cursorOffset = cursorRef.current;

  useInput(
    (input, key) => {
      if (!focused) return;

      if (key.return) {
        onSubmit?.();
        return;
      }

      if (key.backspace || key.delete) {
        if (cursorRef.current > 0) {
          const pos = cursorRef.current;
          const newValue = value.slice(0, pos - 1) + value.slice(pos);
          cursorRef.current = pos - 1;
          onChange(newValue);
        }
        return;
      }

      if (key.leftArrow) {
        if (cursorRef.current > 0) {
          cursorRef.current -= 1;
          onChange(value); // Trigger re-render
        }
        return;
      }

      if (key.rightArrow) {
        if (cursorRef.current < value.length) {
          cursorRef.current += 1;
          onChange(value); // Trigger re-render
        }
        return;
      }

      // Ignore control keys
      if (key.ctrl || key.meta || key.escape || key.upArrow || key.downArrow || key.tab) {
        return;
      }

      // Add character at cursor position
      if (input && input.length === 1) {
        const pos = cursorRef.current;
        const newValue = value.slice(0, pos) + input + value.slice(pos);
        cursorRef.current = pos + 1;
        onChange(newValue);
      }
    },
    { isActive: focused },
  );

  const displayValue = mask ? "*".repeat(value.length) : value;
  const showPlaceholder = value.length === 0;

  return (
    <Box flexDirection="column">
      <Text color={Theme.text.muted}>{label}</Text>
      <BorderBox
        backgroundColor={Theme.bg}
        borderColor={focused ? Theme.selected : Theme.border}
        paddingX={1}
        paddingY={0}
        width={width}
      >
        <Box minHeight={1}>
          {showPlaceholder ? (
            <Text color="gray">
              {placeholder}
              {focused && <Text backgroundColor="white"> </Text>}
            </Text>
          ) : (
            <Text>
              {displayValue.slice(0, cursorOffset)}
              {focused && <Text backgroundColor="white">{displayValue[cursorOffset] ?? " "}</Text>}
              {displayValue.slice(cursorOffset + 1)}
            </Text>
          )}
        </Box>
      </BorderBox>
    </Box>
  );
}
