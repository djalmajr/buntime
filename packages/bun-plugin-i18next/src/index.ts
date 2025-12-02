import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { BunPlugin } from "bun";

const VIRTUAL_MODULE_ID = "virtual:i18n";

interface TranslationEntry {
  lang: string;
  namespace: string;
  path: string;
}

export interface I18nextPluginOptions {
  /**
   * Directories to scan for translation files.
   * If not provided, no scanning will be performed.
   */
  dirs?: string | string[];
}

function findTranslationFiles(dir: string, baseDir: string): TranslationEntry[] {
  const entries: TranslationEntry[] = [];

  function scan(currentDir: string) {
    const items = readdirSync(currentDir);

    for (const item of items) {
      const fullPath = join(currentDir, item);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        if (item === "node_modules" || item === "dist" || item.startsWith("-")) continue;
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

export function i18nextPlugin(options: I18nextPluginOptions = {}): BunPlugin {
  const scanDirs = options.dirs
    ? Array.isArray(options.dirs)
      ? options.dirs
      : [options.dirs]
    : [];

  const allEntries: TranslationEntry[] = [];
  for (const dir of scanDirs) {
    allEntries.push(...findTranslationFiles(dir, dir));
  }

  if (scanDirs.length > 0) {
    console.log(
      `[i18next] Found ${allEntries.length} translation files from ${scanDirs.length} dir(s)`,
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

export default i18nextPlugin;
