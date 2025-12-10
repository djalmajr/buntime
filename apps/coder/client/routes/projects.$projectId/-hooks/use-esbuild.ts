import * as esbuild from "esbuild-wasm";
import { useCallback, useEffect, useRef, useState } from "react";
import pkg from "#/package.json";
import type { Dependency } from "./use-dependencies";

export interface VirtualFile {
  content: string;
  path: string;
}

interface UseEsbuildOptions {
  dependencies: Dependency[];
  files: VirtualFile[];
}

interface UseEsbuildResult {
  build: () => Promise<string | null>;
  error: string | null;
  isReady: boolean;
}

function resolvePath(from: string, to: string): string {
  if (to.startsWith("/")) return to;
  const fromParts = from.split("/").slice(0, -1);
  const toParts = to.split("/");
  for (const part of toParts) {
    if (part === "..") fromParts.pop();
    else if (part !== ".") fromParts.push(part);
  }
  return fromParts.join("/") || "/";
}

function createVirtualFsPlugin(
  files: VirtualFile[],
  dependencies: Dependency[],
  entryPoint: string,
): esbuild.Plugin {
  const fileMap = new Map(files.map((f) => [f.path, f.content]));

  // Build a map of package names to esm.sh URLs
  const depMap = new Map<string, string>();
  for (const dep of dependencies) {
    const version = dep.version === "latest" ? "" : `@${dep.version}`;
    depMap.set(dep.name, `https://esm.sh/${dep.name}${version}`);
  }

  return {
    name: "virtual-fs",
    setup(build) {
      // Resolve entry point
      const entryRegex = new RegExp(`^${entryPoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
      build.onResolve({ filter: entryRegex }, () => ({
        namespace: "virtual-fs",
        path: entryPoint,
      }));

      // Handle npm packages dynamically via esm.sh
      build.onResolve({ filter: /^[^./]/ }, (args) => {
        const importPath = args.path;

        // Check for exact match first - mark as external with full URL
        if (depMap.has(importPath)) {
          return { external: true, path: depMap.get(importPath) };
        }

        // Check for subpath imports (e.g., "react-dom/client", "react/jsx-runtime")
        const basePkg = importPath.split("/")[0];
        if (!basePkg) {
          return { external: true, path: `https://esm.sh/${importPath}` };
        }

        // Handle scoped packages (e.g., "@radix-ui/react-dialog")
        const scopedPkg = importPath.startsWith("@")
          ? importPath.split("/").slice(0, 2).join("/")
          : basePkg;

        if (!scopedPkg) {
          return { external: true, path: `https://esm.sh/${importPath}` };
        }

        if (depMap.has(scopedPkg)) {
          // Build the full esm.sh URL with subpath
          const dep = dependencies.find((d) => d.name === scopedPkg);
          if (dep) {
            const version = dep.version === "latest" ? "" : `@${dep.version}`;
            const subpath = importPath.slice(scopedPkg.length);
            const url = `https://esm.sh/${scopedPkg}${version}${subpath}`;
            return { external: true, path: url };
          }
        }

        // Handle jsx-runtime for automatic JSX transform
        if (importPath.endsWith("/jsx-runtime") || importPath.endsWith("/jsx-dev-runtime")) {
          const pkgName = importPath.replace(/\/jsx(-dev)?-runtime$/, "");
          const dep = dependencies.find((d) => d.name === pkgName);
          if (dep) {
            const version = dep.version === "latest" ? "" : `@${dep.version}`;
            const url = `https://esm.sh/${importPath.replace(pkgName, `${pkgName}${version}`)}`;
            return { external: true, path: url };
          }
        }

        // Unknown package - mark as external, will likely fail at runtime
        console.warn(`Unknown package: ${importPath}. Add it to dependencies.`);
        return { external: true, path: `https://esm.sh/${importPath}` };
      });

      // Handle local files
      build.onResolve({ filter: /^\./ }, (args) => {
        const resolved = resolvePath(args.importer || "/", args.path);
        return { namespace: "virtual-fs", path: resolved };
      });

      build.onLoad({ filter: /.*/, namespace: "virtual-fs" }, (args) => {
        const content = fileMap.get(args.path);
        if (content === undefined) {
          return { errors: [{ text: `File not found: ${args.path}` }] };
        }
        const ext = args.path.split(".").pop();
        const loader =
          ext === "tsx"
            ? "tsx"
            : ext === "ts"
              ? "ts"
              : ext === "jsx"
                ? "jsx"
                : ext === "css"
                  ? "css"
                  : ext === "json"
                    ? "json"
                    : "js";
        return { contents: content, loader };
      });
    },
  };
}

let esbuildInitialized = false;
let initPromise: Promise<void> | null = null;

async function initEsbuild() {
  if (esbuildInitialized) return;
  if (initPromise) return initPromise;

  initPromise = esbuild.initialize({
    wasmURL: `https://esm.sh/esbuild-wasm@${pkg.dependencies["esbuild-wasm"]}/esbuild.wasm`,
  });

  await initPromise;
  esbuildInitialized = true;
}

// Entry point candidates in order of preference
const ENTRY_POINTS = ["/index.tsx", "/index.ts", "/index.jsx", "/index.js"];

function findEntryPoint(files: VirtualFile[]): string | null {
  const filePaths = new Set(files.map((f) => f.path));
  return ENTRY_POINTS.find((ep) => filePaths.has(ep)) ?? null;
}

export function useEsbuild({ dependencies, files }: UseEsbuildOptions): UseEsbuildResult {
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const filesRef = useRef(files);
  const dependenciesRef = useRef(dependencies);
  filesRef.current = files;
  dependenciesRef.current = dependencies;

  useEffect(() => {
    initEsbuild()
      .then(() => setIsReady(true))
      .catch((err) => setError(err.message));
  }, []);

  const build = useCallback(async (): Promise<string | null> => {
    if (!isReady) {
      setError("esbuild is not ready");
      return null;
    }

    const entryPoint = findEntryPoint(filesRef.current);
    if (!entryPoint) {
      setError("No entry point found. Create an index.tsx or index.ts file.");
      return null;
    }

    setError(null);

    try {
      const result = await esbuild.build({
        bundle: true,
        entryPoints: [entryPoint],
        format: "esm",
        jsx: "automatic",
        jsxImportSource: "react",
        plugins: [createVirtualFsPlugin(filesRef.current, dependenciesRef.current, entryPoint)],
        target: "esnext",
        write: false,
      });

      return result.outputFiles?.[0]?.text ?? null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      return null;
    }
  }, [isReady]);

  return { build, error, isReady };
}
