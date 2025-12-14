import { describe, expect, it, spyOn } from "bun:test";
import type { ProxyRule } from "./services";
import { compileRule, httpProxy, matchRule, rewritePath } from "./services";

const createRule = (opts: Partial<ProxyRule> = {}): ProxyRule => ({
  pattern: opts.pattern ?? ".",
  target: opts.target ?? "http://localhost:8080",
  ...opts,
});

describe("matchRule", () => {
  describe("basic matching", () => {
    it("should return null when no rules provided", () => {
      const result = matchRule("/api/users");
      expect(result).toBeNull();
    });

    it("should return null when no rules match", () => {
      // Since matchRule uses internal state, we need to test it differently
      // This test will pass because getAllRules() returns empty array initially
      const result = matchRule("/other/path");
      expect(result).toBeNull();
    });
  });

  describe("capture groups", () => {
    it("should capture single group", () => {
      const rule = compileRule(createRule({ pattern: "^/api/(.*)$" }), false);
      expect(rule).not.toBeNull();
      if (rule) {
        const match = "/api/users/123".match(rule.regex);
        expect(match?.slice(1)).toEqual(["users/123"]);
      }
    });

    it("should capture multiple groups", () => {
      const rule = compileRule(createRule({ pattern: "^/api/v(\\d+)/(.*)$" }), false);
      expect(rule).not.toBeNull();
      if (rule) {
        const match = "/api/v2/users/123".match(rule.regex);
        expect(match?.slice(1)).toEqual(["2", "users/123"]);
      }
    });

    it("should return empty array when no capture groups", () => {
      const rule = compileRule(createRule({ pattern: "^/health$" }), false);
      expect(rule).not.toBeNull();
      if (rule) {
        const match = "/health".match(rule.regex);
        expect(match?.slice(1)).toEqual([]);
      }
    });
  });
});

describe("rewritePath", () => {
  describe("without rewrite", () => {
    it("should return original path when no rewrite provided", () => {
      const rule = compileRule(createRule(), false);
      expect(rule).not.toBeNull();
      if (rule) {
        const result = rewritePath({ groups: [], rule }, "/api/users");
        expect(result).toBe("/api/users");
      }
    });
  });

  describe("with capture groups", () => {
    it("should replace $1 with first capture group", () => {
      const rule = compileRule(createRule({ rewrite: "/v1/$1" }), false);
      expect(rule).not.toBeNull();
      if (rule) {
        const result = rewritePath({ groups: ["users"], rule }, "/api/users");
        expect(result).toBe("/v1/users");
      }
    });

    it("should replace multiple capture groups", () => {
      const rule = compileRule(createRule({ rewrite: "/version/$1/$2" }), false);
      expect(rule).not.toBeNull();
      if (rule) {
        const result = rewritePath({ groups: ["2", "users"], rule }, "/api/v2/users");
        expect(result).toBe("/version/2/users");
      }
    });

    it("should replace same group multiple times", () => {
      const rule = compileRule(createRule({ rewrite: "/$1/path/$1" }), false);
      expect(rule).not.toBeNull();
      if (rule) {
        const result = rewritePath({ groups: ["test"], rule }, "/api/users");
        expect(result).toBe("/test/path/test");
      }
    });

    it("should handle empty groups", () => {
      const rule = compileRule(createRule({ rewrite: "/v1/$1" }), false);
      expect(rule).not.toBeNull();
      if (rule) {
        const result = rewritePath({ groups: [""], rule }, "/api/");
        expect(result).toBe("/v1/");
      }
    });
  });

  describe("path normalization", () => {
    it("should add leading slash if missing", () => {
      const rule = compileRule(createRule({ rewrite: "new/$1" }), false);
      expect(rule).not.toBeNull();
      if (rule) {
        const result = rewritePath({ groups: ["old"], rule }, "/old");
        expect(result).toBe("/new/old");
      }
    });

    it("should keep existing leading slash", () => {
      const rule = compileRule(createRule({ rewrite: "/new/$1" }), false);
      expect(rule).not.toBeNull();
      if (rule) {
        const result = rewritePath({ groups: ["old"], rule }, "/old");
        expect(result).toBe("/new/old");
      }
    });
  });
});

