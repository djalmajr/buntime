import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Icon } from "~/components/ui/icon";
import { listInstalledPlugins, listLoadedPlugins, setPluginEnabled } from "~/helpers/admin-api";
import { pluginsFsApi } from "~/helpers/fs-api";

/**
 * Plugin lifecycle manager — lists every installed plugin (built-in +
 * uploaded) and toggles each on/off at runtime via the enable/disable
 * endpoints, which hot-reload the registry and live routes without a restart.
 *
 * This is the right surface for enable/disable (the file-browser only shows
 * uploaded plugins; built-ins live in the hidden `.plugins` dir). A plugin is
 * "enabled" when its name appears in the loaded set.
 */
export function PluginManager({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const installed$ = useQuery({
    queryFn: () => listInstalledPlugins(),
    queryKey: ["plugins", "installed"],
  });
  const loaded$ = useQuery({
    queryFn: () => listLoadedPlugins(),
    queryKey: ["plugins", "loaded"],
  });

  const toggle$ = useMutation({
    mutationFn: ({ enabled, name }: { enabled: boolean; name: string }) =>
      setPluginEnabled(name, enabled),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : t("admin.plugins.toggleFailed")),
    onSuccess: (_data, { enabled, name }) => {
      queryClient.invalidateQueries({ queryKey: ["plugins"] });
      queryClient.invalidateQueries({ queryKey: ["fs-list", pluginsFsApi.base] });
      toast.success(
        enabled ? t("admin.plugins.enabled", { name }) : t("admin.plugins.disabled", { name }),
      );
    },
  });

  const installed = installed$.data ?? [];
  if (installed.length === 0) return null;

  const loadedNames = new Set((loaded$.data ?? []).map((p) => p.name));

  return (
    <div className="border-border bg-card rounded-md border">
      <div className="border-b px-4 py-3">
        <h3 className="text-sm font-medium">{t("admin.plugins.manageTitle")}</h3>
        <p className="text-muted-foreground text-xs">{t("admin.plugins.manageDescription")}</p>
      </div>
      <div className="divide-border divide-y">
        {installed.map((plugin) => {
          const enabled = loadedNames.has(plugin.name);
          const pending = toggle$.isPending && toggle$.variables?.name === plugin.name;
          return (
            <div className="flex items-center justify-between gap-3 px-4 py-2.5" key={plugin.name}>
              <div className="flex min-w-0 items-center gap-2">
                <Icon
                  className={
                    enabled
                      ? "text-emerald-600 size-4 shrink-0"
                      : "text-muted-foreground size-4 shrink-0"
                  }
                  icon="lucide:puzzle"
                />
                <span className="truncate text-sm font-medium">{plugin.name}</span>
                <span className="bg-secondary text-secondary-foreground shrink-0 rounded px-1.5 py-0.5 text-xs">
                  {plugin.source === "built-in"
                    ? t("admin.plugins.builtIn")
                    : t("admin.plugins.uploaded")}
                </span>
                <span
                  className={
                    enabled
                      ? "shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs text-emerald-700"
                      : "bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-xs"
                  }
                >
                  {enabled ? t("admin.plugins.statusEnabled") : t("admin.plugins.statusDisabled")}
                </span>
              </div>
              {canManage && (
                <Button
                  disabled={pending}
                  onClick={() => toggle$.mutate({ enabled: !enabled, name: plugin.name })}
                  size="sm"
                  variant="outline"
                >
                  <Icon
                    className={pending ? "size-4 animate-spin" : "size-4"}
                    icon={pending ? "lucide:loader-2" : enabled ? "lucide:eye-off" : "lucide:eye"}
                  />
                  {enabled ? t("admin.plugins.disable") : t("admin.plugins.enable")}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
