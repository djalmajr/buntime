import { join } from "node:path";
import z from "zod/v4";
import { boolean, number } from "@/utils/zod-helpers";

// Default values for worker configuration
export const ConfigDefaults = {
  idleTimeout: 60,
  lowMemory: false,
  maxRequests: 1000,
  timeout: 30,
  ttl: 0,
} as const;

const proxyRuleSchema = z.object({
  changeOrigin: z.boolean().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  rewrite: z.string().optional(),
  secure: z.boolean().optional(),
  target: z.string(),
});

const workerConfigSchema = z.object({
  entrypoint: z.string().optional(),
  idleTimeout: number(ConfigDefaults.idleTimeout, z.number().nonnegative()),
  lowMemory: boolean(ConfigDefaults.lowMemory, z.boolean()),
  maxRequests: number(ConfigDefaults.maxRequests, z.number().nonnegative()),
  proxy: z.record(z.string(), proxyRuleSchema).optional(),
  timeout: number(ConfigDefaults.timeout, z.number().nonnegative()),
  ttl: number(ConfigDefaults.ttl, z.number().nonnegative()),
});

export type ProxyRule = z.infer<typeof proxyRuleSchema>;

export type WorkerConfigFile = z.infer<typeof workerConfigSchema>;

// Internal configuration (values in milliseconds)
export interface WorkerConfig {
  entrypoint?: string;
  idleTimeoutMs: number;
  lowMemory: boolean;
  maxRequests: number;
  proxy?: Record<string, ProxyRule>;
  timeoutMs: number;
  ttlMs: number;
}

function processProxyRules(
  proxy: Record<string, ProxyRule> | undefined,
): Record<string, ProxyRule> | undefined {
  if (!proxy) return undefined;

  const result: Record<string, ProxyRule> = {};

  for (const [pattern, rule] of Object.entries(proxy)) {
    result[pattern] = {
      ...rule,
      target: rule.target.replace(/\$\{([^}]+)\}/g, (_, name) => Bun.env[name] || ""),
    };
  }

  return result;
}

/**
 * Load worker configuration with the following precedence:
 * 1. worker.config.json (highest priority)
 * 2. package.json (workerConfig attribute)
 * 3. Default configuration (fallback)
 *
 * Environment variables for proxy targets are resolved from Bun.env
 * (which is automatically populated by Bun from .env files)
 */
export async function loadWorkerConfig(appDir: string): Promise<WorkerConfig> {
  let config: Partial<WorkerConfigFile> | undefined;

  // Priority 1: Try worker.config.json
  try {
    const file = Bun.file(join(appDir, "worker.config.json"));
    if (await file.exists()) config = await file.json();
  } catch (err) {
    console.warn(`[Config] Failed to load worker.config.json:`, err);
  }

  // Priority 2: Try package.json workerConfig attribute
  if (!config) {
    try {
      const file = Bun.file(join(appDir, "package.json"));
      if (await file.exists()) {
        const json = await file.json();
        if (json.workerConfig) config = json.workerConfig;
      }
    } catch (err) {
      console.warn(`[Config] Failed to load package.json:`, err);
    }
  }

  // Validate and apply defaults
  const { data, error } = workerConfigSchema.safeParse(config || {});

  if (error) {
    const err = error.issues.map((v) => `${v.path.join(".")}: ${v.message}`).join(", ");
    throw new Error(`Invalid worker config for ${appDir}: ${err}`);
  }

  return {
    entrypoint: data.entrypoint,
    idleTimeoutMs: data.idleTimeout * 1000,
    lowMemory: data.lowMemory,
    maxRequests: data.maxRequests,
    proxy: processProxyRules(data.proxy),
    timeoutMs: data.timeout * 1000,
    ttlMs: data.ttl * 1000,
  };
}
