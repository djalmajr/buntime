/**
 * Generic file-browser absorbed from `plugin-deployments`. Renders against
 * either the `/api/workers/files` or `/api/plugins/files` surface, with a
 * `ClientPathPolicy` deciding upload validation + folder-name hints.
 *
 * URL state (selected path) is held in a search param via TanStack Router so
 * the browser back/forward and reload preserve the user's location.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Icon } from "~/components/ui/icon";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import type { FileEntry, FsApi } from "~/helpers/fs-api";
import { cn } from "~/utils/cn";
import {
  ConfirmDeleteDialog,
  MoveDialog,
  NewFolderDialog,
  RenameDialog,
} from "./components/dialogs";
import { FileRow } from "./components/file-row";
import { SelectionToolbar } from "./components/selection-toolbar";
import type { ClientPathPolicy } from "./path-policy";

export type FileBrowserRoutePath = "/workers" | "/plugins";

export interface FileBrowserProps {
  api: FsApi;
  policy: ClientPathPolicy;
  /** Route base from which to read/write the `?path=` search param. */
  routePath: FileBrowserRoutePath;
  /**
   * Permission gating. When `canWrite` is false the toolbar hides
   * upload/new-folder buttons and row actions go read-only.
   */
  canWrite?: boolean;
  /** Optional extra header content rendered to the right of the breadcrumb. */
  headerExtra?: React.ReactNode;
}

