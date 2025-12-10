import Editor, { type BeforeMount, type OnMount } from "@monaco-editor/react";
import { useCallback, useEffect, useRef } from "react";
import type { Theme } from "~/helpers/themes";
import { getLanguageFromPath } from "./language";
import { REACT_TYPES } from "./react-types";

interface CodeEditorProps {
  onChange?: (value: string) => void;
  path: string;
  theme: Theme;
  value: string;
}

export function CodeEditor({ onChange, path, theme, value }: CodeEditorProps) {
  const language = getLanguageFromPath(path);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);

  // Configure Monaco BEFORE the editor mounts
  const handleBeforeMount: BeforeMount = useCallback((monaco) => {
    // Disable ALL validation first - this is the most reliable way to suppress JSX errors
    // in a sandpack context where we don't have full type definitions
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      diagnosticCodesToIgnore: [
        2307, // Cannot find module
        2322, // Type is not assignable
        2339, // Property does not exist
        2345, // Argument of type is not assignable
        2551, // Property does not exist. Did you mean?
        2552, // Cannot find name. Did you mean?
        2554, // Expected X arguments, but got Y
        2769, // No overload matches this call
        7006, // Parameter implicitly has an 'any' type
        7016, // Could not find declaration file
        7031, // Binding element implicitly has an 'any' type
        17004, // Cannot use JSX unless '--jsx' flag is provided
      ],
      noSemanticValidation: true,
      noSuggestionDiagnostics: true,
      noSyntaxValidation: false,
    });

    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      diagnosticCodesToIgnore: [
        2307, 2322, 2339, 2345, 2551, 2552, 2554, 2769, 7006, 7016, 7031, 17004,
      ],
      noSemanticValidation: true,
      noSuggestionDiagnostics: true,
      noSyntaxValidation: false,
    });

    // Configure TypeScript/JavaScript compiler options for JSX support
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      allowJs: true,
      allowNonTsExtensions: true,
      allowSyntheticDefaultImports: true,
      checkJs: false,
      esModuleInterop: true,
      jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
      jsxImportSource: "react",
      module: monaco.languages.typescript.ModuleKind.ESNext,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      noEmit: true,
      skipLibCheck: true,
      strict: false,
      target: monaco.languages.typescript.ScriptTarget.ESNext,
    });

    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
      allowJs: true,
      allowNonTsExtensions: true,
      allowSyntheticDefaultImports: true,
      checkJs: false,
      esModuleInterop: true,
      jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
      jsxImportSource: "react",
      module: monaco.languages.typescript.ModuleKind.ESNext,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      noEmit: true,
      skipLibCheck: true,
      strict: false,
      target: monaco.languages.typescript.ScriptTarget.ESNext,
    });

    // Add React type definitions
    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      REACT_TYPES,
      "file:///node_modules/@types/react/index.d.ts",
    );

    monaco.languages.typescript.javascriptDefaults.addExtraLib(
      REACT_TYPES,
      "file:///node_modules/@types/react/index.d.ts",
    );
  }, []);

  const handleEditorMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;

      // Define and apply the custom theme
      monaco.editor.defineTheme(theme.id, theme.monaco);
      monaco.editor.setTheme(theme.id);
    },
    [theme.id, theme.monaco],
  );

  // Update theme when it changes
  useEffect(() => {
    if (monacoRef.current) {
      monacoRef.current.editor.defineTheme(theme.id, theme.monaco);
      monacoRef.current.editor.setTheme(theme.id);
    }
  }, [theme]);

  const handleChange = useCallback(
    (newValue: string | undefined) => {
      if (newValue !== undefined) {
        onChange?.(newValue);
      }
    },
    [onChange],
  );

  return (
    <Editor
      beforeMount={handleBeforeMount}
      defaultLanguage={language}
      height="100%"
      language={language}
      options={{
        automaticLayout: true,
        fontSize: 14,
        lineNumbers: "on",
        minimap: { enabled: false },
        padding: { bottom: 8, top: 8 },
        scrollBeyondLastLine: false,
        tabSize: 2,
        wordWrap: "on",
      }}
      path={`file://${path}`}
      theme={theme.id}
      value={value}
      onChange={handleChange}
      onMount={handleEditorMount}
    />
  );
}
