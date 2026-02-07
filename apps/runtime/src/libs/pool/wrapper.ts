import type { WorkerConfig } from "@buntime/shared/utils/worker-config";
import { Hono } from "hono";
import { Headers, MessageTypes } from "@/constants";
import { serveStatic } from "@/utils/serve-static";
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
const resolvedAppDir = resolve(APP_DIR);
const resolvedEntry = resolve(ENTRYPOINT);
if (!resolvedEntry.startsWith(resolvedAppDir)) {
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
    const isHtml = headers["content-type"]?.includes("text/html");

    // Filter env vars by configured prefixes for client-side injection (security: never expose server-only vars)
    const prefixes = config.envPrefix ?? ["PUBLIC_", "VITE_"];
    const publicEnv =
      config.env && prefixes.length > 0
        ? Object.fromEntries(
            Object.entries(config.env).filter(([key]) =>
              prefixes.some((prefix) => key.startsWith(prefix)),
            ),
          )
        : null;
    const hasPublicEnv = publicEnv && Object.keys(publicEnv).length > 0;

    // Inject <base href> and/or window.__env__ into HTML responses
    if (isHtml && (config.injectBase || hasPublicEnv)) {
      let text = new TextDecoder().decode(body);

      // Inject <base href> after <head> for asset loading (opt-in via injectBase: true)
      if (config.injectBase) {
        const base = req.headers[Headers.BASE];
        if (base) {
          const baseHref = escapeHtml(base === "/" ? "/" : `${base}/`);
          text = text.replace("<head>", `<head><base href="${baseHref}" />`);
        }
      }

      // Inject window.__env__ with vars matching configured prefixes
      if (hasPublicEnv) {
        // Escape </script> in values to prevent XSS
        const safeJson = JSON.stringify(publicEnv).replace(/<\/script>/gi, "<\\/script>");
        text = text.replace("</head>", `<script>window.__env__=${safeJson};</script></head>`);
      }

      body = new TextEncoder().encode(text).buffer;
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
