import { describe, expect, it, spyOn } from "bun:test";
import type { CompiledProxyRule } from "./pool/config";
import { proxy } from "./proxy";

const rule = (opts: Partial<CompiledProxyRule> = {}) => ({
  regex: new RegExp(opts.pattern ?? "."),
  pattern: opts.pattern ?? ".",
  target: opts.target ?? "http://localhost:3000",
  ...opts,
});

describe("proxy.matchRule", () => {
  describe("basic matching", () => {
    it("should return null when no rules provided", () => {
      const result = proxy.matchRule("/api/users", undefined);
      expect(result).toBeNull();
    });

    it("should return null when no rules match", () => {
      const result = proxy.matchRule("/other/path", [rule({ pattern: "^/api/(.*)$" })]);
      expect(result).toBeNull();
    });

    it("should match simple regex pattern", () => {
      const result = proxy.matchRule("/api/users", [rule({ pattern: "^/api/(.*)$" })]);

      expect(result).not.toBeNull();
      expect(result?.groups).toEqual(["users"]);
    });
  });

  describe("capture groups", () => {
    it("should capture single group", () => {
      const result = proxy.matchRule("/api/users/123", [rule({ pattern: "^/api/(.*)$" })]);
      expect(result?.groups).toEqual(["users/123"]);
    });

    it("should capture multiple groups", () => {
      const result = proxy.matchRule("/api/v2/users/123", [
        rule({ pattern: "^/api/v(\\d+)/(.*)$" }),
      ]);
      expect(result?.groups).toEqual(["2", "users/123"]);
    });

    it("should return empty array when no capture groups", () => {
      const result = proxy.matchRule("/health", [rule({ pattern: "^/health$" })]);
      expect(result?.groups).toEqual([]);
    });
  });

  describe("pattern priority", () => {
    it("should return first matching pattern", () => {
      const result = proxy.matchRule("/api/users/123", [
        rule({ pattern: "^/api/users/(.*)$", target: "http://users:3000" }),
        rule({ pattern: "^/api/(.*)$", target: "http://api:3000" }),
      ]);

      expect(result?.rule.target).toBe("http://users:3000");
    });
  });
});

describe("proxy.rewritePath", () => {
  describe("without rewrite", () => {
    it("should return original path when no rewrite provided", () => {
      const result = proxy.rewritePath({ groups: [], pathname: "/api/users", rule: rule() });
      expect(result).toBe("/api/users");
    });
  });

  describe("with capture groups", () => {
    it("should replace $1 with first capture group", () => {
      const result = proxy.rewritePath({
        groups: ["users"],
        pathname: "/api/users",
        rule: rule({ rewrite: "/v1/$1" }),
      });
      expect(result).toBe("/v1/users");
    });

    it("should replace multiple capture groups", () => {
      const result = proxy.rewritePath({
        groups: ["2", "users"],
        pathname: "/api/v2/users",
        rule: rule({ rewrite: "/version/$1/$2" }),
      });
      expect(result).toBe("/version/2/users");
    });

    it("should replace same group multiple times", () => {
      const result = proxy.rewritePath({
        groups: ["test"],
        pathname: "/api/users",
        rule: rule({ rewrite: "/$1/path/$1" }),
      });
      expect(result).toBe("/test/path/test");
    });

    it("should handle empty groups", () => {
      const result = proxy.rewritePath({
        groups: [""],
        pathname: "/api/",
        rule: rule({ rewrite: "/v1/$1" }),
      });
      expect(result).toBe("/v1/");
    });
  });

  describe("path normalization", () => {
    it("should add leading slash if missing", () => {
      const result = proxy.rewritePath({
        groups: ["old"],
        pathname: "/old",
        rule: rule({ rewrite: "new/$1" }),
      });
      expect(result).toBe("/new/old");
    });

    it("should keep existing leading slash", () => {
      const result = proxy.rewritePath({
        groups: ["old"],
        pathname: "/old",
        rule: rule({ rewrite: "/new/$1" }),
      });
      expect(result).toBe("/new/old");
    });
  });
});

describe("proxy.request", () => {
  const TARGET = "http://backend:3000";

  describe("URL construction", () => {
    it("should construct correct target URL", async () => {
      const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("ok", { status: 200 }),
      );

      const request = new Request("http://localhost:8080/api/users?page=1");
      await proxy.request(request, rule({ target: TARGET }), "/v1/users");

      expect(fetchMock).toHaveBeenCalledWith(
        "http://backend:3000/v1/users?page=1",
        expect.any(Object),
      );
      fetchMock.mockRestore();
    });

    it("should preserve query string", async () => {
      const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("ok", { status: 200 }),
      );

      const request = new Request("http://localhost:8080/api?foo=bar&baz=qux");
      await proxy.request(request, rule({ target: TARGET }), "/v1/api");

      expect(fetchMock).toHaveBeenCalledWith(
        "http://backend:3000/v1/api?foo=bar&baz=qux",
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

      await proxy.request(request, rule({ target: TARGET }), "/api");

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
      await proxy.request(request, rule({ target: TARGET, changeOrigin: true }), "/api");

      const calledHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
      expect(calledHeaders.get("host")).toBe("backend:3000");
      expect(calledHeaders.get("origin")).toBe("http://backend:3000");
      fetchMock.mockRestore();
    });

    it("should apply custom headers", async () => {
      const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("ok", { status: 200 }),
      );

      const request = new Request("http://localhost:8080/api");
      await proxy.request(
        request,
        rule({ target: TARGET, headers: { "X-Api-Key": "secret123" } }),
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
      const response = await proxy.request(request, rule({ target: TARGET }), "/api");

      expect(response).not.toBeNull();
      expect(response!.status).toBe(200);
      expect(await response!.json()).toEqual({ data: "test" });
      fetchMock.mockRestore();
    });

    it("should return 502 on fetch error", async () => {
      const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const fetchMock = spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("Connection refused"),
      );

      const request = new Request("http://localhost:8080/api");
      const response = await proxy.request(request, rule({ target: TARGET }), "/api");

      expect(response).not.toBeNull();
      expect(response!.status).toBe(502);
      expect(await response!.json()).toEqual({
        error: "Proxy error: Connection refused",
      });
      fetchMock.mockRestore();
      consoleSpy.mockRestore();
    });
  });
});
