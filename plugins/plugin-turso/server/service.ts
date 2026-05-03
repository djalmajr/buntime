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
  const mode = normalizeMode(getOptionalString(env.TURSO_MODE) ?? getOptionalString(config.mode));
  const localPath =
    getOptionalString(env.TURSO_LOCAL_PATH) ??
    (config.localPath ? substituteEnvVars(config.localPath, env) : undefined) ??
    TURSO_DEFAULT_LOCAL_PATH;
  const syncAuthToken =
    getOptionalString(env.TURSO_SYNC_AUTH_TOKEN) ??
    (config.sync?.authToken ? substituteEnvVars(config.sync.authToken, env) : undefined);
  const syncUrl =
    getOptionalString(env.TURSO_SYNC_URL) ??
    (config.sync?.url ? substituteEnvVars(config.sync.url, env) : undefined);

  if (mode === "sync") {
    if (!syncUrl) {
      throw new ValidationError(
        "Turso sync mode requires TURSO_SYNC_URL or sync.url.",
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
  private adapter: TursoAdapter | null = null;
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
    this.namespaces.clear();
  }

  async connect(namespace?: string): Promise<TursoDatabase> {
    this.namespaces.add(normalizeNamespace(namespace));

    if (!this.adapter) {
      this.adapter = await TursoAdapter.open({
        config: this.config,
        logger: this.logger,
      });
      this.logger.info(`Turso database connected (mode: ${this.config.mode})`);
    }

    return this.adapter;
  }

  getConfig(): TursoResolvedConfig {
    return this.config;
  }

  async health(): Promise<TursoHealth> {
    const sync = {
      enabled: this.config.mode === "sync",
      url: this.config.sync?.url,
    };

    if (!this.adapter) {
      return {
        connected: false,
        localPath: this.config.localPath,
        mode: this.config.mode,
        namespaces: Array.from(this.namespaces),
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
        namespaces: Array.from(this.namespaces),
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
        namespaces: Array.from(this.namespaces),
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
    const transactionType = options.type ?? "concurrent";

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
