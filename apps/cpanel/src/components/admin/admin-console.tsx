import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Icon } from "~/components/ui/icon";
import { Input } from "~/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  useSidebar,
} from "~/components/ui/sidebar";
import { useAdminAuth } from "~/contexts/admin-auth-context";
import type { ApiKeyInfo, ApiKeyRole, ApiPermission, PackageSource } from "~/helpers/admin-api";
import {
  createApiKey,
  deleteApp,
  deleteAppVersion,
  deletePlugin,
  getApiKeyMeta,
  listApiKeys,
  listApps,
  listInstalledPlugins,
  listLoadedPlugins,
  reloadPlugins,
  revokeApiKey,
  uploadApp,
  uploadPlugin,
} from "~/helpers/admin-api";
import { RuntimeApiError } from "~/helpers/api-client";
import type { UploadValidationResult } from "~/helpers/upload-validation";
import { validateUploadFile } from "~/helpers/upload-validation";
import { cn } from "~/utils/cn";

type AdminTab = "apps" | "keys" | "overview" | "plugins";

interface AdminTabItem {
  icon: string;
  id: AdminTab;
  label: string;
}

interface CapabilityGroup {
  icon: string;
  label: string;
  permissions: ApiPermission[];
}

interface OverviewMetric {
  help?: string;
  icon: string;
  label: string;
  value: string;
}

interface AdminPluginRow {
  aliases: string[];
  base?: string;
  dependencies: string[];
  installed: boolean;
  loaded: boolean;
  name: string;
  path?: string;
  removable: boolean;
  removeName?: string;
  source?: PackageSource;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof RuntimeApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unexpected error";
}

function formatTimestamp(value?: number): string {
  if (!value) return "-";
  return new Date(value * 1000).toLocaleString();
}

function getPluginIdentity(name: string): string {
  if (name.startsWith("@buntime/plugin-")) {
    return name.replace("@buntime/", "").toLowerCase();
  }

  return name.toLowerCase();
}

function SourceBadge({ source }: { source: PackageSource }) {
  const { t } = useTranslation();
  const label =
    source === "built-in" ? t("admin.common.builtIn") : t("admin.common.uploadedSource");

  return (
    <span
      className={cn(
        "rounded px-2 py-0.5 text-xs",
        source === "built-in"
          ? "bg-secondary text-secondary-foreground"
          : "bg-primary/10 text-primary",
      )}
    >
      {label}
    </span>
  );
}

