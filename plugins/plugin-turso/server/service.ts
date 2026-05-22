import { ValidationError } from "@buntime/shared/errors";
import type { PluginLogger } from "@buntime/shared/types";
import { TursoAdapter } from "./adapter.ts";
import {
  TURSO_DEFAULT_LOCAL_PATH,
  TURSO_DEFAULT_MAX_RETRIES,
  TURSO_DEFAULT_NAMESPACE,
  TURSO_DEFAULT_RETRY_DELAY_MS,
  type TursoDatabase,
  type TursoHealth,
  type TursoMode,
  type TursoPluginConfig,
  type TursoResolvedConfig,
  type TursoService,
  type TursoTransactionOptions,
  type TursoTransactionType,
} from "./types.ts";

const NAMESPACE_PATTERN = /^[a-zA-Z0-9_-]+$/;

const TransactionBeginSql = {
  concurrent: "BEGIN CONCURRENT",
  deferred: "BEGIN DEFERRED",
  exclusive: "BEGIN EXCLUSIVE",
  immediate: "BEGIN IMMEDIATE",
} as const satisfies Record<TursoTransactionType, string>;

export interface TursoServiceOptions {
  config: TursoResolvedConfig;
  logger: PluginLogger;
}

interface TursoEnvironment {
  TURSO_LOCAL_PATH?: string;
  TURSO_MODE?: string;
  TURSO_SYNC_AUTH_TOKEN?: string;
  TURSO_SYNC_URL?: string;
  // Multi-tenant turso-server endpoints (see apps/turso-server). When
  // TURSO_SERVER_URL is set, each `connect(namespace)` is routed to
  // `<TURSO_SERVER_URL>/<namespace>` and the local replica file is
  // namespace-scoped (`<localPath dir>/<namespace>.db`).
  TURSO_SERVER_URL?: string;
  TURSO_SERVER_TOKEN?: string;
  [key: string]: string | undefined;
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const code = error.code;
  return typeof code === "string" ? code : undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isRetryableTursoError(error: unknown): boolean {
  const code = getErrorCode(error)?.toLowerCase() ?? "";
  const message = getErrorMessage(error).toLowerCase();

  return (
    code.includes("busy") ||
    code.includes("conflict") ||
    message.includes("busy") ||
    message.includes("conflict")
  );
}

function normalizeMode(value: string | undefined): TursoMode {
  if (!value) {
    return "local";
  }

  if (value === "local" || value === "sync") {
    return value;
  }

  throw new ValidationError(`Unsupported Turso mode: ${value}`, "INVALID_TURSO_MODE");
}

function normalizeNamespace(namespace: string | undefined): string {
  const value = namespace?.trim() || TURSO_DEFAULT_NAMESPACE;

  if (!NAMESPACE_PATTERN.test(value)) {
    throw new ValidationError(
      `Invalid Turso namespace: ${value}. Use letters, numbers, hyphens, or underscores.`,
      "INVALID_TURSO_NAMESPACE",
    );
  }

  return value;
}

function normalizeTransactionNumber(
  name: string,
  value: number | undefined,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new ValidationError(`${name} must be a non-negative integer.`, "INVALID_TURSO_RETRY");
  }

  return value;
}

function substituteEnvVars(value: string, env: TursoEnvironment): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_match, name: string) => env[name] ?? "");
}

