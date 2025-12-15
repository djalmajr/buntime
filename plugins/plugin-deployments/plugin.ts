import type {
  BasePluginConfig,
  BuntimePlugin,
  MenuItem,
  PluginContext,
} from "@buntime/shared/types";
import { getDirNames, setWorkspaces } from "./server/api";

export interface DeploymentsConfig extends BasePluginConfig {
  /**
   * Workspace directories containing deployable apps
   * @default Uses globalConfig.workspaces
   */
  workspaces?: string[];
}

/**
 * Deployments plugin for Buntime
 *
 * Provides:
 * - Fragment UI for deployments management
 * - API endpoints for file operations (list, upload, download, etc.)
 */
export default function deploymentsPlugin(_pluginConfig: DeploymentsConfig = {}): BuntimePlugin {
  // Menu items will be populated dynamically in onInit
  const menus: MenuItem[] = [
    {
      icon: "lucide:rocket",
      path: "/deployments",
      priority: 10,
      title: "Deployments",
    },
  ];

  return {
    name: "@buntime/plugin-deployments",

    // Fragment with monkey-patch sandbox (internal plugin)
    fragment: {
      type: "monkey-patch",
    },

    // Menu items for shell navigation (populated in onInit)
    menus,

    onInit(ctx: PluginContext) {
      const config = ctx.config as DeploymentsConfig;
      // Use plugin-specific workspaces if provided, otherwise use global config
      const workspaces = config.workspaces ?? ctx.globalConfig.workspaces ?? ["./apps"];
      setWorkspaces(workspaces);

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

      ctx.logger.info(`Deployments plugin initialized (workspaces: ${workspaces.join(", ")})`);
    },
  };
}
