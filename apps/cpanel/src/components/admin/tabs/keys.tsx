import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
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
import { useApiKey } from "~/contexts/api-key-auth-context";
import type { ApiKeyInfo, ApiKeyRole, ApiPermission } from "~/helpers/admin-api";
import { createApiKey, getApiKeyMeta, listApiKeys, revokeApiKey } from "~/helpers/admin-api";
import { EmptyState, formatTimestamp, getErrorMessage, ResourceTable } from "../shared";

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
              <th className="p-3 text-left text-sm font-medium">
                {t("admin.keys.namespacesColumn")}
              </th>
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
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      {(key.namespaces ?? ["*"]).map((ns) => (
                        <span
                          className="bg-muted text-muted-foreground rounded px-2 py-0.5 font-mono text-xs"
                          key={ns}
                        >
                          {ns}
                        </span>
                      ))}
                    </div>
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

export function KeysTab({
  createOpen,
  onCreateOpenChange,
}: {
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { can, session } = useApiKey();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [expiresIn, setExpiresIn] = useState("1y");
  const [role, setRole] = useState<ApiKeyRole>("editor");
  const [permissions, setPermissions] = useState<ApiPermission[]>([]);
  const [namespaces, setNamespaces] = useState("*");
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const keys$ = useQuery({
    enabled: Boolean(session && can("keys:read")),
    queryFn: () => listApiKeys(),
    queryKey: ["admin", "keys"],
  });

  const meta$ = useQuery({
    enabled: Boolean(session && can("keys:create")),
    queryFn: () => getApiKeyMeta(),
    queryKey: ["admin", "keys", "meta"],
  });

  const create$ = useMutation({
    mutationFn: () => {
      const parsedNamespaces = namespaces
        .split(/[\s,]+/)
        .map((value) => value.trim())
        .filter(Boolean);
      return createApiKey({
        description: description.trim() || undefined,
        expiresIn,
        name: name.trim(),
        namespaces: parsedNamespaces.length ? parsedNamespaces : ["*"],
        permissions: role === "custom" ? permissions : undefined,
        role,
      });
    },
    onSuccess: (result) => {
      setCreatedKey(result.data.key);
      setName("");
      setDescription("");
      setPermissions([]);
      setNamespaces("*");
      setRole("editor");
      queryClient.invalidateQueries({ queryKey: ["admin", "keys"] });
      toast.success(t("admin.keys.created"));
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const revoke$ = useMutation({
    mutationFn: (id: number) => revokeApiKey(id),
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
    <div className="grid gap-4 p-4">
      {can("keys:create") && (
        <div className="flex items-center justify-end">
          <Button onClick={() => onCreateOpenChange(true)} size="sm" type="button">
            <Icon className="size-4" icon="lucide:plus" />
            {t("admin.keys.createTitle")}
          </Button>
        </div>
      )}
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

                <div>
                  <label className="text-sm font-medium" htmlFor="key-namespaces">
                    {t("admin.keys.namespaces")}
                  </label>
                  <Input
                    className="mt-1"
                    id="key-namespaces"
                    onChange={(event) => setNamespaces(event.target.value)}
                    placeholder="*"
                    value={namespaces}
                  />
                  <p className="text-muted-foreground mt-1 text-xs">
                    {t("admin.keys.namespacesHint")}
                  </p>
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
