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
} from "@buntime/shared/types";
import { getConfig } from "@/config";
import { IS_DEV, PLUGINS_DIR } from "@/constants";
import { getShortName } from "@/utils/plugins";
import { getBuiltinPlugin } from "./builtin";
import { createPluginLogger, PluginRegistry } from "./registry";

const logger = getChildLogger("PluginLoader");

/**
 * Validate that a module has a valid plugin structure before using it
 * Security: Prevents arbitrary code from being treated as a plugin
 */
function isValidPluginModule(mod: unknown): boolean {
  if (mod === null || mod === undefined) return false;
  if (typeof mod === "function") return true; // Factory function

  if (typeof mod === "object") {
    // Check for default export
    if ("default" in mod) {
      return isValidPluginModule((mod as { default: unknown }).default);
    }
    // Direct plugin object must have 'name' property
    return "name" in mod && typeof (mod as { name: unknown }).name === "string";
  }

  return false;
}

/**
 * Resolve a plugin module to a BuntimePlugin
 */
function resolvePlugin(
  mod: PluginModule,
  config: Record<string, unknown>,
): BuntimePlugin | Promise<BuntimePlugin> {
  // Security: Validate module structure before processing
  if (!isValidPluginModule(mod)) {
    throw new Error(
      "Invalid plugin module structure: must export a plugin object with 'name' or a factory function",
    );
  }

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
 * Resolved plugin with module and root directory
 */
interface ResolvedPlugin {
  /** Root directory (contains client/, server/, plugin.ts) */
  dir: string;
  /** Plugin factory/module (the logic) */
  module: PluginModule;
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
      const { module } = await this.resolvePlugin(name);
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

    let queueIndex = 0;
    while (queueIndex < queue.length) {
      const name = queue[queueIndex++]!;
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
      const resultNames = new Set(result.map((p) => p.name));
      const remaining = plugins.filter((p) => !resultNames.has(p.name));
      throw new Error(
        `Circular dependency detected among plugins: ${remaining.map((p) => p.name).join(", ")}`,
      );
    }

    return result;
  }

  /**
   * Resolve a plugin by name
   *
   * Returns:
   * - module: Plugin factory (the logic)
   * - dir: Root directory (contains client/, server/, plugin.ts)
   *
   * Resolution order:
   * 1. Built-in plugins (embedded in binary/bundle)
   * 2. External plugins from ./plugins/ directory
   * 3. Node modules (dev mode only)
   *
   * Plugin directory resolution:
   * - Production (bundle/compiled): ./plugins/{shortName}/ (must be copied manually)
   * - Dev: node_modules via Bun.resolveSync
   */
  private async resolvePlugin(name: string): Promise<ResolvedPlugin> {
    // Find package directory via Bun resolution (dev mode only)
    const resolveFromNodeModules = (packageName: string): string | null => {
      try {
        return dirname(Bun.resolveSync(packageName, process.cwd()));
      } catch {
        return null;
      }
    };

    // Find plugin in ./plugins/{shortName}/ (production: bundle/compiled)
    const resolveFromPluginsDir = (packageName: string): string => {
      const shortName = getShortName(packageName);
      const dir = join(process.cwd(), PLUGINS_DIR, shortName);
      const indexHtml = join(dir, "index.html");
      return existsSync(indexHtml) ? dir : "";
    };

    // 1. Built-in plugins (embedded in binary/bundle)
    const builtinFactory = await getBuiltinPlugin(name);
    if (builtinFactory) {
      const dir = IS_DEV ? resolveFromNodeModules(name) : resolveFromPluginsDir(name);
      return { dir: dir ?? "", module: builtinFactory };
    }

    // 2. External plugins from ./plugins/ directory
    const externalPath = await this.resolveExternalPlugin(name);
    if (externalPath) {
      const module = await import(externalPath);
      return { dir: dirname(externalPath), module };
    }

    // 3. Node modules (dev mode only)
    try {
      const module = await import(name);
      return { dir: resolveFromNodeModules(name) ?? "", module };
    } catch {
      throw new Error(
        `Could not resolve plugin "${name}". ` +
          `Not a built-in plugin and not found in ${PLUGINS_DIR}/`,
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

    const { dir, module } = await this.resolvePlugin(name);
    const plugin = await resolvePlugin(module, options);

    // Validate plugin structure
    if (!plugin.name) {
      throw new Error(`Plugin "${name}" is missing required field: name`);
    }
    if (!plugin.base) {
      throw new Error(`Plugin "${name}" is missing required field: base`);
    }

    // Validate base path format (security: prevent route interception)
    // Must be "/" followed by alphanumeric, underscore, or hyphen
    const BASE_PATH_PATTERN = /^\/[a-zA-Z0-9_-]+$/;
    if (plugin.base !== "/" && !BASE_PATH_PATTERN.test(plugin.base)) {
      throw new Error(
        `Plugin "${name}" has invalid base path "${plugin.base}". ` +
          `Must match pattern: /[a-zA-Z0-9_-]+ (e.g., "/metrics", "/my-plugin")`,
      );
    }

    // Security: Block reserved paths used by runtime internals
    const RESERVED_PATHS = ["/api", "/health", "/.well-known"];
    if (RESERVED_PATHS.includes(plugin.base)) {
      throw new Error(
        `Plugin "${name}" cannot use reserved path "${plugin.base}". ` +
          `Reserved paths: ${RESERVED_PATHS.join(", ")}`,
      );
    }

    // Override base from config if specified
    // Plugins define their own base path (e.g., "/cpanel", "/metrics")
    if (options.base !== undefined) {
      const baseOverride = options.base as string;
      if (baseOverride !== "/" && !BASE_PATH_PATTERN.test(baseOverride)) {
        throw new Error(
          `Plugin "${name}" config has invalid base path "${baseOverride}". ` +
            `Must match pattern: /[a-zA-Z0-9_-]+ (e.g., "/metrics", "/my-plugin")`,
        );
      }
      // Security: Also check reserved paths for overrides
      if (RESERVED_PATHS.includes(baseOverride)) {
        throw new Error(
          `Plugin "${name}" config cannot use reserved path "${baseOverride}". ` +
            `Reserved paths: ${RESERVED_PATHS.join(", ")}`,
        );
      }
      plugin.base = baseOverride;
    }

    // Create context for initialization with service access
    // Use resolved config (with env var substitution) for workspaces
    const registry = this.registry;
    const runtimeConfig = getConfig();

    const context: PluginContext = {
      config: options,
      globalConfig: {
        poolSize: runtimeConfig.poolSize,
        workspaces: runtimeConfig.workspaces,
      },
      logger: createPluginLogger(plugin.name),
      pool: this.pool,
      registerService<T>(serviceName: string, service: T): void {
        registry.registerService(serviceName, service);
      },
      getService<T>(serviceName: string): T | undefined {
        return registry.getService<T>(serviceName);
      },
    };

    // Initialize plugin with timeout to prevent hanging
    // Security: Misbehaving plugins can't block server startup indefinitely
    const INIT_TIMEOUT_MS = 30_000;
    if (plugin.onInit) {
      const initPromise = plugin.onInit(context);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(`Plugin "${name}" initialization timed out after ${INIT_TIMEOUT_MS}ms`),
            ),
          INIT_TIMEOUT_MS,
        ),
      );
      await Promise.race([initPromise, timeoutPromise]);
    }

    // Register plugin with its root directory
    this.registry.register(plugin, dir || undefined);

    logger.info(`Loaded: ${plugin.name}${dir ? ` (${dir})` : ""}`);

    return plugin;
  }

  /**
   * Try to resolve a plugin from the external plugins directory
   * Looks for: ./plugins/{name}.ts, ./plugins/{name}/index.ts
   */
  private async resolveExternalPlugin(name: string): Promise<string | null> {
    const cwd = process.cwd();
    const pluginsDir = join(cwd, PLUGINS_DIR);

    if (!existsSync(pluginsDir)) {
      return null;
    }

    // Extract short name from @buntime/plugin-xxx or @buntime/xxx
    const shortName = getShortName(name);

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
 * Load buntime configuration from buntime.jsonc
 * Bun natively parses JSONC (strips comments and trailing commas)
 */
export async function loadBuntimeConfig(): Promise<LoadedBuntimeConfig> {
  try {
    const jsoncPath = Bun.resolveSync("./buntime.jsonc", process.cwd());
    const config = await import(jsoncPath);
    return {
      baseDir: dirname(jsoncPath),
      config: validateBuntimeConfig(config.default ?? config, "buntime.jsonc"),
    };
  } catch (err) {
    if (err instanceof Error && !err.message.includes("Cannot find module")) {
      throw new Error(`[buntime.jsonc] Failed to parse: ${err.message}`);
    }
  }

  return { baseDir: process.cwd(), config: {} };
}
