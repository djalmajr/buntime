import { useEffect, useRef } from "react";
import { cn } from "~/utils/cn";
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

export function NumberCell({ isEditable, isEditing, value, onBlur, onSave }: CellVariantProps) {
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

  // Filter input to only allow numbers, minus sign, and decimal point
  const handleInput = (e: React.FormEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const text = target.textContent ?? "";
    const filtered = text.replace(/[^0-9.-]/g, "");
    if (filtered !== text) {
      const selection = window.getSelection();
      const cursorPos = selection?.focusOffset ?? 0;
      target.textContent = filtered;
      if (target.firstChild) {
        const newPos = Math.min(cursorPos, filtered.length);
        const range = document.createRange();
        range.setStart(target.firstChild, newPos);
        range.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
  };

  if (isEditing && isEditable) {
    return (
      <div
        ref={cellRef}
        contentEditable
        role="textbox"
        suppressContentEditableWarning
        className="w-full whitespace-nowrap text-right tabular-nums outline-none caret-primary"
        onBlur={handleBlur}
        onClick={(e) => e.stopPropagation()}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <div
      className={cn(
        "w-full truncate text-right tabular-nums",
        isNull && "text-muted-foreground italic text-left",
      )}
    >
      {isNull ? "NULL" : displayValue}
    </div>
  );
}
