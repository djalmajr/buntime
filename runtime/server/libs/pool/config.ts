import { join } from "node:path";
import type { PublicRoutesConfig } from "@buntime/shared/types";
import { boolean, number } from "@buntime/shared/utils/zod-helpers";
import z from "zod/v4";
import { parseDurationToMs } from "../../utils/duration";

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

const workerConfigSchema = z.object({
  autoInstall: boolean(ConfigDefaults.autoInstall, z.boolean()),
  entrypoint: z.string().optional(),
  idleTimeout: durationSchema.default(ConfigDefaults.idleTimeout),
  lowMemory: boolean(ConfigDefaults.lowMemory, z.boolean()),
  maxRequests: number(ConfigDefaults.maxRequests, z.number().nonnegative()),
  publicRoutes: publicRoutesSchema.optional(),
  timeout: durationSchema.default(ConfigDefaults.timeout),
  ttl: durationSchema.default(ConfigDefaults.ttl),
});

export type WorkerConfigFile = z.infer<typeof workerConfigSchema>;

// Internal configuration (values in milliseconds)
export interface WorkerConfig {
  autoInstall: boolean;
  entrypoint?: string;
  env?: Record<string, string>;
  idleTimeoutMs: number;
  lowMemory: boolean;
  maxRequests: number;
  publicRoutes?: PublicRoutesConfig;
  timeoutMs: number;
  ttlMs: number;
}

/**
 * Load worker configuration from worker.jsonc or package.json#workerConfig
 */
export async function loadWorkerConfig(appDir: string): Promise<WorkerConfig> {
  let config: Partial<WorkerConfigFile> | undefined;

  // Try worker.jsonc first
  const jsoncPath = join(appDir, "worker.jsonc");
  try {
    const file = Bun.file(jsoncPath);
    if (await file.exists()) {
      // Bun natively parses JSONC (strips comments and trailing commas)
      const mod = await import(jsoncPath);
      config = mod.default ?? mod;
    }
  } catch (err) {
    if (err instanceof Error && !err.message.includes("Cannot find module")) {
      throw new Error(`[worker.jsonc] Failed to parse ${jsoncPath}: ${err.message}`);
    }
  }

  // Fallback to package.json#workerConfig
  if (!config) {
    const pkgPath = join(appDir, "package.json");
    try {
      const file = Bun.file(pkgPath);
      if (await file.exists()) {
        const pkg = await file.json();
        if (pkg.workerConfig) {
          config = pkg.workerConfig;
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
    throw new Error(`[workerConfig] Invalid config in ${appDir}: ${err}`);
  }

  return {
    autoInstall: data.autoInstall,
    entrypoint: data.entrypoint,
    idleTimeoutMs: parseDurationToMs(data.idleTimeout),
    lowMemory: data.lowMemory,
    maxRequests: data.maxRequests,
    publicRoutes: data.publicRoutes,
    timeoutMs: parseDurationToMs(data.timeout),
    ttlMs: parseDurationToMs(data.ttl),
  };
}
