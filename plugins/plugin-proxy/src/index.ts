import type { Kv } from "@buntime/plugin-keyval";
import type { BasePluginConfig, BuntimePlugin, PluginContext } from "@buntime/shared/types";
import { substituteEnvVars } from "@buntime/shared/utils/zod-helpers";
import type { Server, ServerWebSocket } from "bun";
import { Hono } from "hono";

export interface ProxyRule {
  /**
   * Unique identifier for the rule (auto-generated for dynamic rules)
   */
  id?: string;

  /**
   * Human-readable name for the rule
   * @example "API Proxy"
   */
  name?: string;

  /**
   * Regex pattern to match request path
   * Use capture groups for path rewriting
   * @example "^/api/v(\\d+)/(.*)$"
   */
  pattern: string;

  /**
   * Target URL to proxy to
   * Supports ${ENV_VAR} syntax for environment variables
   * @example "http://backend:8080" or "${API_URL}"
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

  /**
   * Inject <base href="..."> tag into HTML responses
   * Useful for SPAs served under a subpath
   * @example "/cpanel"
   */
  base?: string;

  /**
   * Rewrite absolute paths in HTML responses to relative paths
   * Converts src="/..." and href="/..." to src="./..." and href="./..."
   * Works in conjunction with `base` tag for SPAs under subpaths
   * @default false
   */
  relativePaths?: boolean;
}

export interface ProxyConfig extends BasePluginConfig {
  /**
   * Static proxy rules (from buntime.jsonc, readonly)
   */
  rules?: ProxyRule[];
}

