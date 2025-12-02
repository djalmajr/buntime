import type { BuntimePlugin, PluginContext } from "@buntime/shared/types";
import { substituteEnvVars } from "@buntime/shared/utils";
import type { Server, ServerWebSocket } from "bun";

export interface ProxyRule {
  /**
   * Regex pattern to match request path
   * Use capture groups for path rewriting
   * @example "^/api/v(\\d+)/(.*)$"
   */
  pattern: string;

  /**
   * Target URL to proxy to
   * Supports ${ENV_VAR} syntax for environment variables
   * @example "http://backend:3000" or "${API_URL}"
   */
  target: string;

  /**
   * Path rewrite using capture groups from pattern
   * Use $1, $2, etc. to reference captured groups
   * @example "/version/$1/$2"
   */
  rewrite?: string;

  /**
   * Change Host and Origin headers to match target
   * @default false
   */
  changeOrigin?: boolean;

  /**
   * Verify SSL certificates
   * @default true
   */
  secure?: boolean;

  /**
   * Additional headers to send with proxied requests
   */
  headers?: Record<string, string>;

  /**
   * Enable WebSocket proxy for this rule
   * @default true
   */
  ws?: boolean;
}

export interface ProxyConfig {
  /**
   * Global proxy rules (applied to all requests before app-specific rules)
   */
  rules?: ProxyRule[];
}

interface CompiledRule extends ProxyRule {
  regex: RegExp;
}

interface MatchResult {
  groups: string[];
  rule: CompiledRule;
}

interface WebSocketData {
  pathname: string;
  rule: CompiledRule;
  target: WebSocket | null;
}

// Module state
let globalRules: CompiledRule[] = [];
let logger: PluginContext["logger"];
let bunServer: Server<WebSocketData> | null = null;

function compileRules(rules: ProxyRule[]): CompiledRule[] {
  const compiled: CompiledRule[] = [];

  for (const rule of rules) {
    try {
      compiled.push({
        ...rule,
        regex: new RegExp(rule.pattern),
        target: substituteEnvVars(rule.target),
        ws: rule.ws !== false, // default true
      });
    } catch (err) {
      logger?.warn(`Invalid regex pattern: ${rule.pattern}`, err);
    }
  }

  return compiled;
}

function matchRule(pathname: string, rules: CompiledRule[]): MatchResult | null {
  for (const rule of rules) {
    const match = pathname.match(rule.regex);
    if (match) {
      return { groups: match.slice(1), rule };
    }
  }
  return null;
}

function rewritePath(match: MatchResult, pathname: string): string {
  if (!match.rule.rewrite) {
    return pathname;
  }

  let result = match.rule.rewrite;
  for (let i = 0; i < match.groups.length; i++) {
    result = result.replace(new RegExp(`\\$${i + 1}`, "g"), match.groups[i] || "");
  }

  return result.startsWith("/") ? result : `/${result}`;
}

