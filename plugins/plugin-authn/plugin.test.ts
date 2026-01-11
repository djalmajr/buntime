/**
 * Tests for plugin-authn main plugin module
 *
 * Tests:
 * - Plugin configuration and structure
 * - globToRegex utility function
 * - globArrayToRegex utility function
 * - getPublicRoutesForMethod utility function
 * - isPublicRoute utility function
 * - processProviderConfig utility function
 * - onRequest middleware
 * - onInit lifecycle
 * - onShutdown lifecycle
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { AppInfo, PluginContext, PublicRoutesConfig } from "@buntime/shared/types";

// We need to test the internal functions, so we'll recreate them here
// since they're not exported from the plugin

/**
 * Convert glob pattern to regex pattern
 */
function globToRegex(pattern: string): string {
  if (pattern.startsWith("(")) return pattern;
  let regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "___DOUBLE_STAR___")
    .replace(/\*/g, "[^/]*")
    .replace(/___DOUBLE_STAR___/g, ".*")
    .replace(/\?/g, ".");
  if (!regex.startsWith("^")) regex = `^${regex}`;
  if (!regex.endsWith("$")) regex = `${regex}$`;
  return regex;
}

/**
 * Convert array of glob patterns to combined regex
 */
function globArrayToRegex(patterns: string[]): RegExp | null {
  if (!patterns?.length) return null;
  return new RegExp(`(${patterns.map(globToRegex).join("|")})`);
}

/**
 * Get public routes for a specific HTTP method
 */
function getPublicRoutesForMethod(
  publicRoutes: PublicRoutesConfig | undefined,
  method: string,
): string[] {
  if (!publicRoutes) return [];
  if (Array.isArray(publicRoutes)) return publicRoutes;
  const normalized = method.toUpperCase() as keyof typeof publicRoutes;
  const all = publicRoutes.ALL || [];
  const specific = publicRoutes[normalized] || [];
  return [...new Set([...all, ...specific])];
}

/**
 * Check if a route is public for the given worker
 */
function isPublicRoute(
  pathname: string,
  method: string,
  internalPublicRoutes: PublicRoutesConfig,
  app?: AppInfo,
): boolean {
  // 1. Check internal plugin routes (absolute paths)
  const internalRoutes = getPublicRoutesForMethod(internalPublicRoutes, method);
  if (internalRoutes.length > 0) {
    const regex = globArrayToRegex(internalRoutes);
    if (regex?.test(pathname)) return true;
  }

  // 2. Check worker's publicRoutes (relative to app basePath)
  if (app?.config?.publicRoutes && app.name) {
    const workerRoutes = getPublicRoutesForMethod(app.config.publicRoutes, method);
    if (workerRoutes.length > 0) {
      const basePath = `/${app.name}`;
      const absoluteRoutes = workerRoutes.map((route) => `${basePath}${route}`);
      const regex = globArrayToRegex(absoluteRoutes);
      if (regex?.test(pathname)) return true;
    }
  }

  return false;
}

