/**
 * Virtual Hosts Plugin for Buntime
 *
 * Enables serving workspace apps via custom domains directly at root path.
 * Supports wildcard subdomains for multi-tenancy.
 */
import type { BasePluginConfig, BuntimePlugin, PluginContext } from "@buntime/shared/types";
import { matchVirtualHost, type VHostConfig } from "./server/matcher";

/** Header name for tenant extracted from wildcard subdomain */
const VHOST_TENANT_HEADER = "x-vhost-tenant";

/** Header name for base path (used by runtime's wrapper.ts) */
const BASE_HEADER = "x-base";

export interface VHostsPluginConfig extends BasePluginConfig {
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

// Local type for worker config (subset of what we need)
interface WorkerConfigLike {
  entrypoint?: string;
  timeout?: number;
}

// Type for the pool interface we need
interface PoolLike {
  fetch(appDir: string, config: WorkerConfigLike, req: Request): Promise<Response>;
}

// Type for the app resolver function
type GetAppDir = (appName: string) => string;

// Type for worker config loader
type LoadWorkerConfig = (appDir: string) => Promise<WorkerConfigLike>;

/**
 * Virtual Hosts plugin for Buntime
 *
 * Allows serving workspace apps via custom domains:
 * - `sked.ly` → serves `skedly@latest` at root `/`
 * - `*.sked.ly` → captures subdomain as tenant header
 */
export default function vhostsPlugin(pluginConfig: VHostsPluginConfig): BuntimePlugin {
  // These will be set during onInit
  let pool: PoolLike;
  let getAppDir: GetAppDir;
  let loadWorkerConfig: LoadWorkerConfig;

  return {
    name: "@buntime/plugin-vhosts",
    base: "", // No routes of its own

    async onInit(ctx: PluginContext) {
      // Get pool from context
      pool = ctx.pool as PoolLike;

      // Import runtime utilities dynamically (builtin plugin can access runtime internals)
      // Using string variable to prevent TypeScript from following the import
      const getAppDirPath = "../../runtime/src/utils/get-app-dir";
      const poolConfigPath = "../../runtime/src/libs/pool/config";

      const appDirModule = (await import(getAppDirPath)) as {
        createAppResolver: (workspaces: string[]) => GetAppDir;
      };
      const poolConfigModule = (await import(poolConfigPath)) as {
        loadWorkerConfig: LoadWorkerConfig;
      };

      getAppDir = appDirModule.createAppResolver(ctx.globalConfig.workspaces);
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

        // Resolve app directory
        const appDir = getAppDir(match.app);
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
