import { describe, expect, it, spyOn } from "bun:test";
import type { ProxyRule } from "./index";

// Import internal functions for testing
// We need to test the exported handleProxyRequest and the plugin behavior

const createRule = (opts: Partial<ProxyRule> = {}): ProxyRule => ({
  pattern: opts.pattern ?? ".",
  target: opts.target ?? "http://localhost:8080",
  ...opts,
});

// Helper to create compiled rule (simulating what the plugin does internally)
const compileRule = (rule: ProxyRule) => ({
  ...rule,
  regex: new RegExp(rule.pattern),
  ws: rule.ws !== false,
});

type CompiledRule = ReturnType<typeof compileRule>;

// Test internal matching logic
function matchRule(pathname: string, rules?: CompiledRule[]) {
  if (!rules) return null;

  for (const rule of rules) {
    const match = pathname.match(rule.regex);
    if (match) {
      return { groups: match.slice(1), rule };
    }
  }
  return null;
}

function rewritePath(match: { groups: string[]; rule: CompiledRule }, pathname: string): string {
  if (!match.rule.rewrite) {
    return pathname;
  }

  let result = match.rule.rewrite;
  for (let i = 0; i < match.groups.length; i++) {
    result = result.replace(new RegExp(`\\$${i + 1}`, "g"), match.groups[i] || "");
  }

  return result.startsWith("/") ? result : `/${result}`;
}

describe("matchRule", () => {
  describe("basic matching", () => {
    it("should return null when no rules provided", () => {
      const result = matchRule("/api/users", undefined);
      expect(result).toBeNull();
    });

    it("should return null when no rules match", () => {
      const result = matchRule("/other/path", [
        compileRule(createRule({ pattern: "^/api/(.*)$" })),
      ]);
      expect(result).toBeNull();
    });

    it("should match simple regex pattern", () => {
      const result = matchRule("/api/users", [compileRule(createRule({ pattern: "^/api/(.*)$" }))]);

      expect(result).not.toBeNull();
      expect(result?.groups).toEqual(["users"]);
    });
  });

  describe("capture groups", () => {
    it("should capture single group", () => {
      const result = matchRule("/api/users/123", [
        compileRule(createRule({ pattern: "^/api/(.*)$" })),
      ]);
      expect(result?.groups).toEqual(["users/123"]);
    });

    it("should capture multiple groups", () => {
      const result = matchRule("/api/v2/users/123", [
        compileRule(createRule({ pattern: "^/api/v(\\d+)/(.*)$" })),
      ]);
      expect(result?.groups).toEqual(["2", "users/123"]);
    });

    it("should return empty array when no capture groups", () => {
      const result = matchRule("/health", [compileRule(createRule({ pattern: "^/health$" }))]);
      expect(result?.groups).toEqual([]);
    });
  });

  describe("pattern priority", () => {
    it("should return first matching pattern", () => {
      const result = matchRule("/api/users/123", [
        compileRule(createRule({ pattern: "^/api/users/(.*)$", target: "http://users:8080" })),
        compileRule(createRule({ pattern: "^/api/(.*)$", target: "http://api:8080" })),
      ]);

      expect(result?.rule.target).toBe("http://users:8080");
    });
  });
});

describe("rewritePath", () => {
  describe("without rewrite", () => {
    it("should return original path when no rewrite provided", () => {
      const result = rewritePath({ groups: [], rule: compileRule(createRule()) }, "/api/users");
      expect(result).toBe("/api/users");
    });
  });

  describe("with capture groups", () => {
    it("should replace $1 with first capture group", () => {
      const result = rewritePath(
        { groups: ["users"], rule: compileRule(createRule({ rewrite: "/v1/$1" })) },
        "/api/users",
      );
      expect(result).toBe("/v1/users");
    });

    it("should replace multiple capture groups", () => {
      const result = rewritePath(
        { groups: ["2", "users"], rule: compileRule(createRule({ rewrite: "/version/$1/$2" })) },
        "/api/v2/users",
      );
      expect(result).toBe("/version/2/users");
    });

    it("should replace same group multiple times", () => {
      const result = rewritePath(
        { groups: ["test"], rule: compileRule(createRule({ rewrite: "/$1/path/$1" })) },
        "/api/users",
      );
      expect(result).toBe("/test/path/test");
    });

    it("should handle empty groups", () => {
      const result = rewritePath(
        { groups: [""], rule: compileRule(createRule({ rewrite: "/v1/$1" })) },
        "/api/",
      );
      expect(result).toBe("/v1/");
    });
  });

  describe("path normalization", () => {
    it("should add leading slash if missing", () => {
      const result = rewritePath(
        { groups: ["old"], rule: compileRule(createRule({ rewrite: "new/$1" })) },
        "/old",
      );
      expect(result).toBe("/new/old");
    });

    it("should keep existing leading slash", () => {
      const result = rewritePath(
        { groups: ["old"], rule: compileRule(createRule({ rewrite: "/new/$1" })) },
        "/old",
      );
      expect(result).toBe("/new/old");
    });
  });
});

