import type { Server, ServerWebSocket } from "bun";
import type { ProxyRule } from "./pool/config";

interface MatchRule {
  groups: string[];
  pattern: string;
  rule: ProxyRule;
}

interface WebSocketData {
  pathname: string;
  rule: ProxyRule;
  target: WebSocket | null;
}

type BunServer = Server<WebSocketData>;

class ProxyServer {
  private server: BunServer | null = null;

  /**
   * Set the Bun server instance (required for WebSocket upgrades)
   */
  setServer(server: BunServer): void {
    this.server = server;
  }

  /**
   * Get the WebSocket handler for Bun.serve()
   */
  get websocketHandler() {
    return {
      close: this.handleWebSocketClose.bind(this),
      message: this.handleWebSocketMessage.bind(this),
      open: this.handleWebSocketOpen.bind(this),
    };
  }

  /**
   * Match a request path against proxy rules
   * Patterns are JavaScript regex strings (e.g., "^/api/v(\\d+)/(.*)$")
   * Returns the pattern, rule, and captured groups from the match
   */
  matchRule(pathname: string, rules?: Record<string, ProxyRule>): MatchRule | null {
    if (!rules) return null;

    for (const [pattern, rule] of Object.entries(rules)) {
      try {
        const regex = new RegExp(pattern);
        const match = pathname.match(regex);

        if (match) {
          const groups = match.slice(1);
          return { groups, pattern, rule };
        }
      } catch {
        console.warn(`[Proxy] Invalid regex pattern: ${pattern}`);
      }
    }

    return null;
  }

  /**
   * Rewrite the request path based on the proxy rule
   *
   * Uses regex capture groups for substitution:
   * - $1, $2, ... are replaced with captured groups from pattern match
   * - No rewrite → uses the full matched path
   *
   * Examples:
   * - Pattern: "^/api/v(\\d+)/(.*)$", Rewrite: "/version/$1/$2"
   *   Input: "/api/v2/users" → Output: "/version/2/users"
   * - Pattern: "^/old/(.*)$", Rewrite: "/new/$1"
   *   Input: "/old/page" → Output: "/new/page"
   */
  rewritePath(opts: Omit<MatchRule, "pattern"> & { pathname: string }): string {
    if (!opts.rule.rewrite) {
      return opts.pathname;
    }

    let result = opts.rule.rewrite;
    for (let i = 0; i < opts.groups.length; i++) {
      result = result.replace(new RegExp(`\\$${i + 1}`, "g"), opts.groups[i] || "");
    }

    return result.startsWith("/") ? result : `/${result}`;
  }

  /**
   * Execute proxy request (HTTP or WebSocket)
   * Automatically detects WebSocket upgrade requests
   * Returns null when WebSocket upgrade succeeds (Bun handles the connection)
   */
  async request(req: Request, rule: ProxyRule, path: string): Promise<Response | null> {
    return req.headers.get("upgrade")?.toLowerCase() === "websocket"
      ? this.upgradeToWebSocket(req, rule, path)
      : this.httpProxy(req, rule, path);
  }

  private upgradeToWebSocket(req: Request, rule: ProxyRule, path: string): Response | null {
    if (!this.server) {
      return new Response("WebSocket server not configured", { status: 500 });
    }

    const data: WebSocketData = { pathname: path, rule, target: null };
    const upgraded = this.server.upgrade(req, { data });

    if (!upgraded) {
      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    return null;
  }

  private async httpProxy(req: Request, rule: ProxyRule, path: string): Promise<Response> {
    const url = new URL(req.url);
    const targetUrl = new URL(path, rule.target);
    targetUrl.search = url.search;

    const headers = new Headers(req.headers);

    // Remove hop-by-hop headers
    headers.delete("connection");
    headers.delete("keep-alive");
    headers.delete("proxy-authenticate");
    headers.delete("proxy-authorization");
    headers.delete("te");
    headers.delete("trailers");
    headers.delete("transfer-encoding");
    headers.delete("upgrade");

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

      // Clone response with new headers (remove hop-by-hop)
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
      console.error(`[Proxy] Error proxying to ${targetUrl.href}:`, message);
      return new Response(JSON.stringify({ error: `Proxy error: ${message}` }), {
        headers: { "Content-Type": "application/json" },
        status: 502,
      });
    }
  }

  private handleWebSocketOpen(ws: ServerWebSocket<WebSocketData>): void {
    const { pathname, rule } = ws.data;
    const targetUrl = new URL(rule.target);
    const protocol = targetUrl.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${targetUrl.host}${pathname}`;

    try {
      const target = new WebSocket(wsUrl);

      target.onopen = () => {
        ws.data.target = target;
      };

      target.onmessage = (event) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(event.data);
        }
      };

      target.onerror = (error) => {
        console.error(`[Proxy WS] Target error:`, error);
        ws.close(1011, "Target connection error");
      };

      target.onclose = (event) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(event.code, event.reason);
        }
      };
    } catch (err) {
      console.error(`[Proxy WS] Failed to connect to ${wsUrl}:`, err);
      ws.close(1011, "Failed to connect to target");
    }
  }

  private handleWebSocketMessage(
    ws: ServerWebSocket<WebSocketData>,
    message: string | Buffer,
  ): void {
    const { target } = ws.data;
    if (target?.readyState === WebSocket.OPEN) {
      target.send(message);
    }
  }

  private handleWebSocketClose(
    ws: ServerWebSocket<WebSocketData>,
    code: number,
    reason: string,
  ): void {
    const { target } = ws.data;
    if (target?.readyState === WebSocket.OPEN) {
      target.close(code, reason);
    }
  }
}

export const proxy = new ProxyServer();
