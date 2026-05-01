import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { getChildLogger } from "@buntime/shared/logger";
import type {
  BuntimePlugin,
  PluginContext,
  PluginImpl,
  PluginImplFactory,
  PluginManifest,
  PluginModule,
} from "@buntime/shared/types";
import { omit } from "es-toolkit";
import { getConfig } from "@/config";
import { API_PATH, RESERVED_PATHS, VERSION } from "@/constants";
import { createPluginLogger, PluginRegistry } from "./registry";

const logger = getChildLogger("PluginLoader");

/** Manifest file names to try in order */
const MANIFEST_FILES = ["manifest.yaml", "manifest.yml"] as const;

/**
 * Validate that a module has a valid plugin implementation structure
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
    // Direct plugin object - no longer requires 'name' (comes from manifest)
    return true;
  }

  return false;
}

/**
 * Resolve a plugin module to a PluginImpl
 * The manifest provides metadata (name, base, etc.), the module provides implementation
 */
function resolvePluginImpl(
  mod: PluginModule,
  config: Record<string, unknown>,
): PluginImpl | Promise<PluginImpl> {
  // Security: Validate module structure before processing
  if (!isValidPluginModule(mod)) {
    throw new Error(
      "Invalid plugin module structure: must export a plugin implementation or factory function",
    );
  }

  // Handle default export
  if ("default" in mod) {
    return resolvePluginImpl(mod.default as PluginModule, config);
  }

  // Handle factory function
  if (typeof mod === "function") {
    return (mod as PluginImplFactory)(config);
  }

  // Handle direct plugin object
  return mod as PluginImpl;
}

