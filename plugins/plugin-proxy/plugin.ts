import type { ApiKeyStore } from "@buntime/shared/api-keys";
import { createApiKeyMiddleware } from "@buntime/shared/middleware/api-key";
import type { PluginContext, PluginImpl } from "@buntime/shared/types";
import type { Server } from "bun";
import { Hono } from "hono";
import { createApi } from "./server/api";
import {
  handleProxyRequest,
  initializeProxyService,
  isProxyRoutePublic,
  loadDynamicRules,
  type ProxyRule,
  proxyWebSocketHandler,
  setProxyServer,
  shutdownProxyService,
  type WebSocketData,
} from "./server/services";

export interface ProxyConfig {
  /**
   * Static proxy rules (from manifest.yaml, readonly)
   */
  rules?: ProxyRule[];
}

export default function proxyPlugin(config: ProxyConfig = {}): PluginImpl {
  // The plugin loader spreads the impl (`{...impl}`) so any `routes` getter
  // would be evaluated once at registration time. We need a stable object
  // that can have its routing table replaced at onInit when the auth context
  // arrives — hence a thin Hono forwarder that delegates to a mutable inner
  // router. Until onInit runs, an unprotected default is used.
  let activeRouter = createApi();
  // `.all("/*", ...)` is the deep catch-all in Hono v4 — `*` alone matches a
  // single segment, missing nested paths like `/admin/rules/:id`.
  const routes = new Hono().all("/*", (c) => activeRouter.fetch(c.req.raw));

  return {
    routes,

    // Expose public routes checker for auth plugins
    provides: () => ({ isPublic: isProxyRoutePublic }),

    async onInit(ctx: PluginContext) {
      initializeProxyService(ctx, config.rules || []);
      await loadDynamicRules();

      const store = ctx.auth?.store as ApiKeyStore | undefined;
      const rootKey = ctx.auth?.rootKey;
      const middleware = store || rootKey ? createApiKeyMiddleware({ rootKey, store }) : undefined;
      activeRouter = createApi({ middleware });
    },

    async onShutdown() {
      shutdownProxyService();
    },

    onServerStart(server) {
      setProxyServer(server as Server<WebSocketData>);
      const logger = (server as unknown as { logger?: PluginContext["logger"] }).logger;
      logger?.debug("Proxy server configured for WebSocket upgrades");
    },

    websocket: proxyWebSocketHandler as PluginImpl["websocket"],

    // Content routing, not an auth gate: a crash here should let the request
    // fall through to normal routing, not block all traffic. See PluginImpl.
    onRequestFailOpen: true,

    async onRequest(req) {
      const result = await handleProxyRequest(req);

      if (result === undefined) {
        return;
      }

      if (result === null) {
        return new Response(null, { status: 101 });
      }

      return result;
    },
  };
}

export { proxyPlugin };
export type { ProxyRoutesType } from "./server/api";
export type { ProxyRule };
