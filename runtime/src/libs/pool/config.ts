import { join } from "node:path";
import { getChildLogger } from "@buntime/shared/logger";
import type { PublicRoutesConfig } from "@buntime/shared/types";
import { parseDurationToMs } from "@buntime/shared/utils/duration";
import { parseSizeToBytes } from "@buntime/shared/utils/size";
import { boolean, number, substituteEnvVars } from "@buntime/shared/utils/zod-helpers";
import z from "zod/v4";
import { getConfig } from "@/config";

const logger = getChildLogger("WorkerConfig");

// Default values for worker configuration
export const ConfigDefaults = {
  autoInstall: false,
  idleTimeout: 60,
  lowMemory: false,
  maxRequests: 1000,
  timeout: 30,
  ttl: 0,
} as const;

// Schema for publicRoutes - can be array or object with HTTP methods
const publicRoutesSchema = z.union([
  z.array(z.string()),
  z.object({
    ALL: z.array(z.string()).optional(),
    DELETE: z.array(z.string()).optional(),
    GET: z.array(z.string()).optional(),
    HEAD: z.array(z.string()).optional(),
    OPTIONS: z.array(z.string()).optional(),
    PATCH: z.array(z.string()).optional(),
    POST: z.array(z.string()).optional(),
    PUT: z.array(z.string()).optional(),
  }),
]);

// Schema for duration values (number in seconds or string like "30s", "1m", "1h")
const durationSchema = z.union([z.number().nonnegative(), z.string()]);

// Schema for size values (number in bytes or string like "10mb", "1gb")
const sizeSchema = z.union([z.number().positive(), z.string()]);

const workerConfigSchema = z.object({
  autoInstall: boolean(ConfigDefaults.autoInstall, z.boolean()),
  entrypoint: z.string().optional(),
  // Environment variables to pass to the worker (supports ${VAR_NAME} substitution)
  env: z.record(z.string(), z.string()).optional(),
  idleTimeout: durationSchema.default(ConfigDefaults.idleTimeout),
  lowMemory: boolean(ConfigDefaults.lowMemory, z.boolean()),
  maxBodySize: sizeSchema.optional(),
  maxRequests: number(ConfigDefaults.maxRequests, z.number().nonnegative()),
  publicRoutes: publicRoutesSchema.optional(),
  timeout: durationSchema.default(ConfigDefaults.timeout),
  ttl: durationSchema.default(ConfigDefaults.ttl),
});

export type WorkerConfigFile = z.infer<typeof workerConfigSchema>;

/** Validation errors for worker config */
class WorkerConfigError extends Error {
  constructor(
    message: string,
    public readonly appDir: string,
  ) {
    super(`[buntime] ${appDir}: ${message}`);
    this.name = "WorkerConfigError";
  }
}

// Internal configuration (values in milliseconds/bytes)
export interface WorkerConfig {
  autoInstall: boolean;
  entrypoint?: string;
  env?: Record<string, string>;
  idleTimeoutMs: number;
  lowMemory: boolean;
  maxBodySizeBytes: number;
  maxRequests: number;
  publicRoutes?: PublicRoutesConfig;
  timeoutMs: number;
  ttlMs: number;
}

/**
 * Load worker configuration from buntime.jsonc or package.json#buntime
 */
export async function loadWorkerConfig(appDir: string): Promise<WorkerConfig> {
  let config: Partial<WorkerConfigFile> | undefined;

  // Try buntime.jsonc first
  const jsoncPath = join(appDir, "buntime.jsonc");
  try {
    const file = Bun.file(jsoncPath);
    if (await file.exists()) {
      // Bun natively parses JSONC (strips comments and trailing commas)
      const mod = await import(jsoncPath);
      config = mod.default ?? mod;
    }
  } catch (err) {
    if (err instanceof Error && !err.message.includes("Cannot find module")) {
      throw new Error(`[buntime.jsonc] Failed to parse ${jsoncPath}: ${err.message}`);
    }
  }

  // Fallback to package.json#buntime
  if (!config) {
    const pkgPath = join(appDir, "package.json");
    try {
      const file = Bun.file(pkgPath);
      if (await file.exists()) {
        const pkg = await file.json();
        if (pkg.buntime) {
          config = pkg.buntime;
        }
      }
    } catch {
      // Ignore package.json errors
    }
  }

  // Validate and apply defaults
  const { data, error } = workerConfigSchema.safeParse(config || {});

  if (error) {
    const err = error.issues.map((v) => `${v.path.join(".")}: ${v.message}`).join(", ");
    throw new WorkerConfigError(`Invalid config: ${err}`, appDir);
  }

  const timeoutMs = parseDurationToMs(data.timeout);
  const ttlMs = parseDurationToMs(data.ttl);
  let idleTimeoutMs = parseDurationToMs(data.idleTimeout);

  // Parse and validate maxBodySize (with ceiling from runtime config)
  const { bodySize } = getConfig();
  let maxBodySizeBytes = bodySize.default;
  if (data.maxBodySize !== undefined) {
    const parsed = parseSizeToBytes(data.maxBodySize);
    if (parsed > bodySize.max) {
      logger.warn(
        `maxBodySize (${parsed} bytes) exceeds maximum (${bodySize.max} bytes), capping to maximum`,
        { appDir },
      );
      maxBodySizeBytes = bodySize.max;
    } else {
      maxBodySizeBytes = parsed;
    }
  }

  // Validate durations are positive/non-negative
  if (timeoutMs <= 0) {
    throw new WorkerConfigError(`timeout must be positive, got: ${data.timeout}`, appDir);
  }
  if (ttlMs < 0) {
    throw new WorkerConfigError(`ttl must be non-negative, got: ${data.ttl}`, appDir);
  }
  if (idleTimeoutMs <= 0) {
    throw new WorkerConfigError(`idleTimeout must be positive, got: ${data.idleTimeout}`, appDir);
  }

  // Validate config relationships for persistent workers (ttl > 0)
  if (ttlMs > 0) {
    // ttl must be >= timeout (worker shouldn't expire during a request)
    if (ttlMs < timeoutMs) {
      throw new WorkerConfigError(
        `ttl (${ttlMs}ms) must be >= timeout (${timeoutMs}ms). Worker would expire before request completes.`,
        appDir,
      );
    }

    // idleTimeout must be >= timeout (worker shouldn't be marked idle during a request)
    if (idleTimeoutMs < timeoutMs) {
      throw new WorkerConfigError(
        `idleTimeout (${idleTimeoutMs}ms) must be >= timeout (${timeoutMs}ms). Worker could be marked idle while processing.`,
        appDir,
      );
    }

    // idleTimeout > ttl is pointless - auto-adjust with warning
    if (idleTimeoutMs > ttlMs) {
      logger.warn(`idleTimeout (${idleTimeoutMs}ms) exceeds ttl (${ttlMs}ms), adjusting to ttl`, {
        appDir,
      });
      idleTimeoutMs = ttlMs;
    }
  }

  // Substitute environment variables in env config values
  const env = data.env
    ? Object.fromEntries(Object.entries(data.env).map(([k, v]) => [k, substituteEnvVars(v)]))
    : undefined;

  return {
    autoInstall: data.autoInstall,
    entrypoint: data.entrypoint,
    env,
    idleTimeoutMs,
    lowMemory: data.lowMemory,
    maxBodySizeBytes,
    maxRequests: data.maxRequests,
    publicRoutes: data.publicRoutes,
    timeoutMs,
    ttlMs,
  };
}
