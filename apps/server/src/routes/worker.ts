import type { Context } from "hono";
import { Hono } from "hono";
import { APP_SHELL, VERSION } from "~/constants";
import { loadWorkerConfig } from "~/libs/pool/config";
import { pool } from "~/libs/pool/pool";
import { getAppDir } from "~/utils/get-app-dir";

async function run(ctx: Context, app: string) {
  try {
    const dir = getAppDir(app);
    if (!dir) return ctx.json({ error: `App not found: ${app}` }, 404);

    const config = await loadWorkerConfig(dir);
    const pathname = ctx.req.path.split(app)[1] || "/";

    const req = new Request(new URL(pathname, ctx.req.url).href, ctx.req.raw);
    req.headers.set("x-base", `/${app}`);

    return (await pool.getOrCreate(dir, config)).fetch(req);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(`[Main] Error serving ${app}:`, error);
    return ctx.json({ error: `Error: ${error.message}` }, 500);
  }
}

export default new Hono()
  .all(":app/*", (ctx) => run(ctx, ctx.req.param("app")))
  .get("/*", (ctx) => (APP_SHELL ? run(ctx, APP_SHELL) : new Response(`Buntime v${VERSION}`)));
