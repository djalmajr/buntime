import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
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
import { RESERVED_PATHS } from "@/constants";
import {
  setPluginVersion as dbSetPluginVersion,
  getPluginVersion,
  isPluginEnabled,
  seedPluginFromManifest,
} from "@/libs/database";
import { createPluginLogger, PluginRegistry } from "./registry";

const logger = getChildLogger("PluginLoader");

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
  /** Plugin manifest from manifest.jsonc */
  manifest: PluginManifest;
  /** Version of this plugin (from directory name) */
  version: string;
}

/**
 * Version info for a plugin
 */
interface PluginVersionInfo {
  /** Root directory for this version */
  dir: string;
  /** Full path to the plugin entry file */
  path: string;
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
  /** Map of plugin name -> available versions (for version management) */
  private availableVersions = new Map<string, Map<string, PluginVersionInfo>>();

  constructor(options: PluginLoaderOptions = {}) {
    this.pool = options.pool;
    this.pluginDirsOverride = options.pluginDirs;
  }

  /**
   * Get available versions for a plugin
   */
  getVersions(name: string): string[] {
    const versions = this.availableVersions.get(name);
    if (!versions) return [];
    return [...versions.keys()].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  }

  /**
   * Get the active version for a plugin (from SQLite or "latest")
   */
  async getActiveVersion(name: string): Promise<string> {
    return getPluginVersion(name);
  }

  /**
   * Set the active version for a plugin
   * Takes effect on next rescan
   */
  async setActiveVersion(name: string, version: string): Promise<void> {
    const versions = this.availableVersions.get(name);
    if (!versions) {
      throw new Error(`Plugin "${name}" not found`);
    }
    if (version !== "latest" && !versions.has(version)) {
      throw new Error(
        `Version "${version}" not found for plugin "${name}". ` +
          `Available versions: ${[...versions.keys()].join(", ")}`,
      );
    }
    await dbSetPluginVersion(name, version);
  }

