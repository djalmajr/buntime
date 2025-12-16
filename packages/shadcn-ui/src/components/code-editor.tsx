import { html } from "@codemirror/lang-html";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { linter, lintGutter } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { githubLight } from "@uiw/codemirror-theme-github";
import CodeMirror from "@uiw/react-codemirror";
import { cn } from "../utils/cn";
import { Label } from "./ui/label";

type Language = "html" | "json";

interface CodeEditorProps {
  className?: string;
  label?: string;
  language?: Language;
  placeholder?: string;
  readOnly?: boolean;
  value: string;
  onChange?: (value: string) => void;
}

function getExtensions(language: Language) {
  switch (language) {
    case "json":
      return [json(), linter(jsonParseLinter()), lintGutter(), EditorView.lineWrapping];
    case "html":
      return [html(), EditorView.lineWrapping];
    default:
      return [EditorView.lineWrapping];
  }
}

export function CodeEditor({
  className,
  label,
  language = "json",
  placeholder,
  readOnly = false,
  value,
  onChange,
}: CodeEditorProps) {
  return (
    <div className={cn("flex flex-col space-y-2", className)}>
      {label && <Label>{label}</Label>}
      <div className="relative w-full flex-1 overflow-hidden rounded-md border border-input">
        <CodeMirror
          basicSetup={{
            foldGutter: true,
            lineNumbers: true,
          }}
          className="h-full w-full [&_.cm-editor]:h-full [&_.cm-editor]:outline-none [&_.cm-editor.cm-focused]:ring-2 [&_.cm-editor.cm-focused]:ring-ring [&_.cm-editor.cm-focused]:ring-offset-2"
          editable={!readOnly}
          extensions={getExtensions(language)}
          height="100%"
          placeholder={placeholder}
          theme={githubLight}
          value={value}
          width="100%"
          onChange={onChange}
        />
      </div>
    </div>
  );
}