export function FileBrowser({
  api,
  policy,
  routePath,
  canWrite = true,
  headerExtra,
}: FileBrowserProps) {
  const queryClient = useQueryClient();
  const search = useSearch({ from: routePath }) as { path?: string };
  const navigate = useNavigate({ from: routePath });

  const path = search.path ?? "";
  const [searchTerm, setSearchTerm] = useState("");
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchMoveOpen, setBatchMoveOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [moveTarget, setMoveTarget] = useState<FileEntry | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  // Reset selection + search on path change
  useEffect(() => {
    setSelectedPaths(new Set());
    setSearchTerm("");
  }, [path]);

  // Discover mount roots (each workerDir / pluginDir) on first render — used
  // for the breadcrumb's "Workers"/"Plugins" home crumb and root detection.
  const rootsQuery = useQuery({
    queryFn: async () => {
      const res = await api.list("");
      return res.data?.entries?.filter((e) => e.isDirectory).map((e) => e.name) ?? [];
    },
    queryKey: ["fs-roots", api.base],
    staleTime: 1000 * 60 * 5,
  });
  const rootDirs = rootsQuery.data ?? [];

  // Listing for the current path.
  const list$ = useQuery({
    queryFn: async () => {
      const res = await api.list(path);
      return res.data;
    },
    queryKey: ["fs-list", api.base, path],
  });

  const entries = list$.data?.entries ?? [];
  const currentVisibility = list$.data?.currentVisibility;

  const filteredEntries = useMemo(() => {
    if (!searchTerm.trim()) return entries;
    const term = searchTerm.toLowerCase().trim();
    return entries.filter((entry) => entry.name.toLowerCase().includes(term));
  }, [entries, searchTerm]);

  // Relative path inside the policy (strip the root prefix).
  const relativePath = useMemo(() => {
    if (!path) return "";
    const [first, ...rest] = path.split("/");
    if (first && rootDirs.includes(first)) return rest.join("/");
    return path;
  }, [path, rootDirs]);

  // Can the operator drop files here? Permission + policy + visibility.
  const canUpload =
    canWrite && policy.canWriteAt(relativePath) && currentVisibility !== "protected";

  const navigateTo = (newPath: string) => {
    navigate({ search: newPath ? { path: newPath } : {}, to: routePath, replace: false });
  };

  const invalidateCurrent = () =>
    queryClient.invalidateQueries({ queryKey: ["fs-list", api.base, path] });

  // ------------------------------------------------------------------------
  // Mutations
  // ------------------------------------------------------------------------

  const handleUpload = useCallback(
    async (files: File[]) => {
      setIsUploading(true);
      try {
        const paths = files.map((file) => {
          const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
          return rel || file.name;
        });
        const res = await api.upload(path, files, paths);
        if (!res.success) throw new Error("Upload failed");
        invalidateCurrent();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Upload failed");
      } finally {
        setIsUploading(false);
      }
    },
    [api, path, invalidateCurrent],
  );

  const handleCreateFolder = async (name: string) => {
    try {
      const folderPath = path ? `${path}/${name}` : name;
      const res = await api.mkdir(folderPath);
      if (!res.success) throw new Error("Failed to create folder");
      invalidateCurrent();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create folder");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await api.delete(deleteTarget.path);
      if (!res.success) throw new Error("Failed to delete");
      setDeleteTarget(null);
      invalidateCurrent();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete");
    }
  };

  const handleRename = async (newName: string) => {
    if (!renameTarget) return;
    try {
      const res = await api.rename(renameTarget.path, newName);
      if (!res.success) throw new Error("Failed to rename");
      setRenameTarget(null);
      invalidateCurrent();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to rename");
    }
  };

  const handleDownload = async (entry: FileEntry) => {
    const url = await api.getDownloadUrl(entry.path);
    window.open(url, "_blank");
  };

  const handleMove = async (destPath: string) => {
    if (!moveTarget) return;
    try {
      const res = await api.move(moveTarget.path, destPath);
      if (!res.success) throw new Error("Failed to move");
      setMoveTarget(null);
      invalidateCurrent();
      queryClient.invalidateQueries({ queryKey: ["fs-list", api.base, destPath] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to move");
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await api.refresh(path);
      invalidateCurrent();
    } catch {
      toast.error("Failed to refresh");
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSelect = (entry: FileEntry, selected: boolean) => {
    if (entry.visibility === "protected") return;
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (selected) next.add(entry.path);
      else next.delete(entry.path);
      return next;
    });
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedPaths(
        new Set(filteredEntries.filter((e) => e.visibility !== "protected").map((e) => e.path)),
      );
    } else {
      setSelectedPaths(new Set());
    }
  };

  const handleBatchDelete = async () => {
    if (selectedPaths.size === 0) return;
    try {
      const res = await api.deleteBatch(Array.from(selectedPaths));
      if (!res.success) throw new Error("Failed to delete");
      setSelectedPaths(new Set());
      setBatchDeleteOpen(false);
      invalidateCurrent();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete");
    }
  };

  const handleBatchDownload = async () => {
    if (selectedPaths.size === 0) return;
    const url = await api.getBatchDownloadUrl(Array.from(selectedPaths));
    window.open(url, "_blank");
  };

  const handleBatchMove = async (destPath: string) => {
    if (selectedPaths.size === 0) return;
    try {
      const res = await api.moveBatch(Array.from(selectedPaths), destPath);
      if (!res.success) throw new Error("Failed to move");
      setSelectedPaths(new Set());
      setBatchMoveOpen(false);
      invalidateCurrent();
      queryClient.invalidateQueries({ queryKey: ["fs-list", api.base, destPath] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to move");
    }
  };

  // ------------------------------------------------------------------------
  // Drag-drop (Entry API → recursive folder upload)
  // ------------------------------------------------------------------------

  const handleDragOver = useCallback(
    (evt: React.DragEvent) => {
      evt.preventDefault();
      evt.stopPropagation();
      if (canUpload) setIsDragging(true);
    },
    [canUpload],
  );

  const handleDragLeave = useCallback((evt: React.DragEvent) => {
    evt.preventDefault();
    evt.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    async (evt: React.DragEvent) => {
      evt.preventDefault();
      evt.stopPropagation();
      setIsDragging(false);
      if (!canUpload) return;

      const files: File[] = [];

      const readAllEntries = async (
        reader: FileSystemDirectoryReader,
      ): Promise<FileSystemEntry[]> => {
        const all: FileSystemEntry[] = [];
        let batch: FileSystemEntry[];
        do {
          batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
            reader.readEntries(resolve, reject);
          });
          all.push(...batch);
        } while (batch.length > 0);
        return all;
      };

      const readEntry = async (entry: FileSystemEntry, basePath = ""): Promise<void> => {
        if (entry.isFile) {
          const fileEntry = entry as FileSystemFileEntry;
          const file = await new Promise<File>((resolve, reject) => {
            fileEntry.file(resolve, reject);
          });
          const fileWithPath = new File([file], file.name, { type: file.type });
          Object.defineProperty(fileWithPath, "webkitRelativePath", {
            value: basePath ? `${basePath}/${file.name}` : file.name,
            writable: false,
          });
          files.push(fileWithPath);
        } else if (entry.isDirectory) {
          const dirEntry = entry as FileSystemDirectoryEntry;
          const reader = dirEntry.createReader();
          const children = await readAllEntries(reader);
          const dirPath = basePath ? `${basePath}/${entry.name}` : entry.name;
          for (const child of children) {
            await readEntry(child, dirPath);
          }
        }
      };

      const items = Array.from(evt.dataTransfer.items);
      const entries: FileSystemEntry[] = [];
      for (const item of items) {
        const entry = item?.webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }

      if (entries.length === items.length && entries.length > 0) {
        for (const entry of entries) {
          await readEntry(entry);
        }
      } else {
        for (const file of Array.from(evt.dataTransfer.files)) {
          if (file.size > 0) files.push(file);
        }
      }

      if (files.length > 0) handleUpload(files);
    },
    [canUpload, handleUpload],
  );

  // ------------------------------------------------------------------------
  // Breadcrumbs
  // ------------------------------------------------------------------------

  const breadcrumbs = useMemo(() => {
    const parts = path ? path.split("/") : [];
    return [
      { icon: "lucide:home", label: policy.rootLabel, path: "" },
      ...parts.map((part, idx) => ({
        label: part,
        path: parts.slice(0, idx + 1).join("/"),
      })),
    ];
  }, [path, policy.rootLabel]);

  // ------------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------------

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      {/* Breadcrumb + new-folder button */}
      <div className="flex items-center justify-between">
        <nav className="flex items-center gap-1 text-sm">
          {breadcrumbs.map((crumb, idx) => (
            <span key={crumb.path} className="flex items-center gap-1">
              {idx > 0 && (
                <Icon className="text-muted-foreground size-4" icon="lucide:chevron-right" />
              )}
              <button
                className={cn(
                  "flex items-center gap-1.5",
                  idx === breadcrumbs.length - 1
                    ? "pointer-events-none font-medium"
                    : "text-muted-foreground hover:text-foreground cursor-pointer",
                )}
                disabled={idx === breadcrumbs.length - 1}
                type="button"
                onClick={() => navigateTo(crumb.path)}
              >
                {"icon" in crumb && crumb.icon && <Icon className="size-3.5" icon={crumb.icon} />}
                <span>{crumb.label}</span>
              </button>
            </span>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          {headerExtra}
          {canWrite && (
            <Button size="sm" onClick={() => setNewFolderOpen(true)}>
              <Icon className="size-4" icon="lucide:plus" />
              <span>New folder</span>
            </Button>
          )}
        </div>
      </div>

      {/* Search + upload + refresh */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Icon
            className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2"
            icon="lucide:search"
          />
          <Input
            className="pl-9"
            placeholder="Search files and folders..."
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        {canUpload && (
          <>
            <Button
              asChild
              disabled={isUploading}
              size="icon"
              title="Upload files"
              variant="outline"
            >
              <label>
                <Icon className="size-4" icon="lucide:file-up" />
                <input
                  className="hidden"
                  multiple
                  type="file"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length > 0) handleUpload(files);
                    e.target.value = "";
                  }}
                />
              </label>
            </Button>
            <Button
              asChild
              disabled={isUploading}
              size="icon"
              title="Upload folder"
              variant="outline"
            >
              <label>
                <Icon className="size-4" icon="lucide:folder-up" />
                <input
                  className="hidden"
                  ref={(el) => el?.setAttribute("webkitdirectory", "")}
                  type="file"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length > 0) handleUpload(files);
                    e.target.value = "";
                  }}
                />
              </label>
            </Button>
          </>
        )}
        <Button
          disabled={isRefreshing}
          size="icon"
          title="Refresh"
          variant="outline"
          onClick={handleRefresh}
        >
          <Icon className={cn("size-4", isRefreshing && "animate-spin")} icon="lucide:refresh-cw" />
        </Button>
      </div>

      {/* biome-ignore lint/a11y/noStaticElementInteractions: drag-drop zone */}
      <section
        className={cn(
          "rounded-lg border transition-colors",
          isDragging && canUpload && "border-primary bg-primary/5",
          selectedPaths.size > 0 && "mb-12",
        )}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <table className="w-full">
          <thead>
            <tr className="bg-muted/50 border-b">
              {filteredEntries.length > 0 && canWrite && (
                <th className="w-10 p-3">
                  <Checkbox
                    checked={
                      selectedPaths.size === filteredEntries.length && filteredEntries.length > 0
                    }
                    onCheckedChange={handleSelectAll}
                  />
                </th>
              )}
              <th className="p-3 text-left text-sm font-medium">Name</th>
              <th className="p-3 text-left text-sm font-medium">Size</th>
              <th className="w-16 p-3" />
            </tr>
          </thead>
          <tbody>
            {list$.isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr className="border-b" key={i}>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <Skeleton className="size-5" />
                      <Skeleton className="h-4 w-40" />
                    </div>
                  </td>
                  <td className="p-3">
                    <Skeleton className="h-4 w-16" />
                  </td>
                  <td className="p-3">
                    <Skeleton className="size-7" />
                  </td>
                </tr>
              ))
            ) : isUploading ? (
              <tr>
                <td className="text-muted-foreground p-8 text-center" colSpan={3}>
                  <div className="flex flex-col items-center gap-2">
                    <Icon className="text-primary size-12 animate-spin" icon="lucide:loader-2" />
                    <p className="font-medium">Uploading files...</p>
                  </div>
                </td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td className="text-muted-foreground p-8 text-center" colSpan={3}>
                  <div className="relative flex flex-col items-center gap-2">
                    {canUpload && (
                      <input
                        className="absolute inset-0 cursor-pointer opacity-0"
                        multiple
                        ref={(el) => el?.setAttribute("webkitdirectory", "")}
                        type="file"
                        onChange={(evt) => {
                          const files = Array.from(evt.target.files || []);
                          if (files.length > 0) handleUpload(files);
                          evt.target.value = "";
                        }}
                      />
                    )}
                    <Icon
                      className={cn(
                        "size-12",
                        isDragging && canUpload ? "text-primary" : "text-muted-foreground/50",
                      )}
                      icon={canUpload ? "lucide:upload-cloud" : "lucide:folder-open"}
                    />
                    <p className="font-medium">
                      {isDragging && canUpload ? "Drop files here..." : "This folder is empty"}
                    </p>
                    <p className="text-sm">
                      {canUpload
                        ? "Drag and drop files here, or click to upload. ZIP files will be extracted automatically."
                        : "No files to display."}
                    </p>
                  </div>
                </td>
              </tr>
            ) : filteredEntries.length === 0 ? (
              <tr>
                <td className="text-muted-foreground p-8 text-center" colSpan={3}>
                  <div className="flex flex-col items-center gap-2">
                    <Icon className="text-muted-foreground/50 size-12" icon="lucide:search-x" />
                    <p className="font-medium">No results found</p>
                    <p className="text-sm">No files match "{searchTerm}"</p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredEntries.map((entry) => (
                <FileRow
                  entry={entry}
                  key={entry.path}
                  readOnly={!canWrite || entry.visibility === "protected"}
                  selected={selectedPaths.has(entry.path)}
                  onDelete={setDeleteTarget}
                  onDownload={handleDownload}
                  onMove={canUpload ? setMoveTarget : undefined}
                  onNavigate={navigateTo}
                  onRename={setRenameTarget}
                  onSelect={canWrite ? handleSelect : undefined}
                />
              ))
            )}
          </tbody>
        </table>
      </section>

      <NewFolderDialog
        open={newFolderOpen}
        parentPath={relativePath}
        policy={policy}
        onClose={() => setNewFolderOpen(false)}
        onCreate={handleCreateFolder}
      />
      <RenameDialog
        currentName={renameTarget?.name ?? ""}
        open={!!renameTarget}
        onClose={() => setRenameTarget(null)}
        onRename={handleRename}
      />
      <MoveDialog
        currentPath={moveTarget?.path ?? ""}
        open={!!moveTarget}
        onClose={() => setMoveTarget(null)}
        onMove={handleMove}
      />
      <ConfirmDeleteDialog
        description={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
        open={!!deleteTarget}
        title="Delete item"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
      <ConfirmDeleteDialog
        description={`Are you sure you want to delete ${selectedPaths.size} items? This action cannot be undone.`}
        open={batchDeleteOpen}
        title="Delete items"
        onCancel={() => setBatchDeleteOpen(false)}
        onConfirm={handleBatchDelete}
      />
      <MoveDialog
        currentPath={path ? `${path}/item` : ""}
        open={batchMoveOpen}
        onClose={() => setBatchMoveOpen(false)}
        onMove={handleBatchMove}
      />

      {selectedPaths.size > 0 && (
        <div className="pointer-events-none fixed right-0 bottom-0 left-0 z-50 flex justify-center pb-4">
          <div className="pointer-events-auto">
            <SelectionToolbar
              count={selectedPaths.size}
              onClear={() => setSelectedPaths(new Set())}
              onDelete={() => setBatchDeleteOpen(true)}
              onDownload={handleBatchDownload}
              onMove={canUpload ? () => setBatchMoveOpen(true) : undefined}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export type { ClientPathPolicy } from "./path-policy";
export { pluginsClientPolicy, workersClientPolicy } from "./path-policy";
