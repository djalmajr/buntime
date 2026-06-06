import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Icon } from "~/components/ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import type { FileEntry } from "~/helpers/fs-api";

interface FileRowProps {
  entry: FileEntry;
  /** Optional extra dropdown items (e.g. plugin/worker enable-disable). */
  extraActions?: (entry: FileEntry) => React.ReactNode;
  readOnly?: boolean;
  selected?: boolean;
  onDelete: (entry: FileEntry) => void;
  onDownload: (entry: FileEntry) => void;
  onMove?: (entry: FileEntry) => void;
  onNavigate: (path: string) => void;
  onRename: (entry: FileEntry) => void;
  onSelect?: (entry: FileEntry, selected: boolean) => void;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "-";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

export function FileRow({
  entry,
  extraActions,
  readOnly,
  selected,
  onDelete,
  onDownload,
  onMove,
  onNavigate,
  onRename,
  onSelect,
}: FileRowProps) {
  const extra = extraActions?.(entry);
  const handleClick = () => {
    if (entry.isDirectory) onNavigate(entry.path);
  };

  const handleDoubleClick = () => {
    if (!entry.isDirectory) onDownload(entry);
  };

  const validation = entry.configValidation;
  const hasErrors = validation?.errors && validation.errors.length > 0;
  const hasWarnings = validation?.warnings && validation.warnings.length > 0;

  return (
    <tr
      className={`hover:bg-muted/50 border-b transition-colors ${
        entry.isDirectory ? "cursor-pointer" : ""
      }`}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      {onSelect && (
        <td className="w-10 p-3">
          <Checkbox
            checked={selected}
            disabled={readOnly}
            onClick={(evt) => evt.stopPropagation()}
            onCheckedChange={(checked) => onSelect(entry, !!checked)}
          />
        </td>
      )}
      <td className="p-3">
        <div className="flex items-center gap-2">
          <Icon
            className={entry.isDirectory ? "text-primary size-5" : "text-muted-foreground size-5"}
            icon={entry.isDirectory ? "ic:twotone-folder-open" : "ic:outline-insert-drive-file"}
          />
          <span className="font-medium">{entry.name}</span>
          {readOnly && <Icon className="size-3.5 text-amber-500" icon="lucide:lock" />}
          {hasErrors && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-help">
                  <Icon className="text-destructive size-4" icon="lucide:alert-circle" />
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs" side="right">
                <div className="space-y-1 text-xs">
                  {validation?.errors?.map((err, i) => (
                    <p key={i} className="text-destructive">
                      {err.message}
                    </p>
                  ))}
                  {validation?.warnings?.map((warn, i) => (
                    <p key={i} className="text-amber-500">
                      {warn.message}
                    </p>
                  ))}
                </div>
              </TooltipContent>
            </Tooltip>
          )}
          {!hasErrors && hasWarnings && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-help">
                  <Icon className="size-4 text-amber-500" icon="lucide:alert-triangle" />
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs" side="right">
                <div className="space-y-1 text-xs">
                  {validation?.warnings?.map((warn, i) => (
                    <p key={i} className="text-amber-500">
                      {warn.message}
                    </p>
                  ))}
                </div>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </td>
      <td className="text-muted-foreground p-3 text-sm">{formatBytes(entry.size)}</td>
      <td className="p-3 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className="size-7"
              size="icon"
              variant="ghost"
              onClick={(evt) => evt.stopPropagation()}
            >
              <Icon className="size-4" icon="lucide:ellipsis" />
            </Button>
          </DropdownMenuTrigger>
          {readOnly ? (
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="gap-2"
                onClick={(evt) => {
                  evt.stopPropagation();
                  onDownload(entry);
                }}
              >
                <Icon className="size-4" icon="lucide:download" />
                Download
              </DropdownMenuItem>
            </DropdownMenuContent>
          ) : (
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="gap-2"
                onClick={(evt) => {
                  evt.stopPropagation();
                  onRename(entry);
                }}
              >
                <Icon className="size-4" icon="lucide:pencil" />
                Rename
              </DropdownMenuItem>
              {onMove && (
                <DropdownMenuItem
                  className="gap-2"
                  onClick={(evt) => {
                    evt.stopPropagation();
                    onMove(entry);
                  }}
                >
                  <Icon className="size-4" icon="lucide:folder-input" />
                  Move
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="gap-2"
                onClick={(evt) => {
                  evt.stopPropagation();
                  onDownload(entry);
                }}
              >
                <Icon className="size-4" icon="lucide:download" />
                Download
              </DropdownMenuItem>
              {extra && (
                <>
                  <DropdownMenuSeparator />
                  {extra}
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="gap-2"
                onClick={(evt) => {
                  evt.stopPropagation();
                  onDelete(entry);
                }}
              >
                <Icon className="size-4" icon="lucide:trash-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          )}
        </DropdownMenu>
      </td>
    </tr>
  );
}
