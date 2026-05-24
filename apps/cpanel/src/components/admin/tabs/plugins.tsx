import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FileBrowser, pluginsClientPolicy } from "~/components/file-browser";
import { UploadArchiveButton } from "~/components/file-browser/components/upload-archive-button";
import { Button } from "~/components/ui/button";
import { Icon } from "~/components/ui/icon";
import { useApiKey } from "~/contexts/api-key-auth-context";
import { reloadPlugins, uploadPlugin } from "~/helpers/admin-api";
import { pluginsFsApi } from "~/helpers/fs-api";
import { PluginManager } from "./plugin-manager";

/**
 * Plugins admin tab — file-browser over `RUNTIME_PLUGIN_DIRS`. Plugins live
 * as flat `{name}/` folders, so uploads/moves are allowed anywhere inside a
 * plugin root via drag-drop.
 *
 * The header carries three plugin-specific affordances rendered to the left
 * of "New folder":
 *
 * 1. **Install plugin** — opens a file picker for the plugin archive and
 *    routes it through `/api/plugins/upload`, which extracts at the right
 *    place regardless of the current FS view. Use this to install a brand-new
 *    plugin without first creating the destination folder.
 * 2. **Reload** — `POST /api/plugins/reload` to rescan the runtime registry
 *    after manual changes to disk.
 */
export function PluginsTab(_props: {
  uploadOpen: boolean;
  onUploadOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { can } = useApiKey();
  const canWrite = can("plugins:install");

  const reload$ = useMutation({
    mutationFn: () => reloadPlugins(),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to reload plugins"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fs-list", pluginsFsApi.base] });
      queryClient.invalidateQueries({ queryKey: ["plugins"] });
      toast.success(t("admin.plugins.reloaded"));
    },
  });

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="p-4 pb-0">
        <PluginManager canManage={canWrite} />
      </div>
      <FileBrowser
        api={pluginsFsApi}
        canWrite={canWrite}
        headerExtra={
          canWrite ? (
            <>
              <Button
                disabled={reload$.isPending}
                onClick={() => reload$.mutate()}
                size="sm"
                variant="outline"
              >
                <Icon
                  className={reload$.isPending ? "size-4 animate-spin" : "size-4"}
                  icon="lucide:refresh-cw"
                />
                {t("admin.plugins.reload")}
              </Button>
              <UploadArchiveButton
                label={t("admin.common.upload")}
                onSuccess={() => {
                  queryClient.invalidateQueries({ queryKey: ["fs-list", pluginsFsApi.base] });
                  queryClient.invalidateQueries({ queryKey: ["fs-roots", pluginsFsApi.base] });
                  queryClient.invalidateQueries({ queryKey: ["plugins"] });
                }}
                onUpload={uploadPlugin}
                successMessage={t("admin.plugins.uploaded")}
              />
            </>
          ) : null
        }
        policy={pluginsClientPolicy}
        routePath="/plugins"
      />
    </div>
  );
}
