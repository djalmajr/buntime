import type { BasePluginConfig, BuntimePlugin, PluginContext } from "@buntime/shared/types";
import { setAppsDirs } from "./server/api";

export interface DeploymentsConfig extends BasePluginConfig {
  /**
   * Directories containing deployable apps
   * @default Uses globalConfig.appsDirs
   */
  appsDirs?: string[];
}

/**
 * Deployments plugin for Buntime
 *
 * Provides:
 * - Fragment UI for deployments management
 * - API endpoints for file operations (list, upload, download, etc.)
 */
export default function deploymentsPlugin(_pluginConfig: DeploymentsConfig = {}): BuntimePlugin {
  return {
    name: "@buntime/plugin-deployments",

    // Fragment with monkey-patch sandbox (internal plugin)
    fragment: {
      type: "monkey-patch",
    },

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
      // Use plugin-specific appsDirs if provided, otherwise use global config
      const appsDirs = config.appsDirs ?? ctx.globalConfig.appsDirs ?? ["./apps"];
      setAppsDirs(appsDirs);
      ctx.logger.info(`Deployments plugin initialized (appsDirs: ${appsDirs.join(", ")})`);
    },
  };
}
