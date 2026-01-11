/**
 * TUI Theme colors (Catppuccin Mocha inspired)
 */
export const Theme = {
  /** Main background color - dark blue */
  bg: "#1e1e2e",
  /** Surface background - slightly lighter for modals/dialogs */
  bgSurface: "#313244",
  /** Border color - slightly lighter than bg */
  border: "#45475a",
  /** Primary action color - blue */
  primary: "#0875b7",
  /** Selected/focused border color - cyan */
  selected: "cyan",
  /** Text colors */
  text: {
    muted: "#6c7086",
    primary: "white",
  },
} as const;
