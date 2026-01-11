import { Box, Text, useInput } from "ink";
import { Label } from "./label.js";

interface MessageProps {
  message: string;
  onContinue?: () => void;
  submessage?: string;
  type: "error" | "success" | "warning";
}

export function Message({ message, onContinue, submessage, type }: MessageProps) {
  const icon = type === "success" ? "+" : type === "error" ? "x" : "!";
  const color = type === "success" ? "green" : type === "error" ? "red" : "cyan";

  useInput((_input, key) => {
    if (key.return && onContinue) {
      onContinue();
    }
  });

  return (
    <Box alignItems="center" flexDirection="column" justifyContent="center" padding={2}>
      <Box>
        <Text color={color}>{icon} </Text>
        <Label>{message}</Label>
      </Box>
      {submessage && (
        <Box marginTop={1}>
          <Label muted>{submessage}</Label>
        </Box>
      )}
      {onContinue && (
        <Box marginTop={2}>
          <Label muted>Press Enter to continue...</Label>
        </Box>
      )}
    </Box>
  );
}
