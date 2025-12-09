import type { Context } from "hono";
import { Hono } from "hono";
import { loadWorkerConfig } from "@/libs/pool/config";
import type { WorkerPool } from "@/libs/pool/pool";

export interface WorkerRoutesConfig {
  shell?: string;
  version: string;
}

export interface WorkerRoutesDeps {
  config: WorkerRoutesConfig;
  getAppDir: (appName: string) => string;
  pool: WorkerPool;
}

export function createWorkerRoutes({ config, getAppDir, pool }: WorkerRoutesDeps) {
  async function run(ctx: Context, app: string) {
    try {
      const dir = getAppDir(app);
      if (!dir) return ctx.json({ error: `App not found: ${app}` }, 404);

      const workerConfig = await loadWorkerConfig(dir);
      const pathname = ctx.req.path.split(app)[1] || "/";

      const req = new Request(new URL(pathname, ctx.req.url).href, ctx.req.raw);
      req.headers.set("x-base", `/${app}`);

      return (await pool.getOrCreate(dir, workerConfig)).fetch(req);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(`[Main] Error serving ${app}:`, error);
      return ctx.json({ error: `Error: ${error.message}` }, 500);
    }
  }

  return new Hono()
    .all(":app/*", (ctx) => run(ctx, ctx.req.param("app")))
    .get("/*", (ctx) =>
      config.shell ? run(ctx, config.shell) : new Response(`Buntime v${config.version}`),
    );
}