describe("ProxyRule", () => {
  describe("ws field", () => {
    it("should default ws to true when not specified", () => {
      const rule = compileRule(createRule({ pattern: "^/ws/(.*)$" }));
      expect(rule.ws).toBe(true);
    });

    it("should respect ws: false", () => {
      const rule = compileRule(createRule({ pattern: "^/api/(.*)$", ws: false }));
      expect(rule.ws).toBe(false);
    });

    it("should respect ws: true", () => {
      const rule = compileRule(createRule({ pattern: "^/ws/(.*)$", ws: true }));
      expect(rule.ws).toBe(true);
    });
  });
});

describe("HTTP proxy", () => {
  const TARGET = "http://backend:8080";

  // Helper to simulate HTTP proxy behavior
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
      return new Response(JSON.stringify({ error: `Proxy error: ${message}` }), {
        headers: { "Content-Type": "application/json" },
        status: 502,
      });
    }
  }

  describe("URL construction", () => {
    it("should construct correct target URL", async () => {
      const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("ok", { status: 200 }),
      );

      const request = new Request("http://localhost:8080/api/users?page=1");
      await httpProxy(request, compileRule(createRule({ target: TARGET })), "/v1/users");

      expect(fetchMock).toHaveBeenCalledWith(
        "http://backend:8080/v1/users?page=1",
        expect.any(Object),
      );
      fetchMock.mockRestore();
    });

    it("should preserve query string", async () => {
      const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("ok", { status: 200 }),
      );

      const request = new Request("http://localhost:8080/api?foo=bar&baz=qux");
      await httpProxy(request, compileRule(createRule({ target: TARGET })), "/v1/api");

      expect(fetchMock).toHaveBeenCalledWith(
        "http://backend:8080/v1/api?foo=bar&baz=qux",
        expect.any(Object),
      );
      fetchMock.mockRestore();
    });
  });

  describe("headers", () => {
    it("should remove hop-by-hop headers", async () => {
      const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("ok", { status: 200 }),
      );

      const request = new Request("http://localhost:8080/api", {
        headers: {
          connection: "keep-alive",
          "keep-alive": "timeout=5",
          "x-custom": "value",
        },
      });

      await httpProxy(request, compileRule(createRule({ target: TARGET })), "/api");

      const calledHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
      expect(calledHeaders.get("connection")).toBeNull();
      expect(calledHeaders.get("keep-alive")).toBeNull();
      expect(calledHeaders.get("x-custom")).toBe("value");
      fetchMock.mockRestore();
    });

    it("should apply changeOrigin headers", async () => {
      const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("ok", { status: 200 }),
      );

      const request = new Request("http://localhost:8080/api");
      await httpProxy(
        request,
        compileRule(createRule({ target: TARGET, changeOrigin: true })),
        "/api",
      );

      const calledHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
      expect(calledHeaders.get("host")).toBe("backend:8080");
      expect(calledHeaders.get("origin")).toBe("http://backend:8080");
      fetchMock.mockRestore();
    });

    it("should apply custom headers", async () => {
      const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("ok", { status: 200 }),
      );

      const request = new Request("http://localhost:8080/api");
      await httpProxy(
        request,
        compileRule(createRule({ target: TARGET, headers: { "X-Api-Key": "secret123" } })),
        "/api",
      );

      const calledHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
      expect(calledHeaders.get("X-Api-Key")).toBe("secret123");
      fetchMock.mockRestore();
    });
  });

  describe("response handling", () => {
    it("should return response from backend", async () => {
      const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ data: "test" }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      );

      const request = new Request("http://localhost:8080/api");
      const response = await httpProxy(
        request,
        compileRule(createRule({ target: TARGET })),
        "/api",
      );

      expect(response).not.toBeNull();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: "test" });
      fetchMock.mockRestore();
    });

    it("should return 502 on fetch error", async () => {
      const fetchMock = spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("Connection refused"),
      );

      const request = new Request("http://localhost:8080/api");
      const response = await httpProxy(
        request,
        compileRule(createRule({ target: TARGET })),
        "/api",
      );

      expect(response).not.toBeNull();
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({
        error: "Proxy error: Connection refused",
      });
      fetchMock.mockRestore();
    });
  });
});
