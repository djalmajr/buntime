import { useCallback, useState } from "react";
import { Icon } from "~/components/icon";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "~/components/ui/context-menu";
import { cn } from "~/libs/cn";
import type { FileSystemItem } from "../-hooks/use-file-system";

interface FileTreeProps {
  activeFileId: string | null;
  items: Record<string, FileSystemItem>;
  rootIds: string[];
  onCreateFile: (parentPath: string) => void;
  onCreateFolder: (parentPath: string) => void;
  onDeleteItem: (id: string) => void;
  onRenameItem: (id: string) => void;
  onSelectFile: (id: string) => void;
}

interface FileTreeItemProps {
  activeFileId: string | null;
  item: FileSystemItem;
  items: Record<string, FileSystemItem>;
  level: number;
  onCreateFile: (parentPath: string) => void;
  onCreateFolder: (parentPath: string) => void;
  onDeleteItem: (id: string) => void;
  onRenameItem: (id: string) => void;
  onSelectFile: (id: string) => void;
}

function getFileIconColor(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "tsx":
    case "jsx":
      return "text-blue-400";
    case "ts":
    case "js":
      return "text-yellow-400";
    case "css":
      return "text-purple-400";
    case "json":
      return "text-green-400";
    case "html":
      return "text-orange-400";
    default:
      return "text-muted-foreground";
  }
}

function FileTreeItem({
  activeFileId,
  item,
  items,
  level,
  onCreateFile,
  onCreateFolder,
  onDeleteItem,
  onRenameItem,
  onSelectFile,
}: FileTreeItemProps) {
  const [isOpen, setIsOpen] = useState(true);

  const handleClick = useCallback(() => {
    if (item.type === "folder") {
      setIsOpen((prev) => !prev);
    } else {
      onSelectFile(item.id);
    }
  }, [item.id, item.type, onSelectFile]);

  const children = item.children
    ?.map((childId) => items[childId])
    .filter(Boolean)
    .sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "folder" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

  const isActive = item.id === activeFileId;

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex w-full items-center gap-1 rounded px-2 py-1 text-left text-sm transition-colors",
              isActive
                ? "bg-primary/20 text-primary-foreground"
                : "hover:bg-accent/50",
            )}
            style={{ paddingLeft: `${level * 12 + 8}px` }}
            onClick={handleClick}
          >
            {item.type === "folder" ? (
              <>
                <Icon
                  className="text-muted-foreground size-4"
                  name={isOpen ? "lucide:chevron-down" : "lucide:chevron-right"}
                />
                <Icon
                  className="text-muted-foreground size-4"
                  name={isOpen ? "lucide:folder-open" : "lucide:folder"}
                />
              </>
            ) : (
              <>
                <span className="size-4" />
                <Icon className={cn("size-4", getFileIconColor(item.name))} name="lucide:file" />
              </>
            )}
            <span className="truncate">{item.name}</span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {item.type === "folder" && (
            <>
              <ContextMenuItem onClick={() => onCreateFile(item.path)}>New File</ContextMenuItem>
              <ContextMenuItem onClick={() => onCreateFolder(item.path)}>
                New Folder
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem onClick={() => onRenameItem(item.id)}>Rename</ContextMenuItem>
          <ContextMenuItem
            className="text-red-400 focus:text-red-400"
            onClick={() => onDeleteItem(item.id)}
          >
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {item.type === "folder" && isOpen && children && children.length > 0 && (
        <div>
          {children.map((child) => (
            <FileTreeItem
              activeFileId={activeFileId}
              item={child}
              items={items}
              key={child.id}
              level={level + 1}
              onCreateFile={onCreateFile}
              onCreateFolder={onCreateFolder}
              onDeleteItem={onDeleteItem}
              onRenameItem={onRenameItem}
              onSelectFile={onSelectFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree({
  activeFileId,
  items,
  rootIds,
  onCreateFile,
  onCreateFolder,
  onDeleteItem,
  onRenameItem,
  onSelectFile,
}: FileTreeProps) {
  const rootItems = rootIds
    .map((id) => items[id])
    .filter(Boolean)
    .sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "folder" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="min-h-[100px] py-1">
          {rootItems.map((item) => (
            <FileTreeItem
              activeFileId={activeFileId}
              item={item}
              items={items}
              key={item.id}
              level={0}
              onCreateFile={onCreateFile}
              onCreateFolder={onCreateFolder}
              onDeleteItem={onDeleteItem}
              onRenameItem={onRenameItem}
              onSelectFile={onSelectFile}
            />
          ))}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onCreateFile("/")}>New File</ContextMenuItem>
        <ContextMenuItem onClick={() => onCreateFolder("/")}>New Folder</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
