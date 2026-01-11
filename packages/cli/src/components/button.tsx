import { Text } from "ink";
import { Theme } from "../lib/theme.js";

type ButtonType = "button" | "cancel" | "submit";

interface ButtonProps {
  focused?: boolean;
  label: string;
  type?: ButtonType;
}

export function Button({ focused = false, label, type: _type = "button" }: ButtonProps) {
  return (
    <Text backgroundColor={focused ? Theme.primary : Theme.text.muted} bold={focused} color="white">
      {` ${label} `}
    </Text>
  );
}

export type { ButtonType };
