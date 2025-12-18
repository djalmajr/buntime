import { errorToResponse } from "@buntime/shared/errors";
import type { AppInfo, WorkerConfig as SharedWorkerConfig } from "@buntime/shared/types";
import type { Hono } from "hono";
import { Hono as HonoApp } from "hono";
import type { WorkerConfig } from "@/libs/pool/config";
import { loadWorkerConfig } from "@/libs/pool/config";
import type { WorkerPool } from "@/libs/pool/pool";
import type { PluginRegistry } from "@/plugins/registry";

export interface AppDeps {
  getAppDir: (appName: string) => string | undefined;
  /**
   * Homepage configuration from buntime.jsonc
   * Can be a plugin name (e.g., "@buntime/plugin-cpanel") or path (e.g., "/my-app")
   */
  homepage?: string;
  pluginsInfo: Hono;
  pool?: WorkerPool;
  registry?: PluginRegistry;
  workers: Hono;
}

/**
 * Information about a resolved app target
 */
interface ResolvedApp {
  basePath: string;
  config: WorkerConfig;
  dir: string;
  name: string;
  type: "plugin" | "worker";
}

/**
 * Resolve which app will handle a request
 * Returns app info or undefined if no app matches
 */
async function resolveTargetApp(
  pathname: string,
  registry: PluginRegistry | undefined,
  getAppDir: (appName: string) => string | undefined,
): Promise<ResolvedApp | undefined> {
  // 1. Check plugin apps first
  if (registry) {
    const pluginApp = registry.resolvePluginApp(pathname);
    if (pluginApp) {
      const workerConfig = await loadWorkerConfig(pluginApp.dir);
      const merged = { ...workerConfig, ...pluginApp.config };
      return {
        basePath: pluginApp.basePath,
        config: merged,
        dir: pluginApp.dir,
        name: pluginApp.basePath.replace(/^\//, "") || "root",
        type: "plugin",
      };
    }
  }

  // 2. Check regular worker apps (pattern: /:app/*)
  const match = pathname.match(/^\/([^/]+)/);
  if (match?.[1]) {
    const appName = match[1];
    const dir = getAppDir(appName);
    if (dir) {
      const workerConfig = await loadWorkerConfig(dir);
      return {
        basePath: `/${appName}`,
        config: workerConfig,
        dir,
        name: appName,
        type: "worker",
      };
    }
  }

  return undefined;
}

/**
 * Create AppInfo from resolved app for plugin hooks
 * Converts pool's WorkerConfig to shared WorkerConfig format
 */
function createAppInfo(resolved: ResolvedApp): AppInfo {
  const poolConfig = resolved.config;

  // Convert pool config (ms) to shared config (seconds) format
  const sharedConfig: SharedWorkerConfig = {
    autoInstall: poolConfig.autoInstall,
    entrypoint: poolConfig.entrypoint,
    idleTimeout: poolConfig.idleTimeoutMs / 1000,
    lowMemory: poolConfig.lowMemory,
    maxRequests: poolConfig.maxRequests,
    publicRoutes: poolConfig.publicRoutes,
    timeout: poolConfig.timeoutMs / 1000,
    ttl: poolConfig.ttlMs / 1000,
  };

  return {
    config: sharedConfig,
    dir: resolved.dir,
    name: resolved.name,
    version: "1.0.0", // TODO: Get from worker config or manifest
  };
}

/**
 * Serve a plugin app via the worker pool
 */
async function servePluginApp(
  req: Request,
  pool: WorkerPool,
  resolved: ResolvedApp,
): Promise<Response> {
  // Calculate pathname relative to plugin app base path
  const url = new URL(req.url);
  const pathname = url.pathname.slice(resolved.basePath.length) || "/";

  const newReq = new Request(new URL(pathname + url.search, req.url).href, req);

  // x-base is always the plugin's basePath where assets are served
  // Router basepath is handled client-side via fragment-outlet's base attribute
  newReq.headers.set("x-base", resolved.basePath);

  return pool.fetch(resolved.dir, resolved.config, newReq);
}

/**
 * Resolved shell configuration
 */
interface ResolvedShell {
  plugin: NonNullable<ReturnType<PluginRegistry["getShellPlugin"]>>;
  dir: string;
  config: WorkerConfig;
}

/**
 * Resolve shell plugin if homepage points to a shell plugin
 */
async function resolveShell(
  homepage: string | undefined,
  registry: PluginRegistry | undefined,
): Promise<ResolvedShell | undefined> {
  if (!homepage || !registry) return undefined;

  // Check if homepage is a plugin reference
  const isPluginRef = homepage.startsWith("@");
  if (!isPluginRef) return undefined;

  // Get the shell plugin
  const shellPlugin = registry.getShellPlugin();
  if (!shellPlugin) return undefined;

  // Check if homepage matches the shell plugin
  if (shellPlugin.name !== homepage) return undefined;

  // Get shell plugin directory and config
  const dir = registry.getPluginDir(shellPlugin.name);
  if (!dir) return undefined;

  const config = await loadWorkerConfig(dir);

  return { plugin: shellPlugin, dir, config };
}

/**
 * Serve the shell app with fragment route injection
 */
async function serveShellApp(
  req: Request,
  pool: WorkerPool,
  shell: ResolvedShell,
  fragmentRoute: string,
  notFound: boolean = false,
): Promise<Response> {
  const url = new URL(req.url);

  // Shell always serves from root, so pathname is "/"
  const newReq = new Request(new URL("/" + url.search, req.url).href, req);

  // Set headers for shell to know the fragment route
  // x-base must be the shell's actual base path so assets load correctly
  // e.g., shell at /cpanel -> <base href="/cpanel/"> -> /cpanel/index.js
  newReq.headers.set("x-base", shell.plugin.base);
  newReq.headers.set("x-fragment-route", fragmentRoute);
  if (notFound) {
    newReq.headers.set("x-not-found", "true");
  }

  return pool.fetch(shell.dir, shell.config, newReq);
}

/**
 * Create the main Hono app with unified routing
 */
export function createApp({ getAppDir, homepage, pluginsInfo, pool, registry, workers }: AppDeps) {
  const app = new HonoApp();

  // Build plugin routes map: base -> { plugin, routes }
  type PluginType = NonNullable<typeof registry>["getAll"] extends () => (infer T)[] ? T : never;
  const pluginRoutes = new Map<string, { plugin: PluginType; routes: Hono }>();
  const pluginPaths = new Map<string, string>();

  // Resolve shell plugin early (will be used in routing)
  let shellPromise: Promise<ResolvedShell | undefined> | undefined;
  if (homepage && registry && pool) {
    shellPromise = resolveShell(homepage, registry);
  }

  if (registry) {
    for (const plugin of registry.getAll()) {
      if (plugin.routes) {
        const base = plugin.base;
        // Check plugin-vs-plugin collision
        if (pluginPaths.has(base)) {
          const existingPlugin = pluginPaths.get(base);
          throw new Error(
            `Route collision: Plugin "${plugin.name}" cannot mount routes at "${base}" - ` +
              `already used by "${existingPlugin}"`,
          );
        }

        pluginPaths.set(base, plugin.name);
        pluginRoutes.set(base, { plugin, routes: plugin.routes as Hono });
        console.log(`[Plugin] ${plugin.name} routes registered at ${base || "/"}`);
      }
    }

    registry.setMountedPaths(pluginPaths);
  }

  // Mount API routes
  app.route("/api/plugins", pluginsInfo);

  // Note: Fragment routes (/f/:fragmentId) have been removed
  // Fragments are now served directly from /{plugin} (unified with plugin routes)
  // The piercing outlet fetches from /{plugin} and assets are served from the same path

  // Single catch-all that handles: server.fetch -> onRequest -> plugin routes -> worker routes
  app.all("*", async (ctx) => {
    const pathname = ctx.req.path;
    const method = ctx.req.method;

    // Clone the request body early to avoid "Body already used" errors
    // when multiple handlers need to read the body
    // We need to clone the body separately because ctx.req.raw.clone() returns
    // a different Request type that doesn't match Bun's Request type
    const requestBody = ctx.req.raw.body
      ? await Bun.readableStreamToArrayBuffer(ctx.req.raw.clone().body!)
      : null;

    // Resolve shell if configured
    const shell = shellPromise ? await shellPromise : undefined;

    // APP-SHELL MODE: If we have a shell and pathname should go to shell, serve it
    // This intercepts navigation requests to: "/" (homepage), "/metrics", "/metrics/workers", etc.
    // But NOT: "/metrics/api/*" (API routes), or fetch requests from fragment-outlet
    const secFetchMode = ctx.req.header("sec-fetch-mode");
    if (shell && pool && registry?.shouldRouteToShell(pathname, secFetchMode)) {
      // Run onRequest hooks first (for auth)
      const authResult = await registry.runOnRequest(ctx.req.raw);
      if (authResult instanceof Response) {
        return authResult; // Auth failed
      }

      // Create request with processed headers
      const shellReq = new Request(ctx.req.url, {
        body: requestBody,
        headers: authResult.headers,
        method: ctx.req.method,
      });

      return serveShellApp(shellReq, pool, shell, pathname);
    }

    // Resolve target app early for use in onResponse
    let appInfo: AppInfo | undefined;
    if (registry) {
      const resolved = await resolveTargetApp(pathname, registry, getAppDir);
      appInfo = resolved ? createAppInfo(resolved) : undefined;
    }

    // Helper to run onResponse hooks
    const runOnResponse = async (response: Response): Promise<Response> => {
      if (!registry || !appInfo) return response;
      return registry.runOnResponse(response, appInfo);
    };

    // 1. Try plugin server.fetch handlers (with publicRoutes check)
    if (registry) {
      for (const plugin of registry.getPluginsWithServerFetch()) {
        // Check if route is public for this plugin
        const isPublic = registry.isPublicRouteForPlugin(plugin, pathname, method);

        if (!isPublic) {
          // Protected route: run onRequest hooks first
          const result = await registry.runOnRequest(ctx.req.raw);
          if (result instanceof Response) {
            return result; // Auth failed
          }
        }

        // Call plugin's server.fetch
        try {
          const response = await plugin.server!.fetch!(ctx.req.raw);
          if (response.status !== 404) {
            return runOnResponse(response);
          }
        } catch (err) {
          console.error(`[Plugin:${plugin.name}] server.fetch error:`, err);
          return ctx.json(
            { error: `Plugin error: ${err instanceof Error ? err.message : String(err)}` },
            500,
          );
        }
      }
    }

    // 2. Run plugin onRequest hooks for remaining routes
    // This may return a modified request (e.g., with X-Identity header from authn)
    let processedReq = ctx.req.raw;
    if (registry) {
      const result = await registry.runOnRequest(ctx.req.raw, appInfo);
      if (result instanceof Response) {
        return result;
      }
      // Use the modified request with any injected headers (e.g., X-Identity)
      processedReq = result;
    }

    // 3. Try plugin routes FIRST (in order of specificity - longest base first)
    // This is important for plugins with both routes and fragment - routes should handle
    // API requests (including SSE) from main thread to avoid worker timeouts
    const sortedPaths = [...pluginRoutes.keys()].sort((a, b) => b.length - a.length);

    for (const base of sortedPaths) {
      // Check if pathname starts with base (or base is root)
      if (base === "" || pathname === base || pathname.startsWith(`${base}/`)) {
        const { routes } = pluginRoutes.get(base)!;

        // Rewrite URL to be relative to base, preserving query string
        const relativePath = base ? pathname.slice(base.length) || "/" : pathname;
        const originalUrl = new URL(ctx.req.url);
        const newUrl = new URL(relativePath + originalUrl.search, ctx.req.url);

        // Create new request with cloned body and processed headers (includes X-Identity)
        const newReq = new Request(newUrl.href, {
          body: requestBody,
          headers: processedReq.headers,
          method: ctx.req.method,
        });
        const response = await routes.fetch(newReq);

        // If plugin route matched (not 404), return it
        if (response.status !== 404) {
          return runOnResponse(response);
        }
      }
    }

    // 4. Serve plugin app (fragment) if resolved - after routes to allow main thread API handling
    if (registry) {
      const resolved = await resolveTargetApp(pathname, registry, getAppDir);
      if (resolved?.type === "plugin" && pool) {
        try {
          // Create request with cloned body and processed headers (includes X-Identity)
          const freshReq = new Request(ctx.req.url, {
            body: requestBody,
            headers: processedReq.headers,
            method: ctx.req.method,
          });
          const response = await servePluginApp(freshReq, pool, resolved);
          return runOnResponse(response);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          console.error(`[Main] Error serving plugin app at ${resolved.basePath}:`, error);
          return ctx.json({ error: `Error: ${error.message}` }, 500);
        }
      }
    }

    // 5. Fall back to worker routes
    // Create request with cloned body and processed headers (includes X-Identity)
    const workerReq = new Request(ctx.req.url, {
      body: requestBody,
      headers: processedReq.headers,
      method: ctx.req.method,
    });
    const response = await workers.fetch(workerReq);

    // 6. If 404 and we have a shell, serve shell with not-found flag
    // This allows the shell to display a consistent 404 page with its layout
    if (response.status === 404 && shell && pool) {
      const shellReq = new Request(ctx.req.url, {
        body: requestBody,
        headers: processedReq.headers,
        method: ctx.req.method,
      });
      return serveShellApp(shellReq, pool, shell, pathname, true);
    }

    return runOnResponse(response);
  });

  // Error handler
  app.onError(errorToResponse);

  return app;
}

export type AppType = ReturnType<typeof createApp>;
