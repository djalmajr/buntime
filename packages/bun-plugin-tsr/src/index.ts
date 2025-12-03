import { existsSync, watch as fsWatch } from "node:fs";
import { join, resolve } from "node:path";
import { type Config, Generator, getConfig as getTSRConfig } from "@tanstack/router-generator";
import type { BunPlugin } from "bun";

type TSRConfig = Partial<Config> & { rootDirectory: string };

interface PluginsBunfig {
  plugins?: {
    tsr?: Partial<Config> & {
      rootDirectory?: string | string[];
    };
  };
}

function getConfig(): TSRConfig[] {
  try {
    const bunfig = require(resolve(process.cwd(), "bunfig.toml")) as PluginsBunfig;
    const config = bunfig?.plugins?.tsr;

    if (config?.rootDirectory) {
      const { rootDirectory, ...rest } = config;
      const dirs = Array.isArray(rootDirectory) ? rootDirectory : [rootDirectory];

      return dirs.map((dir) => ({
        ...rest,
        rootDirectory: resolve(process.cwd(), dir),
      }));
    }
  } catch {
    // Ignore errors
  }

  // Fallback: auto-detect src/
  const srcDir = resolve(process.cwd(), "src");
  if (existsSync(srcDir)) {
    return [{ rootDirectory: srcDir }];
  }

  return [];
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
  const config = getTSRConfig({ ...defaults, ...configOverrides }, root);
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

// Generate routes at import time (like other plugins pre-collect data)
const configs = getConfig();

if (configs.length > 0) {
  const shouldWatch = process.env.NODE_ENV !== "production";
  await Promise.all(configs.map((cfg) => generateRoutes(cfg, shouldWatch)));
}

function tsrPlugin(): BunPlugin {
  return {
    name: "tsr",
    setup() {
      // Routes already generated at import time
    },
  };
}

export default tsrPlugin();
