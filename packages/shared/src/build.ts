/**
 * Shared build utilities for Buntime plugins and apps
 *
 * ## Plugin Builder
 *
 * Usage in plugin scripts/build.ts:
 *
 * ```ts
 * import { createPluginBuilder } from "@buntime/shared/build";
 *
 * // Server-only plugin
 * createPluginBuilder({ name: "plugin-metrics" }).run();
 *
 * // Plugin with client (uses iconify, i18next, tailwind)
 * createPluginBuilder({
 *   name: "plugin-health",
 *   client: true,
 * }).run();
 * ```
 *
 * ### Conditional Build
 *
 * Plugin builds are conditional based on `manifest.jsonc` in the plugin directory.
 * If `enabled: false`, the build is skipped:
 *
 * ```jsonc
 * // plugins/plugin-metrics/manifest.jsonc
 * {
 *   "enabled": false,  // Build will be skipped
 *   "entrypoint": "dist/client/index.html"
 * }
 * ```
 *
 * This allows having plugins in the directory without building them.
 *
 * ## App Builder
 *
 * Usage in app scripts/build.ts:
 *
 * ```ts
 * import { createAppBuilder } from "@buntime/shared/build";
 *
 * // Basic app (server + client)
 * createAppBuilder({ name: "my-app" }).run();
 *
 * // App with extra external dependencies
 * createAppBuilder({
 *   name: "cpanel",
 *   external: ["asciidoctor"],
 * }).run();
 * ```
 *
 * ## Watch Mode
 *
 * Both builders support watch mode with `--watch` flag:
 *
 * ```bash
 * bun scripts/build.ts --watch
 * ```
 */
import { existsSync, rmSync, watch } from "node:fs";
import { basename, join } from "node:path";
import type { BunPlugin } from "bun";
import { isEnabledSync } from "./utils/buntime-config";

export interface PluginBuildConfig {
  /** Plugin name for logging (e.g., "plugin-health") */
  name: string;
  /** Build client (looks for client/index.html) */
  client?: boolean;
  /** External dependencies to exclude from bundle */
  external?: string[];
  /** Additional watch directories */
  watchDirs?: string[];
}

export interface PluginBuilder {
  run(): Promise<void>;
}

/**
 * Create a plugin builder with watch mode support
 */
export function createPluginBuilder(config: PluginBuildConfig): PluginBuilder {
  const isWatch = process.argv.includes("--watch");
  const cwd = process.cwd();

  // Bundle everything by default - plugins should be self-contained
  const external = config.external ?? [];
  const watchDirs =
    config.watchDirs ?? (config.client ? ["./client", "./server", "."] : ["./server", "."]);
  const watchExtensions = config.client ? /\.(ts|tsx|css|html|json)$/ : /\.(ts|tsx)$/;

  async function build(): Promise<boolean> {
    // Clean dist
    try {
      rmSync(join(cwd, "dist"), { recursive: true, force: true });
    } catch {}

    console.log(`Building ${config.name}...`);

    // Build plugin definition (plugin.ts → dist/plugin.js)
    const hasPluginTs = existsSync(join(cwd, "plugin.ts"));
    if (hasPluginTs) {
      const pluginResult = await Bun.build({
        entrypoints: ["./plugin.ts"],
        external,
        minify: !isWatch,
        outdir: "./dist",
        splitting: true,
        target: "bun",
      });

      if (!pluginResult.success) {
        console.error("Plugin build failed:", pluginResult.logs);
        if (!isWatch) process.exit(1);
        return false;
      }
    }

    // Build worker entrypoint (index.ts → dist/index.js)
    const hasIndexTs = existsSync(join(cwd, "index.ts"));
    if (hasIndexTs) {
      const serverResult = await Bun.build({
        entrypoints: ["./index.ts"],
        external,
        minify: !isWatch,
        outdir: "./dist",
        splitting: true,
        target: "bun",
      });

      if (!serverResult.success) {
        console.error("Worker build failed:", serverResult.logs);
        if (!isWatch) process.exit(1);
        return false;
      }
    }

    // Build client if configured
    if (config.client) {
      const clientEntry = join(cwd, "client/index.html");
      if (!existsSync(clientEntry)) {
        console.error(`Client entry not found: ${clientEntry}`);
        if (!isWatch) process.exit(1);
        return false;
      }

      // Load plugins from bunfig.toml if it exists
      const plugins: BunPlugin[] = [];
      const bunfigPath = join(cwd, "bunfig.toml");

      if (existsSync(bunfigPath)) {
        const bunfig = (await import(bunfigPath)) as {
          default: { serve?: { static?: { plugins?: string[] } } };
        };
        const pluginNames = bunfig.default?.serve?.static?.plugins ?? [];

        for (const name of pluginNames) {
          try {
            const { default: plugin } = await import(name);
            plugins.push(plugin);
          } catch {
            console.warn(`Plugin ${name} not available, skipping`);
          }
        }
      } else {
        // Fallback: load default plugins if no bunfig.toml
        const defaultPlugins = [
          "@zomme/bun-plugin-iconify",
          "@zomme/bun-plugin-i18next",
          "bun-plugin-tailwind",
        ];

        for (const name of defaultPlugins) {
          try {
            const { default: plugin } = await import(name);
            plugins.push(plugin);
          } catch {
            // Plugin not available, skip
          }
        }
      }

      const clientResult = await Bun.build({
        entrypoints: ["./client/index.html"],
        minify: !isWatch,
        outdir: "./dist/client",
        plugins,
        publicPath: "./",
        splitting: true,
        target: "browser",
      });

      if (!clientResult.success) {
        console.error("Client build failed:", clientResult.logs);
        if (!isWatch) process.exit(1);
        return false;
      }
    }

    console.log("Build completed successfully");
    return true;
  }

  async function run(): Promise<void> {
    // Check if plugin is enabled
    if (!isEnabledSync(cwd)) {
      console.log(`Skipping ${config.name} (disabled in manifest.jsonc)`);
      return;
    }

    // Initial build
    await build();

    // Watch mode
    if (isWatch) {
      console.log("\nWatching for changes...");

      let debounce: Timer | null = null;

      for (const dir of watchDirs) {
        const fullPath = join(cwd, dir);
        if (!existsSync(fullPath)) continue;

        watch(fullPath, { recursive: true }, (event, filename) => {
          if (!filename || filename.includes("dist")) return;
          if (!watchExtensions.test(filename)) return;

          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(async () => {
            console.log(`\n[${event}] ${filename}`);
            await build();
          }, 100);
        });
      }
    }
  }

  return { run };
}

