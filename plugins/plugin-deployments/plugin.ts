import type { BasePluginConfig, MenuItem, PluginContext, PluginImpl } from "@buntime/shared/types";
import { getDirNames, setExcludes, setWorkerDirs } from "./server/api";

export interface DeploymentsConfig extends BasePluginConfig {
  /**
   * Directories containing deployable apps
   * @default Uses globalConfig.workerDirs
   */
  workerDirs?: string[];

  /**
   * Global folder patterns to exclude from listing.
   * These are merged with defaults and hidden across all app directories.
   *
   * Per-app excludes can also be set in package.json:
   * ```json
   * { "buntime": { "excludes": [".turbo", "coverage"] } }
   * ```
   *
   * @default [".git", "node_modules"]
   * @example ["dist", ".cache"] // Adds to defaults
   */
  excludes?: string[];

  /**
   * Menu items from manifest (passed by loader)
   * @internal
   */
  menus?: MenuItem[];
}

/**
 * Deployments plugin for Buntime
 *
 * Provides:
 * - UI for deployments management (via worker)
 * - API endpoints for file operations (via worker - serverless)
 *
 * This plugin runs as serverless (API in index.ts worker, not persistent).
 * The onInit hook only configures menu items dynamically.
 */
export default function deploymentsPlugin(pluginConfig: DeploymentsConfig = {}): PluginImpl {
  // Menu items from manifest (passed by loader, modified dynamically in onInit)
  const menus = pluginConfig.menus ?? [];

  return {
    // No routes here - API runs in worker (index.ts) for serverless mode

    onInit(ctx: PluginContext) {
      const config = ctx.config as DeploymentsConfig;
      // Use plugin-specific workerDirs if provided, otherwise use global config
      const workerDirs = config.workerDirs ?? ctx.globalConfig.workerDirs ?? ["./apps"];
      setWorkerDirs(workerDirs);

      // Set global excludes (defaults applied in api.ts)
      if (config.excludes) {
        setExcludes(config.excludes);
      }

      // Generate submenu items for each directory (only if more than one)
      const dirNames = getDirNames();
      const mainMenu = menus[0];
      if (dirNames.length > 1 && mainMenu) {
        mainMenu.items = dirNames.map((name) => ({
          icon: "lucide:folder",
          path: `/deployments/${name}`,
          title: name,
        }));
      }

      ctx.logger.info(`Deployments plugin initialized (workerDirs: ${workerDirs.join(", ")})`);
    },
  };
}
