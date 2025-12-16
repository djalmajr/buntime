import type { Kv } from "@buntime/plugin-keyval";
import type { PluginContext, SandboxStrategy } from "@buntime/shared/types";
import { substituteEnvVars } from "@buntime/shared/utils/zod-helpers";
import type { Server, ServerWebSocket } from "bun";

/**
 * Fragment piercing configuration for proxied apps
 */
export interface ProxyFragmentConfig {
  /**
   * Sandbox strategy for the fragment
   * - "none": No isolation (internal plugins only)
   * - "patch": Intercepts History API (lightweight)
   * - "iframe": Full isolation via iframe (untrusted apps)
   * - "service-worker": SW intercepts requests (shared styles)
   * @default "patch"
   */
  sandbox?: SandboxStrategy;

  /**
   * Allow MessageBus communication with shell
   * @default true
   */
  allowMessageBus?: boolean;

  /**
   * CSS to inject before fragment loads (for loading states)
   */
  preloadStyles?: string;
}

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

  /**
   * Fragment piercing configuration for this proxied app
   * When set, the shell can embed this app as a fragment with the specified sandbox
   */
  fragment?: ProxyFragmentConfig;
}

export interface CompiledRule extends ProxyRule {
  readonly: boolean;
  regex: RegExp;
}

export interface MatchResult {
  groups: string[];
  rule: CompiledRule;
}

export interface WebSocketData {
  pathname: string;
  rule: CompiledRule;
  target: WebSocket | null;
}

export interface StoredRule extends ProxyRule {
  id: string;
}

// Module state
let staticRules: CompiledRule[] = [];
let dynamicRules: CompiledRule[] = [];
let logger: PluginContext["logger"];
let bunServer: Server<WebSocketData> | null = null;
let kv: Kv | null = null;

const KV_PREFIX = ["proxy", "rules"];

export function compileRule(rule: ProxyRule, readonly: boolean): CompiledRule | null {
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

export function compileRules(rules: ProxyRule[], readonly: boolean): CompiledRule[] {
  return rules.map((r) => compileRule(r, readonly)).filter((r): r is CompiledRule => r !== null);
}

export function getAllRules(): CompiledRule[] {
  // Static rules have priority (come first)
  return [...staticRules, ...dynamicRules];
}

export function matchRule(pathname: string): MatchResult | null {
  const rules = getAllRules();
  for (const rule of rules) {
    const match = pathname.match(rule.regex);
    if (match) {
      return { groups: match.slice(1), rule };
    }
  }
  return null;
}

export function rewritePath(match: MatchResult, pathname: string): string {
  if (!match.rule.rewrite) {
    return pathname;
  }

  let result = match.rule.rewrite;
  for (let i = 0; i < match.groups.length; i++) {
    result = result.replace(new RegExp(`\\$${i + 1}`, "g"), match.groups[i] || "");
  }

  return result.startsWith("/") ? result : `/${result}`;
}

export async function httpProxy(req: Request, rule: CompiledRule, path: string): Promise<Response> {
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

export async function loadDynamicRules(): Promise<void> {
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

export async function saveRule(rule: StoredRule): Promise<void> {
  if (!kv) throw new Error("KeyVal not initialized");
  await kv.set([...KV_PREFIX, rule.id], rule);
}

export async function deleteRule(id: string): Promise<void> {
  if (!kv) throw new Error("KeyVal not initialized");
  await kv.delete([...KV_PREFIX, id]);
}

export function ruleToResponse(rule: CompiledRule) {
  return {
    base: rule.base,
    changeOrigin: rule.changeOrigin,
    fragment: rule.fragment,
    headers: rule.headers,
    id: rule.id,
    name: rule.name,
    pattern: rule.pattern,
    readonly: rule.readonly,
    relativePaths: rule.relativePaths,
    rewrite: rule.rewrite,
    secure: rule.secure,
    target: rule.target,
    ws: rule.ws,
  };
}

// ============================================================================
// State Management
// ============================================================================

export function initializeProxyService(ctx: PluginContext, staticRulesConfig: ProxyRule[]): void {
  logger = ctx.logger;

  // Compile static rules
  if (staticRulesConfig && staticRulesConfig.length > 0) {
    staticRules = compileRules(
      staticRulesConfig.map((r, i) => ({ ...r, id: `static-${i}` })),
      true,
    );
    logger.info(`Loaded ${staticRules.length} static proxy rules`);
  }

  // Use shared kv service from plugin-keyval for dynamic rules
  const sharedKv = ctx.getService<Kv>("kv");

  if (sharedKv) {
    kv = sharedKv;
  } else {
    logger.debug("KeyVal service not available, dynamic rules disabled");
  }
}

export function shutdownProxyService(): void {
  staticRules = [];
  dynamicRules = [];
  kv = null;
}

export function getKv(): Kv | null {
  return kv;
}

export function getStaticRules(): CompiledRule[] {
  return staticRules;
}

export function getDynamicRules(): CompiledRule[] {
  return dynamicRules;
}

export function setDynamicRules(rules: CompiledRule[]): void {
  dynamicRules = rules;
}

export function getLogger(): PluginContext["logger"] {
  return logger;
}
