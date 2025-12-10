import { join } from "node:path";

// Priority order: index.html first, then JS/TS files
const ENTRYPOINTS = ["index.html", "index.ts", "index.js", "index.mjs"] as const;

export type EntrypointResult = {
  path: string; // Relative path to entrypoint (relative to appDir)
  static: boolean; // Whether it's a static (HTML) entrypoint
};

/**
 * Find the entrypoint file for a worker app
 *
 * Priority:
 * 1. If configEntrypoint is provided, use it directly
 * 2. Otherwise, search in order: index.html, index.ts, index.js, index.mjs
 *
 * Returns the relative path (to appDir) and whether it's a static (HTML) entrypoint
 */
export async function getEntrypoint(appDir: string, entry?: string): Promise<EntrypointResult> {
  if (entry) {
    const file = Bun.file(join(appDir, entry));
    if (await file.exists()) return { path: entry, static: entry.endsWith(".html") };
  }

  for (const name of ENTRYPOINTS) {
    const file = Bun.file(join(appDir, name));
    if (await file.exists()) return { path: name, static: name.endsWith(".html") };
  }

  // Fallback to index.html (will fail if doesn't exist, but that's expected)
  return { path: ENTRYPOINTS[0], static: true };
}
