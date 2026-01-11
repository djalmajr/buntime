import { Text, type TextProps } from "ink";
import { Theme } from "../lib/theme.js";

interface LabelProps extends Omit<TextProps, "color"> {
  color?: TextProps["color"];
  muted?: boolean;
  selected?: boolean;
}

export function Label({ children, color, muted, selected, ...props }: LabelProps) {
  const resolvedColor = color ?? (selected ? "cyan" : muted ? Theme.text.muted : "white");

  return (
    <Text color={resolvedColor} {...props}>
      {children}
    </Text>
  );
}
