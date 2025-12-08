import { Icon } from "~/components/icon";
import { cn } from "~/libs/cn";
import type { FileSystemItem } from "../-hooks/use-file-system";

interface FileTabsProps {
  activeFileId: string | null;
  openFiles: FileSystemItem[];
  onCloseFile: (id: string) => void;
  onSelectFile: (id: string) => void;
}

export function FileTabs({ activeFileId, openFiles, onCloseFile, onSelectFile }: FileTabsProps) {
  if (openFiles.length === 0) {
    return (
      <div className="bg-card text-muted-foreground flex h-9 items-center border-b px-4 text-sm">
        No files open
      </div>
    );
  }

  return (
    <div className="bg-card flex h-9 items-center gap-0 overflow-x-auto border-b">
      {openFiles.map((file) => {
        const isActive = file.id === activeFileId;

        return (
          <div
            className={cn(
              "group flex h-full items-center gap-2 border-r px-3 text-sm",
              isActive
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
            key={file.id}
          >
            <button
              className="cursor-pointer truncate"
              type="button"
              onClick={() => onSelectFile(file.id)}
            >
              {file.name}
            </button>
            <button
              className={cn(
                "hover:bg-accent rounded p-0.5",
                !isActive && "opacity-0 group-hover:opacity-100",
              )}
              type="button"
              onClick={() => onCloseFile(file.id)}
            >
              <Icon className="size-3" name="lucide:x" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