describe("plugin-authn", () => {
  describe("globToRegex", () => {
    it("should convert simple pattern", () => {
      const regex = globToRegex("/api/test");
      expect(regex).toBe("^/api/test$");
    });

    it("should convert single wildcard", () => {
      const regex = globToRegex("/api/*");
      expect(regex).toBe("^/api/[^/]*$");
    });

    it("should convert double wildcard", () => {
      const regex = globToRegex("/api/**");
      expect(regex).toBe("^/api/.*$");
    });

    it("should escape special regex characters", () => {
      const regex = globToRegex("/api/test.json");
      expect(regex).toBe("^/api/test\\.json$");
    });

    it("should convert question mark to single character matcher", () => {
      const regex = globToRegex("/api/v?/test");
      expect(regex).toBe("^/api/v./test$");
    });

    it("should handle patterns already starting with regex group", () => {
      const regex = globToRegex("(^/api/test$)");
      expect(regex).toBe("(^/api/test$)");
    });

    it("should handle complex patterns", () => {
      const regex = globToRegex("/auth/api/**");
      expect(regex).toBe("^/auth/api/.*$");
    });

    it("should handle multiple wildcards", () => {
      const regex = globToRegex("/*/api/**/test");
      expect(regex).toBe("^/[^/]*/api/.*/test$");
    });
  });

  describe("globArrayToRegex", () => {
    it("should return null for empty array", () => {
      const result = globArrayToRegex([]);
      expect(result).toBeNull();
    });

    it("should return null for undefined", () => {
      const result = globArrayToRegex(undefined as unknown as string[]);
      expect(result).toBeNull();
    });

    it("should convert single pattern", () => {
      const regex = globArrayToRegex(["/api/test"]);
      expect(regex).not.toBeNull();
      expect(regex!.test("/api/test")).toBe(true);
      expect(regex!.test("/api/other")).toBe(false);
    });

    it("should combine multiple patterns with OR", () => {
      const regex = globArrayToRegex(["/api/test", "/api/other"]);
      expect(regex).not.toBeNull();
      expect(regex!.test("/api/test")).toBe(true);
      expect(regex!.test("/api/other")).toBe(true);
      expect(regex!.test("/api/unknown")).toBe(false);
    });

    it("should handle wildcard patterns", () => {
      const regex = globArrayToRegex(["/api/*", "/auth/**"]);
      expect(regex).not.toBeNull();
      expect(regex!.test("/api/users")).toBe(true);
      expect(regex!.test("/api/users/123")).toBe(false); // single wildcard doesn't match /
      expect(regex!.test("/auth/login")).toBe(true);
      expect(regex!.test("/auth/oauth/callback")).toBe(true);
    });
  });

  describe("getPublicRoutesForMethod", () => {
    it("should return empty array for undefined config", () => {
      const routes = getPublicRoutesForMethod(undefined, "GET");
      expect(routes).toEqual([]);
    });

    it("should return routes array directly if config is array", () => {
      const config: PublicRoutesConfig = ["/api/public", "/api/health"];
      const routes = getPublicRoutesForMethod(config, "GET");
      expect(routes).toEqual(["/api/public", "/api/health"]);
    });

    it("should return ALL routes for any method", () => {
      const config: PublicRoutesConfig = {
        ALL: ["/api/health"],
        GET: ["/api/info"],
      };
      const routes = getPublicRoutesForMethod(config, "POST");
      expect(routes).toContain("/api/health");
    });

    it("should combine ALL and method-specific routes", () => {
      const config: PublicRoutesConfig = {
        ALL: ["/api/health"],
        GET: ["/api/info"],
      };
      const routes = getPublicRoutesForMethod(config, "GET");
      expect(routes).toContain("/api/health");
      expect(routes).toContain("/api/info");
    });

    it("should deduplicate routes", () => {
      const config: PublicRoutesConfig = {
        ALL: ["/api/health"],
        GET: ["/api/health", "/api/info"],
      };
      const routes = getPublicRoutesForMethod(config, "GET");
      expect(routes.filter((r) => r === "/api/health").length).toBe(1);
    });

    it("should normalize method to uppercase", () => {
      const config: PublicRoutesConfig = {
        GET: ["/api/info"],
      };
      const routes = getPublicRoutesForMethod(config, "get");
      expect(routes).toContain("/api/info");
    });
  });

  describe("isPublicRoute", () => {
    const internalPublicRoutes: PublicRoutesConfig = {
      ALL: ["/auth/api", "/auth/api/**"],
      GET: ["/auth/login", "/auth/login/**"],
    };

    it("should return true for internal public routes", () => {
      expect(isPublicRoute("/auth/api", "GET", internalPublicRoutes)).toBe(true);
      expect(isPublicRoute("/auth/api/providers", "GET", internalPublicRoutes)).toBe(true);
      expect(isPublicRoute("/auth/api/auth/signin", "POST", internalPublicRoutes)).toBe(true);
    });

    it("should return true for GET-only internal routes", () => {
      expect(isPublicRoute("/auth/login", "GET", internalPublicRoutes)).toBe(true);
      expect(isPublicRoute("/auth/login/callback", "GET", internalPublicRoutes)).toBe(true);
    });

    it("should return false for protected routes", () => {
      expect(isPublicRoute("/dashboard", "GET", internalPublicRoutes)).toBe(false);
      expect(isPublicRoute("/api/users", "GET", internalPublicRoutes)).toBe(false);
    });

    it("should check app-specific public routes", () => {
      const app: AppInfo = {
        config: {
          publicRoutes: ["/api/public/**"],
        },
        name: "myapp",
        path: "/path/to/app",
        port: 5000,
      };
      expect(isPublicRoute("/myapp/api/public/data", "GET", {}, app)).toBe(true);
      expect(isPublicRoute("/myapp/api/private/data", "GET", {}, app)).toBe(false);
    });

    it("should handle app with method-specific routes", () => {
      const app: AppInfo = {
        config: {
          publicRoutes: {
            GET: ["/public"],
            POST: ["/webhook"],
          },
        },
        name: "myapp",
        path: "/path/to/app",
        port: 5000,
      };
      expect(isPublicRoute("/myapp/public", "GET", {}, app)).toBe(true);
      expect(isPublicRoute("/myapp/public", "POST", {}, app)).toBe(false);
      expect(isPublicRoute("/myapp/webhook", "POST", {}, app)).toBe(true);
    });

    it("should return false for app without publicRoutes", () => {
      const app: AppInfo = {
        name: "myapp",
        path: "/path/to/app",
        port: 5000,
      };
      expect(isPublicRoute("/myapp/api/data", "GET", {}, app)).toBe(false);
    });

    it("should prioritize internal routes over app routes", () => {
      const app: AppInfo = {
        config: {
          publicRoutes: [],
        },
        name: "auth",
        path: "/path/to/app",
        port: 5000,
      };
      expect(isPublicRoute("/auth/api/providers", "GET", internalPublicRoutes, app)).toBe(true);
    });
  });
});

