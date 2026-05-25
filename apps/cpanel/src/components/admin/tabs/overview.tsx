import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Icon } from "~/components/ui/icon";
import { useApiKey } from "~/contexts/api-key-auth-context";
import {
  listApiKeys,
  listInstalledPlugins,
  listLoadedPlugins,
  listWorkers,
} from "~/helpers/admin-api";
import { cn } from "~/utils/cn";
import { type CapabilityGroup, type OverviewMetric, Section } from "../shared";

export function OverviewTab() {
  const { t } = useTranslation();
  const { can, session } = useApiKey();
  const principal = session?.principal;

  const workers$ = useQuery({
    enabled: Boolean(session && can("workers:read")),
    queryFn: () => listWorkers(),
    queryKey: ["admin", "overview", "workers"],
  });

  const keys$ = useQuery({
    enabled: Boolean(session && can("keys:read")),
    queryFn: () => listApiKeys(),
    queryKey: ["admin", "overview", "keys"],
  });

  const installedPlugins$ = useQuery({
    enabled: Boolean(session && can("plugins:read")),
    queryFn: () => listInstalledPlugins(),
    queryKey: ["admin", "overview", "plugins", "installed"],
  });

  const loadedPlugins$ = useQuery({
    enabled: Boolean(session && can("plugins:read")),
    queryFn: () => listLoadedPlugins(),
    queryKey: ["admin", "overview", "plugins", "loaded"],
  });

  if (!principal) return null;

  const noAccess = t("admin.overview.noAccess");
  const loading = t("admin.common.loading");
  const roleLabel = t(`admin.roles.${principal.role}`);
  const summary: OverviewMetric[] = [
    {
      help: can("workers:read")
        ? t("admin.overview.workersHelp", { count: workers$.data?.length ?? 0 })
        : noAccess,
      icon: "lucide:cpu",
      label: t("admin.overview.workers"),
      value: can("workers:read")
        ? workers$.isLoading
          ? loading
          : String(workers$.data?.length ?? 0)
        : "-",
    },
    {
      help: can("plugins:read")
        ? t("admin.overview.pluginsHelp", {
            installed: installedPlugins$.data?.length ?? 0,
            loaded: loadedPlugins$.data?.length ?? 0,
          })
        : noAccess,
      icon: "lucide:puzzle",
      label: t("admin.overview.plugins"),
      value: can("plugins:read")
        ? loadedPlugins$.isLoading || installedPlugins$.isLoading
          ? loading
          : String(loadedPlugins$.data?.length ?? 0)
        : "-",
    },
    {
      help: can("keys:read")
        ? t("admin.overview.keysHelp", { count: keys$.data?.keys.length ?? 0 })
        : noAccess,
      icon: "lucide:fingerprint",
      label: t("admin.overview.keys"),
      value: can("keys:read")
        ? keys$.isLoading
          ? loading
          : String(keys$.data?.keys.length ?? 0)
        : "-",
    },
    {
      help: t("admin.overview.permissionsHelp"),
      icon: "lucide:list-checks",
      label: t("admin.overview.permissions"),
      value: String(principal.permissions.length),
    },
  ];

  const capabilities: CapabilityGroup[] = [
    {
      icon: "lucide:cpu",
      label: t("admin.overview.workerOps"),
      permissions: ["workers:read", "workers:install", "workers:remove", "workers:restart"],
    },
    {
      icon: "lucide:puzzle",
      label: t("admin.overview.pluginOps"),
      permissions: ["plugins:read", "plugins:install", "plugins:remove", "plugins:config"],
    },
    {
      icon: "lucide:key-round",
      label: t("admin.overview.keyOps"),
      permissions: ["keys:read", "keys:create", "keys:revoke"],
    },
  ];

  return (
    <div className="grid gap-4 p-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {summary.map((item) => (
          <div className="border-border rounded-md border p-4" key={item.label}>
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Icon icon={item.icon} className="size-4" />
              <span>{item.label}</span>
            </div>
            <div className="mt-3 truncate text-lg font-semibold">{item.value}</div>
            {item.help && (
              <p className="text-muted-foreground mt-2 truncate text-xs">{item.help}</p>
            )}
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Section
          description={t("admin.overview.capabilitiesDescription")}
          title={t("admin.overview.capabilitiesTitle")}
        >
          <div className="divide-border divide-y">
            {capabilities.map((group) => (
              <div
                className="grid gap-3 py-3 first:pt-0 last:pb-0 md:grid-cols-[180px_minmax(0,1fr)]"
                key={group.label}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Icon className="text-muted-foreground size-4 shrink-0" icon={group.icon} />
                  <h3 className="truncate text-sm font-medium">{group.label}</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  {group.permissions.map((permission) => (
                    <span
                      className={cn(
                        "rounded px-2 py-1 text-xs",
                        can(permission)
                          ? "bg-emerald-500/10 text-emerald-700"
                          : "bg-secondary text-secondary-foreground",
                      )}
                      key={permission}
                    >
                      {permission}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>
        <Section title={t("admin.overview.sessionTitle")}>
          <div className="grid gap-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t("admin.overview.prefix")}</span>
              <span className="font-medium">{principal.keyPrefix}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t("admin.overview.scope")}</span>
              <span className="font-medium">
                {principal.isRoot ? t("admin.overview.fullAccess") : roleLabel}
              </span>
            </div>
            <div className="grid gap-2 pt-2">
              <div className="text-muted-foreground text-xs">
                {t("admin.overview.activePermissions")}
              </div>
              <div className="flex flex-wrap gap-2">
                {principal.permissions.map((permission) => (
                  <span
                    className="bg-secondary text-secondary-foreground rounded px-2 py-1 text-xs"
                    key={permission}
                  >
                    {permission}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