describe("ProxyRule", () => {
  describe("ws field", () => {
    it("should default ws to true when not specified", () => {
      const rule = compileRule(createRule({ pattern: "^/ws/(.*)$" }), false);
      expect(rule).not.toBeNull();
      if (rule) {
        expect(rule.ws).toBe(true);
      }
    });

    it("should respect ws: false", () => {
      const rule = compileRule(createRule({ pattern: "^/api/(.*)$", ws: false }), false);
      expect(rule).not.toBeNull();
      if (rule) {
        expect(rule.ws).toBe(false);
      }
    });

    it("should respect ws: true", () => {
      const rule = compileRule(createRule({ pattern: "^/ws/(.*)$", ws: true }), false);
      expect(rule).not.toBeNull();
      if (rule) {
        expect(rule.ws).toBe(true);
      }
    });
  });
});

describe("HTTP proxy", () => {
  const TARGET = "http://backend:8080";

  describe("URL construction", () => {
    it("should construct correct target URL", async () => {
      const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("ok", { status: 200 }),
      );

      const request = new Request("http://localhost:8080/api/users?page=1");
      const rule = compileRule(createRule({ target: TARGET }), false);
      expect(rule).not.toBeNull();
      if (rule) {
        await httpProxy(request, rule, "/v1/users");

        expect(fetchMock).toHaveBeenCalledWith(
          "http://backend:8080/v1/users?page=1",
          expect.any(Object),
        );
      }
      fetchMock.mockRestore();
    });

    it("should preserve query string", async () => {
      const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("ok", { status: 200 }),
      );

      const request = new Request("http://localhost:8080/api?foo=bar&baz=qux");
      const rule = compileRule(createRule({ target: TARGET }), false);
      expect(rule).not.toBeNull();
      if (rule) {
        await httpProxy(request, rule, "/v1/api");

        expect(fetchMock).toHaveBeenCalledWith(
          "http://backend:8080/v1/api?foo=bar&baz=qux",
          expect.any(Object),
        );
      }
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

      const rule = compileRule(createRule({ target: TARGET }), false);
      expect(rule).not.toBeNull();
      if (rule) {
        await httpProxy(request, rule, "/api");

        const calledHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
        expect(calledHeaders.get("connection")).toBeNull();
        expect(calledHeaders.get("keep-alive")).toBeNull();
        expect(calledHeaders.get("x-custom")).toBe("value");
      }
      fetchMock.mockRestore();
    });

    it("should apply changeOrigin headers", async () => {
      const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("ok", { status: 200 }),
      );

      const request = new Request("http://localhost:8080/api");
      const rule = compileRule(createRule({ target: TARGET, changeOrigin: true }), false);
      expect(rule).not.toBeNull();
      if (rule) {
        await httpProxy(request, rule, "/api");

        const calledHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
        expect(calledHeaders.get("host")).toBe("backend:8080");
        expect(calledHeaders.get("origin")).toBe("http://backend:8080");
      }
      fetchMock.mockRestore();
    });

    it("should apply custom headers", async () => {
      const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("ok", { status: 200 }),
      );

      const request = new Request("http://localhost:8080/api");
      const rule = compileRule(
        createRule({ target: TARGET, headers: { "X-Api-Key": "secret123" } }),
        false,
      );
      expect(rule).not.toBeNull();
      if (rule) {
        await httpProxy(request, rule, "/api");

        const calledHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
        expect(calledHeaders.get("X-Api-Key")).toBe("secret123");
      }
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
      const rule = compileRule(createRule({ target: TARGET }), false);
      expect(rule).not.toBeNull();
      if (rule) {
        const response = await httpProxy(request, rule, "/api");

        expect(response).not.toBeNull();
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ data: "test" });
      }
      fetchMock.mockRestore();
    });

    it("should return 502 on fetch error", async () => {
      const fetchMock = spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("Connection refused"),
      );

      const request = new Request("http://localhost:8080/api");
      const rule = compileRule(createRule({ target: TARGET }), false);
      expect(rule).not.toBeNull();
      if (rule) {
        const response = await httpProxy(request, rule, "/api");

        expect(response).not.toBeNull();
        expect(response.status).toBe(502);
        expect(await response.json()).toEqual({
          error: "Proxy error: Connection refused",
        });
      }
      fetchMock.mockRestore();
    });
  });
});