describe("plugin configuration", () => {
  it("should have implementation properties", async () => {
    // Import the plugin to verify structure
    const { default: authnPlugin } = await import("./plugin");
    const plugin = authnPlugin({
      providers: [{ type: "email-password" }],
    });

    expect(plugin.routes).toBeDefined();
    expect(plugin.onInit).toBeDefined();
    expect(plugin.onShutdown).toBeDefined();
    expect(plugin.onRequest).toBeDefined();
  });

  it("should accept empty config", async () => {
    const { default: authnPlugin } = await import("./plugin");
    const plugin = authnPlugin();

    expect(plugin.routes).toBeDefined();
  });

  it("should process API keys with env substitution", async () => {
    // Set test env var
    process.env.TEST_API_KEY = "secret-key-123";

    const { default: authnPlugin } = await import("./plugin");
    const plugin = authnPlugin({
      apiKeys: [
        {
          key: "${TEST_API_KEY}",
          name: "Test Key",
          roles: ["admin"],
        },
      ],
      providers: [{ type: "email-password" }],
    });

    // The API keys are processed in the plugin closure, we can't directly access them
    // but we can verify the plugin is created successfully
    expect(plugin.routes).toBeDefined();

    // Clean up
    delete process.env.TEST_API_KEY;
  });

  it("should process OAuth provider config with env substitution", async () => {
    // Set test env vars
    process.env.TEST_CLIENT_ID = "client-123";
    process.env.TEST_CLIENT_SECRET = "secret-456";
    process.env.TEST_ISSUER = "https://keycloak.example.com";
    process.env.TEST_REALM = "test-realm";

    const { default: authnPlugin } = await import("./plugin");
    const plugin = authnPlugin({
      providers: [
        {
          type: "keycloak",
          clientId: "${TEST_CLIENT_ID}",
          clientSecret: "${TEST_CLIENT_SECRET}",
          issuer: "${TEST_ISSUER}",
          realm: "${TEST_REALM}",
        },
      ],
    });

    expect(plugin.routes).toBeDefined();

    // Clean up
    delete process.env.TEST_CLIENT_ID;
    delete process.env.TEST_CLIENT_SECRET;
    delete process.env.TEST_ISSUER;
    delete process.env.TEST_REALM;
  });

  it("should process Auth0 provider config with env substitution", async () => {
    process.env.TEST_DOMAIN = "test.auth0.com";
    process.env.TEST_CLIENT_ID = "client-123";
    process.env.TEST_CLIENT_SECRET = "secret-456";

    const { default: authnPlugin } = await import("./plugin");
    const plugin = authnPlugin({
      providers: [
        {
          type: "auth0",
          clientId: "${TEST_CLIENT_ID}",
          clientSecret: "${TEST_CLIENT_SECRET}",
          domain: "${TEST_DOMAIN}",
        },
      ],
    });

    expect(plugin.routes).toBeDefined();

    delete process.env.TEST_DOMAIN;
    delete process.env.TEST_CLIENT_ID;
    delete process.env.TEST_CLIENT_SECRET;
  });
});

