import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  BuntimeConfig,
  BuntimePlugin,
  PluginConfig,
  PluginContext,
  PluginFactory,
  PluginModule,
} from "@buntime/shared/types";
import { getBuiltinPlugin } from "./builtin";
import { createPluginLogger, PluginRegistry } from "./registry";

const EXTERNAL_PLUGINS_DIR = "./plugins";

/**
 * Resolve a plugin module to a BuntimePlugin
 */
function resolvePlugin(
  mod: PluginModule,
  config: Record<string, unknown>,
): BuntimePlugin | Promise<BuntimePlugin> {
  // Handle default export
  if ("default" in mod) {
    return resolvePlugin(mod.default as PluginModule, config);
  }

  // Handle factory function
  if (typeof mod === "function") {
    return (mod as PluginFactory)(config);
  }

  // Handle direct plugin object
  return mod as BuntimePlugin;
}

/**
 * Parse plugin configuration from Babel-style format
 */
function parsePluginConfig(config: PluginConfig): {
  name: string;
  options: Record<string, unknown>;
} {
  if (typeof config === "string") {
    return { name: config, options: {} };
  }

  const [name, options = {}] = config;
  return { name, options };
}

/**
 * Load plugins from configuration
 */
export class PluginLoader {
  private registry = new PluginRegistry();
  private config: BuntimeConfig;
  private pool?: unknown;

  constructor(config: BuntimeConfig = {}, pool?: unknown) {
    this.config = config;
    this.pool = pool;
  }

  /**
   * Load all plugins from configuration
   */
  async load(): Promise<PluginRegistry> {
    const plugins = this.config.plugins || [];

    for (const pluginConfig of plugins) {
      const { name, options } = parsePluginConfig(pluginConfig);

      try {
        await this.loadPlugin(name, options);
      } catch (error) {
        console.error(`[PluginLoader] Failed to load plugin "${name}":`, error);
        throw error;
      }
    }

    return this.registry;
  }

  /**
   * Load a single plugin by name
   *
   * Resolution order:
   * 1. Built-in plugins (always available, embedded in binary)
   * 2. External plugins from ./plugins/ directory
   * 3. Node modules (dev/bundle mode only)
   */
  async loadPlugin(name: string, options: Record<string, unknown> = {}): Promise<BuntimePlugin> {
    // Check if already loaded
    if (this.registry.has(name)) {
      throw new Error(`Plugin "${name}" is already loaded`);
    }

    let mod: PluginModule;

    // 1. Try built-in plugins first (works in compiled binary)
    const builtinFactory = await getBuiltinPlugin(name);
    if (builtinFactory) {
      mod = builtinFactory;
    } else {
      // 2. Try external plugins directory
      const externalPath = await this.resolveExternalPlugin(name);
      if (externalPath) {
        mod = await import(externalPath);
      } else {
        // 3. Try node_modules (dev/bundle mode)
        try {
          mod = await import(name);
        } catch {
          throw new Error(
            `Could not resolve plugin "${name}". ` +
              `Not a built-in plugin and not found in ${EXTERNAL_PLUGINS_DIR}/`,
          );
        }
      }
    }

    // Resolve to BuntimePlugin
    const plugin = await resolvePlugin(mod, options);

    // Validate plugin structure
    if (!plugin.name || !plugin.version) {
      throw new Error(`Plugin "${name}" is missing required fields (name, version)`);
    }

    // Validate dependencies are loaded (declared in plugin code)
    if (plugin.dependencies) {
      for (const dep of plugin.dependencies) {
        if (!this.registry.has(dep)) {
          throw new Error(
            `Plugin "${name}" requires "${dep}" to be loaded first. ` +
              `Add "${dep}" before "${name}" in your buntime.jsonc plugins array.`,
          );
        }
      }
    }

    // Create context for initialization
    const context: PluginContext = {
      config: options,
      logger: createPluginLogger(plugin.name),
      pool: this.pool,
    };

    // Initialize plugin
    if (plugin.onInit) {
      await plugin.onInit(context);
    }

    // Register plugin
    this.registry.register(plugin);

    console.log(`[PluginLoader] Loaded: ${plugin.name}@${plugin.version}`);

    return plugin;
  }

