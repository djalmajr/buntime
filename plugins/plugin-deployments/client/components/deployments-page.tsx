import {
  Button,
  Checkbox,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Icon,
  Input,
  Skeleton,
} from "@buntime/shadcn-ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiRequest, getApiBase, uploadFiles } from "~/utils/api";
import { isValidUploadDestination, parseDeploymentPath } from "~/utils/path-utils";
import { useFragmentUrl } from "~/utils/use-fragment-url";
import { FileRow } from "./file-row";
import { MoveDialog } from "./move-dialog";
import { NewFolderDialog } from "./new-folder-dialog";
import { RenameDialog } from "./rename-dialog";
import { SelectionToolbar } from "./selection-toolbar";

interface FileEntry {
  isDirectory: boolean;
  name: string;
  path: string;
  size: number;
  updatedAt: string;
  visibility?: "public" | "protected" | "internal";
}

export function DeploymentsPage() {
  const { t } = useTranslation("deployments");
  const queryClient = useQueryClient();

  // Get root directories first (needed for URL parsing)
  const rootQuery = useQuery({
    queryFn: async () => {
      const res = await apiRequest<{ entries: FileEntry[]; path: string }>("/list?path=");
      return res.data?.entries.filter((e) => e.isDirectory).map((e) => e.name) ?? [];
    },
    queryKey: ["deployments-roots"],
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });

  const rootDirs = rootQuery.data ?? [];

  // URL-synced navigation state via MessageBus
  const { path, selectedRoot, setPath } = useFragmentUrl(rootDirs);
  const [search, setSearch] = useState("");

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

  // Clear selection when path changes
  useEffect(() => {
    setSelectedPaths(new Set());
    setSearch("");
  }, [path]);

  // Effective path combines selectedRoot with relative path
  const effectivePath = selectedRoot ? (path ? `${selectedRoot}/${path}` : selectedRoot) : "";

  const entries$ = useQuery({
    enabled: !!selectedRoot,
    queryFn: async () => {
      const res = await apiRequest<{
        currentVisibility?: "public" | "protected" | "internal";
        entries: FileEntry[];
        path: string;
      }>(`/list?path=${encodeURIComponent(effectivePath)}`);
      return res.data;
    },
    queryKey: ["deployments", effectivePath],
  });

  const entries = entries$.data?.entries ?? [];
  const currentVisibility = entries$.data?.currentVisibility;

  // Filter entries by search term
  const filteredEntries = useMemo(() => {
    if (!search.trim()) return entries;
    const term = search.toLowerCase().trim();
    return entries.filter((entry) => entry.name.toLowerCase().includes(term));
  }, [entries, search]);

  // Parse path to get format info and determine if uploads are allowed
  const pathInfo = parseDeploymentPath(effectivePath);
  // Upload is only allowed inside a version folder (flat: app@version, nested: app/version)
  // and the current folder is not protected
  const canUpload = isValidUploadDestination(effectivePath) && currentVisibility !== "protected";

  const navigateTo = (newPath: string) => {
    // Entries have full paths (e.g., "buntime-apps/my-app"), strip selectedRoot prefix
    if (selectedRoot && newPath.startsWith(`${selectedRoot}/`)) {
      setPath(newPath.slice(selectedRoot.length + 1));
    } else if (newPath === selectedRoot) {
      setPath("");
    } else {
      setPath(newPath);
    }
  };

  const handleUpload = useCallback(
    async (files: File[]) => {
      setIsUploading(true);
      try {
        const paths = files.map((file) => {
          const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
          return relativePath || file.name;
        });

        const res = await uploadFiles(effectivePath, files, paths);

        if (!res.success) {
          throw new Error(res.error || t("errors.uploadFailed"));
        }

        queryClient.invalidateQueries({ queryKey: ["deployments", effectivePath] });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("errors.uploadFailed"));
      } finally {
        setIsUploading(false);
      }
    },
    [effectivePath, queryClient, t],
  );

  const handleCreateFolder = async (name: string) => {
    try {
      const folderPath = effectivePath ? `${effectivePath}/${name}` : name;
      const res = await apiRequest("/mkdir", {
        body: JSON.stringify({ path: folderPath }),
        method: "POST",
      });
      if (!res.success) throw new Error(t("errors.createFolderFailed"));
      queryClient.invalidateQueries({ queryKey: ["deployments", effectivePath] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("errors.createFolderFailed"));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await apiRequest("/delete", {
        body: JSON.stringify({ path: deleteTarget.path }),
        method: "DELETE",
      });
      if (!res.success) throw new Error(t("errors.deleteFailed"));
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["deployments", effectivePath] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("errors.deleteFailed"));
    }
  };

  const handleRename = async (newName: string) => {
    if (!renameTarget) return;
    try {
      const res = await apiRequest("/rename", {
        body: JSON.stringify({ newName, path: renameTarget.path }),
        method: "POST",
      });
      if (!res.success) throw new Error(t("errors.renameFailed"));
      setRenameTarget(null);
      queryClient.invalidateQueries({ queryKey: ["deployments", effectivePath] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("errors.renameFailed"));
    }
  };

  const handleDownload = (entry: FileEntry) => {
    const basePath = getApiBase();
    window.open(`${basePath}/api/download?path=${encodeURIComponent(entry.path)}`, "_blank");
  };

  const handleMove = async (destPath: string) => {
    if (!moveTarget) return;

    // Validate destination is inside a version folder (flat or nested)
    if (!isValidUploadDestination(destPath)) {
      toast.error(t("errors.moveFailed"));
      return;
    }

    try {
      const res = await apiRequest<{ message?: string }>("/move", {
        body: JSON.stringify({ destPath, path: moveTarget.path }),
        method: "POST",
      });
      if (!res.success) {
        throw new Error(res.error || t("errors.moveFailed"));
      }
      setMoveTarget(null);
      queryClient.invalidateQueries({ queryKey: ["deployments", effectivePath] });
      queryClient.invalidateQueries({ queryKey: ["deployments", destPath] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("errors.moveFailed"));
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await apiRequest(`/refresh?path=${encodeURIComponent(effectivePath)}`);
      queryClient.invalidateQueries({ queryKey: ["deployments", effectivePath] });
    } catch {
      toast.error(t("errors.refreshFailed"));
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSelect = (entry: FileEntry, selected: boolean) => {
    // Don't allow selecting protected entries
    if (entry.visibility === "protected") return;

    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(entry.path);
      } else {
        next.delete(entry.path);
      }
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
      const res = await apiRequest("/delete-batch", {
        body: JSON.stringify({ paths: Array.from(selectedPaths) }),
        method: "POST",
      });
      if (!res.success) throw new Error(t("errors.deleteFailed"));
      setSelectedPaths(new Set());
      setBatchDeleteOpen(false);
      queryClient.invalidateQueries({ queryKey: ["deployments", effectivePath] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("errors.deleteFailed"));
    }
  };

  const handleBatchDownload = () => {
    if (selectedPaths.size === 0) return;
    const basePath = getApiBase();
    const paths = Array.from(selectedPaths)
      .map((p) => encodeURIComponent(p))
      .join(",");
    window.open(`${basePath}/api/download-batch?paths=${paths}`, "_blank");
  };

  const handleBatchMove = async (destPath: string) => {
    if (selectedPaths.size === 0) return;

    // Validate destination is inside a version folder (flat or nested)
    if (!isValidUploadDestination(destPath)) {
      toast.error(t("errors.moveFailed"));
      return;
    }

    try {
      const res = await apiRequest<{ message?: string }>("/move-batch", {
        body: JSON.stringify({ destPath, paths: Array.from(selectedPaths) }),
        method: "POST",
      });
      if (!res.success) {
        throw new Error(res.error || t("errors.moveFailed"));
      }
      setSelectedPaths(new Set());
      setBatchMoveOpen(false);
      queryClient.invalidateQueries({ queryKey: ["deployments", effectivePath] });
      queryClient.invalidateQueries({ queryKey: ["deployments", destPath] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("errors.moveFailed"));
    }
  };

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

      // Helper to read all entries from a directory (may require multiple calls)
      const readAllEntries = async (
        reader: FileSystemDirectoryReader,
      ): Promise<FileSystemEntry[]> => {
        const entries: FileSystemEntry[] = [];
        let batch: FileSystemEntry[];
        do {
          batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
            reader.readEntries(resolve, reject);
          });
          entries.push(...batch);
        } while (batch.length > 0);
        return entries;
      };

      // Recursively read directory entries
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
          const entries = await readAllEntries(reader);
          const dirPath = basePath ? `${basePath}/${entry.name}` : entry.name;
          for (const childEntry of entries) {
            await readEntry(childEntry, dirPath);
          }
        }
      };

      // Strategy: Try Entry API first for folder support, fallback to dataTransfer.files
      const items = Array.from(evt.dataTransfer.items);

      // Collect all valid entries
      const entries: FileSystemEntry[] = [];
      for (const item of items) {
        const entry = item?.webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }

      // If Entry API worked for all items, use it (better folder support)
      if (entries.length === items.length && entries.length > 0) {
        for (const entry of entries) {
          await readEntry(entry);
        }
      } else {
        // Entry API failed for some items - use dataTransfer.files as fallback
        // This won't read folder contents, but at least files will work
        for (const file of Array.from(evt.dataTransfer.files)) {
          if (file.size > 0) {
            files.push(file);
          }
        }
      }

      if (files.length > 0) handleUpload(files);
    },
    [canUpload, handleUpload],
  );

  // Build breadcrumb trail (relative path only, selectedRoot shown separately)
  const breadcrumbs = useMemo(() => {
    const parts = path ? path.split("/") : [];
    return [
      { icon: "lucide:home", label: t("breadcrumb.root"), path: "" },
      ...parts.map((part, idx) => ({
        label: part,
        path: parts.slice(0, idx + 1).join("/"),
      })),
    ];
  }, [path, t]);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      {/* Header with breadcrumb, root selector, and new folder button */}
      <div className="flex items-center justify-between">
        <nav className="flex items-center gap-1 text-sm">
          {breadcrumbs.map((crumb, idx) => (
            <span key={crumb.path} className="flex items-center gap-1">
              {idx > 0 && (
                <Icon className="size-4 text-muted-foreground" icon="lucide:chevron-right" />
              )}
              <button
                className={cn(
                  "flex items-center gap-1.5",
                  idx === breadcrumbs.length - 1
                    ? "pointer-events-none font-medium"
                    : "cursor-pointer text-muted-foreground hover:text-foreground",
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
          <Button size="sm" onClick={() => setNewFolderOpen(true)}>
            <Icon className="size-4" icon="lucide:plus" />
            <span>{t("actions.newFolder")}</span>
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Icon
            className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            icon="lucide:search"
          />
          <Input
            className="pl-9"
            placeholder={t("search.placeholder")}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {canUpload && (
          <>
            <Button
              asChild
              disabled={isUploading}
              size="icon"
              title={t("actions.uploadFiles")}
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
              title={t("actions.uploadFolder")}
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
          title={t("actions.refresh")}
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
            <tr className="border-b bg-muted/50">
              {filteredEntries.length > 0 && (
                <th className="w-10 p-3">
                  <Checkbox
                    checked={
                      selectedPaths.size === filteredEntries.length && filteredEntries.length > 0
                    }
                    onCheckedChange={handleSelectAll}
                  />
                </th>
              )}
              <th className="p-3 text-left text-sm font-medium">{t("list.name")}</th>
              <th className="p-3 text-left text-sm font-medium">{t("list.size")}</th>
              <th className="w-16 p-3"></th>
            </tr>
          </thead>
          <tbody>
            {entries$.isLoading ? (
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
                <td className="p-8 text-center text-muted-foreground" colSpan={3}>
                  <div className="flex flex-col items-center gap-2">
                    <Icon className="size-12 animate-spin text-primary" icon="lucide:loader-2" />
                    <p className="font-medium">{t("upload.uploading")}</p>
                  </div>
                </td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td className="p-8 text-center text-muted-foreground" colSpan={3}>
                  <div className="relative flex flex-col items-center gap-2">
                    {canUpload && (
                      <input
                        className="absolute inset-0 cursor-pointer opacity-0"
                        multiple
                        ref={(el) => el?.setAttribute("webkitdirectory", "")}
                        type="file"
                        onChange={(evt) => {
                          const files = Array.from(evt.target.files || []);
                          if (files.length > 0) {
                            handleUpload(files);
                          }
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
                      {isDragging && canUpload ? t("upload.dragActive") : t("empty.title")}
                    </p>
                    <p className="text-sm">
                      {canUpload ? t("empty.descriptionWithUpload") : t("empty.description")}
                    </p>
                  </div>
                </td>
              </tr>
            ) : filteredEntries.length === 0 ? (
              <tr>
                <td className="p-8 text-center text-muted-foreground" colSpan={3}>
                  <div className="flex flex-col items-center gap-2">
                    <Icon className="size-12 text-muted-foreground/50" icon="lucide:search-x" />
                    <p className="font-medium">{t("search.noResults")}</p>
                    <p className="text-sm">{t("search.noResultsDescription", { term: search })}</p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredEntries.map((entry) => (
                <FileRow
                  entry={entry}
                  key={entry.path}
                  readOnly={entry.visibility === "protected"}
                  selected={selectedPaths.has(entry.path)}
                  onDelete={setDeleteTarget}
                  onDownload={handleDownload}
                  onMove={canUpload ? setMoveTarget : undefined}
                  onNavigate={navigateTo}
                  onRename={setRenameTarget}
                  onSelect={handleSelect}
                />
              ))
            )}
          </tbody>
        </table>
      </section>
      <NewFolderDialog
        depth={pathInfo.depth}
        isInsideVersion={pathInfo.isInsideVersion}
        open={newFolderOpen}
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
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("confirmDelete.title")}</DialogTitle>
            <DialogDescription>
              {t("confirmDelete.description", { name: deleteTarget?.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t("confirmDelete.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              {t("confirmDelete.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={batchDeleteOpen} onOpenChange={setBatchDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("batch.confirmDelete.title")}</DialogTitle>
            <DialogDescription>
              {t("batch.confirmDelete.description", { count: selectedPaths.size })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchDeleteOpen(false)}>
              {t("confirmDelete.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleBatchDelete}>
              {t("confirmDelete.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <MoveDialog
        currentPath={effectivePath ? `${effectivePath}/item` : ""}
        open={batchMoveOpen}
        onClose={() => setBatchMoveOpen(false)}
        onMove={handleBatchMove}
      />
      {selectedPaths.size > 0 && (
        <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-50 flex justify-center pb-4">
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
