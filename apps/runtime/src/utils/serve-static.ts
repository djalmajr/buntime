import { dirname, resolve } from "node:path";

/**
 * Serve static files from an app directory
 * Falls back to entrypoint (index.html) for SPA routing
 *
 * Security: Validates that resolved paths stay within the app directory
 * to prevent path traversal attacks (e.g., "../../etc/passwd")
 *
 * @param entrypoint - Absolute path to entrypoint (e.g., "/apps/my-app/1.0.0/public/index.html")
 * @param pathname - Request pathname (already stripped of app prefix, e.g., "/" or "/assets/style.css")
 */
export async function serveStatic(entrypoint: string, pathname: string): Promise<Response> {
  const baseDir = resolve(dirname(entrypoint));
  const resolvedEntry = resolve(entrypoint);

  // Normalize and resolve the requested path
  const requestedPath = pathname.replace(/^\//, "");
  const resolvedPath = requestedPath === "" ? resolvedEntry : resolve(baseDir, requestedPath);

  // Security: Ensure resolved path is within the base directory
  // Prevents path traversal attacks like "../../etc/passwd"
  if (!resolvedPath.startsWith(`${baseDir}/`) && resolvedPath !== resolvedEntry) {
    return new Response("Forbidden", { status: 403 });
  }

  const file = Bun.file(resolvedPath);
  if (await file.exists()) return new Response(file, { headers: { "Content-Type": file.type } });

  const index = Bun.file(resolvedEntry);
  if (await index.exists()) return new Response(index, { headers: { "Content-Type": index.type } });

  return new Response("Not Found", { status: 404 });
}
