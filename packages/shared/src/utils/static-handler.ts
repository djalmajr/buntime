import { join } from "node:path";

/**
 * Creates a static file handler for Bun.serve that serves files from a directory.
 * Falls back to index.html for SPA routing.
 *
 * @param baseDir - The directory to serve files from (usually import.meta.dir)
 * @returns A fetch handler for Bun.serve
 *
 * @example
 * ```ts
 * import { createStaticHandler } from "@buntime/shared/utils/static-handler";
 *
 * export default {
 *   port: 3000,
 *   fetch: createStaticHandler(import.meta.dir),
 * } satisfies Parameters<typeof Bun.serve>[0];
 * ```
 */
export function createStaticHandler(baseDir: string) {
  return async (req: Bun.BunRequest): Promise<Response> => {
    const path = new URL(req.url).pathname;
    const name = path !== "/" ? path : "index.html";
    const file = Bun.file(join(baseDir, name));

    if (await file.exists()) {
      return new Response(file, { headers: { "Content-Type": file.type } });
    }

    // SPA fallback
    const home = Bun.file(join(baseDir, "index.html"));
    return new Response(home, { headers: { "Content-Type": home.type } });
  };
}
