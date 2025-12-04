import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  watch,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { BunPlugin } from "bun";

const VIRTUAL_MODULE_ID = "virtual:icons";
const REGISTRY_FILE = ".cache/iconify/registry.js";

interface IconifyConfig {
  dirs: string[];
}

interface PluginsBunfig {
  plugins?: {
    iconify?: {
      dirs?: string | string[];
    };
  };
}

interface IconData {
  body: string;
  height: number;
  width: number;
}

interface IconifyIcon {
  body: string;
  height?: number;
  hidden?: boolean;
  width?: number;
}

interface IconifyAlias {
  parent: string;
}

interface IconifyJSON {
  aliases?: Record<string, IconifyAlias>;
  height?: number;
  icons: Record<string, IconifyIcon>;
  info?: {
    height?: number;
    palette?: boolean;
    width?: number;
  };
  prefix: string;
  width?: number;
}

interface GetIconOptions {
  silent?: boolean;
}

const collectionCache = new Map<string, IconifyJSON>();
const collectedIcons = new Map<string, IconData>();

// Track if we're in watch mode and current working directory for file writing
let isWatching = false;
let currentCwd = "";

function loadCollection(collection: string, options: GetIconOptions = {}): IconifyJSON | null {
  if (collectionCache.has(collection)) return collectionCache.get(collection)!;

  // Try individual collection first (@iconify-json/{collection} ~100KB each)
  // Then fallback to full package (@iconify/json ~200MB)
  const paths = [`@iconify-json/${collection}/icons.json`, `@iconify/json/json/${collection}.json`];

  for (const modulePath of paths) {
    try {
      const resolvedPath = require.resolve(modulePath);
      const data = JSON.parse(readFileSync(resolvedPath, "utf-8")) as IconifyJSON;
      collectionCache.set(collection, data);
      return data;
    } catch {
      // Try next path
    }
  }

  // Only warn if not in silent mode - this avoids noise from false positives
  // like "webhook-relay:language" which is not an icon
  if (!options.silent) {
    console.warn(
      `[iconify] Collection "${collection}" not found. Install @iconify-json/${collection} or @iconify/json`,
    );
  }
  return null;
}

/**
 * Resolve an icon, supporting chained aliases (alias -> alias -> icon)
 * Also filters out hidden/deprecated icons
 */
function resolveIcon(
  data: IconifyJSON,
  iconName: string,
  visited = new Set<string>(),
): IconifyIcon | null {
  // Prevent infinite loops in circular aliases
  if (visited.has(iconName)) {
    console.warn(`[iconify] Circular alias detected for "${iconName}"`);
    return null;
  }
  visited.add(iconName);

  // Check direct icon first
  const directIcon = data.icons[iconName];
  if (directIcon) {
    // Filter out hidden/deprecated icons
    return directIcon.hidden ? null : directIcon;
  }

  // Check aliases and resolve recursively (supports chained aliases)
  const alias = data.aliases?.[iconName];
  if (alias?.parent) {
    return resolveIcon(data, alias.parent, visited);
  }

  return null;
}

function getIconData(name: string, options: GetIconOptions = {}): IconData | null {
  const [collection, iconName] = name.split(":");
  if (!collection || !iconName) return null;

  const data = loadCollection(collection, options);
  if (!data) return null;

  const icon = resolveIcon(data, iconName);
  if (!icon) {
    if (!options.silent) {
      console.warn(`[iconify] Icon "${iconName}" not found in collection "${collection}"`);
    }
    return null;
  }

  return {
    body: icon.body,
    // Priority: icon-specific > collection root level > info (display height) > fallback
    height: icon.height ?? data.height ?? data.info?.height ?? 24,
    width: icon.width ?? data.width ?? data.info?.width ?? 24,
  };
}

// Regex to find all icon names in strings (for collecting)
// Matches patterns like "lucide:home" or "ant-design:home-filled"
const ALL_ICONS_REGEX = /["']([a-z][a-z0-9-]*:[a-z][a-z0-9-]*)["']/gi;

// Track collections that failed to load (to avoid repeated warnings)
const failedCollections = new Set<string>();

function collectIconsFromCode(code: string): boolean {
  let foundNew = false;
  const matches = code.matchAll(ALL_ICONS_REGEX);
  for (const match of matches) {
    const name = match[1] || "";
    const [prefix] = name.split(":") as [string];

    // Skip if we already know this collection doesn't exist
    if (failedCollections.has(prefix)) continue;

    if (!collectedIcons.has(name)) {
      const iconData = getIconData(name, { silent: true });
      if (iconData) {
        collectedIcons.set(name, iconData);
        foundNew = true;
      } else {
        // Mark collection as failed to avoid repeated lookups
        if (!collectionCache.has(prefix)) {
          failedCollections.add(prefix);
        }
      }
    }
  }
  return foundNew;
}

// Recursively collect icons from all tsx/jsx/ts/js files in a directory
function collectIconsFromDir(dir: string): void {
  if (!existsSync(dir)) return;

  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      // Skip node_modules and dist directories
      if (/^(node_modules|dist|\.git)$/.test(entry)) continue;
      collectIconsFromDir(fullPath);
    } else if (/\.[jt]sx?$/.test(entry)) {
      try {
        const content = readFileSync(fullPath, "utf-8");
        if (content.includes(":")) {
          collectIconsFromCode(content);
        }
      } catch {
        // Ignore read errors
      }
    }
  }
}

