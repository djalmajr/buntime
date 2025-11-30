import { Hono } from "hono";
import { serveStatic } from "@/utils/serve-static";
import type { MethodHandlers, RouteHandler, WorkerApp, WorkerResponse } from "./types";

declare var self: Worker;

interface RequestWithParams extends Request {
  params?: Record<string, string>;
}

const Errors = {
  INVALID_APP: "Module must export default with fetch method or routes",
  INVALID_ENTRY: "ENTRYPOINT env var is missing",
};

const { ENTRYPOINT } = Bun.env;

if (!ENTRYPOINT) throw new Error(Errors.INVALID_ENTRY);

const spa = ENTRYPOINT.endsWith(".html");
const app: WorkerApp | null = spa ? null : (await import(ENTRYPOINT)).default;

if (!spa && (!app || (typeof app.fetch !== "function" && !app.routes))) {
  throw new Error(Errors.INVALID_APP);
}

const fetcher = (() => {
  if (spa) {
    return (req: Request) => serveStatic(ENTRYPOINT, new URL(req.url).pathname);
  }

  if (app!.routes) {
    const srv = new Hono();

    for (const [path, value] of Object.entries(app!.routes)) {
      if (value instanceof Response) {
        srv.all(path, () => value);
      } else if (typeof value === "function") {
        srv.all(path, async (c) => {
          const req = c.req.raw as RequestWithParams;
          req.params = c.req.param();
          return await (value as RouteHandler)(req);
        });
      } else if (typeof value === "object") {
        for (const [method, fn] of Object.entries(value as MethodHandlers)) {
          srv.on(method, path, async (c) => {
            const req = c.req.raw as RequestWithParams;
            req.params = c.req.param();
            return await fn(req);
          });
        }
      }
    }

    if (app!.fetch) {
      srv.all("*", (ctx) => app!.fetch!(ctx.req.raw));
    }

    return srv.fetch;
  }

  return app!.fetch!;
})();

self.onmessage = async ({ data }) => {
  const { type, req, reqId } = data;

  if (type === "IDLE") return app?.onIdle?.();
  if (type === "TERMINATE") return app?.onTerminate?.();

  try {
    const request = new Request(req.url, req);
    const pathname = new URL(req.url).pathname;
    const response = await (pathname === "/health" ? new Response("OK") : fetcher(request));

    const headers = Object.fromEntries(response.headers.entries());
    headers["content-type"] ||= "text/plain; charset=utf-8";

    let body = await response.arrayBuffer();
    const appName = req.headers["x-app-name"];
    const isHtml = headers["content-type"]?.includes("text/html");

    if (isHtml && appName) {
      const text = new TextDecoder().decode(body);
      const html = text.replace("<head>", `<head><base href="/${appName}/" />`);
      body = new TextEncoder().encode(html).buffer;
    }

    const message: WorkerResponse = {
      type: "RESPONSE",
      res: { body, headers, status: response.status },
      reqId,
    };

    self.postMessage(message, [body]);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    self.postMessage({ type: "ERROR", error: err.message, reqId });
  }
};

self.postMessage({ type: "READY" });