  /**
   * Get the plugin registry
   */
  getRegistry(): PluginRegistry {
    return this.registry;
  }

  /**
   * Try to resolve a plugin from the external plugins directory
   * Looks for: ./plugins/{name}.ts, ./plugins/{name}/index.ts
   */
  private async resolveExternalPlugin(name: string): Promise<string | null> {
    const cwd = process.cwd();
    const pluginsDir = join(cwd, EXTERNAL_PLUGINS_DIR);

    if (!existsSync(pluginsDir)) {
      return null;
    }

    // Extract short name from @buntime/plugin-xxx or @buntime/xxx
    const shortName = name.replace(/^@buntime\/plugin-/, "").replace(/^@buntime\//, "");

    // Try direct file: ./plugins/{name}.ts
    const directPath = join(pluginsDir, `${shortName}.ts`);
    if (existsSync(directPath)) {
      return directPath;
    }

    // Try directory: ./plugins/{name}/index.ts
    const dirPath = join(pluginsDir, shortName, "index.ts");
    if (existsSync(dirPath)) {
      return dirPath;
    }

    return null;
  }
}

/**
 * Validate buntime configuration and provide helpful error messages
 */
function validateBuntimeConfig(config: unknown, configPath: string): BuntimeConfig {
  if (config === null || config === undefined) {
    return {};
  }

  if (typeof config !== "object") {
    throw new Error(`[${configPath}] Invalid configuration: expected object, got ${typeof config}`);
  }

  const cfg = config as Record<string, unknown>;

  // Validate plugins section (Babel-style array)
  if (cfg.plugins !== undefined) {
    if (!Array.isArray(cfg.plugins)) {
      throw new Error(`[${configPath}] Invalid "plugins" section: expected array (Babel-style)`);
    }

    // Validate each plugin entry
    for (let i = 0; i < cfg.plugins.length; i++) {
      const entry = cfg.plugins[i];

      // String format: "@buntime/name"
      if (typeof entry === "string") {
        continue;
      }

      // Tuple format: ["@buntime/name", { config }]
      if (Array.isArray(entry)) {
        if (entry.length < 1 || entry.length > 2) {
          throw new Error(
            `[${configPath}] Invalid plugin at index ${i}: tuple must have 1-2 elements`,
          );
        }
        if (typeof entry[0] !== "string") {
          throw new Error(
            `[${configPath}] Invalid plugin at index ${i}: first element must be string`,
          );
        }
        if (entry.length === 2 && (typeof entry[1] !== "object" || entry[1] === null)) {
          throw new Error(
            `[${configPath}] Invalid plugin at index ${i}: second element must be object`,
          );
        }
        continue;
      }

      throw new Error(
        `[${configPath}] Invalid plugin at index ${i}: expected string or [name, config] tuple`,
      );
    }
  }

  console.log(`[Buntime] Loaded configuration from ${configPath}`);
  return cfg as BuntimeConfig;
}

/**
 * Load buntime configuration from file
 * Priority: buntime.jsonc (JSONC with comments support)
 */
export async function loadBuntimeConfig(): Promise<BuntimeConfig> {
  // Primary: buntime.jsonc
  try {
    const jsoncPath = Bun.resolveSync("./buntime.jsonc", process.cwd());
    const file = Bun.file(jsoncPath);

    if (await file.exists()) {
      // Bun natively parses JSONC (strips comments and trailing commas)
      const config = await import(jsoncPath);
      return validateBuntimeConfig(config.default ?? config, "buntime.jsonc");
    }
  } catch (err) {
    if (err instanceof Error && !err.message.includes("Cannot find module")) {
      throw new Error(`[buntime.jsonc] Failed to parse: ${err.message}`);
    }
  }

  // No config file found, return empty config
  return {};
}
