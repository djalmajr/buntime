/**
 * Response shapes returned by the Buntime runtime management API. These mirror
 * the runtime route handlers in `apps/runtime/src/routes/*`.
 */

export interface WellKnown {
  api: string;
  version: string;
}

export interface HealthStatus {
  ok: boolean;
  status: string;
  version: string;
}

export interface Principal {
  id: number;
  name: string;
  keyPrefix: string;
  role: string;
  permissions: string[];
  namespaces: string[];
  isRoot?: boolean;
}

export interface SessionInfo {
  authenticated: boolean;
  principal?: Principal;
}

export type PackageSource = "built-in" | "uploaded";

export interface WorkerInfo {
  name: string;
  path: string;
  removable: boolean;
  source: PackageSource;
  versions: string[];
  disabledVersions?: string[];
}

export interface PluginInfo {
  name: string;
  path: string;
  removable: boolean;
  source: PackageSource;
}

export interface LoadedPlugin {
  name: string;
  base: string;
  menus?: unknown[];
  dependencies: string[];
  optionalDependencies: string[];
}

export interface ApiKeyInfo {
  id: number;
  keyPrefix: string;
  name: string;
  role: string;
  permissions: string[];
  namespaces: string[];
  createdAt: number;
  description?: string;
  expiresAt?: number;
  lastUsedAt?: number;
}

export interface KeysMeta {
  roles: string[];
  permissions: string[];
}

export interface CreateKeyInput {
  name: string;
  role?: string;
  permissions?: string[];
  namespaces?: string[];
  description?: string;
  expiresIn?: string;
}

export interface CreatedKey {
  id: number;
  key: string;
  keyPrefix: string;
  name: string;
  role: string;
}

/** Proxy redirect rule input (plugin-proxy admin). `id` set => update, else create. */
export interface ProxyRedirectInput {
  id?: string;
  name: string;
  pattern: string;
  target: string;
  rewrite?: string;
  changeOrigin?: boolean;
  secure?: boolean;
}
