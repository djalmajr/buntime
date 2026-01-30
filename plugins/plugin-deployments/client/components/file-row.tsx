import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Icon } from "./ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface ConfigValidation {
  errors: string[];
  isValid: boolean;
  warnings: string[];
}

interface FileEntry {
  configValidation?: ConfigValidation;
  isDirectory: boolean;
  name: string;
  path: string;
  size: number;
  updatedAt: string;
  visibility?: "public" | "protected" | "internal";
}

interface FileRowProps {
  entry: FileEntry;
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
  if (bytes === 0) return "-";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

export function FileRow({
  entry,
  readOnly,
  selected,
  onDelete,
  onDownload,
  onMove,
  onNavigate,
  onRename,
  onSelect,
}: FileRowProps) {
  const { t } = useTranslation("deployments");

  const handleClick = () => {
    if (entry.isDirectory) {
      onNavigate(entry.path);
    }
  };

  const handleDoubleClick = () => {
    if (!entry.isDirectory) {
      onDownload(entry);
    }
  };

  return (
    <tr
      className={`border-b transition-colors hover:bg-muted/50 ${entry.isDirectory ? "cursor-pointer" : ""}`}
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
            className={entry.isDirectory ? "size-5 text-primary" : "size-5 text-muted-foreground"}
            icon={entry.isDirectory ? "ic:twotone-folder-open" : "ic:outline-insert-drive-file"}
          />
          <span className="font-medium">{entry.name}</span>
          {readOnly && <Icon className="size-3.5 text-amber-500" icon="lucide:lock" />}
          {entry.configValidation && !entry.configValidation.isValid && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-help">
                  <Icon className="size-4 text-destructive" icon="lucide:alert-circle" />
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs" side="right">
                <div className="space-y-1 text-xs">
                  {entry.configValidation.errors.map((err, i) => (
                    <p key={i} className="text-destructive">
                      {err}
                    </p>
                  ))}
                  {entry.configValidation.warnings.map((warn, i) => (
                    <p key={i} className="text-amber-500">
                      {warn}
                    </p>
                  ))}
                </div>
              </TooltipContent>
            </Tooltip>
          )}
          {entry.configValidation?.isValid && entry.configValidation.warnings.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-help">
                  <Icon className="size-4 text-amber-500" icon="lucide:alert-triangle" />
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs" side="right">
                <div className="space-y-1 text-xs">
                  {entry.configValidation.warnings.map((warn, i) => (
                    <p key={i} className="text-amber-500">
                      {warn}
                    </p>
                  ))}
                </div>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </td>
      <td className="p-3 text-sm text-muted-foreground">{formatBytes(entry.size)}</td>
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
                {t("actions.download")}
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
                {t("actions.rename")}
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
                  {t("actions.move")}
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
                {t("actions.download")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="gap-2"
                onClick={(evt) => {
                  evt.stopPropagation();
                  onDelete(entry);
                }}
              >
                <Icon className="size-4" icon="lucide:trash-2" />
                {t("actions.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          )}
        </DropdownMenu>
      </td>
    </tr>
  );
}
