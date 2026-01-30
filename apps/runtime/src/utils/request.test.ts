import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as configModule from "@/config";
import { Headers } from "@/constants";
import { BodyTooLargeError, cloneRequestBody, createWorkerRequest, rewriteUrl } from "./request";

describe("request utils", () => {
  describe("BodyTooLargeError", () => {
    it("should create error with correct message", () => {
      const error = new BodyTooLargeError(1000, 500);
      expect(error.message).toBe("Request body too large: 1000 bytes (max: 500)");
      expect(error.name).toBe("BodyTooLargeError");
    });
  });

  describe("cloneRequestBody", () => {
    beforeEach(() => {
      spyOn(configModule, "getConfig").mockReturnValue({
        bodySize: { default: 1024, max: 10240 },
        delayMs: 100,
        isCompiled: false,
        isDev: true,
        nodeEnv: "test",
        pluginDirs: ["./plugins"],
        poolSize: 10,
        port: 8000,
        version: "1.0.0",
        workerDirs: ["/tmp"],
      });
    });

    it("should return null for request without body", async () => {
      const req = new Request("http://localhost/test");
      const body = await cloneRequestBody(req);
      expect(body).toBeNull();
    });

    it("should clone request body successfully", async () => {
      const req = new Request("http://localhost/test", {
        body: "hello world",
        method: "POST",
      });
      const body = await cloneRequestBody(req);
      expect(body).toBeInstanceOf(ArrayBuffer);
      expect(new TextDecoder().decode(body!)).toBe("hello world");
    });

    it("should throw BodyTooLargeError when Content-Length exceeds limit", async () => {
      const req = new Request("http://localhost/test", {
        body: "x".repeat(100),
        headers: { "content-length": "2000" },
        method: "POST",
      });
      await expect(cloneRequestBody(req, 1000)).rejects.toThrow(BodyTooLargeError);
    });

    it("should throw for invalid Content-Length (NaN)", async () => {
      const req = new Request("http://localhost/test", {
        body: "hello",
        headers: { "content-length": "invalid" },
        method: "POST",
      });
      await expect(cloneRequestBody(req, 1000)).rejects.toThrow(BodyTooLargeError);
    });

    it("should throw for negative Content-Length", async () => {
      const req = new Request("http://localhost/test", {
        body: "hello",
        headers: { "content-length": "-100" },
        method: "POST",
      });
      await expect(cloneRequestBody(req, 1000)).rejects.toThrow(BodyTooLargeError);
    });

    it("should throw when actual body exceeds limit", async () => {
      const req = new Request("http://localhost/test", {
        body: "x".repeat(2000),
        method: "POST",
      });
      await expect(cloneRequestBody(req, 1000)).rejects.toThrow(BodyTooLargeError);
    });

    it("should use default limit from config when not specified", async () => {
      const req = new Request("http://localhost/test", {
        body: "x".repeat(500),
        method: "POST",
      });
      const body = await cloneRequestBody(req);
      expect(body).toBeInstanceOf(ArrayBuffer);
    });

    it("should use custom limit when specified", async () => {
      const req = new Request("http://localhost/test", {
        body: "hello",
        method: "POST",
      });
      const body = await cloneRequestBody(req, 10);
      expect(body).toBeInstanceOf(ArrayBuffer);
    });
  });

  describe("rewriteUrl", () => {
    it("should strip base path and preserve query string", () => {
      const url = new URL("http://localhost/api/users?page=1");
      const result = rewriteUrl(url, "/api");
      expect(result.pathname).toBe("/users");
      expect(result.search).toBe("?page=1");
    });

    it("should return root path when pathname equals base path", () => {
      const url = new URL("http://localhost/api");
      const result = rewriteUrl(url, "/api");
      expect(result.pathname).toBe("/");
    });

    it("should handle nested paths", () => {
      const url = new URL("http://localhost/api/v1/users/123");
      const result = rewriteUrl(url, "/api/v1");
      expect(result.pathname).toBe("/users/123");
    });

    it("should preserve origin", () => {
      const url = new URL("https://example.com:3000/api/test");
      const result = rewriteUrl(url, "/api");
      expect(result.origin).toBe("https://example.com:3000");
    });

    it("should handle empty base path", () => {
      const url = new URL("http://localhost/users/123?id=1");
      const result = rewriteUrl(url, "");
      expect(result.pathname).toBe("/users/123");
      expect(result.search).toBe("?id=1");
    });

    it("should handle multiple query parameters", () => {
      const url = new URL("http://localhost/api/items?page=1&limit=10&sort=name");
      const result = rewriteUrl(url, "/api");
      expect(result.search).toBe("?page=1&limit=10&sort=name");
    });
  });

  describe("createWorkerRequest", () => {
    it("should create request with base header", () => {
      const original = new Request("http://localhost/my-app/page?q=test");
      const req = createWorkerRequest({
        base: "/my-app",
        originalRequest: original,
        targetPath: "/page",
      });

      expect(req.headers.get(Headers.BASE)).toBe("/my-app");
      expect(req.url).toBe("http://localhost/page?q=test");
    });

    it("should set not found header when true", () => {
      const original = new Request("http://localhost/app/unknown");
      const req = createWorkerRequest({
        base: "/app",
        notFound: true,
        originalRequest: original,
        targetPath: "/404",
      });

      expect(req.headers.get(Headers.NOT_FOUND)).toBe("true");
    });

    it("should not set optional headers when not provided", () => {
      const original = new Request("http://localhost/app/page");
      const req = createWorkerRequest({
        base: "/app",
        originalRequest: original,
        targetPath: "/page",
      });

      expect(req.headers.get(Headers.NOT_FOUND)).toBeNull();
    });

    it("should preserve original request method", () => {
      const original = new Request("http://localhost/api/items", {
        method: "POST",
      });
      const req = createWorkerRequest({
        base: "/api",
        originalRequest: original,
        targetPath: "/items",
      });

      expect(req.method).toBe("POST");
    });

    it("should preserve query string from original request", () => {
      const original = new Request("http://localhost/app/search?q=test&page=2");
      const req = createWorkerRequest({
        base: "/app",
        originalRequest: original,
        targetPath: "/search",
      });

      expect(req.url).toContain("?q=test&page=2");
    });
  });
});
