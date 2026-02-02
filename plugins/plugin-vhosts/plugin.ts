/**
 * Virtual Hosts Plugin for Buntime
 *
 * Enables serving apps via custom domains directly at root path.
 * Supports wildcard subdomains for multi-tenancy.
 */
import type { PluginContext, PluginImpl } from "@buntime/shared/types";
import type { WorkerConfig } from "@buntime/shared/utils/worker-config";
import { matchVirtualHost, type VHostConfig } from "./server/matcher";

/** Header name for tenant extracted from wildcard subdomain */
const VHOST_TENANT_HEADER = "x-vhost-tenant";

/** Header name for base path (used by runtime's wrapper.ts) */
const BASE_HEADER = "x-base";

export interface VHostsPluginConfig {
  /**
   * Virtual host configurations keyed by hostname pattern
   *
   * @example
   * {
   *   "sked.ly": { "app": "skedly@latest" },
   *   "*.sked.ly": { "app": "skedly@latest" }
   * }
   */
  hosts: Record<string, VHostConfig>;
}

// Type for the pool interface we need
interface PoolLike {
  fetch(appDir: string, config: WorkerConfig, req: Request): Promise<Response>;
}

// Type for the app resolver function
type GetWorkerDir = (workerName: string) => string;

// Type for worker config loader
type LoadWorkerConfig = (appDir: string) => Promise<WorkerConfig>;

/**
 * Virtual Hosts plugin for Buntime
 *
 * Allows serving apps via custom domains:
 * - `sked.ly` → serves `skedly@latest` at root `/`
 * - `*.sked.ly` → captures subdomain as tenant header
 */
export default function vhostsPlugin(pluginConfig: VHostsPluginConfig): PluginImpl {
  // These will be set during onInit
  let pool: PoolLike;
  let getWorkerDir: GetWorkerDir;
  let loadWorkerConfig: LoadWorkerConfig;

  return {
    async onInit(ctx: PluginContext) {
      // Get pool from context
      pool = ctx.pool as PoolLike;

      // Import runtime utilities dynamically (builtin plugin can access runtime internals)
      // Using string variable to prevent TypeScript from following the import
      const getWorkerDirPath = "../../apps/runtime/src/utils/get-worker-dir";
      const poolConfigPath = "../../apps/runtime/src/libs/pool/config";

      const workerDirModule = (await import(getWorkerDirPath)) as {
        createWorkerResolver: (workerDirs: string[]) => GetWorkerDir;
      };
      const poolConfigModule = (await import(poolConfigPath)) as {
        loadWorkerConfig: LoadWorkerConfig;
      };

      getWorkerDir = workerDirModule.createWorkerResolver(ctx.globalConfig.workerDirs);
      loadWorkerConfig = poolConfigModule.loadWorkerConfig;

      ctx.logger.info(`Virtual hosts configured: ${Object.keys(pluginConfig.hosts).join(", ")}`);
    },

    server: {
      async fetch(req: Request): Promise<Response> {
        const url = new URL(req.url);
        const hostname = url.hostname;

        // Try to match hostname against configured virtual hosts
        const match = matchVirtualHost(hostname, pluginConfig.hosts);

        if (!match) {
          // No match - return 404 to let pipeline continue
          return new Response(null, { status: 404 });
        }

        // Check pathPrefix filter if configured
        if (match.pathPrefix && !url.pathname.startsWith(match.pathPrefix)) {
          return new Response(null, { status: 404 });
        }

        // Resolve worker directory
        const appDir = getWorkerDir(match.app);
        if (!appDir) {
          return new Response(`Virtual host app not found: ${match.app}`, {
            status: 502,
            headers: { "Content-Type": "text/plain" },
          });
        }

        // Load worker configuration
        const workerConfig = await loadWorkerConfig(appDir);

        // Create request with proper base header for root serving
        const workerReq = new Request(req.url, req);
        workerReq.headers.set(BASE_HEADER, "/");

        // Add tenant header if wildcard match
        if (match.tenant) {
          workerReq.headers.set(VHOST_TENANT_HEADER, match.tenant);
        }

        // Route to worker pool
        return pool.fetch(appDir, workerConfig, workerReq);
      },
    },
  };
}

// Re-export types for external use
export type { VHostConfig } from "./server/matcher";
