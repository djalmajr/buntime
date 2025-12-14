import type { BasePluginConfig, BuntimePlugin, PluginContext } from "@buntime/shared/types";
import { api } from "./server/api";
import { setAppsDir } from "./server/services";

export interface DeploymentsConfig extends BasePluginConfig {
  /**
   * Directory containing deployable apps
   * @default Uses first directory from globalConfig.appsDirs
   */
  appsDir?: string;
}

/**
 * Deployments plugin for Buntime
 *
 * Provides:
 * - Fragment UI for deployments management
 * - API endpoints for listing and downloading deployments
 */
export default function deploymentsPlugin(pluginConfig: DeploymentsConfig = {}): BuntimePlugin {
  return {
    base: pluginConfig.base ?? "/api/deployments",
    name: "@buntime/plugin-deployments",
    routes: api,

    // Fragment plugin (can be embedded in shell)
    // Note: This plugin needs restructuring to client/server folders
    // fragment: true,

    // Menu items for shell navigation
    menus: [
      {
        icon: "lucide:rocket",
        path: "/deployments",
        title: "Deployments",
      },
    ],

    onInit(ctx: PluginContext) {
      const config = ctx.config as DeploymentsConfig;
      // Use plugin-specific appsDir if provided, otherwise use first from global config
      const appsDir = config.appsDir ?? ctx.globalConfig.appsDirs[0] ?? "./apps";
      setAppsDir(appsDir);
      ctx.logger.info(`Deployments plugin initialized (appsDir: ${appsDir})`);
    },
  };
}
