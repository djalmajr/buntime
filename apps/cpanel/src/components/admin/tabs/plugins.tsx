import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FileBrowser, pluginsClientPolicy } from "~/components/file-browser";
import { UploadArchiveButton } from "~/components/file-browser/components/upload-archive-button";
import { Button } from "~/components/ui/button";
import { DropdownMenuItem } from "~/components/ui/dropdown-menu";
import { Icon } from "~/components/ui/icon";
import { useApiKey } from "~/contexts/api-key-auth-context";
import {
  listInstalledPlugins,
  listLoadedPlugins,
  reloadPlugins,
  setPluginEnabled,
  uploadPlugin,
} from "~/helpers/admin-api";
import { type FileEntry, pluginsFsApi } from "~/helpers/fs-api";

/**
 * Plugins admin tab — file-browser over `RUNTIME_PLUGIN_DIRS`. Plugins live
 * as flat `{name}/` folders. The header carries Reload + Upload; each plugin
 * root folder gets an Enable/Disable action in its row dropdown (hot-reload,
 * no restart).
 */
export function PluginsTab(_props: {
  uploadOpen: boolean;
  onUploadOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { can } = useApiKey();
  const canWrite = can("plugins:install");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["fs-list", pluginsFsApi.base] });
    queryClient.invalidateQueries({ queryKey: ["fs-roots", pluginsFsApi.base] });
    queryClient.invalidateQueries({ queryKey: ["plugins"] });
  };

  // Installed (filesystem) + loaded (registry) — a plugin is enabled when its
  // name is in the loaded set. Used to resolve a row folder to a plugin + state.
  const installed$ = useQuery({
    queryFn: () => listInstalledPlugins(),
    queryKey: ["plugins", "installed"],
  });
  const loaded$ = useQuery({ queryFn: () => listLoadedPlugins(), queryKey: ["plugins", "loaded"] });

  const reload$ = useMutation({
    mutationFn: () => reloadPlugins(),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to reload plugins"),
    onSuccess: () => {
      invalidate();
      toast.success(t("admin.plugins.reloaded"));
    },
  });

  const toggle$ = useMutation({
    mutationFn: ({ enabled, name }: { enabled: boolean; name: string }) =>
      setPluginEnabled(name, enabled),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : t("admin.plugins.toggleFailed")),
    onSuccess: (_data, { enabled, name }) => {
      invalidate();
      toast.success(
        enabled ? t("admin.plugins.enabled", { name }) : t("admin.plugins.disabled", { name }),
      );
    },
  });

  const loadedNames = new Set((loaded$.data ?? []).map((p) => p.name));

  // Resolve a row folder to an installed plugin by matching its absolute path
  // suffix against the row's relative path (mount-basename agnostic).
  const pluginForEntry = (entry: FileEntry) => {
    if (!entry.isDirectory) return undefined;
    return (installed$.data ?? []).find(
      (p) => p.path === entry.path || p.path.endsWith(`/${entry.path}`),
    );
  };

  const extraActions = canWrite
    ? (entry: FileEntry) => {
        const plugin = pluginForEntry(entry);
        if (!plugin) return null;
        const enabled = loadedNames.has(plugin.name);
        return (
          <DropdownMenuItem
            className="gap-2"
            disabled={toggle$.isPending}
            onClick={(evt) => {
              evt.stopPropagation();
              toggle$.mutate({ enabled: !enabled, name: plugin.name });
            }}
          >
            <Icon className="size-4" icon={enabled ? "lucide:eye-off" : "lucide:eye"} />
            {enabled ? t("admin.plugins.disable") : t("admin.plugins.enable")}
          </DropdownMenuItem>
        );
      }
    : undefined;

  return (
    <FileBrowser
      api={pluginsFsApi}
      canWrite={canWrite}
      extraActions={extraActions}
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
              onSuccess={invalidate}
              onUpload={uploadPlugin}
              successMessage={t("admin.plugins.uploaded")}
            />
          </>
        ) : null
      }
      policy={pluginsClientPolicy}
      routePath="/plugins"
    />
  );
}
