import { getChildLogger } from "@buntime/shared/logger";
import { loadManifestConfig } from "@buntime/shared/utils/buntime-config";
import {
  parseWorkerConfig,
  type WorkerConfig,
  WorkerConfigDefaults,
  type WorkerManifest,
} from "@buntime/shared/utils/worker-config";
import { boolean, number } from "@buntime/shared/utils/zod-helpers";
import z from "zod/v4";
import { getConfig } from "@/config";

const logger = getChildLogger("WorkerConfig");

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
  autoInstall: boolean(WorkerConfigDefaults.autoInstall, z.boolean()),
  entrypoint: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  idleTimeout: durationSchema.default(WorkerConfigDefaults.idleTimeout),
  injectBase: boolean(WorkerConfigDefaults.injectBase, z.boolean()),
  lowMemory: boolean(WorkerConfigDefaults.lowMemory, z.boolean()),
  maxBodySize: sizeSchema.optional(),
  maxRequests: number(WorkerConfigDefaults.maxRequests, z.number().nonnegative()),
  publicRoutes: publicRoutesSchema.optional(),
  timeout: durationSchema.default(WorkerConfigDefaults.timeout),
  ttl: durationSchema.default(WorkerConfigDefaults.ttl),
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

/**
 * Load worker configuration from manifest.yaml
 *
 * 1. Loads and validates manifest with Zod schema
 * 2. Parses to normalized format (ms/bytes) via parseWorkerConfig
 * 3. Applies runtime-specific limits (bodySize ceiling)
 * 4. Validates config relationships (ttl >= timeout, etc.)
 */
export async function loadWorkerConfig(appDir: string): Promise<WorkerConfig> {
  // Load config using shared utility
  const rawConfig = await loadManifestConfig(appDir);

  // Validate schema and apply defaults
  const { data, error } = workerConfigSchema.safeParse(rawConfig || {});

  if (error) {
    const err = error.issues.map((v) => `${v.path.join(".")}: ${v.message}`).join(", ");
    throw new WorkerConfigError(`Invalid config: ${err}`, appDir);
  }

  // Parse to normalized format (ms/bytes)
  const config = parseWorkerConfig(data as WorkerManifest);

  // Apply runtime-specific bodySize limits
  const { bodySize } = getConfig();
  let maxBodySizeBytes = config.maxBodySizeBytes ?? bodySize.default;

  if (maxBodySizeBytes > bodySize.max) {
    logger.warn(
      `maxBodySize (${maxBodySizeBytes} bytes) exceeds maximum (${bodySize.max} bytes), capping to maximum`,
      { appDir },
    );
    maxBodySizeBytes = bodySize.max;
  }

  // Validate durations are positive/non-negative
  if (config.timeoutMs <= 0) {
    throw new WorkerConfigError(`timeout must be positive`, appDir);
  }
  if (config.ttlMs < 0) {
    throw new WorkerConfigError(`ttl must be non-negative`, appDir);
  }
  if (config.idleTimeoutMs <= 0) {
    throw new WorkerConfigError(`idleTimeout must be positive`, appDir);
  }

  // Validate config relationships for persistent workers (ttl > 0)
  let { idleTimeoutMs } = config;

  if (config.ttlMs > 0) {
    // ttl must be >= timeout (worker shouldn't expire during a request)
    if (config.ttlMs < config.timeoutMs) {
      throw new WorkerConfigError(
        `ttl (${config.ttlMs}ms) must be >= timeout (${config.timeoutMs}ms). Worker would expire before request completes.`,
        appDir,
      );
    }

    // idleTimeout must be >= timeout (worker shouldn't be marked idle during a request)
    if (idleTimeoutMs < config.timeoutMs) {
      throw new WorkerConfigError(
        `idleTimeout (${idleTimeoutMs}ms) must be >= timeout (${config.timeoutMs}ms). Worker could be marked idle while processing.`,
        appDir,
      );
    }

    // idleTimeout > ttl is pointless - auto-adjust with warning
    if (idleTimeoutMs > config.ttlMs) {
      logger.warn(
        `idleTimeout (${idleTimeoutMs}ms) exceeds ttl (${config.ttlMs}ms), adjusting to ttl`,
        {
          appDir,
        },
      );
      idleTimeoutMs = config.ttlMs;
    }
  }

  return {
    ...config,
    idleTimeoutMs,
    maxBodySizeBytes,
  };
}