async function httpProxy(req: Request, rule: CompiledRule, path: string): Promise<Response> {
  const url = new URL(req.url);
  const targetUrl = new URL(path, rule.target);
  targetUrl.search = url.search;

  const headers = new Headers(req.headers);

  // Remove hop-by-hop headers
  const hopByHop = [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
  ];
  for (const header of hopByHop) {
    headers.delete(header);
  }

  // Apply changeOrigin
  if (rule.changeOrigin) {
    headers.set("host", targetUrl.host);
    headers.set("origin", targetUrl.origin);
  }

  // Apply custom headers
  if (rule.headers) {
    for (const [key, value] of Object.entries(rule.headers)) {
      headers.set(key, value);
    }
  }

  try {
    const response = await fetch(targetUrl.href, {
      body: req.body,
      headers,
      method: req.method,
    });

    // Clone response with cleaned headers
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("connection");
    responseHeaders.delete("keep-alive");
    responseHeaders.delete("transfer-encoding");

    return new Response(response.body, {
      headers: responseHeaders,
      status: response.status,
      statusText: response.statusText,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger?.error(`Proxy error to ${targetUrl.href}:`, message);
    return new Response(JSON.stringify({ error: `Proxy error: ${message}` }), {
      headers: { "Content-Type": "application/json" },
      status: 502,
    });
  }
}

function upgradeToWebSocket(req: Request, rule: CompiledRule, path: string): Response | null {
  if (!bunServer) {
    return new Response("WebSocket server not configured", { status: 500 });
  }

  const data: WebSocketData = { pathname: path, rule, target: null };
  const upgraded = (bunServer as Server<WebSocketData>).upgrade(req, { data });

  if (!upgraded) {
    return new Response("WebSocket upgrade failed", { status: 500 });
  }

  // Return null to indicate upgrade was successful
  return null;
}

function handleWebSocketOpen(ws: ServerWebSocket<WebSocketData>): void {
  const { pathname, rule } = ws.data;
  const targetUrl = new URL(rule.target);
  const protocol = targetUrl.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${targetUrl.host}${pathname}`;

  try {
    const target = new WebSocket(wsUrl);

    target.onopen = () => {
      ws.data.target = target;
      logger?.debug(`WebSocket connected: ${wsUrl}`);
    };

    target.onmessage = (event) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(event.data);
      }
    };

    target.onerror = (error) => {
      logger?.error(`WebSocket target error:`, error);
      ws.close(1011, "Target connection error");
    };

    target.onclose = (event) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(event.code, event.reason);
      }
    };
  } catch (err) {
    logger?.error(`Failed to connect WebSocket to ${wsUrl}:`, err);
    ws.close(1011, "Failed to connect to target");
  }
}

function handleWebSocketMessage(
  ws: ServerWebSocket<WebSocketData>,
  message: string | Buffer,
): void {
  const { target } = ws.data;
  if (target?.readyState === WebSocket.OPEN) {
    target.send(message);
  }
}

function handleWebSocketClose(
  ws: ServerWebSocket<WebSocketData>,
  code: number,
  reason: string,
): void {
  const { target } = ws.data;
  if (target?.readyState === WebSocket.OPEN) {
    target.close(code, reason);
  }
}

/**
 * WebSocket handler for Bun.serve()
 * Must be passed to Bun.serve({ websocket: proxyWebSocketHandler })
 */
export const proxyWebSocketHandler = {
  close: handleWebSocketClose,
  message: handleWebSocketMessage,
  open: handleWebSocketOpen,
};

/**
 * Set the Bun server instance (required for WebSocket upgrades)
 * Call this after Bun.serve() returns
 */
export function setProxyServer(server: Server<WebSocketData>): void {
  bunServer = server;
}

/**
 * Check if a request matches a proxy rule and handle it
 * Returns Response for HTTP, null for successful WS upgrade, undefined for no match
 */
export async function handleProxyRequest(req: Request): Promise<Response | null | undefined> {
  if (globalRules.length === 0) {
    return undefined;
  }

  const url = new URL(req.url);
  const match = matchRule(url.pathname, globalRules);

  if (!match) {
    return undefined;
  }

  const path = rewritePath(match, url.pathname);
  const isWebSocket = req.headers.get("upgrade")?.toLowerCase() === "websocket";

  if (isWebSocket) {
    if (!match.rule.ws) {
      return undefined; // WebSocket disabled for this rule
    }
    logger?.debug(`WebSocket proxy ${url.pathname} -> ${match.rule.target}${path}`);
    return upgradeToWebSocket(req, match.rule, path);
  }

  logger?.debug(`HTTP proxy ${url.pathname} -> ${match.rule.target}${path}`);
  return httpProxy(req, match.rule, path);
}

/**
 * Proxy plugin for Buntime
 *
 * Provides HTTP and WebSocket proxy functionality with:
 * - Regex-based path matching
 * - Path rewriting with capture groups
 * - Environment variable substitution
 * - Custom headers support
 * - changeOrigin for CORS
 * - WebSocket proxy support
 *
 * @example
 * ```jsonc
 * // buntime.jsonc
 * {
 *   "plugins": [
 *     ["@buntime/plugin-proxy", {
 *       "rules": [
 *         {
 *           "pattern": "^/api/(.*)",
 *           "target": "${API_URL}",
 *           "rewrite": "/$1",
 *           "changeOrigin": true
 *         },
 *         {
 *           "pattern": "^/ws/(.*)",
 *           "target": "ws://realtime:8080",
 *           "rewrite": "/$1"
 *         }
 *       ]
 *     }]
 *   ]
 * }
 * ```
 */
export default function proxyPlugin(config: ProxyConfig = {}): BuntimePlugin {
  return {
    name: "@buntime/plugin-proxy",
    version: "1.0.0",
    priority: 5, // Run early to short-circuit proxy requests

    onInit(ctx: PluginContext) {
      logger = ctx.logger;

      if (config.rules && config.rules.length > 0) {
        globalRules = compileRules(config.rules);
        logger.info(`Loaded ${globalRules.length} proxy rules`);
      }
    },

    onServerStart(server) {
      bunServer = server as Server<WebSocketData>;
      logger?.debug("Proxy server configured for WebSocket upgrades");
    },

    websocket: proxyWebSocketHandler as BuntimePlugin["websocket"],

    async onRequest(req) {
      const result = await handleProxyRequest(req);

      // undefined = no match, continue to next handler
      if (result === undefined) {
        return;
      }

      // null = WebSocket upgrade succeeded
      if (result === null) {
        return new Response(null, { status: 101 });
      }

      // Response = HTTP proxy response
      return result;
    },
  };
}

// Named exports
export { proxyPlugin };
export type { CompiledRule, MatchResult, WebSocketData };
