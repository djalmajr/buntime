import { Button, cn, Icon, Tooltip, TooltipContent, TooltipTrigger } from "@buntime/shadcn-ui";
import { useEffect, useRef, useState } from "react";
import type { CellVariantProps } from "../types";

// UUID regex for validation
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

function formatUuid(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function truncateUuid(uuid: string): string {
  if (!uuid || uuid.length < 8) return uuid;
  return `${uuid.slice(0, 8)}...`;
}

export function UuidCell({ isEditable, isEditing, value, onBlur, onSave }: CellVariantProps) {
  const displayValue = formatUuid(value);
  const isNull = value === null || value === undefined;
  const cellRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

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
    // Validate UUID format if not empty
    if (currentValue && !isValidUuid(currentValue)) {
      // Reset to original if invalid
      if (cellRef.current) {
        cellRef.current.textContent = displayValue;
      }
      onBlur();
      return;
    }
    onSave(currentValue);
    onBlur();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const currentValue = cellRef.current?.textContent ?? "";
      if (!currentValue || isValidUuid(currentValue)) {
        onSave(currentValue);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (cellRef.current) {
        cellRef.current.textContent = displayValue;
      }
      onBlur();
    }
  };

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(displayValue);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback
      const textarea = document.createElement("textarea");
      textarea.value = displayValue;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const handleGenerateUuid = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newUuid = crypto.randomUUID();
    if (cellRef.current) {
      cellRef.current.textContent = newUuid;
    }
    onSave(newUuid);
  };

  if (isEditing && isEditable) {
    return (
      <div className="flex items-center gap-1">
        <div
          ref={cellRef}
          contentEditable
          role="textbox"
          suppressContentEditableWarning
          className="flex-1 whitespace-nowrap font-mono text-xs outline-none caret-primary"
          onBlur={handleBlur}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={handleKeyDown}
          onMouseDown={(e) => e.stopPropagation()}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className="size-5 shrink-0"
              size="icon"
              variant="ghost"
              onClick={handleGenerateUuid}
            >
              <Icon className="size-3" icon="lucide:refresh-cw" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Generate new UUID</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  if (isNull) {
    return <span className="text-muted-foreground italic">NULL</span>;
  }

  return (
    <div className="group flex w-full items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="truncate font-mono text-xs text-muted-foreground">
            {truncateUuid(displayValue)}
          </span>
        </TooltipTrigger>
        <TooltipContent className="font-mono text-xs">{displayValue}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={cn(
              "size-5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100",
              copied && "opacity-100",
            )}
            size="icon"
            variant="ghost"
            onClick={handleCopy}
          >
            <Icon className="size-3" icon={copied ? "lucide:check" : "lucide:copy"} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{copied ? "Copied!" : "Copy UUID"}</TooltipContent>
      </Tooltip>
    </div>
  );
}
