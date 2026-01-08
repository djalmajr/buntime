import { Hono } from "hono";
import { Headers, MessageTypes } from "@/constants";
import { serveStatic } from "@/utils/serve-static";
import type { WorkerConfig } from "./config";
import type { MethodHandlers, RouteHandler, WorkerApp, WorkerResponse } from "./types";

declare var self: Worker;

interface RequestWithParams extends Request {
  params?: Record<string, string>;
}

const Errors = {
  INVALID_APP: "Module must export default with fetch method or routes",
  INVALID_CONFIG: "APP_DIR or WORKER_CONFIG env var is missing",
  INVALID_ENTRY: "ENTRYPOINT env var is missing",
};

/** Header size limits to prevent memory exhaustion */
const HeaderLimits = {
  MAX_COUNT: 100, // Maximum number of headers
  MAX_TOTAL_SIZE: 64 * 1024, // 64KB total headers size
  MAX_VALUE_SIZE: 8 * 1024, // 8KB per header value
} as const;

/**
 * Escape special characters for safe HTML attribute/script injection
 * Prevents XSS attacks from untrusted input in headers
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\\/g, "\\\\");
}

/**
 * Safely copy headers with size limits to prevent memory exhaustion
 * Truncates values exceeding limits, skips excess headers
 */
function safeHeaders(responseHeaders: Headers): Record<string, string> {
  const headers: Record<string, string> = {};
  let totalSize = 0;
  let count = 0;

  for (const [name, value] of responseHeaders.entries()) {
    if (count >= HeaderLimits.MAX_COUNT) break;

    const safeValue =
      value.length > HeaderLimits.MAX_VALUE_SIZE
        ? value.slice(0, HeaderLimits.MAX_VALUE_SIZE)
        : value;

    const entrySize = name.length + safeValue.length;
    if (totalSize + entrySize > HeaderLimits.MAX_TOTAL_SIZE) break;

    headers[name] = safeValue;
    totalSize += entrySize;
    count++;
  }

  return headers;
}

const { APP_DIR, ENTRYPOINT, WORKER_CONFIG } = Bun.env;

if (!APP_DIR || !WORKER_CONFIG) throw new Error(Errors.INVALID_CONFIG);
if (!ENTRYPOINT) throw new Error(Errors.INVALID_ENTRY);

// Security: Validate entrypoint is within APP_DIR to prevent path traversal
// This prevents malicious configs from loading files outside the app directory
const { resolve } = await import("node:path");
const resolvedEntry = resolve(APP_DIR, ENTRYPOINT);
if (!resolvedEntry.startsWith(APP_DIR)) {
  throw new Error(`Security: Entrypoint "${ENTRYPOINT}" escapes app directory`);
}

// Auto-install dependencies if configured (runs before app import)
// Security: --ignore-scripts prevents execution of postinstall scripts from untrusted packages
const config: WorkerConfig = JSON.parse(WORKER_CONFIG);
if (config.autoInstall) {
  const result = Bun.spawnSync(["bun", "install", "--frozen-lockfile", "--ignore-scripts"], {
    cwd: APP_DIR,
    stderr: "pipe",
    stdout: "pipe",
  });

  if (!result.success) {
    throw new Error(`bun install failed in ${APP_DIR}: ${result.stderr.toString()}`);
  }
}

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
      } else if (value instanceof Blob) {
        // BunFile extends Blob - convert to Response
        srv.all(path, () => new Response(value));
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

  if (type === MessageTypes.IDLE) return app?.onIdle?.();
  if (type === MessageTypes.TERMINATE) return app?.onTerminate?.();

  try {
    const request = new Request(req.url, req);
    const response = await fetcher(request);

    // Use safe headers with size limits to prevent memory exhaustion
    const headers = safeHeaders(response.headers);
    headers["content-type"] ||= "text/plain; charset=utf-8";

    let body = await response.arrayBuffer();
    const base = req.headers[Headers.BASE];
    const fragmentRoute = req.headers[Headers.FRAGMENT_ROUTE];
    const notFound = req.headers[Headers.NOT_FOUND] === "true";
    const isHtml = headers["content-type"]?.includes("text/html");

    if (isHtml && base) {
      const text = new TextDecoder().decode(body);
      const baseHref = escapeHtml(base === "/" ? "/" : `${base}/`);

      // Build injection: base tag + optional shell state
      let injection = `<base href="${baseHref}" />`;

      // Inject fragment route and not-found state for app-shell mode
      // __ROUTER_BASEPATH__ tells the shell's router to use "/" as basepath
      // while <base> tag keeps assets loading from the shell's actual path (e.g., /cpanel)
      if (fragmentRoute !== undefined) {
        const safeRoute = escapeHtml(fragmentRoute);
        // Security: notFound must be a boolean literal to prevent XSS injection
        const safeNotFound = notFound === true ? "true" : "false";
        injection += `<script>window.__FRAGMENT_ROUTE__="${safeRoute}";window.__NOT_FOUND__=${safeNotFound};window.__ROUTER_BASEPATH__="/";</script>`;
      }

      const html = text.replace("<head>", `<head>${injection}`);
      body = new TextEncoder().encode(html).buffer;
    }

    const message: WorkerResponse = {
      type: MessageTypes.RESPONSE,
      res: { body, headers, status: response.status },
      reqId,
    };

    self.postMessage(message, [body]);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    self.postMessage({
      type: MessageTypes.ERROR,
      error: err.message,
      reqId,
      stack: err.stack,
    });
  }
};

self.postMessage({ type: MessageTypes.READY });