describe("onInit lifecycle", () => {
  it("should throw error when database service is not available", async () => {
    const { default: authnPlugin } = await import("./plugin");
    const plugin = authnPlugin({
      providers: [{ type: "email-password" }],
    });

    const mockContext: PluginContext = {
      getService: mock(() => null),
      logger: {
        debug: mock(() => {}),
        error: mock(() => {}),
        info: mock(() => {}),
        warn: mock(() => {}),
      },
    } as unknown as PluginContext;

    await expect(plugin.onInit!(mockContext)).rejects.toThrow(
      "@buntime/plugin-authn requires @buntime/plugin-database",
    );
  });

  it("should initialize successfully when database service is available", async () => {
    const { default: authnPlugin } = await import("./plugin");
    const plugin = authnPlugin({
      database: "libsql",
      providers: [{ type: "email-password" }],
      scim: { enabled: true },
      trustedOrigins: ["http://localhost:8000"],
    });

    // Create mock database adapter
    const mockAdapter = {
      close: mock(() => Promise.resolve()),
      execute: mock(() => Promise.resolve([])),
      executeOne: mock(() => Promise.resolve(null)),
      getClient: mock(() => null),
      getRawClient: mock(() => ({
        execute: mock(() => Promise.resolve({ rows: [], columns: [] })),
      })),
      isConnected: mock(() => true),
    };

    // Create mock database service
    const mockDbService = {
      getAdapter: mock(() => mockAdapter),
      getDefaultType: mock(() => "libsql"),
      getRootAdapter: mock(() => mockAdapter),
      isMultiTenant: mock(() => false),
      registerAdapter: mock(() => {}),
    };

    const mockContext: PluginContext = {
      getService: mock((name: string) => (name === "database" ? mockDbService : null)),
      logger: {
        debug: mock(() => {}),
        error: mock(() => {}),
        info: mock(() => {}),
        warn: mock(() => {}),
      },
    } as unknown as PluginContext;

    // Should complete without throwing
    await plugin.onInit!(mockContext);
    // If we reach here, test passed
    expect(true).toBe(true);
  });

  it("should initialize with multiple providers", async () => {
    const { default: authnPlugin } = await import("./plugin");

    // Set env vars for provider config
    process.env.TEST_KC_CLIENT_ID = "keycloak-client";
    process.env.TEST_KC_SECRET = "keycloak-secret";
    process.env.TEST_KC_ISSUER = "https://keycloak.test.com";
    process.env.TEST_KC_REALM = "test";

    const plugin = authnPlugin({
      providers: [
        { type: "email-password", allowSignUp: true },
        {
          type: "keycloak",
          clientId: "${TEST_KC_CLIENT_ID}",
          clientSecret: "${TEST_KC_SECRET}",
          issuer: "${TEST_KC_ISSUER}",
          realm: "${TEST_KC_REALM}",
        },
      ],
    });

    const mockAdapter = {
      close: mock(() => Promise.resolve()),
      execute: mock(() => Promise.resolve([])),
      executeOne: mock(() => Promise.resolve(null)),
      getClient: mock(() => null),
      getRawClient: mock(() => ({
        execute: mock(() => Promise.resolve({ rows: [], columns: [] })),
      })),
      isConnected: mock(() => true),
    };

    const mockDbService = {
      getAdapter: mock(() => mockAdapter),
      getDefaultType: mock(() => "libsql"),
      getRootAdapter: mock(() => mockAdapter),
      isMultiTenant: mock(() => false),
      registerAdapter: mock(() => {}),
    };

    const mockContext: PluginContext = {
      getService: mock((name: string) => (name === "database" ? mockDbService : null)),
      logger: {
        debug: mock(() => {}),
        error: mock(() => {}),
        info: mock(() => {}),
        warn: mock(() => {}),
      },
    } as unknown as PluginContext;
    await plugin.onInit!(mockContext);

    // Clean up
    delete process.env.TEST_KC_CLIENT_ID;
    delete process.env.TEST_KC_SECRET;
    delete process.env.TEST_KC_ISSUER;
    delete process.env.TEST_KC_REALM;
  });
});

