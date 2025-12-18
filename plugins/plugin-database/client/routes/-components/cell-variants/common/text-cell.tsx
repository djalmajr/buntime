import { cn } from "@buntime/shadcn-ui";
import { useEffect, useRef } from "react";
import type { CellVariantProps } from "../types";

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

export function TextCell({
  isEditable,
  isEditing,
  rowHeight,
  value,
  onBlur,
  onSave,
}: CellVariantProps) {
  const displayValue = formatValue(value);
  const isNull = value === null || value === undefined;
  const cellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isEditing && cellRef.current) {
      cellRef.current.textContent = displayValue;
      cellRef.current.focus();
      // Select all text
      const range = document.createRange();
      const selection = window.getSelection();
      range.selectNodeContents(cellRef.current);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }, [isEditing, displayValue]);

  const handleBlur = () => {
    const currentValue = cellRef.current?.textContent ?? "";
    onSave(currentValue);
    onBlur();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const currentValue = cellRef.current?.textContent ?? "";
      onSave(currentValue);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (cellRef.current) {
        cellRef.current.textContent = displayValue;
      }
      onBlur();
    }
  };

  if (isEditing && isEditable) {
    return (
      <div
        ref={cellRef}
        contentEditable
        role="textbox"
        suppressContentEditableWarning
        className="w-full whitespace-nowrap outline-none caret-primary"
        onBlur={handleBlur}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <div
      className={cn(
        "w-full",
        "truncate",
        isNull && "text-muted-foreground italic",
        rowHeight === "medium" && "line-clamp-2 whitespace-normal",
        rowHeight === "tall" && "line-clamp-3 whitespace-normal",
      )}
    >
      {isNull ? "NULL" : displayValue}
    </div>
  );
}
