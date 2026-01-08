import { describe, expect, it } from "bun:test";
import {
  addCorsHeaders,
  buildCorsHeaders,
  buildPreflightHeaders,
  type CorsConfig,
  handlePreflight,
} from "./cors";

function createRequest(options: {
  headers?: Record<string, string>;
  method?: string;
  url?: string;
}): Request {
  const headers = new Headers(options.headers);
  return new Request(options.url ?? "http://localhost:8000/api/test", {
    headers,
    method: options.method ?? "GET",
  });
}

describe("buildCorsHeaders", () => {
  describe("origin validation", () => {
    it("should return empty headers when no Origin header present", () => {
      const req = createRequest({});
      const config: CorsConfig = { origin: "*" };

      const headers = buildCorsHeaders(req, config);

      expect(headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    it("should return empty headers when origin not allowed", () => {
      const req = createRequest({
        headers: { Origin: "http://evil.com" },
      });
      const config: CorsConfig = { origin: "http://allowed.com" };

      const headers = buildCorsHeaders(req, config);

      expect(headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    it("should allow wildcard origin", () => {
      const req = createRequest({
        headers: { Origin: "http://any-site.com" },
      });
      const config: CorsConfig = { origin: "*" };

      const headers = buildCorsHeaders(req, config);

      expect(headers.get("Access-Control-Allow-Origin")).toBe("*");
    });

    it("should allow exact origin match", () => {
      const origin = "http://myapp.com";
      const req = createRequest({
        headers: { Origin: origin },
      });
      const config: CorsConfig = { origin };

      const headers = buildCorsHeaders(req, config);

      expect(headers.get("Access-Control-Allow-Origin")).toBe(origin);
    });

    it("should allow origin from array", () => {
      const origin = "http://app2.com";
      const req = createRequest({
        headers: { Origin: origin },
      });
      const config: CorsConfig = { origin: ["http://app1.com", "http://app2.com"] };

      const headers = buildCorsHeaders(req, config);

      expect(headers.get("Access-Control-Allow-Origin")).toBe(origin);
    });

    it("should reject origin not in array", () => {
      const req = createRequest({
        headers: { Origin: "http://app3.com" },
      });
      const config: CorsConfig = { origin: ["http://app1.com", "http://app2.com"] };

      const headers = buildCorsHeaders(req, config);

      expect(headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    it("should use function for dynamic origin check", () => {
      const req = createRequest({
        headers: { Origin: "http://subdomain.myapp.com" },
      });
      const config: CorsConfig = {
        origin: (origin) => origin.endsWith(".myapp.com"),
      };

      const headers = buildCorsHeaders(req, config);

      expect(headers.get("Access-Control-Allow-Origin")).toBe("http://subdomain.myapp.com");
    });

    it("should reject origin when function returns false", () => {
      const req = createRequest({
        headers: { Origin: "http://other.com" },
      });
      const config: CorsConfig = {
        origin: (origin) => origin.endsWith(".myapp.com"),
      };

      const headers = buildCorsHeaders(req, config);

      expect(headers.get("Access-Control-Allow-Origin")).toBeNull();
    });
  });

  describe("credentials", () => {
    it("should set Allow-Credentials header when enabled", () => {
      const req = createRequest({
        headers: { Origin: "http://app.com" },
      });
      const config: CorsConfig = { origin: "*", credentials: true };

      const headers = buildCorsHeaders(req, config);

      expect(headers.get("Access-Control-Allow-Credentials")).toBe("true");
    });

    it("should not set Allow-Credentials when disabled", () => {
      const req = createRequest({
        headers: { Origin: "http://app.com" },
      });
      const config: CorsConfig = { origin: "*", credentials: false };

      const headers = buildCorsHeaders(req, config);

      expect(headers.get("Access-Control-Allow-Credentials")).toBeNull();
    });

    it("should reflect origin instead of wildcard when credentials enabled", () => {
      const origin = "http://app.com";
      const req = createRequest({
        headers: { Origin: origin },
      });
      const config: CorsConfig = { origin: "*", credentials: true };

      const headers = buildCorsHeaders(req, config);

      // With credentials, should return actual origin, not "*"
      expect(headers.get("Access-Control-Allow-Origin")).toBe(origin);
    });
  });

  describe("exposed headers", () => {
    it("should set Expose-Headers when configured", () => {
      const req = createRequest({
        headers: { Origin: "http://app.com" },
      });
      const config: CorsConfig = {
        origin: "*",
        exposedHeaders: ["X-Custom-Header", "X-Request-Id"],
      };

      const headers = buildCorsHeaders(req, config);

      expect(headers.get("Access-Control-Expose-Headers")).toBe("X-Custom-Header, X-Request-Id");
    });

    it("should not set Expose-Headers when empty", () => {
      const req = createRequest({
        headers: { Origin: "http://app.com" },
      });
      const config: CorsConfig = { origin: "*", exposedHeaders: [] };

      const headers = buildCorsHeaders(req, config);

      expect(headers.get("Access-Control-Expose-Headers")).toBeNull();
    });
  });

  describe("Vary header", () => {
    it("should add Vary: Origin when not using wildcard", () => {
      const req = createRequest({
        headers: { Origin: "http://app.com" },
      });
      const config: CorsConfig = { origin: "http://app.com" };

      const headers = buildCorsHeaders(req, config);

      expect(headers.get("Vary")).toBe("Origin");
    });

    it("should not add Vary when using wildcard without credentials", () => {
      const req = createRequest({
        headers: { Origin: "http://app.com" },
      });
      const config: CorsConfig = { origin: "*" };

      const headers = buildCorsHeaders(req, config);

      expect(headers.get("Vary")).toBeNull();
    });
  });
});

describe("buildPreflightHeaders", () => {
  it("should include base CORS headers", () => {
    const req = createRequest({
      headers: { Origin: "http://app.com" },
      method: "OPTIONS",
    });
    const config: CorsConfig = { origin: "*" };

    const headers = buildPreflightHeaders(req, config);

    expect(headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  describe("allowed methods", () => {
    it("should use default methods when not configured", () => {
      const req = createRequest({
        headers: { Origin: "http://app.com" },
        method: "OPTIONS",
      });
      const config: CorsConfig = { origin: "*" };

      const headers = buildPreflightHeaders(req, config);

      expect(headers.get("Access-Control-Allow-Methods")).toBe(
        "GET, HEAD, PUT, PATCH, POST, DELETE",
      );
    });

    it("should use configured methods", () => {
      const req = createRequest({
        headers: { Origin: "http://app.com" },
        method: "OPTIONS",
      });
      const config: CorsConfig = {
        origin: "*",
        methods: ["GET", "POST"],
      };

      const headers = buildPreflightHeaders(req, config);

      expect(headers.get("Access-Control-Allow-Methods")).toBe("GET, POST");
    });
  });

  describe("allowed headers", () => {
    it("should use configured allowed headers", () => {
      const req = createRequest({
        headers: { Origin: "http://app.com" },
        method: "OPTIONS",
      });
      const config: CorsConfig = {
        origin: "*",
        allowedHeaders: ["Content-Type", "Authorization"],
      };

      const headers = buildPreflightHeaders(req, config);

      expect(headers.get("Access-Control-Allow-Headers")).toBe("Content-Type, Authorization");
    });

    it("should reflect requested headers when not configured", () => {
      const req = createRequest({
        headers: {
          Origin: "http://app.com",
          "Access-Control-Request-Headers": "X-Custom, X-Other",
        },
        method: "OPTIONS",
      });
      const config: CorsConfig = { origin: "*" };

      const headers = buildPreflightHeaders(req, config);

      expect(headers.get("Access-Control-Allow-Headers")).toBe("X-Custom, X-Other");
    });

    it("should add Vary for reflected headers", () => {
      const req = createRequest({
        headers: {
          Origin: "http://app.com",
          "Access-Control-Request-Headers": "X-Custom",
        },
        method: "OPTIONS",
      });
      const config: CorsConfig = { origin: "*" };

      const headers = buildPreflightHeaders(req, config);

      expect(headers.get("Vary")).toContain("Access-Control-Request-Headers");
    });
  });

  describe("max age", () => {
    it("should use default max age (86400)", () => {
      const req = createRequest({
        headers: { Origin: "http://app.com" },
        method: "OPTIONS",
      });
      const config: CorsConfig = { origin: "*" };

      const headers = buildPreflightHeaders(req, config);

      expect(headers.get("Access-Control-Max-Age")).toBe("86400");
    });

    it("should use configured max age", () => {
      const req = createRequest({
        headers: { Origin: "http://app.com" },
        method: "OPTIONS",
      });
      const config: CorsConfig = { origin: "*", maxAge: 3600 };

      const headers = buildPreflightHeaders(req, config);

      expect(headers.get("Access-Control-Max-Age")).toBe("3600");
    });
  });
});

describe("handlePreflight", () => {
  it("should return null for non-OPTIONS requests", () => {
    const req = createRequest({
      headers: { Origin: "http://app.com" },
      method: "GET",
    });
    const config: CorsConfig = { origin: "*" };

    const response = handlePreflight(req, config);

    expect(response).toBeNull();
  });

  it("should return null for OPTIONS without Access-Control-Request-Method", () => {
    const req = createRequest({
      headers: { Origin: "http://app.com" },
      method: "OPTIONS",
    });
    const config: CorsConfig = { origin: "*" };

    const response = handlePreflight(req, config);

    expect(response).toBeNull();
  });

  it("should return 204 response for valid preflight", () => {
    const req = createRequest({
      headers: {
        Origin: "http://app.com",
        "Access-Control-Request-Method": "POST",
      },
      method: "OPTIONS",
    });
    const config: CorsConfig = { origin: "*" };

    const response = handlePreflight(req, config);

    expect(response).not.toBeNull();
    expect(response!.status).toBe(204);
  });

  it("should include preflight headers in response", () => {
    const req = createRequest({
      headers: {
        Origin: "http://app.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type",
      },
      method: "OPTIONS",
    });
    const config: CorsConfig = {
      origin: "*",
      methods: ["GET", "POST"],
    };

    const response = handlePreflight(req, config);

    expect(response!.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response!.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST");
    expect(response!.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type");
  });
});

describe("addCorsHeaders", () => {
  it("should add CORS headers to response", () => {
    const req = createRequest({
      headers: { Origin: "http://app.com" },
    });
    const res = new Response(JSON.stringify({ data: "test" }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
    const config: CorsConfig = { origin: "*" };

    const newRes = addCorsHeaders(req, res, config);

    expect(newRes.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(newRes.headers.get("Content-Type")).toBe("application/json");
    expect(newRes.status).toBe(200);
  });

  it("should return original response when no CORS headers needed", () => {
    const req = createRequest({}); // No Origin header
    const res = new Response("test");
    const config: CorsConfig = { origin: "*" };

    const newRes = addCorsHeaders(req, res, config);

    expect(newRes.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("should preserve original response body", async () => {
    const req = createRequest({
      headers: { Origin: "http://app.com" },
    });
    const originalBody = { message: "hello" };
    const res = new Response(JSON.stringify(originalBody), {
      headers: { "Content-Type": "application/json" },
    });
    const config: CorsConfig = { origin: "*" };

    const newRes = addCorsHeaders(req, res, config);
    const body = await newRes.json();

    expect(body).toEqual(originalBody);
  });

  it("should preserve original response status", () => {
    const req = createRequest({
      headers: { Origin: "http://app.com" },
    });
    const res = new Response("Created", { status: 201, statusText: "Created" });
    const config: CorsConfig = { origin: "*" };

    const newRes = addCorsHeaders(req, res, config);

    expect(newRes.status).toBe(201);
    expect(newRes.statusText).toBe("Created");
  });

  it("should add exposed headers", () => {
    const req = createRequest({
      headers: { Origin: "http://app.com" },
    });
    const res = new Response("test", {
      headers: { "X-Request-Id": "123" },
    });
    const config: CorsConfig = {
      origin: "*",
      exposedHeaders: ["X-Request-Id"],
    };

    const newRes = addCorsHeaders(req, res, config);

    expect(newRes.headers.get("Access-Control-Expose-Headers")).toBe("X-Request-Id");
  });
});
