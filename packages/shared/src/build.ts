/**
 * Shared build utilities for Buntime plugins
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
 *   external: ["@buntime/shared"],
 * }).run();
 * ```
 */
import { existsSync, rmSync, watch } from "node:fs";
import { basename, join } from "node:path";
import type { BunPlugin } from "bun";

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

  const external = config.external ?? ["@buntime/shared"];
  const watchDirs =
    config.watchDirs ?? (config.client ? ["./client", "./server", "."] : ["./server", "."]);
  const watchExtensions = config.client ? /\.(ts|tsx|css|html|json)$/ : /\.(ts|tsx)$/;

  async function build(): Promise<boolean> {
    // Clean dist
    try {
      rmSync(join(cwd, "dist"), { recursive: true, force: true });
    } catch {}

    console.log(`Building ${config.name}...`);

    // Build server
    const serverResult = await Bun.build({
      entrypoints: ["./index.ts"],
      external,
      minify: !isWatch,
      outdir: "./dist",
      splitting: true,
      target: "bun",
    });

    if (!serverResult.success) {
      console.error("Server build failed:", serverResult.logs);
      if (!isWatch) process.exit(1);
      return false;
    }

    // Build client if configured
    if (config.client) {
      const clientEntry = join(cwd, "client/index.html");
      if (!existsSync(clientEntry)) {
        console.error(`Client entry not found: ${clientEntry}`);
        if (!isWatch) process.exit(1);
        return false;
      }

      // Dynamic imports to avoid requiring these in server-only plugins
      // Plugins read their config from bunfig.toml in the plugin directory
      const plugins: BunPlugin[] = [];

      // Iconify plugin (virtual:icons) - reads dirs from bunfig.toml
      try {
        const { default: iconify } = await import("@zomme/bun-plugin-iconify");
        plugins.push(iconify);
      } catch {
        // Plugin not available, skip
      }

      // i18next plugin (translations) - reads dirs from bunfig.toml
      try {
        const { default: i18next } = await import("@zomme/bun-plugin-i18next");
        plugins.push(i18next);
      } catch {
        // Plugin not available, skip
      }

      // Tailwind plugin
      try {
        const { default: tailwind } = await import("bun-plugin-tailwind");
        plugins.push(tailwind);
      } catch {
        // Plugin not available, skip
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
