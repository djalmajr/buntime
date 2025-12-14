import type { BasePluginConfig, BuntimePlugin, PluginContext } from "@buntime/shared/types";
import type { Server } from "bun";
import { api } from "./server/api";
import {
  handleProxyRequest,
  initializeProxyService,
  loadDynamicRules,
  type ProxyRule,
  proxyWebSocketHandler,
  setProxyServer,
  shutdownProxyService,
  type WebSocketData,
} from "./server/services";

export interface ProxyConfig extends BasePluginConfig {
  /**
   * Static proxy rules (from buntime.jsonc, readonly)
   */
  rules?: ProxyRule[];
}

export default function proxyPlugin(config: ProxyConfig = {}): BuntimePlugin {
  return {
    name: "@buntime/plugin-proxy",
    optionalDependencies: ["@buntime/plugin-keyval"],
    base: config.base,
    routes: api,

    async onInit(ctx: PluginContext) {
      initializeProxyService(ctx, config.rules || []);
      await loadDynamicRules();
    },

    async onShutdown() {
      shutdownProxyService();
    },

    onServerStart(server) {
      setProxyServer(server as Server<WebSocketData>);
      const logger = (server as unknown as { logger?: PluginContext["logger"] }).logger;
      logger?.debug("Proxy server configured for WebSocket upgrades");
    },

    websocket: proxyWebSocketHandler as BuntimePlugin["websocket"],

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
