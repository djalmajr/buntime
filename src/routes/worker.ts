import type { Context } from "hono";
import { Hono } from "hono";
import { APP_SHELL, VERSION } from "@/constants";
import { pool } from "@/libs/pool";
import { loadWorkerConfig } from "@/libs/pool/config";
import { proxy } from "@/libs/proxy";
import { getAppDir } from "@/utils/get-app-dir";

async function run(ctx: Context, app: string) {
  try {
    const dir = getAppDir(app);
    if (!dir) return ctx.json({ error: `App not found: ${app}` }, 404);

    const config = await loadWorkerConfig(dir);
    const url = new URL(ctx.req.url);
    const pathname = url.pathname.split(app)[1] || "/";

    // 1. Proxy - direto, sem Worker (melhor performance)
    const match = proxy.matchRule(pathname, config.proxy);
    if (match) {
      const path = proxy.rewritePath({ ...match, pathname });
      const response = await proxy.request(ctx.req.raw, match.rule, path);
      // null means WebSocket upgrade succeeded - Bun handles the connection
      return response ?? new Response(null, { status: 101 });
    }

    // 2. Worker - static ou dynamic app
    url.pathname = pathname;
    const req = new Request(url.href, ctx.req.raw);
    req.headers.set("x-app-name", app);

    return (await pool.getOrCreate(dir)).fetch(req);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(`[Main] Error serving ${app}:`, error);
    return ctx.json({ error: `Error: ${error.message}` }, 500);
  }
}

export default new Hono()
  .all(":app/*", (ctx) => run(ctx, ctx.req.param("app")))
  .get("/*", (ctx) => (APP_SHELL ? run(ctx, APP_SHELL) : new Response(`Buntime v${VERSION}`)));
