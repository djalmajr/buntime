import {
  Button,
  cn,
  Icon,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Textarea,
} from "@buntime/shadcn-ui";
import { useEffect, useRef, useState } from "react";
import type { CellVariantProps } from "../types";

function formatJson(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    try {
      // Try to parse and format if it's a JSON string
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

function compactJson(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value));
    } catch {
      return value;
    }
  }
  return JSON.stringify(value);
}

export function JsonCell({
  isEditable,
  isEditing,
  rowHeight,
  value,
  onBlur,
  onSave,
}: CellVariantProps) {
  const isNull = value === null || value === undefined;
  const displayValue = compactJson(value);
  const formattedValue = formatJson(value);
  const [editValue, setEditValue] = useState(formattedValue);
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setEditValue(formattedValue);
    setError(null);
  }, [formattedValue]);

  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [isOpen]);

  const handleSave = () => {
    if (!editValue.trim()) {
      onSave("");
      setIsOpen(false);
      onBlur();
      return;
    }

    try {
      // Validate JSON
      JSON.parse(editValue);
      setError(null);
      onSave(editValue);
      setIsOpen(false);
      onBlur();
    } catch (_e) {
      setError("Invalid JSON");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setEditValue(formattedValue);
      setError(null);
      setIsOpen(false);
      onBlur();
    }
    // Ctrl/Cmd + Enter to save
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSave();
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formattedValue);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = formattedValue;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  };

  // Open popover when entering edit mode
  useEffect(() => {
    if (isEditing && isEditable) {
      setIsOpen(true);
    }
  }, [isEditing, isEditable]);

  if (isNull) {
    return <span className="text-muted-foreground italic">NULL</span>;
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <div
          className={cn(
            "flex w-full cursor-pointer items-center gap-1",
            rowHeight === "short" && "truncate",
            rowHeight === "medium" && "line-clamp-2",
            rowHeight === "tall" && "line-clamp-3",
          )}
        >
          <Icon className="size-3.5 shrink-0 text-muted-foreground" icon="lucide:braces" />
          <span className="truncate font-mono text-xs">{displayValue}</span>
        </div>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 p-0" side="bottom">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">JSON Editor</span>
          <div className="flex items-center gap-1">
            <Button
              className="size-7"
              size="icon"
              title="Copy"
              variant="ghost"
              onClick={handleCopy}
            >
              <Icon className="size-4" icon="lucide:copy" />
            </Button>
          </div>
        </div>
        <div className="p-2">
          <Textarea
            ref={textareaRef}
            className="min-h-[200px] font-mono text-xs resize-none"
            disabled={!isEditable}
            placeholder="Enter JSON..."
            value={editValue}
            onChange={(e) => {
              setEditValue(e.target.value);
              setError(null);
            }}
            onKeyDown={handleKeyDown}
          />
          {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        </div>
        {isEditable && (
          <div className="flex items-center justify-between border-t px-3 py-2">
            <span className="text-xs text-muted-foreground">Ctrl+Enter to save</span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditValue(formattedValue);
                  setError(null);
                  setIsOpen(false);
                  onBlur();
                }}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave}>
                Save
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