  /**
   * List all scanned plugins with their active versions
   */
  list(): Array<{ name: string; version: string; versions: string[] }> {
    const result: Array<{ name: string; version: string; versions: string[] }> = [];
    for (const [name, scanned] of this.scannedPlugins) {
      result.push({
        name,
        version: scanned.version,
        versions: this.getVersions(name),
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
    this.availableVersions.clear();
    this.registry.clear();

    // Reload
    return this.load();
  }

  /**
   * Load all plugins from pluginDirs using auto-discovery
   * Plugins are sorted topologically based on dependencies from manifest
   */
  async load(): Promise<PluginRegistry> {
    const pluginDirs = this.pluginDirsOverride ?? getConfig().pluginDirs;
    await this.scanPluginDirs(pluginDirs);

    const configuredNames = new Set(this.scannedPlugins.keys());
    const parsedPlugins: ParsedPlugin[] = [];

    for (const [name, scanned] of this.scannedPlugins) {
      const { manifest } = scanned;

      // Skip plugins not enabled in database
      // Database is source of truth for enabled state (not manifest.enabled)
      if (!(await isPluginEnabled(name))) {
        logger.debug(`Skipping plugin not enabled in database: ${name}`);
        continue;
      }

      // Get plugin-specific options from manifest (excluding metadata fields)
      // Note: menus is passed to plugin factory so plugins can modify it dynamically
      const options = omit(manifest, [
        "name",
        "enabled",
        "base",
        "entrypoint",
        "dependencies",
        "optionalDependencies",
        "fragment",
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

    // Load plugins in sorted order
    for (const { name, options } of sorted) {
      try {
        await this.loadPlugin(name, options);
      } catch (error) {
        logger.error(`Failed to load plugin "${name}"`, { error: String(error) });
        throw error;
      }
    }

    if (sorted.length > 0) {
      logger.info(`Loaded ${sorted.length} plugin(s)`);
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
            `Plugin "${plugin.name}" requires "${dep}" which is not available. ` +
              `Ensure "${dep}" is installed in pluginDirs.`,
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
    const module = await import(path);

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
        workerDirs: runtimeConfig.workerDirs,
        poolSize: runtimeConfig.poolSize,
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
   * Load plugin manifest from manifest.jsonc or manifest.json
   */
  private async loadManifest(pluginDir: string): Promise<PluginManifest | null> {
    for (const filename of MANIFEST_FILES) {
      const manifestPath = join(pluginDir, filename);
      if (existsSync(manifestPath)) {
        try {
          const config = await import(manifestPath);
          return (config.default ?? config) as PluginManifest;
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
   * 3. Versioned: {pluginDir}/{name}/{version}/plugin.ts
   * 4. Scoped versioned: {pluginDir}/@scope/{name}/{version}/plugin.ts
   *
   * For versioned plugins, uses the latest version (highest semver).
   * Plugin metadata is read from manifest.jsonc (required)
   */
  private async scanPluginDirs(pluginDirs: string[]): Promise<void> {
    const extensions = [".ts", ".js"];

    for (const pluginDir of pluginDirs) {
      if (!existsSync(pluginDir)) {
        continue;
      }

      const entries = readdirSync(pluginDir);

      for (const entry of entries) {
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
            // Scoped package: {pluginDir}/@scope/{name}/{version}/
            await this.scanScopedPackage(entryPath, extensions);
          } else {
            // Could be: {pluginDir}/{name}/plugin.ts OR {pluginDir}/{name}/{version}/
            const hasPluginFile = this.findPluginFile(entryPath, extensions);
            if (hasPluginFile) {
              await this.tryRegisterPlugin(hasPluginFile, entryPath);
            } else {
              // Try versioned structure: {pluginDir}/{name}/{version}/
              await this.scanVersionedPackage(entryPath, extensions);
            }
          }
        }
      }
    }

    if (this.scannedPlugins.size > 0) {
      logger.debug(`Scanned ${this.scannedPlugins.size} plugin(s) from pluginDirs`);
    }
  }

  /**
   * Scan a scoped package directory (@scope/name/version/)
   */
  private async scanScopedPackage(scopeDir: string, extensions: string[]): Promise<void> {
    if (!existsSync(scopeDir)) return;

    const packages = readdirSync(scopeDir);
    for (const pkg of packages) {
      const pkgPath = join(scopeDir, pkg);
      const stat = statSync(pkgPath);
      if (stat.isDirectory()) {
        await this.scanVersionedPackage(pkgPath, extensions);
      }
    }
  }

  /**
   * Scan a versioned package directory (name/version/)
   * Uses version from SQLite, or latest if not set
   */
  private async scanVersionedPackage(packageDir: string, extensions: string[]): Promise<void> {
    if (!existsSync(packageDir)) return;

    const versions = readdirSync(packageDir)
      .filter((v) => {
        const vPath = join(packageDir, v);
        return statSync(vPath).isDirectory() && !v.startsWith(".");
      })
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true })); // Latest first

    if (versions.length === 0) return;

    // Pre-scan to get plugin name from manifest (to query SQLite)
    const firstVersionDir = join(packageDir, versions[0]!);
    const firstPluginFile = this.findPluginFile(firstVersionDir, extensions);
    if (!firstPluginFile) return;

    // Get plugin name from manifest
    const firstManifest = await this.loadManifest(firstVersionDir);
    if (!firstManifest?.name) return;
    const pluginName = firstManifest.name;

    // Store all available versions for this plugin
    const versionMap = new Map<string, PluginVersionInfo>();
    for (const version of versions) {
      const versionDir = join(packageDir, version);
      const pluginFile = this.findPluginFile(versionDir, extensions);
      if (pluginFile) {
        versionMap.set(version, { dir: versionDir, path: pluginFile });
      }
    }
    this.availableVersions.set(pluginName, versionMap);

    // Determine which version to use
    const configuredVersion = await getPluginVersion(pluginName);
    const latestVersion = versions[0]!;
    const targetVersion =
      configuredVersion === "latest"
        ? latestVersion
        : versionMap.has(configuredVersion)
          ? configuredVersion
          : latestVersion;

    // Register the target version
    const targetInfo = versionMap.get(targetVersion)!;
    await this.tryRegisterPlugin(targetInfo.path, targetInfo.dir, targetVersion);
  }

  /**
   * Find plugin entry file in a directory
   * Tries: plugin.{ts,js}, index.{ts,js}
   */
  private findPluginFile(dir: string, extensions: string[]): string | null {
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
   * Try to import and register a plugin file
   * Requires manifest.jsonc with plugin name and metadata
   * @param version Optional version string (from directory name)
   */
  private async tryRegisterPlugin(filePath: string, dir: string, version?: string): Promise<void> {
    try {
      // Load manifest first (required)
      const manifest = await this.loadManifest(dir);
      if (!manifest) {
        logger.debug(`No manifest found in ${dir}, skipping`);
        return;
      }

      // Manifest must have name
      if (!manifest.name || typeof manifest.name !== "string") {
        logger.warn(`Manifest in ${dir} is missing required field: name`);
        return;
      }

      const pluginName = manifest.name;

      // Seed manifest to database (creates if not exists, skips if exists)
      // This ensures every discovered plugin is tracked in the database
      await seedPluginFromManifest(manifest);

      // Check for duplicates
      if (this.scannedPlugins.has(pluginName)) {
        const existing = this.scannedPlugins.get(pluginName)!;
        logger.warn(
          `Duplicate plugin "${pluginName}" found at ${filePath}, ` +
            `keeping existing from ${existing.path}`,
        );
        return;
      }

      // Determine version from parameter or directory name
      const pluginVersion = version ?? basename(dir);

      // Store plugin info WITHOUT importing the module
      // Module is imported lazily in loadPlugin() to avoid loading disabled plugins
      this.scannedPlugins.set(pluginName, {
        dir,
        manifest,
        path: filePath,
        version: pluginVersion,
      });
      logger.debug(`Scanned plugin: ${pluginName}@${pluginVersion} (${filePath})`);
    } catch (error) {
      // Import failed, silently ignore (might not be a valid module)
      logger.debug(`Failed to import ${filePath}: ${error}`);
    }
  }
}

/** Manifest file names to try in order */
const MANIFEST_FILES = ["manifest.jsonc", "manifest.json"] as const;
