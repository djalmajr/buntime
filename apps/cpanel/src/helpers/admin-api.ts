import type { PluginInfo } from "~/helpers/api-client";
import { runtimeFetch, runtimeJson } from "~/helpers/api-client";

export type ApiKeyRole = "admin" | "editor" | "viewer" | "custom";

export type PackageSource = "built-in" | "uploaded";

export type ApiPermission =
  | "apps:read"
  | "apps:install"
  | "apps:remove"
  | "plugins:read"
  | "plugins:install"
  | "plugins:remove"
  | "plugins:config"
  | "keys:read"
  | "keys:create"
  | "keys:revoke"
  | "workers:read"
  | "workers:restart";

export interface AdminPrincipal {
  id: number;
  isMaster?: boolean;
  keyPrefix: string;
  name: string;
  permissions: ApiPermission[];
  role: ApiKeyRole;
}

export interface AdminSession {
  authenticated: boolean;
  principal: AdminPrincipal;
}

export interface ApiKeyInfo {
  createdAt: number;
  createdBy?: number;
  description?: string;
  expiresAt?: number;
  id: number;
  keyPrefix: string;
  lastUsedAt?: number;
  name: string;
  permissions: ApiPermission[];
  role: ApiKeyRole;
}

export interface CreateApiKeyInput {
  description?: string;
  expiresIn?: string;
  name: string;
  permissions?: ApiPermission[];
  role: ApiKeyRole;
}

export interface CreateApiKeyResponse {
  data: {
    id: number;
    key: string;
    keyPrefix: string;
    name: string;
    role: ApiKeyRole;
  };
  success: boolean;
}

export interface ApiKeyMeta {
  permissions: ApiPermission[];
  roles: ApiKeyRole[];
}

export interface InstalledAppInfo {
  name: string;
  path: string;
  removable?: boolean;
  source?: PackageSource;
  versions: string[];
}

export interface InstalledPluginInfo {
  name: string;
  path: string;
  removable?: boolean;
  source?: PackageSource;
}

export interface UploadResponse {
  data: {
    app?: {
      installedAt: string;
      name: string;
      version: string;
    };
    plugin?: {
      installedAt: string;
      name: string;
      version: string;
    };
  };
  success: boolean;
}

export interface ReloadPluginsResponse {
  ok: boolean;
  plugins: Array<{ name: string; version?: string }>;
}

export function hasPermission(session: AdminSession | null, permission: ApiPermission): boolean {
  return session?.principal.permissions.includes(permission) ?? false;
}

export function getAdminSession(apiKey: string): Promise<AdminSession> {
  return runtimeJson<AdminSession>("/admin/session", { apiKey });
}

export function listApiKeys(apiKey: string): Promise<{ keys: ApiKeyInfo[] }> {
  return runtimeJson<{ keys: ApiKeyInfo[] }>("/keys", { apiKey });
}

export function getApiKeyMeta(apiKey: string): Promise<ApiKeyMeta> {
  return runtimeJson<ApiKeyMeta>("/keys/meta", { apiKey });
}

export function createApiKey(
  apiKey: string,
  input: CreateApiKeyInput,
): Promise<CreateApiKeyResponse> {
  return runtimeJson<CreateApiKeyResponse>("/keys", {
    apiKey,
    json: input,
    method: "POST",
  });
}

export async function revokeApiKey(apiKey: string, id: number): Promise<void> {
  await runtimeFetch(`/keys/${id}`, { apiKey, method: "DELETE" });
}

export function listApps(apiKey: string): Promise<InstalledAppInfo[]> {
  return runtimeJson<InstalledAppInfo[]>("/apps", { apiKey });
}

function appPathSegments(appName: string, version?: string): string {
  const segments = (values: Array<string | undefined>) =>
    values
      .filter((value): value is string => Boolean(value))
      .map(encodeURIComponent)
      .join("/");

  if (appName.startsWith("@")) {
    const [scope, name] = appName.split("/");
    return segments([scope, name, version]);
  }

  return segments(["_", appName, version]);
}

export function uploadApp(apiKey: string, file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  return runtimeJson<UploadResponse>("/apps/upload", {
    apiKey,
    body: form,
    method: "POST",
  });
}

export async function deleteApp(apiKey: string, appName: string): Promise<void> {
  await runtimeFetch(`/apps/${appPathSegments(appName)}`, { apiKey, method: "DELETE" });
}

export async function deleteAppVersion(
  apiKey: string,
  appName: string,
  version: string,
): Promise<void> {
  await runtimeFetch(`/apps/${appPathSegments(appName, version)}`, { apiKey, method: "DELETE" });
}

export function listInstalledPlugins(apiKey: string): Promise<InstalledPluginInfo[]> {
  return runtimeJson<InstalledPluginInfo[]>("/plugins", { apiKey });
}

export function listLoadedPlugins(apiKey: string): Promise<PluginInfo[]> {
  return runtimeJson<PluginInfo[]>("/plugins/loaded", { apiKey });
}

export function uploadPlugin(apiKey: string, file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  return runtimeJson<UploadResponse>("/plugins/upload", {
    apiKey,
    body: form,
    method: "POST",
  });
}

export function reloadPlugins(apiKey: string): Promise<ReloadPluginsResponse> {
  return runtimeJson<ReloadPluginsResponse>("/plugins/reload", {
    apiKey,
    method: "POST",
  });
}

export async function deletePlugin(apiKey: string, pluginName: string): Promise<void> {
  await runtimeFetch(`/plugins/${encodeURIComponent(pluginName)}`, {
    apiKey,
    method: "DELETE",
  });
}
