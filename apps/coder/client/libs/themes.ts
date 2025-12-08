import type { editor } from "monaco-editor";

export interface Theme {
  id: string;
  name: string;
  type: "dark" | "light";
  colors: {
    // Background colors
    bg: string;
    bgSecondary: string;
    bgTertiary: string;
    // Border colors
    border: string;
    borderSecondary: string;
    // Text colors
    text: string;
    textSecondary: string;
    textMuted: string;
    // Accent colors
    accent: string;
    accentHover: string;
    // Selection/highlight
    selection: string;
    selectionText: string;
    // Status colors
    error: string;
    warning: string;
    success: string;
  };
  monaco: editor.IStandaloneThemeData;
}

export const themes: Record<string, Theme> = {
  monokai: {
    id: "monokai",
    name: "Monokai",
    type: "dark",
    colors: {
      bg: "#272822",
      bgSecondary: "#1e1f1c",
      bgTertiary: "#3e3d32",
      border: "#3e3d32",
      borderSecondary: "#49483e",
      text: "#f8f8f2",
      textSecondary: "#cfcfc2",
      textMuted: "#75715e",
      accent: "#a6e22e",
      accentHover: "#b6f23e",
      selection: "#49483e",
      selectionText: "#f8f8f2",
      error: "#f92672",
      warning: "#e6db74",
      success: "#a6e22e",
    },
    monaco: {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "75715e", fontStyle: "italic" },
        { token: "keyword", foreground: "f92672" },
        { token: "string", foreground: "e6db74" },
        { token: "number", foreground: "ae81ff" },
        { token: "type", foreground: "66d9ef", fontStyle: "italic" },
        { token: "function", foreground: "a6e22e" },
        { token: "variable", foreground: "f8f8f2" },
        { token: "constant", foreground: "ae81ff" },
        { token: "operator", foreground: "f92672" },
        { token: "tag", foreground: "f92672" },
        { token: "attribute.name", foreground: "a6e22e" },
        { token: "attribute.value", foreground: "e6db74" },
      ],
      colors: {
        "editor.background": "#272822",
        "editor.foreground": "#f8f8f2",
        "editor.lineHighlightBackground": "#3e3d32",
        "editor.selectionBackground": "#49483e",
        "editorCursor.foreground": "#f8f8f0",
        "editorWhitespace.foreground": "#3e3d32",
      },
    },
  },
  dracula: {
    id: "dracula",
    name: "Dracula",
    type: "dark",
    colors: {
      bg: "#282a36",
      bgSecondary: "#21222c",
      bgTertiary: "#44475a",
      border: "#44475a",
      borderSecondary: "#6272a4",
      text: "#f8f8f2",
      textSecondary: "#e0e0e0",
      textMuted: "#6272a4",
      accent: "#bd93f9",
      accentHover: "#caa4fa",
      selection: "#44475a",
      selectionText: "#f8f8f2",
      error: "#ff5555",
      warning: "#f1fa8c",
      success: "#50fa7b",
    },
    monaco: {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "6272a4", fontStyle: "italic" },
        { token: "keyword", foreground: "ff79c6" },
        { token: "string", foreground: "f1fa8c" },
        { token: "number", foreground: "bd93f9" },
        { token: "type", foreground: "8be9fd", fontStyle: "italic" },
        { token: "function", foreground: "50fa7b" },
        { token: "variable", foreground: "f8f8f2" },
        { token: "constant", foreground: "bd93f9" },
        { token: "operator", foreground: "ff79c6" },
        { token: "tag", foreground: "ff79c6" },
        { token: "attribute.name", foreground: "50fa7b" },
        { token: "attribute.value", foreground: "f1fa8c" },
      ],
      colors: {
        "editor.background": "#282a36",
        "editor.foreground": "#f8f8f2",
        "editor.lineHighlightBackground": "#44475a",
        "editor.selectionBackground": "#44475a",
        "editorCursor.foreground": "#f8f8f2",
        "editorWhitespace.foreground": "#44475a",
      },
    },
  },
  "github-dark": {
    id: "github-dark",
    name: "GitHub Dark",
    type: "dark",
    colors: {
      bg: "#0d1117",
      bgSecondary: "#161b22",
      bgTertiary: "#21262d",
      border: "#30363d",
      borderSecondary: "#484f58",
      text: "#c9d1d9",
      textSecondary: "#8b949e",
      textMuted: "#6e7681",
      accent: "#58a6ff",
      accentHover: "#79b8ff",
      selection: "#264f78",
      selectionText: "#ffffff",
      error: "#f85149",
      warning: "#d29922",
      success: "#3fb950",
    },
    monaco: {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "8b949e", fontStyle: "italic" },
        { token: "keyword", foreground: "ff7b72" },
        { token: "string", foreground: "a5d6ff" },
        { token: "number", foreground: "79c0ff" },
        { token: "type", foreground: "ffa657" },
        { token: "function", foreground: "d2a8ff" },
        { token: "variable", foreground: "c9d1d9" },
        { token: "constant", foreground: "79c0ff" },
        { token: "operator", foreground: "ff7b72" },
        { token: "tag", foreground: "7ee787" },
        { token: "attribute.name", foreground: "79c0ff" },
        { token: "attribute.value", foreground: "a5d6ff" },
      ],
      colors: {
        "editor.background": "#0d1117",
        "editor.foreground": "#c9d1d9",
        "editor.lineHighlightBackground": "#161b22",
        "editor.selectionBackground": "#264f78",
        "editorCursor.foreground": "#c9d1d9",
        "editorWhitespace.foreground": "#21262d",
      },
    },
  },
  "one-dark": {
    id: "one-dark",
    name: "One Dark",
    type: "dark",
    colors: {
      bg: "#282c34",
      bgSecondary: "#21252b",
      bgTertiary: "#2c313a",
      border: "#3e4451",
      borderSecondary: "#4b5263",
      text: "#abb2bf",
      textSecondary: "#9da5b4",
      textMuted: "#5c6370",
      accent: "#61afef",
      accentHover: "#74b9f0",
      selection: "#3e4451",
      selectionText: "#abb2bf",
      error: "#e06c75",
      warning: "#e5c07b",
      success: "#98c379",
    },
    monaco: {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "5c6370", fontStyle: "italic" },
        { token: "keyword", foreground: "c678dd" },
        { token: "string", foreground: "98c379" },
        { token: "number", foreground: "d19a66" },
        { token: "type", foreground: "e5c07b" },
        { token: "function", foreground: "61afef" },
        { token: "variable", foreground: "e06c75" },
        { token: "constant", foreground: "d19a66" },
        { token: "operator", foreground: "56b6c2" },
        { token: "tag", foreground: "e06c75" },
        { token: "attribute.name", foreground: "d19a66" },
        { token: "attribute.value", foreground: "98c379" },
      ],
      colors: {
        "editor.background": "#282c34",
        "editor.foreground": "#abb2bf",
        "editor.lineHighlightBackground": "#2c313a",
        "editor.selectionBackground": "#3e4451",
        "editorCursor.foreground": "#528bff",
        "editorWhitespace.foreground": "#3e4451",
      },
    },
  },
  "github-light": {
    id: "github-light",
    name: "GitHub Light",
    type: "light",
    colors: {
      bg: "#ffffff",
      bgSecondary: "#f6f8fa",
      bgTertiary: "#eaeef2",
      border: "#d0d7de",
      borderSecondary: "#afb8c1",
      text: "#24292f",
      textSecondary: "#57606a",
      textMuted: "#8c959f",
      accent: "#0969da",
      accentHover: "#0550ae",
      selection: "#ddf4ff",
      selectionText: "#24292f",
      error: "#cf222e",
      warning: "#9a6700",
      success: "#1a7f37",
    },
    monaco: {
      base: "vs",
      inherit: true,
      rules: [
        { token: "comment", foreground: "6e7781", fontStyle: "italic" },
        { token: "keyword", foreground: "cf222e" },
        { token: "string", foreground: "0a3069" },
        { token: "number", foreground: "0550ae" },
        { token: "type", foreground: "953800" },
        { token: "function", foreground: "8250df" },
        { token: "variable", foreground: "24292f" },
        { token: "constant", foreground: "0550ae" },
        { token: "operator", foreground: "cf222e" },
        { token: "tag", foreground: "116329" },
        { token: "attribute.name", foreground: "0550ae" },
        { token: "attribute.value", foreground: "0a3069" },
      ],
      colors: {
        "editor.background": "#ffffff",
        "editor.foreground": "#24292f",
        "editor.lineHighlightBackground": "#f6f8fa",
        "editor.selectionBackground": "#ddf4ff",
        "editorCursor.foreground": "#24292f",
        "editorWhitespace.foreground": "#d0d7de",
      },
    },
  },
};

export const themeList = Object.values(themes);
export const defaultTheme = themes["github-dark"];
