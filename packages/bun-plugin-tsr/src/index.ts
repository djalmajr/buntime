import { watch as fsWatch } from "node:fs";
import { join, resolve } from "node:path";
import { type Config, Generator, getConfig } from "@tanstack/router-generator";
import type { BunPlugin } from "bun";

type TSRConfig = Partial<Config> & { rootDirectory: string };

export interface TSRPluginOptions {
  /**
   * Enable watch mode to regenerate routes on file changes.
   */
  watch?: boolean;

  /**
   * Configuration for TanStack Router generation.
   * Can be a single config or an array of configs for multiple root directories.
   */
  config?: TSRConfig | TSRConfig[];
}

const defaults = {
  generatedRouteTree: "routeTree.gen.ts",
  quoteStyle: "double",
  routeFileIgnorePattern: ".test.",
  routesDirectory: "./routes",
} as const;

async function generateRoutes(tsrConfig: TSRConfig, watchMode: boolean): Promise<void> {
  const root = resolve(process.cwd(), tsrConfig.rootDirectory);
  const { rootDirectory: _, ...configOverrides } = tsrConfig;
  const config = getConfig({ ...defaults, ...configOverrides }, root);
  const routesDir = resolve(root, config.routesDirectory);
  const generator = new Generator({ config, root });

  await generator.run();
  console.log(`[tsr] Routes generated for ${root}`);

  if (watchMode) {
    fsWatch(routesDir, { recursive: true }, async (eventType, filename) => {
      if (!filename || filename.includes("routeTree.gen")) return;

      const filePath = join(routesDir, filename);

      try {
        if (eventType === "rename") {
          const exists = await Bun.file(filePath).exists();
          await generator.run({ type: exists ? "create" : "delete", path: filePath });
        } else if (eventType === "change") {
          await generator.run({ type: "update", path: filePath });
        }

        console.log(`[tsr] Routes updated (${eventType}: ${filename})`);
      } catch (err) {
        console.error(`[tsr] Error generating routes for ${root}`, err);
      }
    });

    console.log(`[tsr] Watching ${routesDir}`);
  }
}

export function tsrPlugin(options: TSRPluginOptions = {}): BunPlugin {
  const { watch: watchMode = false, config } = options;

  return {
    name: "tsr",
    async setup() {
      if (!config) {
        console.warn("[tsr] No config provided");
        return;
      }

      const configs = Array.isArray(config) ? config : [config];

      if (configs.length === 0) {
        console.warn("[tsr] No paths configured");
        return;
      }

      await Promise.all(configs.map((cfg) => generateRoutes(cfg, watchMode)));
    },
  };
}

export default tsrPlugin;