function wait(ms: number): Promise<void> {
  if (ms === 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolveTursoConfig(
  config: TursoPluginConfig = {},
  env: TursoEnvironment = Bun.env,
): TursoResolvedConfig {
  const localPath =
    getOptionalString(env.TURSO_LOCAL_PATH) ??
    (config.localPath ? substituteEnvVars(config.localPath, env) : undefined) ??
    TURSO_DEFAULT_LOCAL_PATH;
  const serverUrl =
    getOptionalString(env.TURSO_SERVER_URL) ??
    (config.server?.url ? substituteEnvVars(config.server.url, env) : undefined);
  const serverToken =
    getOptionalString(env.TURSO_SERVER_TOKEN) ??
    (config.server?.authToken ? substituteEnvVars(config.server.authToken, env) : undefined);

  // Multi-tenant via in-cluster turso-server. Each `connect(namespace)`
  // routes to `<server.url>/<namespace>`. Mode is implicitly `sync` —
  // every namespace becomes an embedded replica.
  if (serverUrl) {
    return {
      localPath,
      mode: "sync",
      server: {
        url: serverUrl.replace(/\/$/, ""),
        authToken: serverToken,
      },
    };
  }

  const mode = normalizeMode(getOptionalString(env.TURSO_MODE) ?? getOptionalString(config.mode));
  const syncAuthToken =
    getOptionalString(env.TURSO_SYNC_AUTH_TOKEN) ??
    (config.sync?.authToken ? substituteEnvVars(config.sync.authToken, env) : undefined);
  const syncUrl =
    getOptionalString(env.TURSO_SYNC_URL) ??
    (config.sync?.url ? substituteEnvVars(config.sync.url, env) : undefined);

  if (mode === "sync") {
    if (!syncUrl) {
      throw new ValidationError(
        "Turso sync mode requires TURSO_SYNC_URL, TURSO_SERVER_URL, or sync.url.",
        "TURSO_SYNC_URL_REQUIRED",
      );
    }

    return {
      localPath,
      mode,
      sync: {
        authToken: syncAuthToken,
        url: syncUrl,
      },
    };
  }

  return {
    localPath,
    mode,
  };
}

export class TursoServiceImpl implements TursoService {
  // Single-tenant mode keeps one adapter shared across all `connect(namespace)`
  // calls (legacy behavior). Multi-tenant mode (when `config.server` is set)
  // opens one adapter per namespace, each synced with a dedicated namespace
  // on the in-cluster `turso-server`.
  private adapter: TursoAdapter | null = null;
  private readonly adapters = new Map<string, TursoAdapter>();
  private readonly adapterLocks = new Map<string, Promise<TursoAdapter>>();
  private readonly config: TursoResolvedConfig;
  private readonly logger: PluginLogger;
  private readonly namespaces = new Set<string>();

  constructor(options: TursoServiceOptions) {
    this.config = options.config;
    this.logger = options.logger;
  }

  async close(): Promise<void> {
    await this.adapter?.close();
    this.adapter = null;
    for (const [name, a] of this.adapters) {
      try {
        await a.close();
      } catch (error) {
        this.logger.warn("Turso adapter close failed", { error, namespace: name });
      }
    }
    this.adapters.clear();
    this.adapterLocks.clear();
    this.namespaces.clear();
  }

  async connect(namespace?: string): Promise<TursoDatabase> {
    const ns = normalizeNamespace(namespace);
    this.namespaces.add(ns);

    // Multi-tenant mode: dedicated adapter per namespace.
    if (this.config.server) {
      const existing = this.adapters.get(ns);
      if (existing) {
        return existing;
      }
      // De-duplicate concurrent opens of the same namespace — return the
      // in-flight promise so callers share the result without spawning N
      // sync clients against the same upstream.
      const pending = this.adapterLocks.get(ns);
      if (pending) {
        return pending;
      }
      const open = (async () => {
        const perNamespaceConfig = this.buildNamespaceConfig(ns);
        const adapter = await TursoAdapter.open({
          config: perNamespaceConfig,
          logger: this.logger,
        });
        this.adapters.set(ns, adapter);
        this.adapterLocks.delete(ns);
        this.logger.info(
          `Turso namespace connected (multi-tenant): ${ns} → ${perNamespaceConfig.sync?.url}`,
        );
        return adapter;
      })();
      this.adapterLocks.set(ns, open);
      return open;
    }

    // Single-tenant mode: one adapter shared across the process.
    if (!this.adapter) {
      this.adapter = await TursoAdapter.open({
        config: this.config,
        logger: this.logger,
      });
      this.logger.info(`Turso database connected (mode: ${this.config.mode})`);
    }
    return this.adapter;
  }

  /**
   * Build a per-namespace TursoResolvedConfig when the plugin is running in
   * multi-tenant mode. The local replica file is co-located under the
   * configured `localPath` directory and the sync URL points at the
   * matching namespace on the `turso-server`.
   */
  private buildNamespaceConfig(namespace: string): TursoResolvedConfig {
    if (!this.config.server) {
      // Defensive — caller already checks; keep TypeScript happy.
      return this.config;
    }
    const lastSep = Math.max(
      this.config.localPath.lastIndexOf("/"),
      this.config.localPath.lastIndexOf("\\"),
    );
    const dir = lastSep >= 0 ? this.config.localPath.slice(0, lastSep) : ".";
    return {
      localPath: `${dir}/${namespace}.db`,
      mode: "sync",
      sync: {
        url: `${this.config.server.url}/${namespace}`,
        authToken: this.config.server.authToken,
      },
    };
  }

  getConfig(): TursoResolvedConfig {
    return this.config;
  }

  async health(): Promise<TursoHealth> {
    const namespaces = Array.from(this.namespaces);

    if (this.config.server) {
      // Multi-tenant: pick a representative adapter (or report unconnected
      // if none have been opened yet).
      const first = this.adapters.values().next().value;
      if (!first) {
        return {
          connected: false,
          localPath: this.config.localPath,
          mode: this.config.mode,
          namespaces,
          ok: false,
          sync: { enabled: true, url: this.config.server.url },
        };
      }
      try {
        await first.prepare("SELECT 1 AS ok").get();
        return {
          connected: true,
          localPath: this.config.localPath,
          mode: this.config.mode,
          namespaces,
          ok: true,
          sync: {
            enabled: true,
            url: this.config.server.url,
            stats: (await first.getSyncStats()) ?? undefined,
          },
        };
      } catch (error) {
        this.logger.error("Turso health check failed (multi-tenant)", {
          error,
          stack: error instanceof Error ? error.stack : undefined,
        });
        return {
          connected: false,
          error: getErrorMessage(error),
          localPath: this.config.localPath,
          mode: this.config.mode,
          namespaces,
          ok: false,
          sync: { enabled: true, url: this.config.server.url },
        };
      }
    }

    const sync = {
      enabled: this.config.mode === "sync",
      url: this.config.sync?.url,
    };

    if (!this.adapter) {
      return {
        connected: false,
        localPath: this.config.localPath,
        mode: this.config.mode,
        namespaces,
        ok: false,
        sync,
      };
    }

    try {
      await this.adapter.prepare("SELECT 1 AS ok").get();

      return {
        connected: true,
        localPath: this.config.localPath,
        mode: this.config.mode,
        namespaces,
        ok: true,
        sync: {
          ...sync,
          stats: (await this.adapter.getSyncStats()) ?? undefined,
        },
      };
    } catch (error) {
      this.logger.error("Turso health check failed", {
        error,
        stack: error instanceof Error ? error.stack : undefined,
      });

      return {
        connected: false,
        error: getErrorMessage(error),
        localPath: this.config.localPath,
        mode: this.config.mode,
        namespaces,
        ok: false,
        sync,
      };
    }
  }

  async transaction<T>(
    options: TursoTransactionOptions,
    callback: (db: TursoDatabase) => Promise<T>,
  ): Promise<T> {
    const maxRetries = normalizeTransactionNumber(
      "maxRetries",
      options.maxRetries,
      TURSO_DEFAULT_MAX_RETRIES,
    );
    const retryDelayMs = normalizeTransactionNumber(
      "retryDelayMs",
      options.retryDelayMs,
      TURSO_DEFAULT_RETRY_DELAY_MS,
    );
    let transactionType = options.type ?? "concurrent";
    // `BEGIN CONCURRENT` requires MVCC, which `tursodb` disables on sync
    // replicas (CDC vs MVCC are mutually exclusive). Downgrade to the
    // standard `BEGIN DEFERRED` for sync clients; behavior is otherwise
    // identical for most callers — only true contention with multiple
    // readers/writers will see lock waits instead of MVCC retries.
    if (this.config.mode === "sync" && transactionType === "concurrent") {
      transactionType = "deferred";
    }

    let attempt = 0;

    while (true) {
      const db = await this.connect(options.namespace);
      await db.exec(TransactionBeginSql[transactionType]);

      try {
        const result = await callback(db);
        await db.exec("COMMIT");
        return result;
      } catch (error) {
        await db.exec("ROLLBACK").catch((rollbackError) => {
          this.logger.warn("Turso transaction rollback failed", {
            error: rollbackError,
            originalError: error,
          });
        });

        if (attempt >= maxRetries || !isRetryableTursoError(error)) {
          throw error;
        }

        attempt += 1;
        this.logger.warn("Retrying Turso transaction after conflict", {
          attempt,
          error: getErrorMessage(error),
          maxRetries,
        });
        await wait(retryDelayMs);
      }
    }
  }
}

export { isRetryableTursoError };
