import { dirname, join } from "node:path";

/**
 * Serve static files from an app directory
 * Falls back to entrypoint (index.html) for SPA routing
 *
 * @param entrypoint - Absolute path to entrypoint (e.g., "/apps/my-app/1.0.0/public/index.html")
 * @param pathname - Request pathname (already stripped of app prefix, e.g., "/" or "/assets/style.css")
 */
export async function serveStatic(entrypoint: string, pathname: string): Promise<Response> {
  const path = pathname.replace(/^\//, "");

  const file = Bun.file(path === "" ? entrypoint : join(dirname(entrypoint), path));
  if (await file.exists()) return new Response(file, { headers: { "Content-Type": file.type } });

  const index = Bun.file(entrypoint);
  if (await index.exists()) return new Response(index, { headers: { "Content-Type": index.type } });

  return new Response("Not Found", { status: 404 });
}