function getPluginModuleUrl(path: string): string {
  try {
    const contents = readFileSync(path);
    const hash = createHash("sha256").update(contents).digest("hex").slice(0, 16);
    const ext = extname(path);
    const cachePath = join(dirname(path), `.buntime-${basename(path, ext)}-${hash}${ext}`);

    if (!existsSync(cachePath)) {
      copyFileSync(path, cachePath);
    }

    return pathToFileURL(cachePath).href;
  } catch {
    const url = pathToFileURL(path);
    try {
      url.searchParams.set("mtime", String(statSync(path).mtimeMs));
    } catch {
      // If stat fails, import will report the real module error below.
    }
    return url.href;
  }
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
 * Scanned plugin entry from plugin directories
 * Module is loaded lazily to avoid importing disabled plugins
 */
interface ScannedPlugin {
  /** Root directory containing the plugin file */
  dir: string;
  /** Full path to the plugin entry file */
  path: string;
  /** Plugin manifest from manifest.yaml */
  manifest: PluginManifest;
}

/**
 * Options for PluginLoader constructor
 */
export interface PluginLoaderOptions {
  /** Worker pool instance */
  pool?: unknown;
  /** Override pluginDirs (for testing) */
  pluginDirs?: string[];
}

/**
 * Load plugins from configuration
 */
export class PluginLoader {
  private registry = new PluginRegistry();
  private pool?: unknown;
  private pluginDirsOverride?: string[];
  /** Map of plugin name -> scanned plugin info (populated by scanPluginDirs) */
  private scannedPlugins = new Map<string, ScannedPlugin>();

  constructor(options: PluginLoaderOptions = {}) {
    this.pool = options.pool;
    this.pluginDirsOverride = options.pluginDirs;
  }

  /**
   * List all scanned plugins
   * Returns name and version (from manifest, informative only)
   */
  list(): Array<{ name: string; version: string }> {
    const result: Array<{ name: string; version: string }> = [];
    for (const [name, scanned] of this.scannedPlugins) {
      const version = scanned.manifest.version;
      result.push({
        name,
        version: typeof version === "string" ? version : "0.0.0",
      });
    }
    return result;
  }

  /**
   * Rescan plugin directories and reload plugins
   * Call this after installing/uninstalling plugins
   */
  async rescan(): Promise<PluginRegistry> {
    // Clear current state
    this.scannedPlugins.clear();
    this.registry.clear();

    // Reload
    return this.load();
  }

  /**
   * Load all plugins from pluginDirs using auto-discovery
   * Plugins are sorted topologically based on dependencies from manifest
   *
   * Resilient: if a plugin fails to load, its dependents are skipped
   * and the remaining plugins continue loading normally.
   */
  async load(): Promise<PluginRegistry> {
    const pluginDirs = this.pluginDirsOverride ?? getConfig().pluginDirs;
    await this.scanPluginDirs(pluginDirs);

    const configuredNames = new Set(this.scannedPlugins.keys());
    const parsedPlugins: ParsedPlugin[] = [];

    for (const [name, scanned] of this.scannedPlugins) {
      const { manifest } = scanned;

      // Skip plugins disabled in manifest
      // Manifest is the source of truth for enabled state
      if (manifest.enabled === false) {
        logger.debug(`Skipping plugin disabled in manifest: ${name}`);
        continue;
      }

      // Get plugin-specific options from manifest (excluding metadata fields)
      // Note: menus is passed to plugin factory so plugins can modify it dynamically
      // Note: base is kept in options so plugins can access their own base path
      const options = omit(manifest, [
        "name",
        "version",
        "enabled",
        "entrypoint",
        "dependencies",
        "optionalDependencies",
      ]);

      // Filter optional dependencies to only those available
      const optionalDeps = (manifest.optionalDependencies || []).filter((dep) =>
        configuredNames.has(dep),
      );

      parsedPlugins.push({
        name,
        options,
        dependencies: manifest.dependencies || [],
        optionalDependencies: optionalDeps,
      });
    }

    // Topological sort
    const sorted = this.topologicalSort(parsedPlugins, configuredNames);

    // Track plugins that failed to load so their dependents can be skipped
    const failedPlugins = new Set<string>();
    let loadedCount = 0;

    // Load plugins in sorted order
    for (const { name, options, dependencies } of sorted) {
      // Check if any required dependency has failed
      const failedRequiredDep = dependencies.find((dep) => failedPlugins.has(dep));
      if (failedRequiredDep) {
        logger.warn(
          `Skipping plugin "${name}" because required dependency "${failedRequiredDep}" failed to load`,
        );
        failedPlugins.add(name);
        continue;
      }

      try {
        await this.loadPlugin(name, options);
        loadedCount++;
      } catch (error) {
        logger.error(`Failed to load plugin "${name}", continuing with remaining plugins`, {
          error: String(error),
        });
        failedPlugins.add(name);
      }
    }

    if (loadedCount > 0) {
      logger.info(`Loaded ${loadedCount} plugin(s)`);
    }

    if (failedPlugins.size > 0) {
      logger.warn(
        `${failedPlugins.size} plugin(s) failed to load: ${[...failedPlugins].join(", ")}`,
      );
    }

    return this.registry;
  }

  /**
   * Topological sort using Kahn's algorithm
   * Considers both required and optional dependencies
   *
   * Resilient: plugins with missing required dependencies are excluded
   * from the sort (with a warning) instead of crashing the runtime.
   * Their transitive dependents are also excluded.
   */
  private topologicalSort(plugins: ParsedPlugin[], configuredNames: Set<string>): ParsedPlugin[] {
    // First pass: exclude plugins whose required dependencies are missing
    const excluded = new Set<string>();
    const pluginNames = new Set(plugins.map((p) => p.name));

    // Iteratively remove plugins with unresolvable required dependencies
    // (removing one plugin may cause others to become unresolvable)
    let changed = true;
    while (changed) {
      changed = false;
      for (const plugin of plugins) {
        if (excluded.has(plugin.name)) continue;

        for (const dep of plugin.dependencies) {
          if (!pluginNames.has(dep) || excluded.has(dep)) {
            const isDisabled = configuredNames.has(dep);
            const isExcluded = excluded.has(dep);
            const reason = isExcluded
              ? "was excluded due to its own errors"
              : isDisabled
                ? "disabled"
                : "not installed";

            logger.warn(
              `Excluding plugin "${plugin.name}": required dependency "${dep}" is ${reason}. ` +
                `${isDisabled && !isExcluded ? `Enable "${dep}" in its manifest.yaml.` : isExcluded ? "" : `Ensure "${dep}" is installed in pluginDirs.`}`,
            );
            excluded.add(plugin.name);
            changed = true;
            break;
          }
        }
      }
    }

    // Filter to only includable plugins
    const includedPlugins = plugins.filter((p) => !excluded.has(p.name));

    const pluginMap = new Map<string, ParsedPlugin>();
    const inDegree = new Map<string, number>();
    const graph = new Map<string, string[]>();

    // Initialize
    for (const plugin of includedPlugins) {
      pluginMap.set(plugin.name, plugin);
      inDegree.set(plugin.name, 0);
      graph.set(plugin.name, []);
    }

    // Build graph edges
    for (const plugin of includedPlugins) {
      const allDeps = [...plugin.dependencies, ...plugin.optionalDependencies];

      for (const dep of allDeps) {
        // Only consider deps that are enabled (in pluginMap), not just configured
        if (pluginMap.has(dep)) {
          graph.get(dep)?.push(plugin.name);
          inDegree.set(plugin.name, (inDegree.get(plugin.name) || 0) + 1);
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
    if (result.length !== includedPlugins.length) {
      const resultNames = new Set(result.map((p) => p.name));
      const remaining = includedPlugins.filter((p) => !resultNames.has(p.name));
      logger.error(
        `Circular dependency detected among plugins: ${remaining.map((p) => p.name).join(", ")}. These plugins will not be loaded.`,
      );
      // Return what we could sort instead of crashing
      return result;
    }

    return result;
  }

  /**
   * Load a single plugin by name
   * Merges manifest (metadata) with implementation (code)
   */
  async loadPlugin(name: string, options: Record<string, unknown> = {}): Promise<BuntimePlugin> {
    // Check if already loaded
    if (this.registry.has(name)) {
      throw new Error(`Plugin "${name}" is already loaded`);
    }

    // Get scanned plugin info (includes manifest)
    const scanned = this.scannedPlugins.get(name);
    if (!scanned) {
      throw new Error(`Plugin "${name}" not found in scanned plugins`);
    }

    const { dir, path, manifest } = scanned;

    // Import module lazily - only when plugin is actually being loaded
    // This prevents disabled plugins from being imported
    const module = await import(getPluginModuleUrl(path));

    // Resolve implementation from module
    const impl = await resolvePluginImpl(module, options);

    // Validate manifest has required fields
    if (!manifest.name) {
      throw new Error(`Plugin "${name}" manifest is missing required field: name`);
    }

    // Validate base path format if provided (security: prevent route interception)
    // base is optional - plugins with only hooks (onRequest, onInit) don't need it
    if (manifest.base) {
      const BASE_PATH_PATTERN = /^\/[a-zA-Z0-9_-]+$/;
      if (manifest.base !== "/" && !BASE_PATH_PATTERN.test(manifest.base)) {
        throw new Error(
          `Plugin "${name}" has invalid base path "${manifest.base}". ` +
            `Must match pattern: /[a-zA-Z0-9_-]+ (e.g., "/metrics", "/my-plugin")`,
        );
      }

      // Security: Block reserved paths used by runtime internals
      if (RESERVED_PATHS.includes(manifest.base)) {
        throw new Error(
          `Plugin "${name}" cannot use reserved path "${manifest.base}". ` +
            `Reserved paths: ${RESERVED_PATHS.join(", ")}`,
        );
      }
    }

    // Merge manifest (metadata) with implementation (code)
    const plugin: BuntimePlugin = {
      ...manifest,
      ...impl,
    };

    // Create context for initialization with service access
    const registry = this.registry;
    const runtimeConfig = getConfig();

    const context: PluginContext = {
      config: options,
      globalConfig: {
        pluginDirs: runtimeConfig.pluginDirs,
        workerDirs: runtimeConfig.workerDirs,
        poolSize: runtimeConfig.poolSize,
      },
      logger: createPluginLogger(plugin.name),
      pool: this.pool,
      getPlugin<T>(pluginName: string): T | undefined {
        return registry.getPlugin<T>(pluginName);
      },
      runtime: {
        api: API_PATH,
        version: VERSION,
      },
    };

    // Initialize plugin with timeout to prevent hanging
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

    // Register plugin's provides exports (after onInit completes)
    if (plugin.provides) {
      const provided = await Promise.resolve(plugin.provides());
      registry.registerProvides(plugin.name, provided);
      logger.debug(`Registered provides for ${plugin.name}`);
    }

    // Register plugin with its root directory
    this.registry.register(plugin, dir || undefined);

    logger.info(`Loaded: ${plugin.name}${dir ? ` (${dir})` : ""}`);

    return plugin;
  }

  /**
   * Load plugin manifest from manifest.yaml or manifest.yml
   */
  private async loadManifest(pluginDir: string): Promise<PluginManifest | null> {
    for (const filename of MANIFEST_FILES) {
      const manifestPath = join(pluginDir, filename);
      if (existsSync(manifestPath)) {
        try {
          const content = await Bun.file(manifestPath).text();
          return Bun.YAML.parse(content) as PluginManifest;
        } catch (err) {
          logger.warn(`Failed to parse ${manifestPath}: ${err}`);
        }
      }
    }
    return null;
  }

  /**
   * Scan plugin directories and build a map of plugin name -> module
   *
   * Supports multiple directory structures:
   * 1. Direct: {pluginDir}/plugin.ts
   * 2. Subdirectory: {pluginDir}/{name}/plugin.ts
   * 3. Scoped: {pluginDir}/@scope/{name}/plugin.ts
   *
   * Plugin metadata is read from manifest.yaml (required)
   */
  private async scanPluginDirs(pluginDirs: string[]): Promise<void> {
    const extensions = [".ts", ".js"];

    for (const pluginDir of pluginDirs) {
      if (!existsSync(pluginDir)) {
        continue;
      }

      let entries: string[];
      try {
        entries = readdirSync(pluginDir);
      } catch (error) {
        logger.error(`Failed to read plugin directory "${pluginDir}", skipping`, {
          error: String(error),
        });
        continue;
      }

      for (const entry of entries) {
        if (entry.startsWith(".")) {
          continue;
        }

        try {
          const entryPath = join(pluginDir, entry);
          const stat = statSync(entryPath);

          if (stat.isFile()) {
            // Direct file: {pluginDir}/*.ts or {pluginDir}/*.js
            const ext = entry.slice(entry.lastIndexOf("."));
            if (extensions.includes(ext)) {
              await this.tryRegisterPlugin(entryPath, pluginDir);
            }
          } else if (stat.isDirectory()) {
            if (entry.startsWith("@")) {
              // Scoped package: {pluginDir}/@scope/{name}/
              await this.scanScopedPackage(entryPath, extensions);
            } else {
              // Subdirectory: {pluginDir}/{name}/
              // Load manifest first to check for "pluginEntry" field
              const manifest = await this.loadManifest(entryPath);
              if (manifest) {
                const pluginFile = this.findPluginFile(entryPath, extensions, manifest.pluginEntry);
                if (pluginFile) {
                  await this.tryRegisterPluginWithManifest(pluginFile, entryPath, manifest);
                }
              }
            }
          }
        } catch (error) {
          logger.error(`Failed to scan plugin entry "${entry}" in "${pluginDir}", skipping`, {
            error: String(error),
          });
        }
      }
    }

    if (this.scannedPlugins.size > 0) {
      logger.debug(`Scanned ${this.scannedPlugins.size} plugin(s) from pluginDirs`);
    }
  }

  /**
   * Scan a scoped package directory (@scope/name/)
   */
  private async scanScopedPackage(scopeDir: string, extensions: string[]): Promise<void> {
    if (!existsSync(scopeDir)) return;

    let packages: string[];
    try {
      packages = readdirSync(scopeDir);
    } catch (error) {
      logger.error(`Failed to read scoped package directory "${scopeDir}", skipping`, {
        error: String(error),
      });
      return;
    }

    for (const pkg of packages) {
      try {
        const pkgPath = join(scopeDir, pkg);
        const stat = statSync(pkgPath);
        if (stat.isDirectory()) {
          // Load manifest first to check for "pluginEntry" field
          const manifest = await this.loadManifest(pkgPath);
          if (manifest) {
            const pluginFile = this.findPluginFile(pkgPath, extensions, manifest.pluginEntry);
            if (pluginFile) {
              await this.tryRegisterPluginWithManifest(pluginFile, pkgPath, manifest);
            }
          }
        }
      } catch (error) {
        logger.error(`Failed to scan scoped package "${pkg}" in "${scopeDir}", skipping`, {
          error: String(error),
        });
      }
    }
  }

  /**
   * Find plugin entry file in a directory
   * Priority:
   * 1. manifest.pluginEntry field (if specified)
   * 2. {dir}/plugin.{ts,js}, {dir}/index.{ts,js} (source/fallback)
   */
  private findPluginFile(dir: string, extensions: string[], pluginEntry?: string): string | null {
    // 1. Use manifest.pluginEntry if specified
    if (pluginEntry) {
      const pluginPath = join(dir, pluginEntry);
      if (existsSync(pluginPath)) {
        return pluginPath;
      }
      logger.warn(`Plugin file from manifest not found: ${pluginPath}`);
    }

    // 2. Fallback: try root (source files)
    for (const filename of ["plugin", "index"]) {
      for (const ext of extensions) {
        const filePath = join(dir, `${filename}${ext}`);
        if (existsSync(filePath)) {
          return filePath;
        }
      }
    }
    return null;
  }

  /**
   * Try to register a plugin from a file path
   * Requires manifest.yaml with plugin name and metadata
   * Used for direct file plugins (not in subdirectory)
   */
  private async tryRegisterPlugin(filePath: string, dir: string): Promise<void> {
    try {
      // Load manifest first (required)
      const manifest = await this.loadManifest(dir);
      if (!manifest) {
        logger.debug(`No manifest found in ${dir}, skipping`);
        return;
      }

      await this.tryRegisterPluginWithManifest(filePath, dir, manifest);
    } catch (error) {
      // Import failed, silently ignore (might not be a valid module)
      logger.debug(`Failed to scan ${filePath}: ${error}`);
    }
  }

  /**
   * Register a plugin with an already-loaded manifest
   * Avoids loading manifest twice when scanning directories
   */
  private async tryRegisterPluginWithManifest(
    filePath: string,
    dir: string,
    manifest: PluginManifest,
  ): Promise<void> {
    // Manifest must have name
    if (!manifest.name || typeof manifest.name !== "string") {
      logger.warn(`Manifest in ${dir} is missing required field: name`);
      return;
    }

    const pluginName = manifest.name;

    // Check for duplicates
    if (this.scannedPlugins.has(pluginName)) {
      const existing = this.scannedPlugins.get(pluginName)!;
      logger.warn(
        `Duplicate plugin "${pluginName}" found at ${filePath}, ` +
          `keeping existing from ${existing.path}`,
      );
      return;
    }

    // Store plugin info WITHOUT importing the module
    // Module is imported lazily in loadPlugin() to avoid loading disabled plugins
    this.scannedPlugins.set(pluginName, {
      dir,
      manifest,
      path: filePath,
    });
    logger.debug(`Scanned plugin: ${pluginName} (${filePath})`);
  }
}
