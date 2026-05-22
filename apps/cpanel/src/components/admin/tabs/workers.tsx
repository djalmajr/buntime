import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FileBrowser, workersClientPolicy } from "~/components/file-browser";
import { UploadArchiveButton } from "~/components/file-browser/components/upload-archive-button";
import { useApiKey } from "~/contexts/api-key-auth-context";
import { uploadWorker } from "~/helpers/admin-api";
import { workersFsApi } from "~/helpers/fs-api";

/**
 * Workers admin tab — file-browser over `RUNTIME_WORKER_DIRS`. Semver-aware:
 * uploads via drag-drop must target a version folder (`{name}/{version}/...`).
 *
 * The header carries an "Install worker" button that bypasses the FS policy
 * by routing through the dedicated `/api/workers/upload` endpoint — the
 * proper place to install a brand-new worker, since the legacy install
 * pipeline knows how to detect the worker name + version from the archive
 * and place it at the correct `{name}/{version}/` location.
 */
export function WorkersTab(_props: {
  uploadOpen: boolean;
  onUploadOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { can } = useApiKey();
  const queryClient = useQueryClient();
  const canWrite = can("workers:install");

  return (
    <FileBrowser
      api={workersFsApi}
      canWrite={canWrite}
      headerExtra={
        canWrite ? (
          <UploadArchiveButton
            label={t("admin.common.upload")}
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ["fs-list", workersFsApi.base] });
              queryClient.invalidateQueries({ queryKey: ["fs-roots", workersFsApi.base] });
            }}
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
