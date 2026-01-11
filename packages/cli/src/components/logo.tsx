import { Box } from "ink";
import { Label } from "./label.js";

const LOGO_TEXT = `
█▄▄ █ █ █▄ █ ▀█▀ █ █▄ ▄█ █▀▀
█▄█ █▄█ █ ▀█  █  █ █ ▀ █ ██▄
`;

export function Logo() {
  return (
    <Box alignItems="center" flexDirection="column" paddingY={1}>
      <Label selected>{LOGO_TEXT}</Label>
    </Box>
  );
}
