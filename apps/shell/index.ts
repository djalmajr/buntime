/**
 * Shell worker entrypoint (Buntime serverless worker, served at root by the
 * gateway app-shell). Serves the built client from dist/ and, for document
 * requests, injects the per-host Keycloak config as `window.__config.auth`,
 * resolved SERVER-SIDE from the platform app (`/platform/api/config`) using the
 * request Host. Mirrors the canonical app-shell recipe (wiki/agents/spa-as-app-shell.md).
 *
 * Why custom (not createStaticHandler): the config is per-host and injected into
 * the HTML <head>, so the same artifact serves every tenant host.
 */

import { join } from "node:path";

const DIST = Bun.env.APP_DIR ? join(Bun.env.APP_DIR, "dist") : import.meta.dir;
const RUNTIME_API_URL = Bun.env.RUNTIME_API_URL ?? "http://127.0.0.1:8000";
const CONFIG_URL = `${RUNTIME_API_URL}/platform/api/config`;

/** Resolve the per-host Keycloak config from the platform app (open endpoint). */
export async function resolveAuthConfig(
  host: string,
  fetchFn: typeof fetch = fetch,
): Promise<unknown> {
  try {
    const res = await fetchFn(CONFIG_URL, { headers: { host } });
    if (res.ok) return await res.json();
  } catch {
    // Unreachable/unknown host: leave undefined; the client surfaces the error.
  }
  return undefined;
}

/**
 * Inject `window.__config` into the HTML <head>. Escapes `</script` and `<!--`
 * (OWASP) before embedding JSON in an inline <script> to prevent breaking out.
 */
export function injectConfig(html: string, config: unknown): string {
  const json = JSON.stringify(config)
    .replace(/<\/script/gi, "<\\/script")
    .replace(/<!--/g, "<\\!--");
  return html.replace("</head>", `<script>window.__config=${json}</script></head>`);
}

let indexHtmlCache: string | undefined;
async function indexHtml(): Promise<string> {
  if (indexHtmlCache === undefined) {
    indexHtmlCache = await Bun.file(join(DIST, "index.html")).text();
  }
  return indexHtmlCache;
}

export default {
  async fetch(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);

    // Static assets: serve the file when it exists under dist/.
    if (pathname !== "/" && !pathname.endsWith("/")) {
      const file = Bun.file(join(DIST, pathname));
      if (await file.exists()) {
        return new Response(file, { headers: { "content-type": file.type } });
      }
    }

    // Document: serve index.html with the per-host config injected.
    const auth = await resolveAuthConfig(req.headers.get("host") ?? "");
    const html = injectConfig(await indexHtml(), { auth });
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
};
