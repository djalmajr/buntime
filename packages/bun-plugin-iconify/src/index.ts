import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BunPlugin } from "bun";

const VIRTUAL_MODULE_ID = "virtual:icons";

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

interface IconifyJSON {
  height?: number;
  icons: Record<string, { body: string; height?: number; width?: number }>;
  info?: { height?: number; width?: number };
  prefix: string;
  width?: number;
}

const collectionCache = new Map<string, IconifyJSON>();
const collectedIcons = new Map<string, IconData>();

function loadCollection(collection: string): IconifyJSON | null {
  if (collectionCache.has(collection)) return collectionCache.get(collection)!;

  // Try individual collection first (@iconify-json/{collection} ~100KB each)
  // Then fallback to full package (@iconify/json ~200MB)
  const paths = [
    `@iconify-json/${collection}/icons.json`,
    `@iconify/json/json/${collection}.json`,
  ];

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

  console.warn(
    `[iconify] Collection "${collection}" not found. Install @iconify-json/${collection} or @iconify/json`,
  );
  return null;
}

function getIconData(name: string): IconData | null {
  const [collection, iconName] = name.split(":");
  if (!collection || !iconName) return null;

  const data = loadCollection(collection);
  if (!data) return null;

  const icon = data.icons[iconName];
  if (!icon) return null;

  return {
    body: icon.body,
    // Priority: icon-specific > collection root level > info (display height) > fallback
    height: icon.height ?? data.height ?? data.info?.height ?? 24,
    width: icon.width ?? data.width ?? data.info?.width ?? 24,
  };
}

// Regex to find all icon names in strings (for collecting)
const ALL_ICONS_REGEX = /["']([a-z0-9-]+:[a-z0-9-]+)["']/gi;

function collectIconsFromCode(code: string): void {
  const matches = code.matchAll(ALL_ICONS_REGEX);
  for (const match of matches) {
    const name = match[1] || "";
    if (!collectedIcons.has(name)) {
      const iconData = getIconData(name);
      if (iconData) {
        collectedIcons.set(name, iconData);
      }
    }
  }
}

// Recursively collect icons from all tsx/jsx files in a directory
function collectIconsFromDir(dir: string): void {
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      // Skip node_modules and dist directories
      if (entry === "node_modules" || entry === "dist") continue;
      collectIconsFromDir(fullPath);
    } else if (entry.endsWith(".tsx") || entry.endsWith(".jsx") || entry.endsWith(".ts")) {
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

// Regex to match <Icon ... name="..." ... /> and transform to use registry
const ICON_WITH_NAME_REGEX = /<Icon\s+([^>]*?)name=["']([^"']+)["']([^>]*?)\s*\/>/g;

function transformIconUsage(code: string): string {
  return code.replace(ICON_WITH_NAME_REGEX, (_match, before, name, after) => {
    // Collect the icon
    if (!collectedIcons.has(name)) {
      const iconData = getIconData(name);
      if (iconData) {
        collectedIcons.set(name, iconData);
      }
    }

    // Transform to use registry lookup
    return `<Icon ${before}icon={registry["${name}"]}${after} />`;
  });
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

  const { dirs } = getConfig();

  for (const dir of dirs) {
    collectIconsFromDir(dir);
  }

  if (dirs.length > 0) {
    console.log(
      `[iconify] Pre-collected ${collectedIcons.size} icons from ${dirs.length} dir(s)`,
    );
  }

  return {
    name: "iconify",
    setup(build) {
      // Resolve virtual:icons module
      build.onResolve({ filter: new RegExp(`^${VIRTUAL_MODULE_ID}$`) }, (args) => {
        return {
          namespace: "virtual-icons",
          path: args.path,
        };
      });

      // Load virtual:icons module content
      build.onLoad({ filter: /.*/, namespace: "virtual-icons" }, () => {
        const content = generateRegistryModule();
        console.log(`[iconify] Generated virtual module with ${collectedIcons.size} icons`);
        return {
          contents: content,
          loader: "js",
        };
      });

      // Transform tsx/jsx files
      build.onLoad({ filter: /\.(tsx|jsx)$/ }, async (args) => {
        const content = readFileSync(args.path, "utf-8");

        // Collect icons from code
        if (content.includes(":")) {
          collectIconsFromCode(content);
        }

        // Check if file uses Icon component with static name
        if (!content.includes("<Icon") || !content.includes('name="')) {
          return undefined;
        }

        // Transform static Icon usage and add registry import
        let transformed = transformIconUsage(content);

        // Add registry import if we transformed something and it's not already there
        if (transformed !== content && !content.includes(VIRTUAL_MODULE_ID)) {
          // Find the last import statement and add our import after it
          const importMatch = transformed.match(/^(import\s+.+from\s+['"][^'"]+['"];?\s*)+/m);
          if (importMatch) {
            const lastImportEnd = importMatch.index! + importMatch[0].length;
            transformed =
              transformed.slice(0, lastImportEnd) +
              `\nimport { registry } from "${VIRTUAL_MODULE_ID}";\n` +
              transformed.slice(lastImportEnd);
          } else {
            // No imports found, add at the beginning
            transformed = `import { registry } from "${VIRTUAL_MODULE_ID}";\n${transformed}`;
          }
        }

        if (transformed !== content) {
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
