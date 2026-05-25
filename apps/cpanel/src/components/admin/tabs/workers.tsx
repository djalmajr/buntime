import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FileBrowser, workersClientPolicy } from "~/components/file-browser";
import { UploadArchiveButton } from "~/components/file-browser/components/upload-archive-button";
import { DropdownMenuItem } from "~/components/ui/dropdown-menu";
import { Icon } from "~/components/ui/icon";
import { useApiKey } from "~/contexts/api-key-auth-context";
import { listWorkers, setWorkerVersionEnabled, uploadWorker } from "~/helpers/admin-api";
import { type FileEntry, workersFsApi } from "~/helpers/fs-api";

/**
 * Workers admin tab — file-browser over `RUNTIME_WORKER_DIRS`. Semver-aware:
 * uploads via drag-drop must target a version folder (`{name}/{version}/...`).
 *
 * The header carries an "Install worker" button (routes through
 * `/api/workers/upload`). Each version folder gets an Enable/Disable action in
 * its row dropdown — a disabled version 404s without a restart.
 */
export function WorkersTab(_props: {
  uploadOpen: boolean;
  onUploadOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { can } = useApiKey();
  const queryClient = useQueryClient();
  const canWrite = can("workers:install");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["fs-list", workersFsApi.base] });
    queryClient.invalidateQueries({ queryKey: ["fs-roots", workersFsApi.base] });
    queryClient.invalidateQueries({ queryKey: ["workers"] });
  };

  const workers$ = useQuery({ queryFn: () => listWorkers(), queryKey: ["workers"] });

  const toggle$ = useMutation({
    mutationFn: ({ enabled, name, version }: { enabled: boolean; name: string; version: string }) =>
      setWorkerVersionEnabled(name, version, enabled),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : t("admin.workers.toggleFailed")),
    onSuccess: (_data, { enabled, name }) => {
      invalidate();
      toast.success(
        enabled ? t("admin.workers.enabled", { name }) : t("admin.workers.disabled", { name }),
      );
    },
  });

  // Map a version-folder row to its worker + version + enabled state. Strips
  // the mount basename, then uses the workers policy to extract name/version.
  const workerVersionForEntry = (entry: FileEntry) => {
    if (!entry.isDirectory) return undefined;
    const relPath = entry.path.split("/").slice(1).join("/");
    const parsed = workersClientPolicy.parse(relPath);
    if (!parsed.isUnitRoot || !parsed.appName || !parsed.version) return undefined;
    const worker = (workers$.data ?? []).find((w) => w.name === parsed.appName);
    if (!worker) return undefined;
    return {
      enabled: !(worker.disabledVersions ?? []).includes(parsed.version),
      name: worker.name,
      version: parsed.version,
    };
  };

  const extraActions = canWrite
    ? (entry: FileEntry) => {
        const wv = workerVersionForEntry(entry);
        if (!wv) return null;
        return (
          <DropdownMenuItem
            className="gap-2"
            disabled={toggle$.isPending}
            onClick={(evt) => {
              evt.stopPropagation();
              toggle$.mutate({ enabled: !wv.enabled, name: wv.name, version: wv.version });
            }}
          >
            <Icon className="size-4" icon={wv.enabled ? "lucide:eye-off" : "lucide:eye"} />
            {wv.enabled ? t("admin.workers.disable") : t("admin.workers.enable")}
          </DropdownMenuItem>
        );
      }
    : undefined;

  return (
    <FileBrowser
      api={workersFsApi}
      canWrite={canWrite}
      extraActions={extraActions}
      headerExtra={
        canWrite ? (
          <UploadArchiveButton
            label={t("admin.common.upload")}
            onSuccess={invalidate}
            onUpload={uploadWorker}
            successMessage={t("admin.workers.uploaded")}
          />
        ) : null
      }
      policy={workersClientPolicy}
      routePath="/workers"
    />
  );
}
