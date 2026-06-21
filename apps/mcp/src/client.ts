import { basename } from "node:path";
import { AppError, ValidationError } from "@buntime/shared/errors";
import type { McpConfig } from "./config.ts";
import type {
  ApiKeyInfo,
  CreatedKey,
  CreateKeyInput,
  HealthStatus,
  KeysMeta,
  LoadedPlugin,
  PluginInfo,
  SessionInfo,
  WellKnown,
  WorkerInfo,
} from "./types.ts";

/** Error raised when the runtime returns a non-2xx response. */
export class RuntimeApiError extends AppError {
  constructor(
    message: string,
    code: string,
    public readonly status: number,
  ) {
    super(message, code);
  }
}

/**
 * Typed client over the Buntime runtime management REST API. Resolves the API
 * path from `/.well-known/buntime` and authenticates with the configured API
 * key. A header credential bypasses the runtime CSRF check, so no extra
 * handshake is required for mutating calls.
 */
export class RuntimeClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly origin: string;
  private apiPath: string | undefined;

  constructor(config: McpConfig) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.origin = config.origin;
    this.apiPath = config.apiPath;
  }

  /** Resolve the runtime API path (e.g. `/api` or `/_/api`), caching the result. */
  async resolveApiPath(): Promise<string> {
    if (this.apiPath !== undefined) {
      return this.apiPath;
    }
    try {
      const res = await fetch(`${this.baseUrl}/.well-known/buntime`, {
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const body = (await res.json()) as Partial<WellKnown>;
        this.apiPath = body.api ?? "/api";
      } else {
        this.apiPath = "/api";
      }
    } catch {
      this.apiPath = "/api";
    }
    return this.apiPath;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      "X-API-Key": this.apiKey,
      Origin: this.origin,
      Accept: "application/json",
      ...extra,
    };
  }

  private async parse<T>(res: Response): Promise<T> {
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    if (!res.ok) {
      const b = (body ?? {}) as { code?: string; message?: string; error?: string };
      const code = b.code ?? `HTTP_${res.status}`;
      const message = b.message ?? b.error ?? res.statusText ?? "Request failed";
      throw new RuntimeApiError(message, code, res.status);
    }
    return body as T;
  }

  private async requestJson<T>(method: string, path: string, json?: unknown): Promise<T> {
    const apiPath = await this.resolveApiPath();
    const headers = this.headers(
      json !== undefined ? { "Content-Type": "application/json" } : undefined,
    );
    const init: RequestInit = { method, headers };
    if (json !== undefined) {
      init.body = JSON.stringify(json);
    }
    const res = await fetch(`${this.baseUrl}${apiPath}${path}`, init);
    return this.parse<T>(res);
  }

  private async uploadFile<T>(path: string, filePath: string, field = "file"): Promise<T> {
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      throw new ValidationError(`File not found: ${filePath}`, "FILE_NOT_FOUND");
    }
    const form = new FormData();
    form.append(field, file, basename(filePath));
    const apiPath = await this.resolveApiPath();
    // Do not set Content-Type: fetch derives the multipart boundary from FormData.
    const res = await fetch(`${this.baseUrl}${apiPath}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: form,
    });
    return this.parse<T>(res);
  }

  // --- System -------------------------------------------------------------

  health(): Promise<HealthStatus> {
    return this.requestJson<HealthStatus>("GET", "/health");
  }

  whoami(): Promise<SessionInfo> {
    return this.requestJson<SessionInfo>("GET", "/admin/session");
  }

  // --- Workers ------------------------------------------------------------

  listWorkers(): Promise<WorkerInfo[]> {
    return this.requestJson<WorkerInfo[]>("GET", "/workers");
  }

  uploadWorker(archivePath: string): Promise<unknown> {
    return this.uploadFile("/workers/upload", archivePath);
  }

  setWorkerEnabled(
    scope: string,
    name: string,
    version: string,
    enabled: boolean,
  ): Promise<unknown> {
    const action = enabled ? "enable" : "disable";
    return this.requestJson(
      "POST",
      `/workers/${enc(scope)}/${enc(name)}/${enc(version)}/${action}`,
    );
  }

  deleteWorker(scope: string, name: string, version?: string): Promise<unknown> {
    const versionSegment = version ? `/${enc(version)}` : "";
    return this.requestJson("DELETE", `/workers/${enc(scope)}/${enc(name)}${versionSegment}`);
  }

  // --- Plugins ------------------------------------------------------------

  listPlugins(): Promise<PluginInfo[]> {
    return this.requestJson<PluginInfo[]>("GET", "/plugins");
  }

  listLoadedPlugins(): Promise<LoadedPlugin[]> {
    return this.requestJson<LoadedPlugin[]>("GET", "/plugins/loaded");
  }

  uploadPlugin(archivePath: string): Promise<unknown> {
    return this.uploadFile("/plugins/upload", archivePath);
  }

  reloadPlugins(): Promise<unknown> {
    return this.requestJson("POST", "/plugins/reload");
  }

  setPluginEnabled(name: string, enabled: boolean): Promise<unknown> {
    const action = enabled ? "enable" : "disable";
    return this.requestJson("POST", `/plugins/${enc(name)}/${action}`);
  }

  deletePlugin(name: string): Promise<unknown> {
    return this.requestJson("DELETE", `/plugins/${enc(name)}`);
  }

  // --- API keys -----------------------------------------------------------

  listKeys(): Promise<{ keys: ApiKeyInfo[] }> {
    return this.requestJson<{ keys: ApiKeyInfo[] }>("GET", "/keys");
  }

  keysMeta(): Promise<KeysMeta> {
    return this.requestJson<KeysMeta>("GET", "/keys/meta");
  }

  createKey(input: CreateKeyInput): Promise<{ success: boolean; data: CreatedKey }> {
    return this.requestJson<{ success: boolean; data: CreatedKey }>("POST", "/keys", input);
  }

  revokeKey(id: number): Promise<unknown> {
    return this.requestJson("DELETE", `/keys/${id}`);
  }
}

/** Encode a single path segment (turns `@scope/name` into a safe segment). */
function enc(segment: string): string {
  return encodeURIComponent(segment);
}
