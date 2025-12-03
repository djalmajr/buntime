import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { BunPlugin } from "bun";

const VIRTUAL_MODULE_ID = "virtual:i18n";

interface I18nextConfig {
  dirs: string[];
}

interface PluginsBunfig {
  plugins?: {
    i18next?: {
      dirs?: string | string[];
    };
  };
}

interface TranslationEntry {
  lang: string;
  namespace: string;
  path: string;
}

function findTranslationFiles(dir: string, baseDir: string): TranslationEntry[] {
  const entries: TranslationEntry[] = [];

  function scan(currentDir: string) {
    const items = readdirSync(currentDir);

    for (const item of items) {
      const fullPath = join(currentDir, item);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        if (item === "node_modules" || item === "dist") continue;
        scan(fullPath);
      } else if (item.endsWith(".json") && currentDir.endsWith("/locales")) {
        // Extract namespace from path
        // routes/locales/pt.json → common
        // routes/deployments/locales/pt.json → deployments
        // routes/deployments/versions/locales/pt.json → deployments.versions
        const relativePath = relative(baseDir, currentDir);
        const parts = relativePath.split("/").filter((p) => p !== "locales");

        // Remove "routes" prefix if present
        if (parts[0] === "routes") parts.shift();

        const namespace = parts.length > 0 ? parts.join(".") : "common";
        const lang = item.replace(".json", "");

        entries.push({
          lang,
          namespace,
          path: fullPath,
        });
      }
    }
  }

  scan(dir);
  return entries;
}

function generateTranslationsModule(entries: TranslationEntry[]): string {
  // Group by namespace
  const namespaces = new Map<string, Map<string, string>>();

  for (const entry of entries) {
    if (!namespaces.has(entry.namespace)) {
      namespaces.set(entry.namespace, new Map());
    }
    namespaces.get(entry.namespace)!.set(entry.lang, entry.path);
  }

  // Generate imports and map
  const imports: string[] = [];
  const mapEntries: string[] = [];
  let importIndex = 0;

  for (const [namespace, langs] of namespaces) {
    const langEntries: string[] = [];

    for (const [lang, path] of langs) {
      const importName = `t${importIndex++}`;
      imports.push(`const ${importName} = () => import("${path}");`);
      langEntries.push(`    "${lang}": ${importName}`);
    }

    mapEntries.push(`  "${namespace}": {\n${langEntries.join(",\n")}\n  }`);
  }

  return `// Auto-generated translations map
${imports.join("\n")}

export const translations = {
${mapEntries.join(",\n")}
};
`;
}

function getConfig(): I18nextConfig {
  try {
    const bunfig = require(resolve(process.cwd(), "bunfig.toml")) as PluginsBunfig;
    const config = bunfig?.plugins?.i18next;

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

function i18nextPlugin(): BunPlugin {
  const { dirs } = getConfig();

  const allEntries: TranslationEntry[] = [];
  for (const dir of dirs) {
    allEntries.push(...findTranslationFiles(dir, dir));
  }

  if (dirs.length > 0) {
    console.log(
      `[i18next] Found ${allEntries.length} translation files from ${dirs.length} dir(s)`,
    );
  }

  return {
    name: "i18next",
    setup(build) {
      // Resolve virtual:i18n module
      build.onResolve({ filter: new RegExp(`^${VIRTUAL_MODULE_ID}$`) }, (args) => {
        return {
          namespace: "virtual-i18n",
          path: args.path,
        };
      });

      // Load virtual:i18n module content
      build.onLoad({ filter: /.*/, namespace: "virtual-i18n" }, () => {
        const content = generateTranslationsModule(allEntries);
        console.log(`[i18next] Generated virtual module with ${allEntries.length} translations`);
        return {
          contents: content,
          loader: "js",
        };
      });
    },
  };
}

export default i18nextPlugin();
