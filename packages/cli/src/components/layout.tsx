import { Box } from "ink";
import type { ReactNode } from "react";
import { useTerminalSize } from "../lib/terminal.js";
import { Theme } from "../lib/theme.js";
import { Footer, type Shortcut } from "./footer.js";
import { Header } from "./header.js";

interface LayoutProps {
  children: ReactNode;
  shortcuts?: Shortcut[];
}

export function Layout({ children, shortcuts = [] }: LayoutProps) {
  const { columns: width, rows: height } = useTerminalSize();

  return (
    <Box backgroundColor={Theme.bg} flexDirection="column" height={height} width={width}>
      <Header />
      <Box
        alignItems="center"
        flexDirection="column"
        flexGrow={1}
        justifyContent="center"
        paddingX={2}
      >
        {children}
      </Box>
      <Footer shortcuts={shortcuts} />
    </Box>
  );
}