/**
 * Infer plugin name from current directory
 */
export function inferPluginName(): string {
  return basename(process.cwd());
}

// =============================================================================
// App Builder
// =============================================================================

export interface AppBuildConfig {
  /** App name for logging (e.g., "cpanel") */
  name: string;
  /** Client-only mode: no server build (default: false) */
  clientOnly?: boolean;
  /** Extra external dependencies to exclude (added to @buntime/*) */
  external?: string[];
  /** Source directory for clientOnly mode (default: "./src") */
  srcDir?: string;
  /** Additional watch directories (defaults to ["./client", "./server", "."] or ["./src"] for clientOnly) */
  watchDirs?: string[];
}

export interface AppBuilder {
  run(): Promise<void>;
}

/**
 * Create an app builder with watch mode support
 * Apps can be server + client (default) or client-only (clientOnly: true)
 */
export function createAppBuilder(config: AppBuildConfig): AppBuilder {
  const isWatch = process.argv.includes("--watch");
  const cwd = process.cwd();

  // @buntime/shared is provided by runtime, @buntime/database is bundled (HTTP client)
  const external = ["@buntime/shared", "@buntime/shadcn-ui", ...(config.external ?? [])];
  const srcDir = config.srcDir ?? "./src";
  const watchDirs =
    config.watchDirs ?? (config.clientOnly ? [srcDir] : ["./client", "./server", "."]);
  const watchExtensions = /\.(ts|tsx|css|html|json)$/;

  async function loadPlugins(): Promise<BunPlugin[]> {
    const plugins: BunPlugin[] = [];
    const bunfigPath = join(cwd, "bunfig.toml");

    if (existsSync(bunfigPath)) {
      const bunfig = (await import(bunfigPath)) as {
        default: { serve?: { static?: { plugins?: string[] } } };
      };
      const pluginNames = bunfig.default?.serve?.static?.plugins ?? [];

      for (const name of pluginNames) {
        try {
          const { default: plugin } = await import(name);
          plugins.push(plugin);
        } catch {
          console.warn(`Plugin ${name} not available, skipping`);
        }
      }
    } else {
      // Fallback: load default plugins
      const defaultPlugins = [
        "@zomme/bun-plugin-tsr",
        "@zomme/bun-plugin-iconify",
        "@zomme/bun-plugin-i18next",
        "bun-plugin-tailwind",
      ];

      for (const name of defaultPlugins) {
        try {
          const { default: plugin } = await import(name);
          plugins.push(plugin);
        } catch {
          // Plugin not available, skip
        }
      }
    }

    return plugins;
  }

  async function build(): Promise<boolean> {
    // Clean dist
    try {
      rmSync(join(cwd, "dist"), { recursive: true, force: true });
    } catch {}

    console.log(`Building ${config.name}...`);

    // Load client plugins
    const plugins = await loadPlugins();

    if (config.clientOnly) {
      // Client-only build
      const entrypoint = `${srcDir}/index.html`;

      if (!existsSync(join(cwd, entrypoint))) {
        console.error(`Entry not found: ${entrypoint}`);
        if (!isWatch) process.exit(1);
        return false;
      }

      const result = await Bun.build({
        entrypoints: [entrypoint],
        minify: !isWatch,
        outdir: "./dist",
        plugins,
        publicPath: "./",
        splitting: true,
        target: "browser",
      });

      if (!result.success) {
        console.error("Build failed:", result.logs);
        if (!isWatch) process.exit(1);
        return false;
      }
    } else {
      // Build server and client in parallel
      const [serverResult, clientResult] = await Promise.all([
        Bun.build({
          entrypoints: ["./index.ts"],
          external,
          minify: !isWatch,
          outdir: "./dist",
          splitting: true,
          target: "bun",
        }),
        Bun.build({
          entrypoints: ["./client/index.html"],
          minify: !isWatch,
          outdir: "./dist",
          plugins,
          publicPath: "./",
          splitting: true,
          target: "browser",
        }),
      ]);

      if (!serverResult.success || !clientResult.success) {
        console.error("Build failed:");
        if (!serverResult.success) console.error("Server:", serverResult.logs);
        if (!clientResult.success) console.error("Client:", clientResult.logs);
        if (!isWatch) process.exit(1);
        return false;
      }
    }

    console.log("Build completed successfully");
    return true;
  }

  async function run(): Promise<void> {
    // Initial build
    await build();

    // Watch mode
    if (isWatch) {
      console.log("\nWatching for changes...");

      let debounce: Timer | null = null;

      for (const dir of watchDirs) {
        const fullPath = join(cwd, dir);
        if (!existsSync(fullPath)) continue;

        watch(fullPath, { recursive: true }, (event, filename) => {
          if (!filename || filename.includes("dist")) return;
          if (!watchExtensions.test(filename)) return;

          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(async () => {
            console.log(`\n[${event}] ${filename}`);
            await build();
          }, 100);
        });
      }
    }
  }

  return { run };
}
