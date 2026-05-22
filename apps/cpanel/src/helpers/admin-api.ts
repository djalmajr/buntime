import type { PluginInfo } from "~/helpers/api-client";
import { runtimeFetch, runtimeJson } from "~/helpers/api-client";

export type ApiKeyRole = "admin" | "editor" | "viewer" | "custom";

export type PackageSource = "built-in" | "uploaded";

export type ApiPermission =
  | "workers:read"
  | "workers:install"
  | "workers:remove"
  | "workers:restart"
  | "plugins:read"
  | "plugins:install"
  | "plugins:remove"
  | "plugins:config"
  | "keys:read"
  | "keys:create"
  | "keys:revoke";

export interface AdminPrincipal {
  id: number;
  isRoot?: boolean;
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

export interface InstalledWorkerInfo {
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
    plugin?: {
      installedAt: string;
      name: string;
      version: string;
    };
    worker?: {
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

/**
 * Probe the current session. The HttpOnly `buntime_api_key` cookie is sent
 * automatically by the browser; returns the principal when authenticated,
 * throws `RuntimeApiError` (401) otherwise.
 */
export function getAdminSession(): Promise<AdminSession> {
  return runtimeJson<AdminSession>("/admin/session");
}

/**
 * Exchange an API key for an HttpOnly session cookie. The browser stores the
 * cookie; JavaScript never sees the key again after this call returns.
 */
export function loginAdminSession(apiKey: string): Promise<AdminSession> {
  return runtimeJson<AdminSession>("/admin/session", {
    json: { key: apiKey },
    method: "POST",
  });
}

/** Clear the session cookie. Idempotent — succeeds even if no cookie is set. */
export async function logoutAdminSession(): Promise<void> {
  await runtimeFetch("/admin/session", { method: "DELETE" });
}

export function listApiKeys(): Promise<{ keys: ApiKeyInfo[] }> {
  return runtimeJson<{ keys: ApiKeyInfo[] }>("/keys");
}

export function getApiKeyMeta(): Promise<ApiKeyMeta> {
  return runtimeJson<ApiKeyMeta>("/keys/meta");
}

export function createApiKey(input: CreateApiKeyInput): Promise<CreateApiKeyResponse> {
  return runtimeJson<CreateApiKeyResponse>("/keys", {
    json: input,
    method: "POST",
  });
}

export async function revokeApiKey(id: number): Promise<void> {
  await runtimeFetch(`/keys/${id}`, { method: "DELETE" });
}

export function listWorkers(): Promise<InstalledWorkerInfo[]> {
  return runtimeJson<InstalledWorkerInfo[]>("/workers");
}

function workerPathSegments(workerName: string, version?: string): string {
  const segments = (values: Array<string | undefined>) =>
    values
      .filter((value): value is string => Boolean(value))
      .map(encodeURIComponent)
      .join("/");

  if (workerName.startsWith("@")) {
    const [scope, name] = workerName.split("/");
    return segments([scope, name, version]);
  }

  return segments(["_", workerName, version]);
}

export function uploadWorker(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  return runtimeJson<UploadResponse>("/workers/upload", {
    body: form,
    method: "POST",
  });
}

export async function deleteWorker(workerName: string): Promise<void> {
  await runtimeFetch(`/workers/${workerPathSegments(workerName)}`, { method: "DELETE" });
}

export async function deleteWorkerVersion(workerName: string, version: string): Promise<void> {
  await runtimeFetch(`/workers/${workerPathSegments(workerName, version)}`, {
    method: "DELETE",
  });
}

export function listInstalledPlugins(): Promise<InstalledPluginInfo[]> {
  return runtimeJson<InstalledPluginInfo[]>("/plugins");
}

export function listLoadedPlugins(): Promise<PluginInfo[]> {
  return runtimeJson<PluginInfo[]>("/plugins/loaded");
}

export function uploadPlugin(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  return runtimeJson<UploadResponse>("/plugins/upload", {
    body: form,
    method: "POST",
  });
}

export function reloadPlugins(): Promise<ReloadPluginsResponse> {
  return runtimeJson<ReloadPluginsResponse>("/plugins/reload", {
    method: "POST",
  });
}

export async function deletePlugin(pluginName: string): Promise<void> {
  await runtimeFetch(`/plugins/${encodeURIComponent(pluginName)}`, {
    method: "DELETE",
  });
}