interface CompiledRule extends ProxyRule {
  readonly: boolean;
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

interface StoredRule extends ProxyRule {
  id: string;
}

// Module state
let staticRules: CompiledRule[] = [];
let dynamicRules: CompiledRule[] = [];
let logger: PluginContext["logger"];
let bunServer: Server<WebSocketData> | null = null;
let kv: Kv | null = null;

const KV_PREFIX = ["proxy", "rules"];

function compileRule(rule: ProxyRule, readonly: boolean): CompiledRule | null {
  try {
    return {
      ...rule,
      id: rule.id || crypto.randomUUID(),
      readonly,
      regex: new RegExp(rule.pattern),
      target: substituteEnvVars(rule.target),
      ws: rule.ws !== false,
    };
  } catch (err) {
    logger?.warn(`Invalid regex pattern: ${rule.pattern}`, err);
    return null;
  }
}

function compileRules(rules: ProxyRule[], readonly: boolean): CompiledRule[] {
  return rules.map((r) => compileRule(r, readonly)).filter((r): r is CompiledRule => r !== null);
}

function getAllRules(): CompiledRule[] {
  // Static rules have priority (come first)
  return [...staticRules, ...dynamicRules];
}

function matchRule(pathname: string): MatchResult | null {
  const rules = getAllRules();
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

    // Process HTML responses: inject <base> tag and/or rewrite paths
    const contentType = responseHeaders.get("content-type") || "";
    if (contentType.includes("text/html") && (rule.base || rule.relativePaths)) {
      let html = await response.text();

      // Rewrite absolute paths to relative paths (works with <base> tag)
      // Must be done BEFORE injecting <base> tag
      if (rule.relativePaths) {
        // Rewrite src="/..." and href="/..." to src="./..." (but not protocol-relative "//...")
        html = html.replace(/(src|href)="\/(?!\/)/g, '$1="./');
        // Rewrite '/...' in inline scripts (single quotes)
        html = html.replace(/'\/(?!\/)/g, "'./");
      }

      // Inject <base> tag if configured
      if (rule.base) {
        const baseHref = rule.base.endsWith("/") ? rule.base : `${rule.base}/`;
        html = html.replace("<head>", `<head><base href="${baseHref}" />`);
      }

      return new Response(html, {
        headers: responseHeaders,
        status: response.status,
        statusText: response.statusText,
      });
    }

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

export const proxyWebSocketHandler = {
  close: handleWebSocketClose,
  message: handleWebSocketMessage,
  open: handleWebSocketOpen,
};

export function setProxyServer(server: Server<WebSocketData>): void {
  bunServer = server;
}

export async function handleProxyRequest(req: Request): Promise<Response | null | undefined> {
  const rules = getAllRules();
  if (rules.length === 0) {
    return undefined;
  }

  const url = new URL(req.url);
  const match = matchRule(url.pathname);

  if (!match) {
    return undefined;
  }

  const path = rewritePath(match, url.pathname);
  const isWebSocket = req.headers.get("upgrade")?.toLowerCase() === "websocket";

  if (isWebSocket) {
    if (!match.rule.ws) {
      return undefined;
    }
    logger?.debug(`WebSocket proxy ${url.pathname} -> ${match.rule.target}${path}`);
    return upgradeToWebSocket(req, match.rule, path);
  }

  logger?.debug(`HTTP proxy ${url.pathname} -> ${match.rule.target}${path}`);
  return httpProxy(req, match.rule, path);
}

// ============================================================================
// Dynamic Rules Management
// ============================================================================

async function loadDynamicRules(): Promise<void> {
  if (!kv) return;

  const rules: StoredRule[] = [];
  for await (const entry of kv.list<StoredRule>(KV_PREFIX)) {
    if (entry.value) {
      rules.push(entry.value);
    }
  }

  dynamicRules = compileRules(rules, false);
  logger?.debug(`Loaded ${dynamicRules.length} dynamic proxy rules`);
}

async function saveRule(rule: StoredRule): Promise<void> {
  if (!kv) throw new Error("KeyVal not initialized");
  await kv.set([...KV_PREFIX, rule.id], rule);
}

async function deleteRule(id: string): Promise<void> {
  if (!kv) throw new Error("KeyVal not initialized");
  await kv.delete([...KV_PREFIX, id]);
}

// ============================================================================
// API Routes
// ============================================================================

function ruleToResponse(rule: CompiledRule) {
  return {
    changeOrigin: rule.changeOrigin,
    headers: rule.headers,
    id: rule.id,
    name: rule.name,
    pattern: rule.pattern,
    readonly: rule.readonly,
    rewrite: rule.rewrite,
    secure: rule.secure,
    target: rule.target,
    ws: rule.ws,
  };
}

const routes = new Hono()
  // List all rules (static + dynamic)
  .get("/rules", (ctx) => {
    const rules = getAllRules().map(ruleToResponse);
    return ctx.json(rules);
  })

  // Get a single rule by ID
  .get("/rules/:id", (ctx) => {
    const { id } = ctx.req.param();
    const rule = getAllRules().find((r) => r.id === id);

    if (!rule) {
      return ctx.json({ error: "Rule not found" }, 404);
    }

    return ctx.json(ruleToResponse(rule));
  })

  // Create a new dynamic rule
  .post("/rules", async (ctx) => {
    if (!kv) {
      return ctx.json({ error: "Dynamic rules not enabled (plugin-keyval not configured)" }, 400);
    }

    const body = await ctx.req.json<Omit<ProxyRule, "id">>();

    if (!body.pattern || !body.target) {
      return ctx.json({ error: "pattern and target are required" }, 400);
    }

    const rule: StoredRule = {
      ...body,
      id: crypto.randomUUID(),
    };

    // Validate pattern compiles
    const compiled = compileRule(rule, false);
    if (!compiled) {
      return ctx.json({ error: "Invalid regex pattern" }, 400);
    }

    await saveRule(rule);
    dynamicRules.push(compiled);

    logger?.info(`Created proxy rule: ${rule.pattern} -> ${rule.target}`);
    return ctx.json(ruleToResponse(compiled), 201);
  })

  // Update an existing dynamic rule
  .put("/rules/:id", async (ctx) => {
    if (!kv) {
      return ctx.json({ error: "Dynamic rules not enabled" }, 400);
    }

    const { id } = ctx.req.param();
    const existingIndex = dynamicRules.findIndex((r) => r.id === id);

    // Check if it's a static rule
    if (staticRules.some((r) => r.id === id)) {
      return ctx.json({ error: "Cannot modify static rules" }, 403);
    }

    if (existingIndex === -1) {
      return ctx.json({ error: "Rule not found" }, 404);
    }

    const body = await ctx.req.json<Partial<ProxyRule>>();
    const existing = dynamicRules[existingIndex]!;

    const updated: StoredRule = {
      changeOrigin: body.changeOrigin ?? existing.changeOrigin,
      headers: body.headers ?? existing.headers,
      id,
      name: body.name ?? existing.name,
      pattern: body.pattern ?? existing.pattern,
      rewrite: body.rewrite ?? existing.rewrite,
      secure: body.secure ?? existing.secure,
      target: body.target ?? existing.target,
      ws: body.ws ?? existing.ws,
    };

    // Validate pattern compiles
    const compiled = compileRule(updated, false);
    if (!compiled) {
      return ctx.json({ error: "Invalid regex pattern" }, 400);
    }

    await saveRule(updated);
    dynamicRules[existingIndex] = compiled;

    logger?.info(`Updated proxy rule: ${updated.pattern} -> ${updated.target}`);
    return ctx.json(ruleToResponse(compiled));
  })

  // Delete a dynamic rule
  .delete("/rules/:id", async (ctx) => {
    if (!kv) {
      return ctx.json({ error: "Dynamic rules not enabled" }, 400);
    }

    const { id } = ctx.req.param();

    // Check if it's a static rule
    if (staticRules.some((r) => r.id === id)) {
      return ctx.json({ error: "Cannot delete static rules" }, 403);
    }

    const index = dynamicRules.findIndex((r) => r.id === id);
    if (index === -1) {
      return ctx.json({ error: "Rule not found" }, 404);
    }

    await deleteRule(id);
    dynamicRules.splice(index, 1);

    logger?.info(`Deleted proxy rule: ${id}`);
    return ctx.json({ success: true });
  });

// ============================================================================
// Plugin Export
// ============================================================================

export default function proxyPlugin(config: ProxyConfig = {}): BuntimePlugin {
  return {
    name: "@buntime/plugin-proxy",
    version: "1.0.0",
    optionalDependencies: ["@buntime/plugin-keyval"],
    base: config.base,
    routes,

    async onInit(ctx: PluginContext) {
      logger = ctx.logger;

      // Compile static rules
      if (config.rules && config.rules.length > 0) {
        staticRules = compileRules(
          config.rules.map((r, i) => ({ ...r, id: `static-${i}` })),
          true,
        );
        logger.info(`Loaded ${staticRules.length} static proxy rules`);
      }

      // Use shared kv service from plugin-keyval for dynamic rules
      const sharedKv = ctx.getService<Kv>("kv");

      if (sharedKv) {
        kv = sharedKv;
        await loadDynamicRules();
        logger.info(`Dynamic proxy rules enabled (${dynamicRules.length} loaded)`);
      } else {
        logger.debug("KeyVal service not available, dynamic rules disabled");
      }
    },

    async onShutdown() {
      // Reset state (kv is shared, don't close it)
      staticRules = [];
      dynamicRules = [];
      kv = null;
    },

    onServerStart(server) {
      bunServer = server as Server<WebSocketData>;
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
export type { CompiledRule, MatchResult, StoredRule, WebSocketData };
export type ProxyRoutesType = typeof routes;
