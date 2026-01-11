import { Box, useInput } from "ink";
import { useState } from "react";
import { BorderBox } from "./border-box.js";
import { Button } from "./button.js";
import { Label } from "./label.js";

interface DialogButton {
  label: string;
  value: string;
}

interface DialogProps {
  buttons: DialogButton[];
  message: string;
  onSelect: (value: string) => void;
  title: string;
}

export function Dialog({ buttons, message, onSelect, title }: DialogProps) {
  const [selectedIndex, setSelectedIndex] = useState(buttons.length - 1);

  useInput((_input, key) => {
    if (key.leftArrow || (key.tab && key.shift)) {
      setSelectedIndex((prev) => (prev - 1 + buttons.length) % buttons.length);
    } else if (key.rightArrow || key.tab) {
      setSelectedIndex((prev) => (prev + 1) % buttons.length);
    } else if (key.return) {
      onSelect(buttons[selectedIndex]!.value);
    } else if (key.escape) {
      onSelect("cancel");
    }
  });

  return (
    <Box alignSelf="center">
      <BorderBox>
        <Box flexDirection="column">
          <Label bold>{title}</Label>
          <Box marginY={1}>
            <Label wrap="wrap">{message}</Label>
          </Box>
          <Box gap={2} justifyContent="flex-end">
            {buttons.map((button, index) => (
              <Button focused={index === selectedIndex} key={button.value} label={button.label} />
            ))}
          </Box>
        </Box>
      </BorderBox>
    </Box>
  );
}
