// Simple API client for fetching plugin information

export interface MenuItemInfo {
  icon: string;
  items?: MenuItemInfo[];
  path: string;
  title: string;
}

export interface PluginInfo {
  base?: string;
  dependencies: string[];
  menus?: MenuItemInfo[];
  name: string;
  optionalDependencies: string[];
}

/**
 * Runtime configuration from /.well-known/buntime
 */
export interface RuntimeConfig {
  api: string;
  version: string;
}

/** Cached runtime config */
let runtimeConfig: RuntimeConfig | null = null;

/**
 * Fetch runtime configuration from well-known endpoint.
 * Caches the result for subsequent calls.
 */
export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  if (runtimeConfig) return runtimeConfig;
  const res = await fetch("/.well-known/buntime");
  const config: RuntimeConfig = await res.json();
  runtimeConfig = config;
  return config;
}

export class RuntimeApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "RuntimeApiError";
  }
}

export interface RuntimeRequestOptions extends RequestInit {
  apiKey?: string;
  json?: unknown;
}

export async function getRuntimeApiUrl(path: string): Promise<string> {
  const { api } = await getRuntimeConfig();
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${api}${suffix}`;
}

async function parseErrorResponse(res: Response): Promise<RuntimeApiError> {
  const contentType = res.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const details = (await res.json().catch(() => undefined)) as
      | { code?: string; error?: string; message?: string }
      | undefined;
    return new RuntimeApiError(
      details?.error ?? details?.message ?? `Runtime API request failed (${res.status})`,
      res.status,
      details?.code,
      details,
    );
  }

  const message = await res.text().catch(() => "");
  return new RuntimeApiError(message || `Runtime API request failed (${res.status})`, res.status);
}

export async function runtimeFetch(path: string, options: RuntimeRequestOptions = {}) {
  const url = await getRuntimeApiUrl(path);
  const headers = new Headers(options.headers);
  let body = options.body;

  if (options.apiKey) {
    headers.set("X-API-Key", options.apiKey);
  }

  if (options.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.json);
  }

  const res = await fetch(url, {
    ...options,
    body,
    headers,
  });

  if (!res.ok) {
    throw await parseErrorResponse(res);
  }

  return res;
}

export async function runtimeJson<T>(
  path: string,
  options: RuntimeRequestOptions = {},
): Promise<T> {
  const res = await runtimeFetch(path, options);
  return res.json() as Promise<T>;
}

/**
 * Fetch list of loaded plugins from the runtime API.
 * Discovers API path dynamically via /.well-known/buntime
 */
export async function fetchLoadedPlugins(): Promise<PluginInfo[]> {
  const { api } = await getRuntimeConfig();
  const res = await fetch(`${api}/plugins/loaded`);
  return res.json();
}
