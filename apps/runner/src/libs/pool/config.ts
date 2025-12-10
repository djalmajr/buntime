import { join } from "node:path";
import { boolean, number } from "@buntime/shared/utils/zod-helpers";
import z from "zod/v4";

// Default values for worker configuration
export const ConfigDefaults = {
  autoInstall: false,
  idleTimeout: 60,
  lowMemory: false,
  maxRequests: 1000,
  timeout: 30,
  ttl: 0,
} as const;

const workerConfigSchema = z.object({
  autoInstall: boolean(ConfigDefaults.autoInstall, z.boolean()),
  entrypoint: z.string().optional(),
  idleTimeout: number(ConfigDefaults.idleTimeout, z.number().nonnegative()),
  lowMemory: boolean(ConfigDefaults.lowMemory, z.boolean()),
  maxRequests: number(ConfigDefaults.maxRequests, z.number().nonnegative()),
  timeout: number(ConfigDefaults.timeout, z.number().nonnegative()),
  ttl: number(ConfigDefaults.ttl, z.number().nonnegative()),
});

export type WorkerConfigFile = z.infer<typeof workerConfigSchema>;

// Internal configuration (values in milliseconds)
export interface WorkerConfig {
  autoInstall: boolean;
  entrypoint?: string;
  idleTimeoutMs: number;
  lowMemory: boolean;
  maxRequests: number;
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
    idleTimeoutMs: data.idleTimeout * 1000,
    lowMemory: data.lowMemory,
    maxRequests: data.maxRequests,
    timeoutMs: data.timeout * 1000,
    ttlMs: data.ttl * 1000,
  };
}
