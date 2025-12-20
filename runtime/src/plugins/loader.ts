import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { getChildLogger } from "@buntime/shared/logger";
import type {
  BuntimeConfig,
  BuntimePlugin,
  PluginConfig,
  PluginContext,
  PluginFactory,
  PluginModule,
  PublicRoutesConfig,
} from "@buntime/shared/types";
import { getConfig, IS_COMPILED } from "@/config";
import { getBuiltinPlugin } from "./builtin";
import { createPluginLogger, PluginRegistry } from "./registry";

const logger = getChildLogger("PluginLoader");

const EXTERNAL_PLUGINS_DIR = "./plugins";
const BUILTIN_PLUGINS_DIR = "./plugins";

const HTTP_METHODS = ["ALL", "DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"] as const;

/**
 * Merge two PublicRoutesConfig objects
 * Config routes are added to plugin routes (config takes priority for additions)
 */
function mergePublicRoutes(
  pluginRoutes: PublicRoutesConfig | undefined,
  configRoutes: PublicRoutesConfig | undefined,
): PublicRoutesConfig | undefined {
  if (!configRoutes) return pluginRoutes;
  if (!pluginRoutes) return configRoutes;

  // Both are arrays - combine them
  if (Array.isArray(pluginRoutes) && Array.isArray(configRoutes)) {
    return [...new Set([...pluginRoutes, ...configRoutes])];
  }

  // Normalize both to object format
  const normalizeToObject = (routes: PublicRoutesConfig): Record<string, string[]> => {
    if (Array.isArray(routes)) {
      return { ALL: routes };
    }
    return routes as Record<string, string[]>;
  };

  const pluginObj = normalizeToObject(pluginRoutes);
  const configObj = normalizeToObject(configRoutes);

  // Merge each method's routes
  const result: Record<string, string[]> = {};

  for (const method of HTTP_METHODS) {
    const pluginMethodRoutes = pluginObj[method] || [];
    const configMethodRoutes = configObj[method] || [];
    const merged = [...new Set([...pluginMethodRoutes, ...configMethodRoutes])];
    if (merged.length > 0) {
      result[method] = merged;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

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
 * Parsed plugin info for topological sorting
 */
interface ParsedPlugin {
  name: string;
  options: Record<string, unknown>;
  dependencies: string[];
  optionalDependencies: string[];
}

/**
 * Resolved plugin module with its directory
 */
interface ResolvedPluginModule {
  module: PluginModule;
  dir: string;
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
   * Plugins are sorted topologically based on dependencies
   */
  async load(): Promise<PluginRegistry> {
    const pluginConfigs = this.config.plugins || [];
    const configuredNames = new Set<string>();

    // First pass: collect all configured plugin names
    for (const pluginConfig of pluginConfigs) {
      const { name } = parsePluginConfig(pluginConfig);
      configuredNames.add(name);
    }

    // Second pass: parse plugins and resolve dependencies
    const parsedPlugins: ParsedPlugin[] = [];

    for (const pluginConfig of pluginConfigs) {
      const { name, options } = parsePluginConfig(pluginConfig);

      // Load plugin module to get dependencies
      const { module } = await this.resolvePluginModule(name);
      const plugin = await resolvePlugin(module, options);

      // Filter optional dependencies to only those that are configured
      const optionalDeps = (plugin.optionalDependencies || []).filter((dep) =>
        configuredNames.has(dep),
      );

      parsedPlugins.push({
        name,
        options,
        dependencies: plugin.dependencies || [],
        optionalDependencies: optionalDeps,
      });
    }

    // Topological sort
    const sorted = this.topologicalSort(parsedPlugins, configuredNames);

    // Load plugins in sorted order
    for (const { name, options } of sorted) {
      try {
        await this.loadPlugin(name, options);
      } catch (error) {
        logger.error(`Failed to load plugin "${name}"`, { error: String(error) });
        throw error;
      }
    }

    return this.registry;
  }

  /**
   * Topological sort using Kahn's algorithm
   * Considers both required and optional dependencies
   */
  private topologicalSort(plugins: ParsedPlugin[], configuredNames: Set<string>): ParsedPlugin[] {
    const pluginMap = new Map<string, ParsedPlugin>();
    const inDegree = new Map<string, number>();
    const graph = new Map<string, string[]>();

    // Initialize
    for (const plugin of plugins) {
      pluginMap.set(plugin.name, plugin);
      inDegree.set(plugin.name, 0);
      graph.set(plugin.name, []);
    }

    // Build graph edges
    for (const plugin of plugins) {
      const allDeps = [...plugin.dependencies, ...plugin.optionalDependencies];

      for (const dep of allDeps) {
        // Only consider deps that are configured
        if (configuredNames.has(dep)) {
          graph.get(dep)?.push(plugin.name);
          inDegree.set(plugin.name, (inDegree.get(plugin.name) || 0) + 1);
        }
      }

      // Validate required dependencies are configured
      for (const dep of plugin.dependencies) {
        if (!configuredNames.has(dep)) {
          throw new Error(
            `Plugin "${plugin.name}" requires "${dep}" which is not configured. ` +
              `Add "${dep}" to your buntime.jsonc plugins array.`,
          );
        }
      }
    }

    // Kahn's algorithm
    const queue: string[] = [];
    const result: ParsedPlugin[] = [];

    // Start with plugins that have no dependencies
    for (const [name, degree] of inDegree) {
      if (degree === 0) {
        queue.push(name);
      }
    }

    while (queue.length > 0) {
      const name = queue.shift()!;
      const plugin = pluginMap.get(name)!;
      result.push(plugin);

      for (const dependent of graph.get(name) || []) {
        const newDegree = (inDegree.get(dependent) || 0) - 1;
        inDegree.set(dependent, newDegree);

        if (newDegree === 0) {
          queue.push(dependent);
        }
      }
    }

    // Check for cycles
    if (result.length !== plugins.length) {
      const remaining = plugins.filter((p) => !result.find((r) => r.name === p.name));
      throw new Error(
        `Circular dependency detected among plugins: ${remaining.map((p) => p.name).join(", ")}`,
      );
    }

    return result;
  }

  /**
   * Resolve a plugin module by name (without loading)
   *
   * Resolution order:
   * 1. Built-in plugins (always available, embedded in binary)
   * 2. External plugins from ./plugins/ directory
   * 3. Node modules (dev/bundle mode only)
   *
   * Returns both the module and its directory for worker spawning
   */
  private async resolvePluginModule(name: string): Promise<ResolvedPluginModule> {
    // Helper to resolve plugin directory from package name
    const resolveDir = (packageName: string): string => {
      try {
        const resolvedPath = Bun.resolveSync(packageName, process.cwd());
        return dirname(resolvedPath);
      } catch {
        return "";
      }
    };

    // Helper to resolve built-in plugin directory in compiled mode
    // Looks for ./plugins/{shortName}/ with index.html (fragment UI)
    const resolveBuiltinDir = (packageName: string): string => {
      const shortName = packageName.replace(/^@buntime\/plugin-/, "").replace(/^@buntime\//, "");
      const pluginDir = join(process.cwd(), BUILTIN_PLUGINS_DIR, shortName);
      const indexHtml = join(pluginDir, "index.html");

      if (existsSync(indexHtml)) {
        return pluginDir;
      }
      return "";
    };

    // 1. Try built-in plugins first (works in compiled binary)
    const builtinFactory = await getBuiltinPlugin(name);
    if (builtinFactory) {
      // In compiled mode, try to find plugin directory in ./plugins/
      // In dev mode, use Bun.resolveSync
      const dir = IS_COMPILED ? resolveBuiltinDir(name) : resolveDir(name);
      return { module: builtinFactory, dir };
    }

    // 2. Try external plugins directory
    const externalPath = await this.resolveExternalPlugin(name);
    if (externalPath) {
      const module = await import(externalPath);
      // External plugins: directory is parent of the resolved file
      const dir = dirname(externalPath);
      return { module, dir };
    }

    // 3. Try node_modules (dev/bundle mode)
    try {
      const module = await import(name);
      const dir = resolveDir(name);
      return { module, dir };
    } catch {
      throw new Error(
        `Could not resolve plugin "${name}". ` +
          `Not a built-in plugin and not found in ${EXTERNAL_PLUGINS_DIR}/`,
      );
    }
  }

  /**
   * Load a single plugin by name
   */
  async loadPlugin(name: string, options: Record<string, unknown> = {}): Promise<BuntimePlugin> {
    // Check if already loaded
    if (this.registry.has(name)) {
      throw new Error(`Plugin "${name}" is already loaded`);
    }

    const { module, dir } = await this.resolvePluginModule(name);
    const plugin = await resolvePlugin(module, options);

    // Validate plugin structure
    if (!plugin.name) {
      throw new Error(`Plugin "${name}" is missing required field: name`);
    }
    if (!plugin.base) {
      throw new Error(`Plugin "${name}" is missing required field: base`);
    }

    // Validate dependencies are loaded (already sorted topologically, so this should pass)
    if (plugin.dependencies) {
      for (const dep of plugin.dependencies) {
        if (!this.registry.has(dep)) {
          throw new Error(
            `Plugin "${name}" requires "${dep}" to be loaded first. ` +
              `Add "${dep}" to your buntime.jsonc plugins array.`,
          );
        }
      }
    }

    // Merge publicRoutes from config (config routes are added to plugin routes)
    if (options.publicRoutes) {
      plugin.publicRoutes = mergePublicRoutes(
        plugin.publicRoutes,
        options.publicRoutes as PublicRoutesConfig,
      );
    }

    // Override base from config if specified
    // Plugins define their own base path (e.g., "/cpanel", "/metrics")
    if (options.base !== undefined) {
      plugin.base = options.base as string;
    }

    // Create context for initialization with service access
    // Use resolved config (with env var substitution) for workspaces
    const registry = this.registry;
    const runtimeConfig = getConfig();
    const globalConfig = {
      poolSize: runtimeConfig.poolSize,
      workspaces: runtimeConfig.workspaces,
    };

    const context: PluginContext = {
      config: options,
      globalConfig,
      logger: createPluginLogger(plugin.name),
      pool: this.pool,
      registerService<T>(serviceName: string, service: T): void {
        registry.registerService(serviceName, service);
      },
      getService<T>(serviceName: string): T | undefined {
        return registry.getService<T>(serviceName);
      },
    };

    // Initialize plugin
    if (plugin.onInit) {
      await plugin.onInit(context);
    }

    // Register plugin with its directory (for spawning as worker)
    this.registry.register(plugin, dir || undefined);

    logger.info(`Loaded: ${plugin.name}${dir ? ` (${dir})` : ""}`);

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

  logger.info(`Loaded configuration from ${configPath}`);
  return cfg as BuntimeConfig;
}

export interface LoadedBuntimeConfig {
  baseDir: string;
  config: BuntimeConfig;
}

/**
 * Load buntime configuration from file
 * Priority: buntime.jsonc (JSONC with comments support)
 */
export async function loadBuntimeConfig(): Promise<LoadedBuntimeConfig> {
  // Primary: buntime.jsonc
  try {
    const jsoncPath = Bun.resolveSync("./buntime.jsonc", process.cwd());
    const file = Bun.file(jsoncPath);

    if (await file.exists()) {
      // Bun natively parses JSONC (strips comments and trailing commas)
      const config = await import(jsoncPath);
      return {
        baseDir: dirname(jsoncPath),
        config: validateBuntimeConfig(config.default ?? config, "buntime.jsonc"),
      };
    }
  } catch (err) {
    if (err instanceof Error && !err.message.includes("Cannot find module")) {
      throw new Error(`[buntime.jsonc] Failed to parse: ${err.message}`);
    }
  }

  // No config file found, return empty config with cwd as base
  return { baseDir: process.cwd(), config: {} };
}
