import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Icon } from "~/components/icon";
import { Button } from "~/components/ui/button";
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
import { NewFolderDialog } from "./-components/new-folder-dialog";
import { RenameDialog } from "./-components/rename-dialog";

interface FileEntry {
  isDirectory: boolean;
  name: string;
  path: string;
  size: number;
  updatedAt: string;
}

function DeploymentsPage() {
  const { t } = useTranslation("deployments");
  const { setAction } = useHeader();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null);
  const [search, setSearch] = useQueryString("search");
  const [path] = useQueryString("path");

  // Set header action button
  useEffect(() => {
    setAction({
      label: t("actions.newFolder"),
      onClick: () => setNewFolderOpen(true),
    });

    return () => {
      setAction(null);
    };
  }, [setAction, t]);

  const entries$ = useQuery({
    queryFn: async () => {
      const res = await api._.deployments.list.$get({ query: { path } });
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
        }

        const res = await fetch("/_/deployments/upload", {
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
      const res = await api._.deployments.mkdir.$post({ json: { path: folderPath } });
      if (!res.ok) throw new Error(t("errors.createFolderFailed"));
      queryClient.invalidateQueries({ queryKey: ["deployments", path] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("errors.createFolderFailed"));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await api._.deployments.delete.$delete({ json: { path: deleteTarget.path } });
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
      const res = await api._.deployments.rename.$post({
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

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (canUpload) setIsDragging(true);
    },
    [canUpload],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      if (!canUpload) return;

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) handleUpload(files);
    },
    [canUpload, handleUpload],
  );

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* Search Input */}
      <div className="relative">
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

      {/* File List with integrated drag-and-drop */}
      <div
        className={cn(
          "rounded-lg border transition-colors",
          isDragging && canUpload && "border-primary bg-primary/5",
        )}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/50">
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
                        accept="*/*"
                        className="absolute inset-0 cursor-pointer opacity-0"
                        multiple
                        type="file"
                        onChange={(e) => {
                          const files = Array.from(e.target.files || []);
                          if (files.length > 0) {
                            handleUpload(files);
                          }
                          e.target.value = "";
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
                  onDelete={setDeleteTarget}
                  onDownload={handleDownload}
                  onNavigate={navigateTo}
                  onRename={setRenameTarget}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* New Folder Dialog */}
      <NewFolderDialog
        depth={pathParts.length}
        open={newFolderOpen}
        onClose={() => setNewFolderOpen(false)}
        onCreate={handleCreateFolder}
      />

      {/* Rename Dialog */}
      <RenameDialog
        currentName={renameTarget?.name ?? ""}
        open={!!renameTarget}
        onClose={() => setRenameTarget(null)}
        onRename={handleRename}
      />

      {/* Delete Confirmation Dialog */}
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
