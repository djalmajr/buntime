import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Icon } from "~/components/icon";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import { useHeader } from "~/contexts/header-context";
import { api } from "~/helpers/api-client";
import { useQueryString } from "~/hooks/use-query-state";
import { cn } from "~/utils/cn";
import { FileRow } from "./-components/file-row";
import { MoveDialog } from "./-components/move-dialog";
import { NewFolderDialog } from "./-components/new-folder-dialog";
import { RenameDialog } from "./-components/rename-dialog";
import { SelectionToolbar } from "./-components/selection-toolbar";

interface FileEntry {
  isDirectory: boolean;
  name: string;
  path: string;
  size: number;
  updatedAt: string;
}

function DeploymentsPage() {
  const { t } = useTranslation("deployments");
  const { setHeader } = useHeader();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchMoveOpen, setBatchMoveOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [moveTarget, setMoveTarget] = useState<FileEntry | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null);
  const [search, setSearch] = useQueryString("search");
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [path] = useQueryString("path");

  // Clear selection when path changes
  useEffect(() => {
    setSelectedPaths(new Set());
  }, [path]);

  // Set header action button
  useEffect(() => {
    setHeader({
      actions: (
        <Button size="sm" onClick={() => setNewFolderOpen(true)}>
          <Icon className="size-4" icon="lucide:plus" />
          <span>{t("actions.newFolder")}</span>
        </Button>
      ),
    });

    return () => {
      setHeader(null);
    };
  }, [setHeader, t]);

  const entries$ = useQuery({
    queryFn: async () => {
      const res = await api.deployments.list.$get({ query: { path } });
      const json = await res.json();
      return json.data;
    },
    queryKey: ["deployments", path],
  });

  const entries = entries$.data?.entries ?? [];

  // Filter entries by search term
  const filteredEntries = useMemo(() => {
    if (!search.trim()) return entries;
    const term = search.toLowerCase().trim();
    return entries.filter((entry) => entry.name.toLowerCase().includes(term));
  }, [entries, search]);

  const pathParts = path ? path.split("/") : [];
  // Upload is only allowed inside app/version/ (at least 2 levels deep)
  const canUpload = pathParts.length >= 2;

  const navigateTo = (newPath: string) => {
    navigate({ search: { path: newPath, search: undefined }, to: "/deployments" });
  };

  const handleUpload = useCallback(
    async (files: File[]) => {
      setIsUploading(true);
      try {
        const formData = new FormData();
        formData.append("path", path);
        for (const file of files) {
          formData.append("files", file);
          // Preserve folder structure using webkitRelativePath
          const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
          formData.append("paths", relativePath || file.name);
        }

        const res = await fetch("/api/deployments/upload", {
          body: formData,
          method: "POST",
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.message || t("errors.uploadFailed"));
        }

        queryClient.invalidateQueries({ queryKey: ["deployments", path] });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("errors.uploadFailed"));
      } finally {
        setIsUploading(false);
      }
    },
    [path, queryClient, t],
  );

  const handleCreateFolder = async (name: string) => {
    try {
      const folderPath = path ? `${path}/${name}` : name;
      const res = await api.deployments.mkdir.$post({ json: { path: folderPath } });
      if (!res.ok) throw new Error(t("errors.createFolderFailed"));
      queryClient.invalidateQueries({ queryKey: ["deployments", path] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("errors.createFolderFailed"));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await api.deployments.delete.$delete({
        json: { path: deleteTarget.path },
      });
      if (!res.ok) throw new Error(t("errors.deleteFailed"));
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["deployments", path] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("errors.deleteFailed"));
    }
  };

  const handleRename = async (newName: string) => {
    if (!renameTarget) return;
    try {
      const res = await api.deployments.rename.$post({
        json: { newName, path: renameTarget.path },
      });
      if (!res.ok) throw new Error(t("errors.renameFailed"));
      setRenameTarget(null);
      queryClient.invalidateQueries({ queryKey: ["deployments", path] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("errors.renameFailed"));
    }
  };

  const handleDownload = (entry: FileEntry) => {
    window.open(`/_/deployments/download?path=${encodeURIComponent(entry.path)}`, "_blank");
  };

  const handleMove = async (destPath: string) => {
    if (!moveTarget) return;

    // Validate destination is at least 2 levels deep (app/version)
    const destParts = destPath.split("/").filter(Boolean);
    if (destParts.length < 2) {
      toast.error(t("errors.moveFailed"));
      return;
    }

    try {
      const res = await api.deployments.move.$post({
        json: { destPath, path: moveTarget.path },
      });
      if (!res.ok) {
        const data = (await res.json()) as { message?: string };
        throw new Error(data.message || t("errors.moveFailed"));
      }
      setMoveTarget(null);
      queryClient.invalidateQueries({ queryKey: ["deployments", path] });
      queryClient.invalidateQueries({ queryKey: ["deployments", destPath] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("errors.moveFailed"));
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await api.deployments.refresh.$get({ query: { path } });
      queryClient.invalidateQueries({ queryKey: ["deployments", path] });
    } catch {
      toast.error(t("errors.refreshFailed"));
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSelect = (entry: FileEntry, selected: boolean) => {
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
      setSelectedPaths(new Set(filteredEntries.map((e) => e.path)));
    } else {
      setSelectedPaths(new Set());
    }
  };

  const handleBatchDelete = async () => {
    if (selectedPaths.size === 0) return;
    try {
      const res = await api.deployments["delete-batch"].$post({
        json: { paths: Array.from(selectedPaths) },
      });
      if (!res.ok) throw new Error(t("errors.deleteFailed"));
      setSelectedPaths(new Set());
      setBatchDeleteOpen(false);
      queryClient.invalidateQueries({ queryKey: ["deployments", path] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("errors.deleteFailed"));
    }
  };

  const handleBatchDownload = () => {
    if (selectedPaths.size === 0) return;
    const paths = Array.from(selectedPaths)
      .map((p) => encodeURIComponent(p))
      .join(",");
    window.open(`/_/deployments/download-batch?paths=${paths}`, "_blank");
  };

  const handleBatchMove = async (destPath: string) => {
    if (selectedPaths.size === 0) return;

    // Validate destination is at least 2 levels deep (app/version)
    const destParts = destPath.split("/").filter(Boolean);
    if (destParts.length < 2) {
      toast.error(t("errors.moveFailed"));
      return;
    }

    try {
      const res = await api.deployments["move-batch"].$post({
        json: { destPath, paths: Array.from(selectedPaths) },
      });
      if (!res.ok) {
        const data = (await res.json()) as { message?: string };
        throw new Error(data.message || t("errors.moveFailed"));
      }
      setSelectedPaths(new Set());
      setBatchMoveOpen(false);
      queryClient.invalidateQueries({ queryKey: ["deployments", path] });
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

  return (
    <div className="flex flex-1 flex-col gap-4">
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
        depth={pathParts.length}
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
        currentPath={path ? `${path}/item` : ""}
        open={batchMoveOpen}
        onClose={() => setBatchMoveOpen(false)}
        onMove={handleBatchMove}
      />
      {selectedPaths.size > 0 && (
        <div className="pointer-events-none fixed bottom-0 left-64 right-0 z-50 flex justify-center pb-4">
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

export const Route = createFileRoute("/deployments/")({
  component: DeploymentsPage,
  loaderDeps: ({ search }) => ({ path: search.path }),
  loader: ({ deps }) => {
    const path = deps.path || "";
    const parts = path ? path.split("/") : [];

    // Build breadcrumb trail: Apps > app-name > version > ...
    const breadcrumbs = [
      { label: "deployments:breadcrumb.root", path: "/deployments" },
      ...parts.map((part, idx) => ({
        label: part,
        path: `/deployments?path=${encodeURIComponent(parts.slice(0, idx + 1).join("/"))}`,
      })),
    ];

    return { breadcrumbs };
  },
  validateSearch: (search: Record<string, unknown>) => ({
    path: (search.path as string) || undefined,
    search: (search.search as string) || undefined,
  }),
});
