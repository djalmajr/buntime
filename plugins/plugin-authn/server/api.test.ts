/**
 * Tests for plugin-authn API routes
 *
 * Tests:
 * - API route definitions
 * - Route handlers
 * - SCIM route mounting
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { DatabaseAdapter } from "@buntime/plugin-database";
import type { PluginLogger } from "@buntime/shared/types";
import { api, mountScimRoutes, type ScimConfig } from "./api";

describe("api module", () => {
  describe("api Hono app", () => {
    it("should have Hono-like structure", () => {
      expect(api).toBeDefined();
      expect(api.routes).toBeDefined();
      expect(typeof api.fetch).toBe("function");
    });

    it("should have routes defined", () => {
      // The API app should have routes defined
      expect(api.routes).toBeDefined();
    });
  });

  describe("route structure", () => {
    it("should have root route", async () => {
      // Root route redirects based on auth status
      // Since auth is not initialized, it should redirect to login
      const req = new Request("http://localhost:8000/");
      const res = await api.fetch(req);

      // Without auth initialized, should redirect to login
      expect(res.status).toBe(302);
    });

    it("should have /api/providers route", async () => {
      const req = new Request("http://localhost:8000/api/providers");
      const res = await api.fetch(req);

      // Should return providers (empty array when not initialized)
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });

    it("should have /api/session route", async () => {
      const req = new Request("http://localhost:8000/api/session");
      const res = await api.fetch(req);

      // Should return 500 when auth is not configured
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("Auth not configured");
    });

    it("should have /api/auth/* wildcard route", async () => {
      const req = new Request("http://localhost:8000/api/auth/signin");
      const res = await api.fetch(req);

      // Should return 500 when auth is not configured
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("Auth not configured");
    });

    it("should have /api/auth route", async () => {
      const req = new Request("http://localhost:8000/api/auth");
      const res = await api.fetch(req);

      // Should return 500 when auth is not configured
      expect(res.status).toBe(500);
    });

    it("should have GET /api/logout route", async () => {
      const req = new Request("http://localhost:8000/api/logout");
      const res = await api.fetch(req);

      // Should redirect when auth is not configured
      expect(res.status).toBe(302);
    });

    it("should have POST /api/logout route", async () => {
      const req = new Request("http://localhost:8000/api/logout", {
        method: "POST",
      });
      const res = await api.fetch(req);

      // Should return 500 when auth is not configured
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe("Auth not configured");
    });
  });

  describe("logout routes", () => {
    it("should accept redirect query parameter in GET /api/logout", async () => {
      const req = new Request("http://localhost:8000/api/logout?redirect=/dashboard");
      const res = await api.fetch(req);

      // When auth is not configured, should redirect to the specified path
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/dashboard");
    });

    it("should default to / when no redirect query in GET /api/logout", async () => {
      const req = new Request("http://localhost:8000/api/logout");
      const res = await api.fetch(req);

      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/");
    });
  });

  describe("error handling", () => {
    it("should handle errors gracefully", async () => {
      // The API has an onError handler
      const req = new Request("http://localhost:8000/api/auth/error-test", {
        method: "POST",
      });
      const res = await api.fetch(req);

      // Should return an error response
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });
});

describe("mountScimRoutes", () => {
  const createMockAdapter = (): DatabaseAdapter =>
    ({
      batch: mock(() => Promise.resolve()),
      close: mock(() => Promise.resolve()),
      createTenant: mock(() => Promise.resolve()),
      deleteTenant: mock(() => Promise.resolve()),
      execute: mock(() => Promise.resolve([])),
      executeOne: mock(() => Promise.resolve(null)),
      getRawClient: mock(() => ({})),
      getTenant: mock(() => Promise.resolve({})),
      listTenants: mock(() => Promise.resolve([])),
      tenantId: null,
      transaction: mock((fn) => fn({})),
      type: "libsql",
    }) as unknown as DatabaseAdapter;

  const createMockLogger = (): PluginLogger => ({
    debug: mock(() => {}),
    error: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
  });

  it("should not mount routes when disabled", () => {
    const logger = createMockLogger();
    const adapter = createMockAdapter();

    const config: ScimConfig = {
      adapter,
      baseUrl: "http://localhost:8000",
      enabled: false,
      logger,
    };

    mountScimRoutes(config);

    // Should not call logger.info since routes are not mounted
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("should define ScimConfig type correctly", () => {
    const logger = createMockLogger();
    const adapter = createMockAdapter();

    const config: ScimConfig = {
      adapter,
      baseUrl: "http://localhost:8000",
      enabled: true,
      logger,
    };

    // Just verify config structure is correct
    expect(config.enabled).toBe(true);
    expect(config.baseUrl).toBe("http://localhost:8000");
  });

  it("should accept bulk configuration in ScimConfig", () => {
    const logger = createMockLogger();
    const adapter = createMockAdapter();

    const config: ScimConfig = {
      adapter,
      baseUrl: "http://localhost:8000",
      bulkEnabled: true,
      enabled: true,
      logger,
      maxBulkOperations: 500,
    };

    expect(config.bulkEnabled).toBe(true);
    expect(config.maxBulkOperations).toBe(500);
  });

  it("should accept maxResults configuration in ScimConfig", () => {
    const logger = createMockLogger();
    const adapter = createMockAdapter();

    const config: ScimConfig = {
      adapter,
      baseUrl: "http://localhost:8000",
      enabled: true,
      logger,
      maxResults: 50,
    };

    expect(config.maxResults).toBe(50);
  });
});

describe("ScimConfig interface", () => {
  it("should define required properties", () => {
    const adapter = {
      close: mock(() => Promise.resolve()),
      execute: mock(() => Promise.resolve([])),
      executeOne: mock(() => Promise.resolve(null)),
      getClient: mock(() => null),
      getRawClient: mock(() => ({})),
      isConnected: mock(() => true),
    } as unknown as DatabaseAdapter;

    const config: ScimConfig = {
      adapter,
      baseUrl: "http://localhost:8000",
      enabled: true,
    };

    expect(config.adapter).toBe(adapter);
    expect(config.baseUrl).toBe("http://localhost:8000");
    expect(config.enabled).toBe(true);
  });

  it("should allow optional properties", () => {
    const adapter = {
      close: mock(() => Promise.resolve()),
      execute: mock(() => Promise.resolve([])),
      executeOne: mock(() => Promise.resolve(null)),
      getClient: mock(() => null),
      getRawClient: mock(() => ({})),
      isConnected: mock(() => true),
    } as unknown as DatabaseAdapter;

    const logger: PluginLogger = {
      debug: mock(() => {}),
      error: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
    };

    const config: ScimConfig = {
      adapter,
      baseUrl: "http://localhost:8000",
      bulkEnabled: false,
      enabled: true,
      logger,
      maxBulkOperations: 100,
      maxResults: 25,
    };

    expect(config.bulkEnabled).toBe(false);
    expect(config.maxBulkOperations).toBe(100);
    expect(config.maxResults).toBe(25);
    expect(config.logger).toBe(logger);
  });
});

describe("API type export", () => {
  it("should export ApiType", async () => {
    const { api } = await import("./api");
    expect(api).toBeDefined();
    expect(typeof api.fetch).toBe("function");
  });
});

describe("API routes with initialized auth", () => {
  /**
   * These tests use mock.module to test routes when auth is configured.
   * We mock the services module to simulate an initialized auth instance.
   */

  describe("root route with session", () => {
    it("should redirect to home when user has session", async () => {
      // Create a mock auth instance
      const mockAuth = {
        api: {
          getSession: mock(() =>
            Promise.resolve({
              session: { id: "session-1" },
              user: { id: "user-1", email: "test@example.com" },
            }),
          ),
        },
      };

      // Mock the services module
      mock.module("./services", () => ({
        getAuth: () => mockAuth,
        getBasePath: () => "/auth",
        getLogger: () => null,
        getProviders: () => [],
        getOAuthAccountsForUser: () => Promise.resolve([]),
        getProviderById: () => null,
      }));

      // Re-import to get the mocked version
      const { api: mockedApi } = await import("./api");

      const req = new Request("http://localhost:8000/");
      const res = await mockedApi.fetch(req);

      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/");
    });
  });

  describe("auth routes with configured auth", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockAuth: any;
    let mockLogger: ReturnType<typeof createMockLogger>;

    const createMockAuth = () => ({
      api: {
        getSession: mock(() => Promise.resolve(null)),
        signOut: mock(() =>
          Promise.resolve(
            new Response(null, {
              headers: new Headers([["Set-Cookie", "session=; Max-Age=0; Path=/"]]),
            }),
          ),
        ),
      },
      handler: mock((_req: Request) => Promise.resolve(new Response(JSON.stringify({ ok: true })))),
    });

    const createMockLogger = () => ({
      debug: mock(() => {}),
      error: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
    });

    beforeEach(() => {
      mockAuth = createMockAuth();
      mockLogger = createMockLogger();

      mock.module("./services", () => ({
        getAuth: () => mockAuth,
        getBasePath: () => "/auth",
        getLogger: () => mockLogger,
        getOAuthAccountsForUser: () => Promise.resolve([]),
        getProviderById: () => null,
        getProviders: () => [
          { displayName: "Email", providerId: "email-password", type: "email-password" },
        ],
      }));
    });

    afterEach(() => {
      mock.restore();
    });

    it("should return providers when auth is configured", async () => {
      const { api: mockedApi } = await import("./api");
      const req = new Request("http://localhost:8000/api/providers");
      const res = await mockedApi.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });

    it("should handle /api/auth/* routes with auth handler", async () => {
      const { api: mockedApi } = await import("./api");
      const req = new Request("http://localhost:8000/api/auth/signin");
      const res = await mockedApi.fetch(req);

      expect(res.status).toBe(200);
    });

    it("should return session when auth is configured", async () => {
      mockAuth.api.getSession = mock(() =>
        Promise.resolve({
          session: { id: "session-1", expiresAt: new Date() },
          user: { id: "user-1", email: "test@example.com" },
        }),
      );

      const { api: mockedApi } = await import("./api");
      const req = new Request("http://localhost:8000/api/session");
      const res = await mockedApi.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.user).toBeDefined();
      expect(body.user.id).toBe("user-1");
    });

    it("should handle /api/auth base route", async () => {
      const { api: mockedApi } = await import("./api");
      const req = new Request("http://localhost:8000/api/auth");
      const res = await mockedApi.fetch(req);

      expect(res.status).toBe(200);
    });

    it("should log debug messages for auth routes", async () => {
      const { api: mockedApi } = await import("./api");
      const req = new Request("http://localhost:8000/api/auth/test-path");
      await mockedApi.fetch(req);

      expect(mockLogger.debug).toHaveBeenCalled();
    });
  });

  describe("logout routes with OIDC provider", () => {
    let mockAuth: ReturnType<typeof createMockAuth>;
    let mockLogger: ReturnType<typeof createMockLogger>;
    let mockProvider: { getLogoutUrl: ReturnType<typeof mock> };

    const createMockAuth = () => ({
      api: {
        getSession: mock(() =>
          Promise.resolve({
            session: { id: "session-1" },
            user: { id: "user-1", email: "test@example.com" },
          }),
        ),
        signOut: mock(() =>
          Promise.resolve(
            new Response(null, {
              headers: new Headers([
                ["Set-Cookie", "session=; Max-Age=0; Path=/"],
                ["Set-Cookie", "auth_token=; Max-Age=0; Path=/"],
              ]),
            }),
          ),
        ),
      },
      handler: mock(() => Promise.resolve(new Response())),
    });

    const createMockLogger = () => ({
      debug: mock(() => {}),
      error: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
    });

    beforeEach(() => {
      mockAuth = createMockAuth();
      mockLogger = createMockLogger();
      mockProvider = {
        getLogoutUrl: mock(() =>
          Promise.resolve(
            "https://idp.example.com/logout?post_logout_redirect_uri=http://localhost:8000/",
          ),
        ),
      };

      mock.module("./services", () => ({
        getAuth: () => mockAuth,
        getBasePath: () => "/auth",
        getLogger: () => mockLogger,
        getOAuthAccountsForUser: () =>
          Promise.resolve([
            {
              accessToken: "access-123",
              accessTokenExpiresAt: null,
              accountId: "acc-1",
              id: "oauth-1",
              idToken: "id-token-123",
              providerId: "keycloak",
              refreshToken: null,
              refreshTokenExpiresAt: null,
              scope: "openid profile email",
              userId: "user-1",
            },
          ]),
        getProviderById: (id: string) => (id === "keycloak" ? mockProvider : null),
        getProviders: () => [],
      }));
    });

    afterEach(() => {
      mock.restore();
    });

    it("should redirect to OIDC logout URL when available", async () => {
      const { api: mockedApi } = await import("./api");
      const req = new Request("http://localhost:8000/api/logout");
      const res = await mockedApi.fetch(req);

      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toContain("https://idp.example.com/logout");
      // Should include Set-Cookie headers from signOut
      const cookies = res.headers.getSetCookie();
      expect(cookies.length).toBeGreaterThan(0);
    });

    it("should log OIDC logout information", async () => {
      const { api: mockedApi } = await import("./api");
      const req = new Request("http://localhost:8000/api/logout");
      await mockedApi.fetch(req);

      // Should log various stages of logout
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it("should handle POST /api/logout with OIDC URL in response", async () => {
      const { api: mockedApi } = await import("./api");
      const req = new Request("http://localhost:8000/api/logout", {
        method: "POST",
      });
      const res = await mockedApi.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.oidcLogoutUrl).toContain("https://idp.example.com/logout");
    });
  });

  describe("logout fallback when no OIDC provider", () => {
    let mockAuth: ReturnType<typeof createMockAuth>;
    let mockLogger: ReturnType<typeof createMockLogger>;

    const createMockAuth = () => ({
      api: {
        getSession: mock(() =>
          Promise.resolve({
            session: { id: "session-1" },
            user: { id: "user-1" },
          }),
        ),
        signOut: mock(() =>
          Promise.resolve(
            new Response(null, {
              headers: new Headers([["Set-Cookie", "session=; Max-Age=0"]]),
            }),
          ),
        ),
      },
      handler: mock(() => Promise.resolve(new Response())),
    });

    const createMockLogger = () => ({
      debug: mock(() => {}),
      error: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
    });

    beforeEach(() => {
      mockAuth = createMockAuth();
      mockLogger = createMockLogger();

      mock.module("./services", () => ({
        getAuth: () => mockAuth,
        getBasePath: () => "/auth",
        getLogger: () => mockLogger,
        getOAuthAccountsForUser: () =>
          Promise.resolve([
            {
              accountId: "acc-1",
              id: "oauth-1",
              idToken: null, // No ID token
              providerId: "email-password",
              userId: "user-1",
            },
          ]),
        getProviderById: () => null,
        getProviders: () => [],
      }));
    });

    afterEach(() => {
      mock.restore();
    });

    it("should fallback to local logout when no OIDC provider", async () => {
      const { api: mockedApi } = await import("./api");
      const req = new Request("http://localhost:8000/api/logout?redirect=/dashboard");
      const res = await mockedApi.fetch(req);

      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/dashboard");
    });

    it("should handle POST /api/logout without OIDC", async () => {
      const { api: mockedApi } = await import("./api");
      const req = new Request("http://localhost:8000/api/logout", {
        method: "POST",
      });
      const res = await mockedApi.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.oidcLogoutUrl).toBeNull();
    });
  });

  describe("logout when no session", () => {
    let mockAuth: ReturnType<typeof createMockAuth>;
    let mockLogger: ReturnType<typeof createMockLogger>;

    const createMockAuth = () => ({
      api: {
        getSession: mock(() => Promise.resolve(null)),
        signOut: mock(() =>
          Promise.resolve(
            new Response(null, {
              headers: new Headers([["Set-Cookie", "session=; Max-Age=0"]]),
            }),
          ),
        ),
      },
      handler: mock(() => Promise.resolve(new Response())),
    });

    const createMockLogger = () => ({
      debug: mock(() => {}),
      error: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
    });

    beforeEach(() => {
      mockAuth = createMockAuth();
      mockLogger = createMockLogger();

      mock.module("./services", () => ({
        getAuth: () => mockAuth,
        getBasePath: () => "/auth",
        getLogger: () => mockLogger,
        getOAuthAccountsForUser: () => Promise.resolve([]),
        getProviderById: () => null,
        getProviders: () => [],
      }));
    });

    afterEach(() => {
      mock.restore();
    });

    it("should log warning and redirect when no session found", async () => {
      const { api: mockedApi } = await import("./api");
      const req = new Request("http://localhost:8000/api/logout");
      const res = await mockedApi.fetch(req);

      expect(res.status).toBe(302);
      expect(mockLogger.warn).toHaveBeenCalledWith("No session found for logout");
    });
  });

  describe("logout error handling", () => {
    let mockAuth: ReturnType<typeof createMockAuth>;
    let mockLogger: ReturnType<typeof createMockLogger>;

    const createMockAuth = () => ({
      api: {
        getSession: mock(() => {
          throw new Error("Session error");
        }),
        signOut: mock(() =>
          Promise.resolve(
            new Response(null, {
              headers: new Headers([["Set-Cookie", "session=; Max-Age=0"]]),
            }),
          ),
        ),
      },
      handler: mock(() => Promise.resolve(new Response())),
    });

    const createMockLogger = () => ({
      debug: mock(() => {}),
      error: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
    });

    beforeEach(() => {
      mockAuth = createMockAuth();
      mockLogger = createMockLogger();

      mock.module("./services", () => ({
        getAuth: () => mockAuth,
        getBasePath: () => "/auth",
        getLogger: () => mockLogger,
        getOAuthAccountsForUser: () => Promise.resolve([]),
        getProviderById: () => null,
        getProviders: () => [],
      }));
    });

    afterEach(() => {
      mock.restore();
    });

    it("should handle errors during GET logout and still sign out", async () => {
      const { api: mockedApi } = await import("./api");
      const req = new Request("http://localhost:8000/api/logout");
      const res = await mockedApi.fetch(req);

      expect(res.status).toBe(302);
      expect(mockLogger.error).toHaveBeenCalled();
      // Should still include Set-Cookie headers from fallback signOut
      expect(res.headers.getSetCookie().length).toBeGreaterThan(0);
    });

    it("should handle errors during POST logout and still sign out", async () => {
      const { api: mockedApi } = await import("./api");
      const req = new Request("http://localhost:8000/api/logout", {
        method: "POST",
      });
      const res = await mockedApi.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("auth handler error handling", () => {
    let mockAuth: ReturnType<typeof createMockAuth>;
    let mockLogger: ReturnType<typeof createMockLogger>;

    const createMockAuth = () => ({
      api: {
        getSession: mock(() => Promise.resolve(null)),
        signOut: mock(() => Promise.resolve(new Response())),
      },
      handler: mock(() => {
        throw new Error("Auth handler error");
      }),
    });

    const createMockLogger = () => ({
      debug: mock(() => {}),
      error: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
    });

    beforeEach(() => {
      mockAuth = createMockAuth();
      mockLogger = createMockLogger();

      mock.module("./services", () => ({
        getAuth: () => mockAuth,
        getBasePath: () => "/auth",
        getLogger: () => mockLogger,
        getOAuthAccountsForUser: () => Promise.resolve([]),
        getProviderById: () => null,
        getProviders: () => [],
      }));
    });

    afterEach(() => {
      mock.restore();
    });

    it("should log and rethrow errors from auth handler", async () => {
      const { api: mockedApi } = await import("./api");
      const req = new Request("http://localhost:8000/api/auth/test");

      // The onError handler should catch this
      const res = await mockedApi.fetch(req);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("mountScimRoutes with enabled", () => {
    it("should create SCIM routes when enabled", async () => {
      // Note: We can't test actual route mounting since the Hono router is already built
      // after first use. The mountScimRoutes function is tested in services.test.ts
      // where the routes are mounted before any requests are made.

      // Instead, test that createScimRoutes is called with correct config
      const { createScimRoutes } = await import("./scim/routes");

      const adapter: DatabaseAdapter = {
        batch: mock(() => Promise.resolve()),
        close: mock(() => Promise.resolve()),
        createTenant: mock(() => Promise.resolve()),
        deleteTenant: mock(() => Promise.resolve()),
        execute: mock(() => Promise.resolve([])),
        executeOne: mock(() => Promise.resolve(null)),
        getRawClient: mock(() => ({})),
        getTenant: mock(() => Promise.resolve({})),
        listTenants: mock(() => Promise.resolve([])),
        tenantId: null,
        transaction: mock((fn) => fn({})),
        type: "libsql",
      } as unknown as DatabaseAdapter;

      const logger: PluginLogger = {
        debug: mock(() => {}),
        error: mock(() => {}),
        info: mock(() => {}),
        warn: mock(() => {}),
      };

      const scimApp = createScimRoutes({
        adapter,
        baseUrl: "http://localhost:8000",
        bulkEnabled: true,
        logger,
        maxBulkOperations: 100,
        maxResults: 50,
      });

      expect(scimApp).toBeDefined();
      expect(typeof scimApp.fetch).toBe("function");
    });
  });

  describe("logout error when signOut also fails", () => {
    let mockAuth: ReturnType<typeof createMockAuth>;
    let mockLogger: ReturnType<typeof createMockLogger>;

    const createMockAuth = () => ({
      api: {
        getSession: mock(() => {
          throw new Error("Session error");
        }),
        signOut: mock(() => {
          throw new Error("SignOut also failed");
        }),
      },
      handler: mock(() => Promise.resolve(new Response())),
    });

    const createMockLogger = () => ({
      debug: mock(() => {}),
      error: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
    });

    beforeEach(() => {
      mockAuth = createMockAuth();
      mockLogger = createMockLogger();

      mock.module("./services", () => ({
        getAuth: () => mockAuth,
        getBasePath: () => "/auth",
        getLogger: () => mockLogger,
        getOAuthAccountsForUser: () => Promise.resolve([]),
        getProviderById: () => null,
        getProviders: () => [],
      }));
    });

    afterEach(() => {
      mock.restore();
    });

    it("should redirect even when both getSession and signOut fail", async () => {
      const { api: mockedApi } = await import("./api");
      const req = new Request("http://localhost:8000/api/logout?redirect=/error-page");
      const res = await mockedApi.fetch(req);

      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/error-page");
    });
  });

  describe("root route with user session", () => {
    let mockAuth: ReturnType<typeof createMockAuth>;

    const createMockAuth = () => ({
      api: {
        getSession: mock(() =>
          Promise.resolve({
            session: { id: "session-123" },
            user: { id: "user-123", name: "Test User" },
          }),
        ),
        signOut: mock(() => Promise.resolve(new Response())),
      },
      handler: mock(() => Promise.resolve(new Response())),
    });

    beforeEach(() => {
      mockAuth = createMockAuth();

      mock.module("./services", () => ({
        getAuth: () => mockAuth,
        getBasePath: () => "/auth",
        getLogger: () => null,
        getOAuthAccountsForUser: () => Promise.resolve([]),
        getProviderById: () => null,
        getProviders: () => [],
      }));
    });

    afterEach(() => {
      mock.restore();
    });

    it("should redirect to / when user is logged in", async () => {
      const { api: mockedApi } = await import("./api");
      const req = new Request("http://localhost:8000/");
      const res = await mockedApi.fetch(req);

      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/");
    });
  });

  describe("/api/auth route without wildcard", () => {
    let mockAuth: ReturnType<typeof createMockAuth>;

    const createMockAuth = () => ({
      api: {
        getSession: mock(() => Promise.resolve(null)),
        signOut: mock(() => Promise.resolve(new Response())),
      },
      handler: mock(() =>
        Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
      ),
    });

    beforeEach(() => {
      mockAuth = createMockAuth();

      mock.module("./services", () => ({
        getAuth: () => mockAuth,
        getBasePath: () => "/auth",
        getLogger: () => null,
        getOAuthAccountsForUser: () => Promise.resolve([]),
        getProviderById: () => null,
        getProviders: () => [],
      }));
    });

    afterEach(() => {
      mock.restore();
    });

    it("should handle /api/auth without wildcard path", async () => {
      const { api: mockedApi } = await import("./api");
      const req = new Request("http://localhost:8000/api/auth");
      const res = await mockedApi.fetch(req);

      expect(res.status).toBe(200);
      expect(mockAuth.handler).toHaveBeenCalled();
    });

    it("should handle POST to /api/auth without wildcard path", async () => {
      const { api: mockedApi } = await import("./api");
      const req = new Request("http://localhost:8000/api/auth", { method: "POST" });
      const res = await mockedApi.fetch(req);

      expect(res.status).toBe(200);
      expect(mockAuth.handler).toHaveBeenCalled();
    });
  });

  describe("OIDC logout with valid logoutUrl", () => {
    let mockAuth: ReturnType<typeof createMockAuth>;
    let mockLogger: ReturnType<typeof createMockLogger>;

    const createMockAuth = () => ({
      api: {
        getSession: mock(() =>
          Promise.resolve({
            session: { id: "session-123" },
            user: { id: "user-123", name: "Test User" },
          }),
        ),
        signOut: mock(() =>
          Promise.resolve(
            new Response(null, {
              headers: {
                "Set-Cookie": "session=; Max-Age=0",
              },
            }),
          ),
        ),
      },
      handler: mock(() => Promise.resolve(new Response())),
    });

    const createMockLogger = () => ({
      debug: mock(() => {}),
      error: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
    });

    const createMockProvider = () => ({
      getLogoutUrl: mock(() =>
        Promise.resolve("https://oidc.example.com/logout?id_token_hint=token123"),
      ),
      type: "keycloak",
    });

    beforeEach(() => {
      mockAuth = createMockAuth();
      mockLogger = createMockLogger();
      const mockProvider = createMockProvider();

      mock.module("./services", () => ({
        getAuth: () => mockAuth,
        getBasePath: () => "/auth",
        getLogger: () => mockLogger,
        getOAuthAccountsForUser: () =>
          Promise.resolve([
            {
              idToken: "test-id-token-12345",
              providerId: "keycloak",
            },
          ]),
        getProviderById: () => mockProvider,
        getProviders: () => [],
      }));
    });

    afterEach(() => {
      mock.restore();
    });

    it("should redirect to OIDC logout URL and clear session cookies", async () => {
      const { api: mockedApi } = await import("./api");
      const req = new Request("http://localhost:8000/api/logout");
      const res = await mockedApi.fetch(req);

      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe(
        "https://oidc.example.com/logout?id_token_hint=token123",
      );
      // Should have Set-Cookie headers to clear session
      expect(res.headers.getSetCookie().length).toBeGreaterThan(0);
    });
  });
});
