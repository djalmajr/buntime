import { readFileSync } from "node:fs";
import { transformSync } from "@babel/core";
import type { BunPlugin } from "bun";

export interface ReactCompilerPluginOptions {
  /**
   * Filter function to determine which files should be compiled.
   * Defaults to all .tsx/.jsx files.
   */
  filter?: (path: string) => boolean;

  /**
   * React Compiler plugin options.
   * @see https://react.dev/reference/react-compiler/configuration
   */
  compilerOptions?: {
    /**
     * Compilation mode strategy.
     * - 'all': Compile all functions (default)
     * - 'annotation': Only compile functions with "use memo" directive
     * - 'infer': Intelligently detect which functions to compile
     */
    compilationMode?: "all" | "annotation" | "infer";

    /**
     * Target React version for compatibility.
     * Use '17' or '18' for older React versions (requires react-compiler-runtime).
     * React 19+ works without additional configuration.
     */
    target?: "17" | "18" | "19";

    /**
     * Enable logging for debugging.
     */
    logger?: {
      logEvent?: (filename: string, event: unknown) => void;
    };

    /**
     * Additional Babel plugin options passed to babel-plugin-react-compiler.
     */
    [key: string]: unknown;
  };

  /**
   * Source type for Babel parsing.
   * Defaults to 'module'.
   */
  sourceType?: "module" | "script" | "unambiguous";
}

export function reactCompilerPlugin(options: ReactCompilerPluginOptions = {}): BunPlugin {
  const { compilerOptions = {}, filter, sourceType = "module" } = options;

  return {
    name: "react-compiler",
    setup(build) {
      build.onLoad({ filter: /\.[jt]sx$/ }, async (args) => {
        // Apply custom filter if provided
        if (filter && !filter(args.path)) {
          return undefined;
        }

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

export default reactCompilerPlugin;
