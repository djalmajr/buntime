import { useTranslation } from "react-i18next";
import { Icon } from "~/components/icon";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

interface FileEntry {
  isDirectory: boolean;
  name: string;
  path: string;
  size: number;
  updatedAt: string;
}

interface FileRowProps {
  entry: FileEntry;
  onDelete: (entry: FileEntry) => void;
  onDownload: (entry: FileEntry) => void;
  onNavigate: (path: string) => void;
  onRename: (entry: FileEntry) => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "—";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

export function FileRow({ entry, onDelete, onDownload, onNavigate, onRename }: FileRowProps) {
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
      className="border-b transition-colors hover:bg-muted/50 cursor-pointer"
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      <td className="p-3">
        <div className="flex items-center gap-2">
          <Icon
            className="size-5 text-muted-foreground"
            icon={entry.isDirectory ? "lucide:folder" : "lucide:file"}
          />
          <span className="font-medium">{entry.name}</span>
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
            {!entry.isDirectory && (
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
              {t("actions.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}