/**
 * Set up file watcher for hot-reload of icons.
 * When files change, re-scan for new icons and update the registry file.
 * Bun's native file watcher will detect changes and trigger HMR.
 */
function setupWatcher(dirs: string[]): void {
  if (isWatching) return;
  isWatching = true;

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;

    try {
      watch(dir, { recursive: true }, (_eventType, filename) => {
        if (!filename || !/\.[jt]sx?$/.test(filename)) return;

        const fullPath = join(dir, filename);
        if (!existsSync(fullPath)) return;

        try {
          const content = readFileSync(fullPath, "utf-8");
          if (content.includes(":")) {
            const foundNew = collectIconsFromCode(content);
            if (foundNew) {
              console.log(`[iconify] New icons detected in ${filename}`);
              writeRegistryFile();
            }
          }
        } catch {
          // Ignore read errors
        }
      });
    } catch (err) {
      console.warn(`[iconify] Could not watch directory ${dir}:`, err);
    }
  }
}

function generateRegistryModule(): string {
  const entries = Array.from(collectedIcons.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, data]) => `  "${name}": ${JSON.stringify(data)}`)
    .join(",\n");

  return `export const registry = {
${entries}
};
`;
}

/**
 * Write the registry module to a real file for HMR support.
 * Bun's native file watcher will detect changes and trigger HMR.
 */
function writeRegistryFile(): void {
  if (!currentCwd) return;

  const filePath = join(currentCwd, REGISTRY_FILE);
  const content = generateRegistryModule();

  // Create directory if it doesn't exist
  mkdirSync(dirname(filePath), { recursive: true });

  // Only write if content changed (avoids HMR loops)
  try {
    const existing = readFileSync(filePath, "utf-8");
    if (existing === content) return;
  } catch {
    // File doesn't exist, continue
  }

  writeFileSync(filePath, content);
  console.log(`[iconify] Updated registry with ${collectedIcons.size} icons`);
}

function getConfig(): IconifyConfig {
  try {
    const bunfig = require(resolve(process.cwd(), "bunfig.toml")) as PluginsBunfig;
    const config = bunfig?.plugins?.iconify;

    if (config?.dirs) {
      const dirs = Array.isArray(config.dirs) ? config.dirs : [config.dirs];
      return { dirs: dirs.map((d) => resolve(process.cwd(), d)) };
    }
  } catch {
    // Ignore errors
  }

  // Fallback: auto-detect src/
  const srcDir = resolve(process.cwd(), "src");
  return { dirs: existsSync(srcDir) ? [srcDir] : [] };
}

function iconifyPlugin(): BunPlugin {
  // Clear and pre-collect icons
  collectedIcons.clear();
  collectionCache.clear();

  // Set current working directory for file writing
  currentCwd = process.cwd();

  const { dirs } = getConfig();

  for (const dir of dirs) {
    collectIconsFromDir(dir);
  }

  if (dirs.length > 0) {
    console.log(`[iconify] Pre-collected ${collectedIcons.size} icons from ${dirs.length} dir(s)`);

    // Write initial registry file
    writeRegistryFile();

    // Set up file watcher for development hot-reload
    if (process.env.NODE_ENV !== "production") {
      setupWatcher(dirs);
    }
  }

  return {
    name: "iconify",
    setup(build) {
      // Resolve virtual:icons to real file path for HMR support
      build.onResolve({ filter: new RegExp(`^${VIRTUAL_MODULE_ID}$`) }, () => {
        return {
          path: join(currentCwd, REGISTRY_FILE),
        };
      });

      // Process tsx/jsx files to collect icons and add registry import
      build.onLoad({ filter: /\.(tsx|jsx)$/ }, async (args) => {
        const content = readFileSync(args.path, "utf-8");

        // Collect icons from code (dynamic collection during build)
        let hasIcons = false;
        if (content.includes(":")) {
          const foundNew = collectIconsFromCode(content);
          // Check if this file contains any icon references
          hasIcons = ALL_ICONS_REGEX.test(content);
          // Reset lastIndex after test
          ALL_ICONS_REGEX.lastIndex = 0;
          // Write registry if new icons found
          if (foundNew) {
            writeRegistryFile();
          }
        }

        // Add registry import if file has icons and import not present
        // This ensures Bun tracks the dependency for HMR
        if (hasIcons && !content.includes(VIRTUAL_MODULE_ID)) {
          // Find the last import statement and add our import after it
          const importMatch = content.match(/^(import\s+.+from\s+['"][^'"]+['"];?\s*)+/m);
          let transformed: string;

          if (importMatch) {
            const lastImportEnd = importMatch.index! + importMatch[0].length;
            transformed =
              content.slice(0, lastImportEnd) +
              `\nimport { registry } from "${VIRTUAL_MODULE_ID}";\n` +
              content.slice(lastImportEnd);
          } else {
            // No imports found, add at the beginning
            transformed = `import { registry } from "${VIRTUAL_MODULE_ID}";\n${content}`;
          }

          return {
            contents: transformed,
            loader: args.path.endsWith(".tsx") ? "tsx" : "jsx",
          };
        }

        return undefined;
      });
    },
  };
}

export default iconifyPlugin();