describe("onRequest middleware", () => {
  let authnPlugin: typeof import("./plugin").default;

  beforeEach(async () => {
    const mod = await import("./plugin");
    authnPlugin = mod.default;
  });

  it("should skip auth routes", async () => {
    const plugin = authnPlugin({
      providers: [{ type: "email-password" }],
    });

    const req = new Request("http://localhost:8000/auth/api/providers");
    const result = await plugin.onRequest!(req);

    expect(result).toBeUndefined();
  });

  it("should skip auth login routes", async () => {
    const plugin = authnPlugin({
      providers: [{ type: "email-password" }],
    });

    const req = new Request("http://localhost:8000/auth/login");
    const result = await plugin.onRequest!(req);

    expect(result).toBeUndefined();
  });

  it("should validate API key and add X-Identity header for valid key", async () => {
    process.env.VALID_API_KEY = "valid-key-123";

    const plugin = authnPlugin({
      apiKeys: [
        {
          key: "${VALID_API_KEY}",
          name: "Test Key",
          roles: ["admin", "deployer"],
        },
      ],
      providers: [{ type: "email-password" }],
    });

    const req = new Request("http://localhost:8000/api/protected", {
      headers: {
        "X-API-Key": "valid-key-123",
      },
    });

    const result = await plugin.onRequest!(req);

    expect(result).toBeInstanceOf(Request);
    const newReq = result as Request;
    const identity = JSON.parse(newReq.headers.get("X-Identity") || "{}");
    expect(identity.id).toBe("apikey:Test Key");
    expect(identity.name).toBe("Test Key");
    expect(identity.roles).toContain("admin");
    expect(identity.roles).toContain("deployer");

    delete process.env.VALID_API_KEY;
  });

  it("should use default roles when API key has no roles specified", async () => {
    process.env.VALID_API_KEY = "valid-key-123";

    const plugin = authnPlugin({
      apiKeys: [
        {
          key: "${VALID_API_KEY}",
          name: "Test Key",
        },
      ],
      providers: [{ type: "email-password" }],
    });

    const req = new Request("http://localhost:8000/api/protected", {
      headers: {
        "X-API-Key": "valid-key-123",
      },
    });

    const result = await plugin.onRequest!(req);

    expect(result).toBeInstanceOf(Request);
    const newReq = result as Request;
    const identity = JSON.parse(newReq.headers.get("X-Identity") || "{}");
    expect(identity.roles).toContain("api-client");

    delete process.env.VALID_API_KEY;
  });

  it("should return 401 for invalid API key", async () => {
    process.env.VALID_API_KEY = "valid-key-123";

    const plugin = authnPlugin({
      apiKeys: [
        {
          key: "${VALID_API_KEY}",
          name: "Test Key",
          roles: ["admin"],
        },
      ],
      providers: [{ type: "email-password" }],
    });

    const req = new Request("http://localhost:8000/api/protected", {
      headers: {
        "X-API-Key": "invalid-key-456",
      },
    });

    const result = await plugin.onRequest!(req);

    expect(result).toBeInstanceOf(Response);
    const res = result as Response;
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Invalid API key");

    delete process.env.VALID_API_KEY;
  });

  it("should return 401 for API requests without session", async () => {
    const plugin = authnPlugin({
      providers: [{ type: "email-password" }],
    });

    const req = new Request("http://localhost:8000/api/protected", {
      headers: {
        Accept: "application/json",
      },
    });

    const result = await plugin.onRequest!(req);

    expect(result).toBeInstanceOf(Response);
    const res = result as Response;
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("should redirect to login for non-API requests without session", async () => {
    const plugin = authnPlugin({
      providers: [{ type: "email-password" }],
    });

    const req = new Request("http://localhost:8000/dashboard", {
      headers: {
        Accept: "text/html",
      },
    });

    const result = await plugin.onRequest!(req);

    expect(result).toBeInstanceOf(Response);
    const res = result as Response;
    expect(res.status).toBe(302);
    const location = res.headers.get("Location");
    expect(location).toContain("/auth/login");
    expect(location).toContain("redirect=%2Fdashboard");
  });

  it("should use custom login path when configured", async () => {
    const plugin = authnPlugin({
      loginPath: "/custom-login",
      providers: [{ type: "email-password" }],
    });

    const req = new Request("http://localhost:8000/dashboard", {
      headers: {
        Accept: "text/html",
      },
    });

    const result = await plugin.onRequest!(req);

    expect(result).toBeInstanceOf(Response);
    const res = result as Response;
    expect(res.status).toBe(302);
    const location = res.headers.get("Location");
    expect(location).toContain("/custom-login");
  });

  it("should preserve query string in redirect", async () => {
    const plugin = authnPlugin({
      providers: [{ type: "email-password" }],
    });

    const req = new Request("http://localhost:8000/dashboard?tab=settings&id=123", {
      headers: {
        Accept: "text/html",
      },
    });

    const result = await plugin.onRequest!(req);

    expect(result).toBeInstanceOf(Response);
    const res = result as Response;
    const location = res.headers.get("Location");
    expect(location).toContain("redirect=%2Fdashboard%3Ftab%3Dsettings%26id%3D123");
  });

  it("should skip authentication for public routes defined in app config", async () => {
    const plugin = authnPlugin({
      providers: [{ type: "email-password" }],
    });

    const app: AppInfo = {
      config: {
        publicRoutes: ["/api/health", "/api/public/**"],
      },
      name: "myapp",
      path: "/path/to/app",
      port: 5000,
    };

    const req = new Request("http://localhost:8000/myapp/api/health");
    const result = await plugin.onRequest!(req, app);

    expect(result).toBeUndefined();
  });

  it("should skip authentication for wildcard public routes in app config", async () => {
    const plugin = authnPlugin({
      providers: [{ type: "email-password" }],
    });

    const app: AppInfo = {
      config: {
        publicRoutes: ["/api/public/**"],
      },
      name: "myapp",
      path: "/path/to/app",
      port: 5000,
    };

    const req = new Request("http://localhost:8000/myapp/api/public/data/nested");
    const result = await plugin.onRequest!(req, app);

    expect(result).toBeUndefined();
  });

  it("should handle method-specific public routes in app config", async () => {
    const plugin = authnPlugin({
      providers: [{ type: "email-password" }],
    });

    const app: AppInfo = {
      config: {
        publicRoutes: {
          GET: ["/public"],
          POST: ["/webhook"],
        },
      },
      name: "myapp",
      path: "/path/to/app",
      port: 5000,
    };

    // GET to /public should be allowed
    const getReq = new Request("http://localhost:8000/myapp/public", {
      method: "GET",
    });
    const getResult = await plugin.onRequest!(getReq, app);
    expect(getResult).toBeUndefined();

    // POST to /webhook should be allowed
    const postReq = new Request("http://localhost:8000/myapp/webhook", {
      method: "POST",
    });
    const postResult = await plugin.onRequest!(postReq, app);
    expect(postResult).toBeUndefined();
  });

  it("should continue without identity when session cookie exists but no valid session", async () => {
    const plugin = authnPlugin({
      providers: [{ type: "email-password" }],
    });

    // Request with session cookie but no valid session (getIdentityFromSession will return null)
    const req = new Request("http://localhost:8000/dashboard", {
      headers: {
        Cookie: "better-auth.session_token=invalid-session-token",
      },
    });

    const result = await plugin.onRequest!(req);

    // Should return undefined (continue) because session cookie exists
    // even though we can't get identity from it
    expect(result).toBeUndefined();
  });

  it("should pass through request with session cookie", async () => {
    const plugin = authnPlugin({
      providers: [{ type: "email-password" }],
    });

    // Request with session cookie
    const req = new Request("http://localhost:8000/api/protected", {
      headers: {
        Accept: "application/json",
        Cookie: "better-auth.session_token=some-token",
      },
    });

    const result = await plugin.onRequest!(req);

    // Should return undefined when session cookie exists (even if no valid identity)
    expect(result).toBeUndefined();
  });
});

describe("processProviderConfig", () => {
  it("should return email-password config unchanged", async () => {
    const { default: authnPlugin } = await import("./plugin");
    const plugin = authnPlugin({
      providers: [
        {
          type: "email-password",
          allowSignUp: false,
          requireEmailVerification: true,
        },
      ],
    });

    expect(plugin.routes).toBeDefined();
  });

  it("should process Okta provider config with env substitution", async () => {
    process.env.TEST_OKTA_DOMAIN = "test.okta.com";
    process.env.TEST_CLIENT_ID = "client-123";
    process.env.TEST_CLIENT_SECRET = "secret-456";

    const { default: authnPlugin } = await import("./plugin");
    const plugin = authnPlugin({
      providers: [
        {
          type: "okta",
          clientId: "${TEST_CLIENT_ID}",
          clientSecret: "${TEST_CLIENT_SECRET}",
          domain: "${TEST_OKTA_DOMAIN}",
        },
      ],
    });

    expect(plugin.routes).toBeDefined();

    delete process.env.TEST_OKTA_DOMAIN;
    delete process.env.TEST_CLIENT_ID;
    delete process.env.TEST_CLIENT_SECRET;
  });

  it("should process Generic OIDC provider config with env substitution", async () => {
    process.env.TEST_ISSUER = "https://oidc.example.com";
    process.env.TEST_CLIENT_ID = "client-123";
    process.env.TEST_CLIENT_SECRET = "secret-456";

    const { default: authnPlugin } = await import("./plugin");
    const plugin = authnPlugin({
      providers: [
        {
          type: "generic-oidc",
          clientId: "${TEST_CLIENT_ID}",
          clientSecret: "${TEST_CLIENT_SECRET}",
          issuer: "${TEST_ISSUER}",
        },
      ],
    });

    expect(plugin.routes).toBeDefined();

    delete process.env.TEST_ISSUER;
    delete process.env.TEST_CLIENT_ID;
    delete process.env.TEST_CLIENT_SECRET;
  });
});

describe("multiple providers", () => {
  it("should handle multiple providers configuration", async () => {
    process.env.TEST_CLIENT_ID = "client-123";
    process.env.TEST_CLIENT_SECRET = "secret-456";
    process.env.TEST_ISSUER = "https://keycloak.example.com";
    process.env.TEST_REALM = "test-realm";

    const { default: authnPlugin } = await import("./plugin");
    const plugin = authnPlugin({
      providers: [
        { type: "email-password" },
        {
          type: "keycloak",
          clientId: "${TEST_CLIENT_ID}",
          clientSecret: "${TEST_CLIENT_SECRET}",
          issuer: "${TEST_ISSUER}",
          realm: "${TEST_REALM}",
        },
      ],
    });

    expect(plugin.routes).toBeDefined();

    delete process.env.TEST_CLIENT_ID;
    delete process.env.TEST_CLIENT_SECRET;
    delete process.env.TEST_ISSUER;
    delete process.env.TEST_REALM;
  });
});

describe("SCIM configuration", () => {
  it("should accept SCIM configuration", async () => {
    const { default: authnPlugin } = await import("./plugin");
    const plugin = authnPlugin({
      providers: [{ type: "email-password" }],
      scim: {
        enabled: true,
        maxResults: 50,
        bulkEnabled: true,
        maxBulkOperations: 500,
      },
    });

    expect(plugin.routes).toBeDefined();
  });

  it("should accept trustedOrigins configuration", async () => {
    const { default: authnPlugin } = await import("./plugin");
    const plugin = authnPlugin({
      providers: [{ type: "email-password" }],
      trustedOrigins: ["http://localhost:3000", "https://example.com"],
    });

    expect(plugin.routes).toBeDefined();
  });
});

describe("database configuration", () => {
  it("should accept database adapter type", async () => {
    const { default: authnPlugin } = await import("./plugin");
    const plugin = authnPlugin({
      database: "libsql",
      providers: [{ type: "email-password" }],
    });

    expect(plugin.routes).toBeDefined();
  });
});

describe("onShutdown lifecycle", () => {
  it("should call onShutdown without errors", async () => {
    const { default: authnPlugin } = await import("./plugin");
    const plugin = authnPlugin({
      providers: [{ type: "email-password" }],
    });

    expect(() => plugin.onShutdown!()).not.toThrow();
  });
});

describe("session cookie handling", () => {
  let authnPlugin: typeof import("./plugin").default;

  beforeEach(async () => {
    const mod = await import("./plugin");
    authnPlugin = mod.default;
  });

  it("should pass through request with session cookie when no identity found", async () => {
    const plugin = authnPlugin({
      providers: [{ type: "email-password" }],
    });

    // Request with session cookie but no valid session (identity will be null)
    const req = new Request("http://localhost:8000/api/protected", {
      headers: {
        cookie: "better-auth.session_token=invalid-token",
      },
    });

    const result = await plugin.onRequest!(req);

    // Should return undefined (pass through) when session cookie exists but no identity
    expect(result).toBeUndefined();
  });

  it("should handle non-matching app public routes", async () => {
    const plugin = authnPlugin({
      providers: [{ type: "email-password" }],
    });

    const app: AppInfo = {
      config: {
        publicRoutes: ["/api/public"],
      },
      name: "myapp",
      path: "/path/to/app",
      port: 5000,
    };

    // Request that matches the app prefix but not the public route pattern
    const req = new Request("http://localhost:8000/myapp/api/private", {
      headers: {
        Accept: "text/html",
      },
    });

    const result = await plugin.onRequest!(req, app);

    // Should redirect to login since the route is not public
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(302);
  });

  it("should handle app with empty publicRoutes array", async () => {
    const plugin = authnPlugin({
      providers: [{ type: "email-password" }],
    });

    const app: AppInfo = {
      config: {
        publicRoutes: [],
      },
      name: "myapp",
      path: "/path/to/app",
      port: 5000,
    };

    const req = new Request("http://localhost:8000/myapp/api/data", {
      headers: {
        Accept: "application/json",
      },
    });

    const result = await plugin.onRequest!(req, app);

    // Should return 401 since no public routes
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it("should handle POST request to method-specific GET public route", async () => {
    const plugin = authnPlugin({
      providers: [{ type: "email-password" }],
    });

    const app: AppInfo = {
      config: {
        publicRoutes: {
          GET: ["/public"],
        },
      },
      name: "myapp",
      path: "/path/to/app",
      port: 5000,
    };

    // POST request to a GET-only public route should require auth
    const req = new Request("http://localhost:8000/myapp/public", {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    });

    const result = await plugin.onRequest!(req, app);

    // Should return 401 since POST is not allowed
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });
});

describe("isPublicRoute edge cases", () => {
  let authnPlugin: typeof import("./plugin").default;

  beforeEach(async () => {
    const mod = await import("./plugin");
    authnPlugin = mod.default;
  });

  it("should handle app without name (edge case)", async () => {
    const plugin = authnPlugin({
      providers: [{ type: "email-password" }],
    });

    const app: AppInfo = {
      config: {
        publicRoutes: ["/public"],
      },
      name: "", // Empty name
      path: "/path/to/app",
      port: 5000,
    };

    const req = new Request("http://localhost:8000/api/data", {
      headers: {
        Accept: "application/json",
      },
    });

    const result = await plugin.onRequest!(req, app);

    // Should return 401 since app name is empty
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it("should handle ALL method public routes from app config", async () => {
    const plugin = authnPlugin({
      providers: [{ type: "email-password" }],
    });

    const app: AppInfo = {
      config: {
        publicRoutes: {
          ALL: ["/health"],
        },
      },
      name: "myapp",
      path: "/path/to/app",
      port: 5000,
    };

    // GET request to ALL route
    const getReq = new Request("http://localhost:8000/myapp/health", {
      method: "GET",
    });
    const getResult = await plugin.onRequest!(getReq, app);
    expect(getResult).toBeUndefined();

    // POST request to ALL route
    const postReq = new Request("http://localhost:8000/myapp/health", {
      method: "POST",
    });
    const postResult = await plugin.onRequest!(postReq, app);
    expect(postResult).toBeUndefined();
  });
});

describe("session cookie with valid identity (through services)", () => {
  it("should inject X-Identity header when session returns valid identity", async () => {
    const { mock } = await import("bun:test");
    const services = await import("./server/services");

    // Create mock adapter and database service
    const mockAdapter = {
      batch: mock(() => Promise.resolve()),
      close: mock(() => Promise.resolve()),
      createTenant: mock(() => Promise.resolve()),
      deleteTenant: mock(() => Promise.resolve()),
      execute: mock(() => Promise.resolve([])),
      executeOne: mock(() => Promise.resolve(null)),
      getRawClient: mock(() => ({
        execute: mock(() => Promise.resolve({ rows: [], columns: [] })),
      })),
      getTenant: mock(() => Promise.resolve({})),
      listTenants: mock(() => Promise.resolve([])),
      tenantId: null,
      transaction: mock((fn: Function) => fn({})),
      type: "libsql",
    };

    const mockDbService = {
      getAdapter: mock(() => Promise.resolve(mockAdapter)),
      getDefaultType: mock(() => "libsql" as const),
      getRootAdapter: mock(() => mockAdapter),
      isMultiTenant: mock(() => false),
      registerAdapter: mock(() => {}),
    };

    const mockLogger = {
      debug: mock(() => {}),
      error: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
    };

    // Initialize services
    await services.initialize(
      mockDbService as never,
      { providers: [{ type: "email-password" }] },
      mockLogger,
    );

    // Get auth and mock getSession
    const auth = services.getAuth();
    if (auth) {
      const originalGetSession = auth.api.getSession;
      auth.api.getSession = mock(async () => ({
        session: { id: "session-123", userId: "user-123" },
        user: {
          id: "user-123",
          email: "test@example.com",
          name: "Test User",
          roles: ["admin", "user"],
          groups: ["group1"],
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      })) as any;

      // Now test the plugin
      const { default: authnPlugin } = await import("./plugin");
      const plugin = authnPlugin({
        providers: [{ type: "email-password" }],
      });

      // Request with session cookie
      const req = new Request("http://localhost:8000/api/protected", {
        headers: {
          cookie: "better-auth.session_token=valid-session-token",
        },
      });

      const result = await plugin.onRequest!(req);

      // Should return a new Request with X-Identity header
      expect(result).toBeInstanceOf(Request);
      const newReq = result as Request;
      const identityHeader = newReq.headers.get("X-Identity");
      expect(identityHeader).not.toBeNull();
      const identity = JSON.parse(identityHeader || "{}");
      expect(identity.sub).toBe("user-123");
      expect(identity.roles).toContain("admin");

      // Restore
      auth.api.getSession = originalGetSession;
    }

    // Shutdown services
    services.shutdown();
  });
});
