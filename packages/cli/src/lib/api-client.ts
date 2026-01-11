import { setupTls } from "../utils/tls.js";

/**
 * API response types
 */
export interface PluginInfo {
  base?: string;
  enabled: boolean;
  name: string;
  path: string;
  versions: string[];
}

export interface AppInfo {
  name: string;
  path: string;
  versions: string[];
}

export interface InstallResult {
  name: string;
  path: string;
  version: string;
}

/**
 * Connection configuration
 */
export interface ConnectionConfig {
  insecure?: boolean;
  token?: string | null;
  url: string;
}

/**
 * API error types
 */
export type ApiErrorType =
  | "auth_required"
  | "connection_refused"
  | "network_error"
  | "server_error"
  | "tls_error"
  | "unknown";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly type: ApiErrorType,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * API client for communicating with Buntime server
 */
export class ApiClient {
  private config: ConnectionConfig;
  private onAuthRequired?: () => Promise<string | null>;

  constructor(config: ConnectionConfig) {
    this.config = config;
    if (config.insecure) {
      setupTls({ insecure: true });
    }
  }

  /**
   * Set the auth required callback
   */
  setAuthCallback(callback: () => Promise<string | null>): void {
    this.onAuthRequired = callback;
  }

  /**
   * Update the token
   */
  setToken(token: string | null): void {
    this.config.token = token;
  }

  /**
   * Get current URL
   */
  getUrl(): string {
    return this.config.url;
  }

  /**
   * Get current token
   */
  getToken(): string | null {
    return this.config.token ?? null;
  }

  /**
   * Make a fetch request with auth handling
   */
  private async fetch(path: string, options: RequestInit = {}): Promise<Response> {
    const headers = new Headers(options.headers);

    if (this.config.token) {
      headers.set("Authorization", `Bearer ${this.config.token}`);
    }

    const url = `${this.config.url}${path}`;

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      // Handle 401 - try to get token via callback
      if (response.status === 401 && this.onAuthRequired) {
        const newToken = await this.onAuthRequired();
        if (newToken) {
          this.config.token = newToken;
          headers.set("Authorization", `Bearer ${newToken}`);
          return fetch(url, { ...options, headers });
        }
        throw new ApiError("Authentication required", "auth_required", 401);
      }

      return response;
    } catch (error) {
      if (error instanceof ApiError) throw error;

      const message = error instanceof Error ? error.message : String(error);

      // Detect TLS errors
      if (
        message.includes("CERT") ||
        message.includes("certificate") ||
        message.includes("TLS") ||
        message.includes("SSL")
      ) {
        throw new ApiError(`TLS certificate error: ${message}`, "tls_error");
      }

      // Detect connection refused
      if (
        message.includes("ECONNREFUSED") ||
        message.includes("Connection refused") ||
        message.includes("fetch failed")
      ) {
        throw new ApiError(`Connection refused: ${this.config.url}`, "connection_refused");
      }

      throw new ApiError(message, "network_error");
    }
  }

  /**
   * Test connection to server
   */
  async testConnection(): Promise<void> {
    const response = await this.fetch("/api/core/plugins");

    if (!response.ok) {
      if (response.status === 401) {
        throw new ApiError("Authentication required", "auth_required", 401);
      }
      throw new ApiError(
        `Server error: ${response.status} ${response.statusText}`,
        "server_error",
        response.status,
      );
    }
  }

  /**
   * List all plugins
   */
  async listPlugins(): Promise<PluginInfo[]> {
    const response = await this.fetch("/api/core/plugins");

    if (!response.ok) {
      throw new ApiError(
        `Failed to fetch plugins: ${response.status} ${response.statusText}`,
        "server_error",
        response.status,
      );
    }

    return (await response.json()) as PluginInfo[];
  }

  /**
   * Install a plugin from file
   */
  async installPlugin(file: File): Promise<InstallResult> {
    const formData = new FormData();
    formData.append("file", file);

    const response = await this.fetch("/api/core/plugins", {
      body: formData,
      method: "POST",
    });

    if (!response.ok) {
      const text = await response.text();
      throw new ApiError(`Failed to install plugin: ${text}`, "server_error", response.status);
    }

    return (await response.json()) as InstallResult;
  }

  /**
   * Remove a plugin version
   */
  async removePlugin(name: string, version: string): Promise<void> {
    const response = await this.fetch(
      `/api/core/plugins/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
      { method: "DELETE" },
    );

    if (!response.ok) {
      throw new ApiError(
        `Failed to remove plugin: ${response.status} ${response.statusText}`,
        "server_error",
        response.status,
      );
    }
  }

  /**
   * Enable a plugin
   */
  async enablePlugin(name: string): Promise<void> {
    // Handle scoped packages (@scope/name) by encoding each part
    const encodedName = name.includes("/")
      ? name.split("/").map(encodeURIComponent).join("/")
      : encodeURIComponent(name);

    const response = await this.fetch(`/api/core/plugins/${encodedName}/enable`, {
      method: "PUT",
    });

    if (!response.ok) {
      throw new ApiError(
        `Failed to enable plugin: ${response.status} ${response.statusText}`,
        "server_error",
        response.status,
      );
    }
  }

  /**
   * Disable a plugin
   */
  async disablePlugin(name: string): Promise<void> {
    // Handle scoped packages (@scope/name) by encoding each part
    const encodedName = name.includes("/")
      ? name.split("/").map(encodeURIComponent).join("/")
      : encodeURIComponent(name);

    const response = await this.fetch(`/api/core/plugins/${encodedName}/disable`, {
      method: "PUT",
    });

    if (!response.ok) {
      throw new ApiError(
        `Failed to disable plugin: ${response.status} ${response.statusText}`,
        "server_error",
        response.status,
      );
    }
  }

  /**
   * List all apps
   */
  async listApps(): Promise<AppInfo[]> {
    const response = await this.fetch("/api/core/apps");

    if (!response.ok) {
      throw new ApiError(
        `Failed to fetch apps: ${response.status} ${response.statusText}`,
        "server_error",
        response.status,
      );
    }

    return (await response.json()) as AppInfo[];
  }

  /**
   * Install an app from file
   */
  async installApp(file: File): Promise<InstallResult> {
    const formData = new FormData();
    formData.append("file", file);

    const response = await this.fetch("/api/core/apps", {
      body: formData,
      method: "POST",
    });

    if (!response.ok) {
      const text = await response.text();
      throw new ApiError(`Failed to install app: ${text}`, "server_error", response.status);
    }

    return (await response.json()) as InstallResult;
  }

  /**
   * Remove an app version
   */
  async removeApp(name: string, version: string): Promise<void> {
    const response = await this.fetch(
      `/api/core/apps/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
      { method: "DELETE" },
    );

    if (!response.ok) {
      throw new ApiError(
        `Failed to remove app: ${response.status} ${response.statusText}`,
        "server_error",
        response.status,
      );
    }
  }
}
