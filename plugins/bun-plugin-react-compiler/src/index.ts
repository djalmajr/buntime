import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transformSync } from "@babel/core";
import type { BunPlugin } from "bun";

interface ReactCompilerConfig {
  compilationMode?: "all" | "annotation" | "infer";
  sourceType?: "module" | "script" | "unambiguous";
  target?: "17" | "18" | "19";
}

interface PluginsBunfig {
  plugins?: {
    "react-compiler"?: ReactCompilerConfig;
  };
}

function getConfig(): ReactCompilerConfig {
  try {
    const bunfig = require(resolve(process.cwd(), "bunfig.toml")) as PluginsBunfig;
    const config = bunfig?.plugins?.["react-compiler"];

    if (config) {
      return config;
    }
  } catch {
    // Ignore errors
  }

  return {};
}

function reactCompilerPlugin(): BunPlugin {
  const { compilationMode, sourceType = "module", target } = getConfig();
  const compilerOptions: Record<string, unknown> = {};

  if (compilationMode) compilerOptions.compilationMode = compilationMode;
  if (target) compilerOptions.target = target;

  const configInfo = [target && `target=${target}`, compilationMode && `mode=${compilationMode}`]
    .filter(Boolean)
    .join(", ");

  console.log(`[react-compiler] Initialized${configInfo ? ` (${configInfo})` : ""}`);

  return {
    name: "react-compiler",
    setup(build) {
      build.onLoad({ filter: /\.[jt]sx$/ }, async (args) => {
        const code = readFileSync(args.path, "utf-8");

        // Skip files with "use no memo" directive
        if (code.includes('"use no memo"') || code.includes("'use no memo'")) {
          return undefined;
        }

        // Skip files without React components (basic heuristic)
        const hasJSX = code.includes("<") && (code.includes("/>") || code.includes("</"));
        const hasReactImport =
          code.includes("react") || code.includes("React") || code.includes("jsx");

        if (!hasJSX && !hasReactImport) {
          return undefined;
        }

        try {
          const isTypeScript = args.path.endsWith(".tsx") || args.path.endsWith(".ts");

          const result = transformSync(code, {
            babelrc: false,
            configFile: false,
            filename: args.path,
            plugins: [["babel-plugin-react-compiler", compilerOptions]],
            presets: isTypeScript
              ? [["@babel/preset-typescript", { isTSX: true, allExtensions: true }]]
              : undefined,
            sourceType,
          });

          if (result?.code) {
            return {
              contents: result.code,
              loader: isTypeScript ? "tsx" : "jsx",
            };
          }
        } catch (error) {
          // Log error but don't fail the build - let Bun handle the file normally
          console.warn(`[react-compiler] Failed to compile ${args.path}:`, error);
        }

        return undefined;
      });
    },
  };
}

export default reactCompilerPlugin();
