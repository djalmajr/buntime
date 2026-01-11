import { Box, Text } from "ink";
import pkg from "../../package.json";
import { getBreadcrumb, useTui } from "../context/tui-context.js";
import { useTerminalSize } from "../lib/terminal.js";
import { Theme } from "../lib/theme.js";
import { Label } from "./label.js";

export function Header() {
  const { columns: width } = useTerminalSize();
  const { connection, currentScreen } = useTui();
  const breadcrumb = getBreadcrumb(currentScreen);
  const title = breadcrumb.length > 0 ? `Buntime CLI > ${breadcrumb.join(" > ")}` : "Buntime CLI";

  return (
    <Box
      backgroundColor={Theme.bg}
      flexDirection="column"
      minHeight={4}
      paddingTop={1}
      width={width}
    >
      <Box paddingX={1}>
        <Label bold>{title}</Label>
      </Box>
      <Box justifyContent="space-between" paddingX={1}>
        <Label muted>v{pkg.version}</Label>
        {connection && <Label muted>{connection.url}</Label>}
      </Box>
      <Text color={Theme.border}>{"─".repeat(width)}</Text>
    </Box>
  );
}