function Section({
  actions,
  children,
  description,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <section className="border-border bg-background rounded-md border">
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          {description && <p className="text-muted-foreground mt-1 text-sm">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="border-border text-muted-foreground rounded-md border border-dashed px-4 py-8 text-center text-sm">
      {children}
    </div>
  );
}

function AdminSearchToolbar({
  actions,
  placeholder,
  search,
  onSearchChange,
}: {
  actions?: ReactNode;
  placeholder: string;
  search: string;
  onSearchChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative w-full max-w-lg">
        <Icon
          className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2"
          icon="lucide:search"
        />
        <Input
          className="pl-9"
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={placeholder}
          type="search"
          value={search}
        />
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

function ResourceTable({ children }: { children: ReactNode }) {
  return <section className="border-border overflow-hidden rounded-lg border">{children}</section>;
}

function UploadValidationPanel({
  validation,
  validating,
}: {
  validation: UploadValidationResult | null;
  validating: boolean;
}) {
  const { t } = useTranslation();

  if (validating) {
    return (
      <div className="border-border text-muted-foreground rounded-md border px-3 py-2 text-sm">
        {t("admin.uploadValidation.checking")}
      </div>
    );
  }

  if (!validation) return null;

  if (validation.errors.length === 0 && validation.warnings.length === 0) {
    return (
      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
        {t("admin.uploadValidation.valid", { count: validation.entries.length })}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        validation.errors.length > 0
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-amber-500/30 bg-amber-500/10 text-amber-700",
      )}
    >
      <ul className="grid gap-1">
        {validation.errors.map((issue) => (
          <li key={`error-${issue.code}`}>
            {t(`admin.uploadValidation.errors.${issue.code}`, issue.values)}
          </li>
        ))}
        {validation.warnings.map((issue) => (
          <li key={`warning-${issue.code}`}>
            {t(`admin.uploadValidation.warnings.${issue.code}`, issue.values)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function UploadArchiveSheet({
  file,
  open,
  title,
  uploadDisabled,
  validation,
  validating,
  onFileChange,
  onOpenChange,
  onSubmit,
}: {
  file: File | null;
  open: boolean;
  title: string;
  uploadDisabled: boolean;
  validation: UploadValidationResult | null;
  validating: boolean;
  onFileChange: (file: File | null) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className="gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{t("admin.common.uploadArchiveDescription")}</SheetDescription>
        </SheetHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <div className="grid flex-1 gap-3 overflow-y-auto p-4">
            <Input
              accept=".zip,.tgz,.tar.gz,application/zip,application/gzip"
              aria-invalid={validation ? !validation.ok : undefined}
              key={file?.name ?? "empty-admin-upload"}
              onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
              type="file"
            />
            <UploadValidationPanel validation={validation} validating={validating} />
          </div>
          <SheetFooter className="border-t">
            <Button disabled={uploadDisabled} type="submit">
              <Icon className="size-4" icon="lucide:upload" />
              {t("admin.common.upload")}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function AdminSidebarToggle({ className }: { className?: string }) {
  const { toggleSidebar } = useSidebar();

  return (
    <button
      className={cn(
        "hover:bg-sidebar-accent flex size-8 items-center justify-center rounded-md",
        className,
      )}
      onClick={toggleSidebar}
      type="button"
    >
      <Icon icon="lucide:panel-left" className="size-4" />
      <span className="sr-only">Toggle Sidebar</span>
    </button>
  );
}

function AdminCollapsedToggle() {
  const { toggleSidebar } = useSidebar();

  return (
    <SidebarMenuButton
      className="hidden group-data-[collapsible=icon]:flex"
      onClick={toggleSidebar}
      tooltip="Toggle Sidebar"
    >
      <Icon icon="lucide:panel-left" />
      <span className="sr-only">Toggle Sidebar</span>
    </SidebarMenuButton>
  );
}

function ApiKeyLogin() {
  const { t } = useTranslation();
  const { authenticate, status } = useAdminAuth();
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await authenticate(apiKey);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-background flex min-h-screen w-full items-center justify-center p-4">
      <form
        className="border-border bg-background w-full max-w-md rounded-md border p-5 shadow-sm"
        onSubmit={handleSubmit}
      >
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-md">
            <Icon icon="lucide:key-round" className="size-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold">{t("admin.login.title")}</h1>
            <p className="text-muted-foreground text-sm">{t("admin.login.description")}</p>
          </div>
        </div>

        <label className="mt-5 block text-sm font-medium" htmlFor="admin-api-key">
          {t("admin.login.apiKey")}
        </label>
        <Input
          autoComplete="off"
          className="mt-2"
          id="admin-api-key"
          onChange={(event) => setApiKey(event.target.value)}
          type="password"
          value={apiKey}
        />

        {error && (
          <div className="border-destructive/30 bg-destructive/10 text-destructive mt-3 rounded-md border px-3 py-2 text-sm">
            {error}
          </div>
        )}

        <Button className="mt-4 w-full" disabled={!apiKey.trim() || submitting} type="submit">
          {submitting || status === "checking" ? (
            <Icon icon="lucide:loader-circle" className="size-4 animate-spin" />
          ) : (
            <Icon icon="lucide:log-in" className="size-4" />
          )}
          {t("admin.login.submit")}
        </Button>
      </form>
    </div>
  );
}

function OverviewTab() {
  const { t } = useTranslation();
  const { apiKey, can, session } = useAdminAuth();
  const principal = session?.principal;

  const apps$ = useQuery({
    enabled: Boolean(apiKey && can("apps:read")),
    queryFn: () => listApps(apiKey!),
    queryKey: ["admin", "overview", "apps"],
  });

  const keys$ = useQuery({
    enabled: Boolean(apiKey && can("keys:read")),
    queryFn: () => listApiKeys(apiKey!),
    queryKey: ["admin", "overview", "keys"],
  });

  const installedPlugins$ = useQuery({
    enabled: Boolean(apiKey && can("plugins:read")),
    queryFn: () => listInstalledPlugins(apiKey!),
    queryKey: ["admin", "overview", "plugins", "installed"],
  });

  const loadedPlugins$ = useQuery({
    enabled: Boolean(apiKey && can("plugins:read")),
    queryFn: () => listLoadedPlugins(apiKey!),
    queryKey: ["admin", "overview", "plugins", "loaded"],
  });

  if (!principal) return null;

  const noAccess = t("admin.overview.noAccess");
  const loading = t("admin.common.loading");
  const roleLabel = t(`admin.roles.${principal.role}`);
  const summary: OverviewMetric[] = [
    {
      help: can("apps:read")
        ? t("admin.overview.appsHelp", { count: apps$.data?.length ?? 0 })
        : noAccess,
      icon: "lucide:boxes",
      label: t("admin.overview.apps"),
      value: can("apps:read") ? (apps$.isLoading ? loading : String(apps$.data?.length ?? 0)) : "-",
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
      icon: "lucide:boxes",
      label: t("admin.overview.deploymentOps"),
      permissions: ["apps:read", "apps:install", "apps:remove"],
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
    {
      icon: "lucide:cpu",
      label: t("admin.overview.workerOps"),
      permissions: ["workers:read", "workers:restart"],
    },
  ];

  return (
    <div className="grid gap-4">
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
                {principal.isMaster ? t("admin.overview.fullAccess") : roleLabel}
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

function ApiKeysTable({
  canRevoke,
  currentKeyId,
  keys,
  revoking,
  onRevoke,
}: {
  canRevoke: boolean;
  currentKeyId?: number;
  keys: ApiKeyInfo[];
  revoking: boolean;
  onRevoke: (id: number) => void;
}) {
  const { t } = useTranslation();

  return (
    <ResourceTable>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px]">
          <thead>
            <tr className="bg-muted/50 border-b">
              <th className="p-3 text-left text-sm font-medium">{t("admin.keys.name")}</th>
              <th className="p-3 text-left text-sm font-medium">{t("admin.keys.role")}</th>
              <th className="p-3 text-left text-sm font-medium">{t("admin.keys.prefixColumn")}</th>
              <th className="p-3 text-left text-sm font-medium">
                {t("admin.keys.lastUsedColumn")}
              </th>
              <th className="p-3 text-left text-sm font-medium">{t("admin.keys.createdColumn")}</th>
              <th className="p-3 text-left text-sm font-medium">{t("admin.keys.expiresColumn")}</th>
              <th className="w-16 p-3">
                <span className="sr-only">{t("admin.keys.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => {
              const isCurrent = key.id === currentKeyId;

              return (
                <tr className="hover:bg-muted/50 border-b transition-colors" key={key.id}>
                  <td className="p-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <Icon
                        className="text-muted-foreground size-4 shrink-0"
                        icon="lucide:key-round"
                      />
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-medium">{key.name}</span>
                          {isCurrent && (
                            <span className="bg-primary/10 text-primary shrink-0 rounded px-2 py-0.5 text-xs">
                              {t("admin.keys.current")}
                            </span>
                          )}
                        </div>
                        {key.description && (
                          <p className="text-muted-foreground mt-1 truncate text-xs">
                            {key.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="p-3">
                    <span className="bg-secondary text-secondary-foreground rounded px-2 py-0.5 text-xs">
                      {t(`admin.roles.${key.role}`)}
                    </span>
                  </td>
                  <td className="text-muted-foreground p-3 font-mono text-xs">{key.keyPrefix}</td>
                  <td className="text-muted-foreground p-3 text-sm">
                    {formatTimestamp(key.lastUsedAt)}
                  </td>
                  <td className="text-muted-foreground p-3 text-sm">
                    {formatTimestamp(key.createdAt)}
                  </td>
                  <td className="text-muted-foreground p-3 text-sm">
                    {formatTimestamp(key.expiresAt)}
                  </td>
                  <td className="p-3 text-right">
                    {canRevoke && (
                      <Button
                        className="size-7"
                        disabled={isCurrent || revoking}
                        onClick={() => onRevoke(key.id)}
                        size="icon"
                        title={t("admin.keys.revoke")}
                        type="button"
                        variant="ghost"
                      >
                        <Icon icon="lucide:ban" className="size-4" />
                        <span className="sr-only">{t("admin.keys.revoke")}</span>
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </ResourceTable>
  );
}

function KeysTab({
  createOpen,
  onCreateOpenChange,
}: {
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { apiKey, can, session } = useAdminAuth();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [expiresIn, setExpiresIn] = useState("1y");
  const [role, setRole] = useState<ApiKeyRole>("editor");
  const [permissions, setPermissions] = useState<ApiPermission[]>([]);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const keys$ = useQuery({
    enabled: Boolean(apiKey && can("keys:read")),
    queryFn: () => listApiKeys(apiKey!),
    queryKey: ["admin", "keys"],
  });

  const meta$ = useQuery({
    enabled: Boolean(apiKey && can("keys:create")),
    queryFn: () => getApiKeyMeta(apiKey!),
    queryKey: ["admin", "keys", "meta"],
  });

  const create$ = useMutation({
    mutationFn: () =>
      createApiKey(apiKey!, {
        description: description.trim() || undefined,
        expiresIn,
        name: name.trim(),
        permissions: role === "custom" ? permissions : undefined,
        role,
      }),
    onSuccess: (result) => {
      setCreatedKey(result.data.key);
      setName("");
      setDescription("");
      setPermissions([]);
      setRole("editor");
      queryClient.invalidateQueries({ queryKey: ["admin", "keys"] });
      toast.success(t("admin.keys.created"));
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const revoke$ = useMutation({
    mutationFn: (id: number) => revokeApiKey(apiKey!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "keys"] });
      toast.success(t("admin.keys.revoked"));
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  useEffect(() => {
    if (createOpen) setCreatedKey(null);
  }, [createOpen]);

  const togglePermission = (permission: ApiPermission) => {
    setPermissions((current) =>
      current.includes(permission)
        ? current.filter((candidate) => candidate !== permission)
        : [...current, permission],
    );
  };

  const handleCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    create$.mutate();
  };

  return (
    <div className="grid gap-4">
      {keys$.isLoading ? (
        <EmptyState>{t("admin.common.loading")}</EmptyState>
      ) : !keys$.data?.keys.length ? (
        <EmptyState>{t("admin.keys.empty")}</EmptyState>
      ) : (
        <ApiKeysTable
          canRevoke={can("keys:revoke")}
          currentKeyId={session?.principal.id}
          keys={keys$.data.keys}
          revoking={revoke$.isPending}
          onRevoke={(id) => revoke$.mutate(id)}
        />
      )}

      {can("keys:create") && (
        <Sheet onOpenChange={onCreateOpenChange} open={createOpen}>
          <SheetContent className="gap-0 p-0 sm:max-w-md">
            <SheetHeader className="border-b px-4 py-3">
              <SheetTitle>{t("admin.keys.createTitle")}</SheetTitle>
              <SheetDescription>{t("admin.keys.createDescription")}</SheetDescription>
            </SheetHeader>
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleCreate}>
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
                <div>
                  <label className="text-sm font-medium" htmlFor="key-name">
                    {t("admin.keys.name")}
                  </label>
                  <Input
                    className="mt-1"
                    id="key-name"
                    onChange={(event) => setName(event.target.value)}
                    value={name}
                  />
                </div>

                <div>
                  <label className="text-sm font-medium" htmlFor="key-description">
                    {t("admin.keys.description")}
                  </label>
                  <Input
                    className="mt-1"
                    id="key-description"
                    onChange={(event) => setDescription(event.target.value)}
                    value={description}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium" htmlFor="key-role">
                      {t("admin.keys.role")}
                    </label>
                    <select
                      className="border-input bg-background mt-1 h-9 w-full rounded-md border px-3 text-sm"
                      id="key-role"
                      onChange={(event) => setRole(event.target.value as ApiKeyRole)}
                      value={role}
                    >
                      {(meta$.data?.roles ?? ["admin", "editor", "viewer", "custom"]).map(
                        (item) => (
                          <option key={item} value={item}>
                            {t(`admin.roles.${item}`)}
                          </option>
                        ),
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="text-sm font-medium" htmlFor="key-expires">
                      {t("admin.keys.expiresIn")}
                    </label>
                    <select
                      className="border-input bg-background mt-1 h-9 w-full rounded-md border px-3 text-sm"
                      id="key-expires"
                      onChange={(event) => setExpiresIn(event.target.value)}
                      value={expiresIn}
                    >
                      {["30d", "90d", "1y", "never"].map((item) => (
                        <option key={item} value={item}>
                          {t(`admin.keys.expiration.${item}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {role === "custom" && (
                  <div className="grid gap-2">
                    <div className="text-sm font-medium">{t("admin.keys.permissions")}</div>
                    <div className="grid gap-2">
                      {(meta$.data?.permissions ?? []).map((permission) => (
                        <label
                          className="border-border flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                          key={permission}
                        >
                          <input
                            checked={permissions.includes(permission)}
                            onChange={() => togglePermission(permission)}
                            type="checkbox"
                          />
                          <span className="break-all">{permission}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {createdKey && (
                  <div className="border-primary/30 bg-primary/5 rounded-md border p-3">
                    <label className="text-sm font-medium" htmlFor="created-key">
                      {t("admin.keys.createdSecret")}
                    </label>
                    <div className="mt-2 flex gap-2">
                      <Input id="created-key" readOnly value={createdKey} />
                      <Button
                        onClick={() => {
                          navigator.clipboard.writeText(createdKey);
                          toast.success(t("admin.common.copied"));
                        }}
                        size="icon"
                        type="button"
                        variant="outline"
                      >
                        <Icon icon="lucide:copy" className="size-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <SheetFooter className="border-t">
                <Button disabled={!name.trim() || create$.isPending} type="submit">
                  <Icon icon="lucide:plus" className="size-4" />
                  {t("admin.keys.create")}
                </Button>
              </SheetFooter>
            </form>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

function AppsTab({
  uploadOpen,
  onUploadOpenChange,
}: {
  uploadOpen: boolean;
  onUploadOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { apiKey, can } = useAdminAuth();
  const [file, setFile] = useState<File | null>(null);
  const [search, setSearch] = useState("");
  const [validation, setValidation] = useState<UploadValidationResult | null>(null);
  const [validating, setValidating] = useState(false);

  const apps$ = useQuery({
    enabled: Boolean(apiKey && can("apps:read")),
    queryFn: () => listApps(apiKey!),
    queryKey: ["admin", "apps"],
  });

  const upload$ = useMutation({
    mutationFn: () => uploadApp(apiKey!, file!),
    onSuccess: () => {
      setFile(null);
      onUploadOpenChange(false);
      queryClient.invalidateQueries({ queryKey: ["admin", "apps"] });
      toast.success(t("admin.apps.uploaded"));
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const deleteApp$ = useMutation({
    mutationFn: (name: string) => deleteApp(apiKey!, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "apps"] });
      toast.success(t("admin.apps.removed"));
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const deleteVersion$ = useMutation({
    mutationFn: ({ name, version }: { name: string; version: string }) =>
      deleteAppVersion(apiKey!, name, version),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "apps"] });
      toast.success(t("admin.apps.versionRemoved"));
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  useEffect(() => {
    if (uploadOpen) setFile(null);
  }, [uploadOpen]);

  useEffect(() => {
    let active = true;
    setValidation(null);

    if (!file) {
      setValidating(false);
      return;
    }

    setValidating(true);
    validateUploadFile(file, "app")
      .then((result) => {
        if (!active) return;
        setValidation(result);
      })
      .catch((error) => {
        if (!active) return;
        setValidation({
          archiveType: "unknown",
          entries: [],
          errors: [{ code: "zipUnreadable" }],
          ok: false,
          warnings: [],
        });
        toast.error(getErrorMessage(error));
      })
      .finally(() => {
        if (!active) return;
        setValidating(false);
      });

    return () => {
      active = false;
    };
  }, [file]);

  const filteredApps = useMemo(() => {
    const term = search.trim().toLowerCase();
    const apps = apps$.data ?? [];

    if (!term) return apps;

    return apps.filter((app) => {
      const sourceLabel =
        app.source === "built-in"
          ? t("admin.common.builtIn")
          : app.source === "uploaded"
            ? t("admin.common.uploadedSource")
            : "";

      return [app.name, app.path, sourceLabel, ...app.versions].some((value) =>
        value.toLowerCase().includes(term),
      );
    });
  }, [apps$.data, search, t]);

  return (
    <div className="grid gap-4">
      <AdminSearchToolbar
        onSearchChange={setSearch}
        placeholder={t("admin.apps.searchPlaceholder")}
        search={search}
      />
      <ResourceTable>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px]">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="p-3 text-left text-sm font-medium">{t("admin.apps.nameColumn")}</th>
                <th className="p-3 text-left text-sm font-medium">
                  {t("admin.apps.versionsColumn")}
                </th>
                <th className="p-3 text-left text-sm font-medium">
                  {t("admin.apps.sourceColumn")}
                </th>
                <th className="p-3 text-left text-sm font-medium">{t("admin.apps.pathColumn")}</th>
                <th className="w-16 p-3">
                  <span className="sr-only">{t("admin.keys.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {apps$.isLoading ? (
                <tr>
                  <td className="p-8 text-center text-muted-foreground" colSpan={5}>
                    {t("admin.common.loading")}
                  </td>
                </tr>
              ) : !apps$.data?.length ? (
                <tr>
                  <td className="p-8 text-center text-muted-foreground" colSpan={5}>
                    {t("admin.apps.empty")}
                  </td>
                </tr>
              ) : filteredApps.length === 0 ? (
                <tr>
                  <td className="p-8 text-center text-muted-foreground" colSpan={5}>
                    {t("admin.common.noSearchResults", { term: search })}
                  </td>
                </tr>
              ) : (
                filteredApps.map((app) => (
                  <tr className="hover:bg-muted/50 border-b transition-colors" key={app.name}>
                    <td className="p-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <Icon
                          className="text-muted-foreground size-4 shrink-0"
                          icon="lucide:folder"
                        />
                        <span className="truncate font-medium">{app.name}</span>
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-2">
                        {app.versions.length > 0 ? (
                          app.versions.map((version) => (
                            <span
                              className="border-border inline-flex items-center gap-2 rounded-md border px-2 py-1 text-xs"
                              key={version}
                            >
                              {version}
                              {can("apps:remove") && app.removable && (
                                <button
                                  className="text-muted-foreground hover:text-destructive"
                                  disabled={deleteVersion$.isPending}
                                  onClick={() => deleteVersion$.mutate({ name: app.name, version })}
                                  type="button"
                                >
                                  <Icon className="size-3" icon="lucide:x" />
                                  <span className="sr-only">
                                    {t("admin.apps.removeVersion", { version })}
                                  </span>
                                </button>
                              )}
                            </span>
                          ))
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </div>
                    </td>
                    <td className="p-3">
                      {app.source ? (
                        <SourceBadge source={app.source} />
                      ) : (
                        <span className="text-muted-foreground text-sm">-</span>
                      )}
                    </td>
                    <td className="text-muted-foreground max-w-96 truncate p-3 text-sm">
                      {app.path}
                    </td>
                    <td className="p-3 text-right">
                      {can("apps:remove") && app.removable && (
                        <Button
                          className="size-7"
                          disabled={deleteApp$.isPending}
                          onClick={() => deleteApp$.mutate(app.name)}
                          size="icon"
                          title={t("admin.common.remove")}
                          type="button"
                          variant="ghost"
                        >
                          <Icon className="size-4" icon="lucide:trash-2" />
                          <span className="sr-only">{t("admin.common.remove")}</span>
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </ResourceTable>
      {can("apps:install") && (
        <UploadArchiveSheet
          file={file}
          onFileChange={setFile}
          onOpenChange={onUploadOpenChange}
          onSubmit={() => upload$.mutate()}
          open={uploadOpen}
          title={t("admin.apps.uploadTitle")}
          uploadDisabled={!file || validating || !validation?.ok || upload$.isPending}
          validating={validating}
          validation={validation}
        />
      )}
    </div>
  );
}

function PluginsTab({
  uploadOpen,
  onUploadOpenChange,
}: {
  uploadOpen: boolean;
  onUploadOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { apiKey, can } = useAdminAuth();
  const [file, setFile] = useState<File | null>(null);
  const [search, setSearch] = useState("");
  const [validation, setValidation] = useState<UploadValidationResult | null>(null);
  const [validating, setValidating] = useState(false);

  const installed$ = useQuery({
    enabled: Boolean(apiKey && can("plugins:read")),
    queryFn: () => listInstalledPlugins(apiKey!),
    queryKey: ["admin", "plugins", "installed"],
  });

  const loaded$ = useQuery({
    enabled: Boolean(apiKey && can("plugins:read")),
    queryFn: () => listLoadedPlugins(apiKey!),
    queryKey: ["admin", "plugins", "loaded"],
  });

  const reload$ = useMutation({
    mutationFn: () => reloadPlugins(apiKey!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "plugins"] });
      queryClient.invalidateQueries({ queryKey: ["plugins"] });
      toast.success(t("admin.plugins.reloaded"));
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const upload$ = useMutation({
    mutationFn: async () => {
      await uploadPlugin(apiKey!, file!);
      await reloadPlugins(apiKey!);
    },
    onSuccess: () => {
      setFile(null);
      onUploadOpenChange(false);
      queryClient.invalidateQueries({ queryKey: ["admin", "plugins"] });
      queryClient.invalidateQueries({ queryKey: ["plugins"] });
      toast.success(t("admin.plugins.uploaded"));
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const delete$ = useMutation({
    mutationFn: async (name: string) => {
      await deletePlugin(apiKey!, name);
      await reloadPlugins(apiKey!);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "plugins"] });
      queryClient.invalidateQueries({ queryKey: ["plugins"] });
      toast.success(t("admin.plugins.removed"));
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  useEffect(() => {
    if (uploadOpen) setFile(null);
  }, [uploadOpen]);

  useEffect(() => {
    let active = true;
    setValidation(null);

    if (!file) {
      setValidating(false);
      return;
    }

    setValidating(true);
    validateUploadFile(file, "plugin")
      .then((result) => {
        if (!active) return;
        setValidation(result);
      })
      .catch((error) => {
        if (!active) return;
        setValidation({
          archiveType: "unknown",
          entries: [],
          errors: [{ code: "zipUnreadable" }],
          ok: false,
          warnings: [],
        });
        toast.error(getErrorMessage(error));
      })
      .finally(() => {
        if (!active) return;
        setValidating(false);
      });

    return () => {
      active = false;
    };
  }, [file]);

  const pluginRows = useMemo<AdminPluginRow[]>(() => {
    const loadedByName = new Map((loaded$.data ?? []).map((plugin) => [plugin.name, plugin]));
    const loadedByIdentity = new Map(
      (loaded$.data ?? []).map((plugin) => [getPluginIdentity(plugin.name), plugin]),
    );
    const installedRows = (installed$.data ?? []).map((plugin) => {
      const loaded =
        loadedByName.get(plugin.name) ?? loadedByIdentity.get(getPluginIdentity(plugin.name));

      return {
        aliases:
          loaded?.name && loaded.name !== plugin.name ? [plugin.name, loaded.name] : [plugin.name],
        base: loaded?.base,
        dependencies: loaded?.dependencies ?? [],
        installed: true,
        loaded: Boolean(loaded),
        name: loaded?.name ?? plugin.name,
        path: plugin.path,
        removable: Boolean(plugin.removable),
        removeName: plugin.name,
        source: plugin.source,
      };
    });
    const installedNames = new Set(
      installedRows.flatMap((plugin) => plugin.aliases.map(getPluginIdentity)),
    );
    const loadedOnlyRows = (loaded$.data ?? [])
      .filter((plugin) => !installedNames.has(getPluginIdentity(plugin.name)))
      .map((plugin) => ({
        aliases: [plugin.name],
        base: plugin.base,
        dependencies: plugin.dependencies,
        installed: false,
        loaded: true,
        name: plugin.name,
        removable: false,
      }));

    return [...installedRows, ...loadedOnlyRows].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }, [installed$.data, loaded$.data]);

  const filteredPlugins = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) return pluginRows;

    return pluginRows.filter((plugin) => {
      const sourceLabel =
        plugin.source === "built-in"
          ? t("admin.common.builtIn")
          : plugin.source === "uploaded"
            ? t("admin.common.uploadedSource")
            : "";

      return [
        plugin.name,
        plugin.path ?? "",
        plugin.base ?? "",
        sourceLabel,
        plugin.loaded
          ? t("admin.plugins.loadedStatus")
          : plugin.installed
            ? t("admin.plugins.installedStatus")
            : "",
        ...plugin.aliases,
        ...plugin.dependencies,
      ].some((value) => value.toLowerCase().includes(term));
    });
  }, [pluginRows, search, t]);

  return (
    <div className="grid gap-4">
      <AdminSearchToolbar
        actions={
          can("plugins:install") && (
            <Button
              disabled={reload$.isPending}
              onClick={() => reload$.mutate()}
              size="icon-sm"
              title={t("admin.plugins.reload")}
              type="button"
              variant="outline"
            >
              <Icon
                className={cn("size-4", reload$.isPending && "animate-spin")}
                icon="lucide:refresh-cw"
              />
              <span className="sr-only">{t("admin.plugins.reload")}</span>
            </Button>
          )
        }
        onSearchChange={setSearch}
        placeholder={t("admin.plugins.searchPlaceholder")}
        search={search}
      />
      <ResourceTable>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px]">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="p-3 text-left text-sm font-medium">
                  {t("admin.plugins.nameColumn")}
                </th>
                <th className="p-3 text-left text-sm font-medium">
                  {t("admin.plugins.baseColumn")}
                </th>
                <th className="p-3 text-left text-sm font-medium">
                  {t("admin.plugins.statusColumn")}
                </th>
                <th className="p-3 text-left text-sm font-medium">
                  {t("admin.plugins.sourceColumn")}
                </th>
                <th className="p-3 text-left text-sm font-medium">
                  {t("admin.plugins.pathColumn")}
                </th>
                <th className="w-16 p-3">
                  <span className="sr-only">{t("admin.keys.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {installed$.isLoading || loaded$.isLoading ? (
                <tr>
                  <td className="p-8 text-center text-muted-foreground" colSpan={6}>
                    {t("admin.common.loading")}
                  </td>
                </tr>
              ) : pluginRows.length === 0 ? (
                <tr>
                  <td className="p-8 text-center text-muted-foreground" colSpan={6}>
                    {t("admin.plugins.empty")}
                  </td>
                </tr>
              ) : filteredPlugins.length === 0 ? (
                <tr>
                  <td className="p-8 text-center text-muted-foreground" colSpan={6}>
                    {t("admin.common.noSearchResults", { term: search })}
                  </td>
                </tr>
              ) : (
                filteredPlugins.map((plugin) => (
                  <tr className="hover:bg-muted/50 border-b transition-colors" key={plugin.name}>
                    <td className="p-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <Icon
                          className="text-muted-foreground size-4 shrink-0"
                          icon="lucide:puzzle"
                        />
                        <div className="min-w-0">
                          <div className="truncate font-medium">{plugin.name}</div>
                          {plugin.dependencies.length > 0 && (
                            <p className="text-muted-foreground mt-1 truncate text-xs">
                              {t("admin.plugins.dependencies", {
                                value: plugin.dependencies.join(", "),
                              })}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="text-muted-foreground p-3 text-sm">{plugin.base ?? "-"}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-2">
                        {plugin.loaded ? (
                          <span className="bg-primary/10 text-primary rounded px-2 py-0.5 text-xs">
                            {t("admin.plugins.loadedStatus")}
                          </span>
                        ) : plugin.installed ? (
                          <span className="bg-secondary text-secondary-foreground rounded px-2 py-0.5 text-xs">
                            {t("admin.plugins.installedStatus")}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </div>
                    </td>
                    <td className="p-3">
                      {plugin.source ? (
                        <SourceBadge source={plugin.source} />
                      ) : (
                        <span className="text-muted-foreground text-sm">-</span>
                      )}
                    </td>
                    <td className="text-muted-foreground max-w-96 truncate p-3 text-sm">
                      {plugin.path ?? "-"}
                    </td>
                    <td className="p-3 text-right">
                      {can("plugins:remove") && plugin.installed && plugin.removable && (
                        <Button
                          className="size-7"
                          disabled={delete$.isPending}
                          onClick={() => delete$.mutate(plugin.removeName ?? plugin.name)}
                          size="icon"
                          title={t("admin.common.remove")}
                          type="button"
                          variant="ghost"
                        >
                          <Icon className="size-4" icon="lucide:trash-2" />
                          <span className="sr-only">{t("admin.common.remove")}</span>
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </ResourceTable>
      {can("plugins:install") && (
        <UploadArchiveSheet
          file={file}
          onFileChange={setFile}
          onOpenChange={onUploadOpenChange}
          onSubmit={() => upload$.mutate()}
          open={uploadOpen}
          title={t("admin.plugins.uploadTitle")}
          uploadDisabled={!file || validating || !validation?.ok || upload$.isPending}
          validating={validating}
          validation={validation}
        />
      )}
    </div>
  );
}

function AdminSidebar({
  onLogout,
  onSelectTab,
  tabs,
  tab,
}: {
  onLogout: () => void;
  onSelectTab: (tab: AdminTab) => void;
  tab: AdminTab;
  tabs: AdminTabItem[];
}) {
  const { t } = useTranslation();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center gap-2 group-data-[collapsible=icon]:hidden">
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{t("admin.shell.name")}</span>
                <span className="truncate text-xs">{t("admin.shell.description")}</span>
              </div>
              <AdminSidebarToggle />
            </div>
            <AdminCollapsedToggle />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="pb-0">
        <SidebarMenu>
          {tabs.map((item) => (
            <SidebarMenuItem key={item.id}>
              <SidebarMenuButton
                isActive={tab === item.id}
                onClick={() => onSelectTab(item.id)}
                tooltip={item.label}
              >
                <Icon icon={item.icon} />
                <span>{item.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip={t("admin.shell.backToCpanel")}>
              <a href="./">
                <Icon icon="lucide:terminal" />
                <span>{t("admin.shell.backToCpanel")}</span>
                <Icon className="ml-auto size-4" icon="lucide:chevron-right" />
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={onLogout} tooltip={t("admin.common.exit")}>
              <Icon icon="lucide:log-out" />
              <span>{t("admin.common.exit")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}

function AdminHeader({
  actions,
  activeTab,
  tabs,
}: {
  actions?: ReactNode;
  activeTab: AdminTab;
  tabs: AdminTabItem[];
}) {
  const { t } = useTranslation();
  const currentTab = tabs.find((item) => item.id === activeTab);

  return (
    <header className="border-b px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <AdminSidebarToggle className="shrink-0 md:hidden" />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2 text-lg font-semibold leading-none">
              {currentTab && <Icon icon={currentTab.icon} className="size-4 shrink-0" />}
              <span className="truncate">{currentTab?.label ?? t("admin.header.title")}</span>
            </div>
            <p className="text-muted-foreground mt-1 truncate text-sm">
              {t("admin.header.description")}
            </p>
          </div>
        </div>

        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

function AuthenticatedAdminConsole() {
  const { t } = useTranslation();
  const { can, logout } = useAdminAuth();
  const [tab, setTab] = useState<AdminTab>("overview");
  const [appUploadOpen, setAppUploadOpen] = useState(false);
  const [keyCreateOpen, setKeyCreateOpen] = useState(false);
  const [pluginUploadOpen, setPluginUploadOpen] = useState(false);

  const tabs = useMemo(
    () =>
      [
        { icon: "lucide:gauge", id: "overview" as const, label: t("admin.tabs.overview") },
        can("keys:read") && {
          icon: "lucide:key-round",
          id: "keys" as const,
          label: t("admin.tabs.keys"),
        },
        can("apps:read") && {
          icon: "lucide:boxes",
          id: "apps" as const,
          label: t("admin.tabs.apps"),
        },
        can("plugins:read") && {
          icon: "lucide:puzzle",
          id: "plugins" as const,
          label: t("admin.tabs.plugins"),
        },
      ].filter(Boolean) as AdminTabItem[],
    [can, t],
  );

  const headerActions = useMemo(() => {
    if (tab === "keys" && can("keys:create")) {
      return (
        <Button onClick={() => setKeyCreateOpen(true)} size="sm" type="button">
          <Icon className="size-4" icon="lucide:plus" />
          {t("admin.keys.createTitle")}
        </Button>
      );
    }

    if (tab === "apps" && can("apps:install")) {
      return (
        <Button onClick={() => setAppUploadOpen(true)} size="sm" type="button">
          <Icon className="size-4" icon="lucide:file-up" />
          {t("admin.apps.uploadTitle")}
        </Button>
      );
    }

    if (tab === "plugins" && can("plugins:install")) {
      return (
        <Button onClick={() => setPluginUploadOpen(true)} size="sm" type="button">
          <Icon className="size-4" icon="lucide:file-up" />
          {t("admin.plugins.uploadTitle")}
        </Button>
      );
    }

    return null;
  }, [can, t, tab]);

  useEffect(() => {
    if (!tabs.some((item) => item.id === tab)) {
      setTab(tabs[0]?.id ?? "overview");
    }
  }, [tab, tabs]);

  useEffect(() => {
    if (tab !== "apps") setAppUploadOpen(false);
    if (tab !== "keys") setKeyCreateOpen(false);
    if (tab !== "plugins") setPluginUploadOpen(false);
  }, [tab]);

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full overflow-hidden">
        <AdminSidebar onLogout={logout} onSelectTab={setTab} tab={tab} tabs={tabs} />
        <SidebarInset className="flex flex-col overflow-hidden">
          <AdminHeader actions={headerActions} activeTab={tab} tabs={tabs} />
          <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4">
            {tab === "overview" && <OverviewTab />}
            {tab === "keys" && (
              <KeysTab createOpen={keyCreateOpen} onCreateOpenChange={setKeyCreateOpen} />
            )}
            {tab === "apps" && (
              <AppsTab onUploadOpenChange={setAppUploadOpen} uploadOpen={appUploadOpen} />
            )}
            {tab === "plugins" && (
              <PluginsTab onUploadOpenChange={setPluginUploadOpen} uploadOpen={pluginUploadOpen} />
            )}
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}

export function AdminConsole() {
  const { t } = useTranslation();
  const { status } = useAdminAuth();

  if (status === "checking") {
    return (
      <div className="bg-background flex min-h-screen w-full items-center justify-center">
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Icon icon="lucide:loader-circle" className="size-4 animate-spin" />
          {t("admin.common.loading")}
        </div>
      </div>
    );
  }

  if (status !== "authenticated") {
    return <ApiKeyLogin />;
  }

  return <AuthenticatedAdminConsole />;
}
