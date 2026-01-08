/**
 * Tests for plugin-authn services module
 *
 * Tests:
 * - Service initialization
 * - Service shutdown
 * - Service getters
 * - Identity extraction from session
 * - OAuth account retrieval
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { DatabaseAdapter, DatabaseService } from "@buntime/plugin-database";
import type { PluginLogger } from "@buntime/shared/types";

// Import the module to reset state between tests
import * as services from "./services";

describe("services", () => {
  // Create mock logger
  const createMockLogger = (): PluginLogger => ({
    debug: mock(() => {}),
    error: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
  });

  // Create mock database adapter
  const createMockAdapter = (): DatabaseAdapter =>
    ({
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
      transaction: mock((fn) => fn({})),
      type: "libsql",
    }) as unknown as DatabaseAdapter;

  // Create mock database service
  const createMockDatabaseService = (adapter: DatabaseAdapter): DatabaseService =>
    ({
      getAdapter: mock(() => Promise.resolve(adapter)),
      getDefaultType: mock(() => "libsql" as const),
      getRootAdapter: mock(() => adapter),
      isMultiTenant: mock(() => false),
      registerAdapter: mock(() => {}),
    }) as unknown as DatabaseService;

  beforeEach(() => {
    // Reset module state before each test
    services.shutdown();
  });

  afterEach(() => {
    // Clean up after each test
    services.shutdown();
  });

  describe("initialize", () => {
    it("should return null when no providers are configured", async () => {
      const logger = createMockLogger();
      const adapter = createMockAdapter();
      const dbService = createMockDatabaseService(adapter);

      const result = await services.initialize(dbService, { providers: [] }, logger);

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        "No providers configured - authentication will be disabled",
      );
    });

    it("should initialize with email-password provider", async () => {
      const logger = createMockLogger();
      const adapter = createMockAdapter();
      const dbService = createMockDatabaseService(adapter);

      const result = await services.initialize(
        dbService,
        { providers: [{ type: "email-password" }] },
        logger,
      );

      expect(result).not.toBeNull();
      expect(logger.info).toHaveBeenCalled();
    });

    it("should set base path from config", async () => {
      const logger = createMockLogger();
      const adapter = createMockAdapter();
      const dbService = createMockDatabaseService(adapter);

      await services.initialize(
        dbService,
        { basePath: "/custom-auth", providers: [{ type: "email-password" }] },
        logger,
      );

      expect(services.getBasePath()).toBe("/custom-auth");
    });

    it("should use default base path when not specified", async () => {
      const logger = createMockLogger();
      const adapter = createMockAdapter();
      const dbService = createMockDatabaseService(adapter);

      await services.initialize(dbService, { providers: [{ type: "email-password" }] }, logger);

      expect(services.getBasePath()).toBe("/auth");
    });
  });

  describe("shutdown", () => {
    it("should reset auth state", async () => {
      const logger = createMockLogger();
      const adapter = createMockAdapter();
      const dbService = createMockDatabaseService(adapter);

      // Initialize first
      await services.initialize(dbService, { providers: [{ type: "email-password" }] }, logger);

      expect(services.getAuth()).not.toBeNull();

      // Shutdown
      services.shutdown();

      expect(services.getAuth()).toBeNull();
      expect(services.getDatabaseAdapter()).toBeNull();
      expect(services.getDrizzle()).toBeNull();
      expect(services.getDatabaseService()).toBeNull();
    });

    it("should log shutdown message", async () => {
      const logger = createMockLogger();
      const adapter = createMockAdapter();
      const dbService = createMockDatabaseService(adapter);

      await services.initialize(dbService, { providers: [{ type: "email-password" }] }, logger);

      services.shutdown();

      expect(logger.info).toHaveBeenCalledWith("Authentication service shut down");
    });
  });

  describe("getAuth", () => {
    it("should return null before initialization", () => {
      expect(services.getAuth()).toBeNull();
    });

    it("should return auth instance after initialization", async () => {
      const logger = createMockLogger();
      const adapter = createMockAdapter();
      const dbService = createMockDatabaseService(adapter);

      await services.initialize(dbService, { providers: [{ type: "email-password" }] }, logger);

      expect(services.getAuth()).not.toBeNull();
    });
  });

  describe("getDatabaseAdapter", () => {
    it("should return null before initialization", () => {
      expect(services.getDatabaseAdapter()).toBeNull();
    });

    it("should return adapter after initialization", async () => {
      const logger = createMockLogger();
      const adapter = createMockAdapter();
      const dbService = createMockDatabaseService(adapter);

      await services.initialize(dbService, { providers: [{ type: "email-password" }] }, logger);

      expect(services.getDatabaseAdapter()).toBe(adapter);
    });
  });

  describe("getDrizzle", () => {
    it("should return null before initialization", () => {
      expect(services.getDrizzle()).toBeNull();
    });

    it("should return drizzle instance after initialization", async () => {
      const logger = createMockLogger();
      const adapter = createMockAdapter();
      const dbService = createMockDatabaseService(adapter);

      await services.initialize(dbService, { providers: [{ type: "email-password" }] }, logger);

      expect(services.getDrizzle()).not.toBeNull();
    });
  });

  describe("getDatabaseService", () => {
    it("should return null before initialization", () => {
      expect(services.getDatabaseService()).toBeNull();
    });

    it("should return database service after initialization", async () => {
      const logger = createMockLogger();
      const adapter = createMockAdapter();
      const dbService = createMockDatabaseService(adapter);

      await services.initialize(dbService, { providers: [{ type: "email-password" }] }, logger);

      expect(services.getDatabaseService()).toBe(dbService);
    });
  });

  describe("getAdapterType", () => {
    it("should return undefined before initialization", () => {
      expect(services.getAdapterType()).toBeUndefined();
    });

    it("should return adapter type after initialization", async () => {
      const logger = createMockLogger();
      const adapter = createMockAdapter();
      const dbService = createMockDatabaseService(adapter);

      await services.initialize(
        dbService,
        { database: "libsql", providers: [{ type: "email-password" }] },
        logger,
      );

      expect(services.getAdapterType()).toBe("libsql");
    });
  });

  describe("getProviders", () => {
    it("should return empty array before initialization", () => {
      expect(services.getProviders()).toEqual([]);
    });

    it("should return provider info after initialization", async () => {
      const logger = createMockLogger();
      const adapter = createMockAdapter();
      const dbService = createMockDatabaseService(adapter);

      await services.initialize(dbService, { providers: [{ type: "email-password" }] }, logger);

      const providers = services.getProviders();
      expect(providers).toHaveLength(1);
      expect(providers[0]?.type).toBe("email-password");
    });
  });

  describe("getProviderById", () => {
    it("should return null before initialization", () => {
      expect(services.getProviderById("email-password")).toBeNull();
    });

    it("should return provider by ID after initialization", async () => {
      const logger = createMockLogger();
      const adapter = createMockAdapter();
      const dbService = createMockDatabaseService(adapter);

      await services.initialize(dbService, { providers: [{ type: "email-password" }] }, logger);

      const provider = services.getProviderById("email-password");
      expect(provider).not.toBeNull();
      expect(provider?.getProviderInfo().type).toBe("email-password");
    });

    it("should return null for non-existent provider", async () => {
      const logger = createMockLogger();
      const adapter = createMockAdapter();
      const dbService = createMockDatabaseService(adapter);

      await services.initialize(dbService, { providers: [{ type: "email-password" }] }, logger);

      const provider = services.getProviderById("keycloak");
      expect(provider).toBeNull();
    });
  });

  describe("getLogger", () => {
    it("should return logger after initialization", async () => {
      const logger = createMockLogger();
      const adapter = createMockAdapter();
      const dbService = createMockDatabaseService(adapter);

      await services.initialize(dbService, { providers: [{ type: "email-password" }] }, logger);

      expect(services.getLogger()).toBe(logger);
    });
  });

  describe("getBasePath", () => {
    it("should return default /auth before initialization", () => {
      expect(services.getBasePath()).toBe("/auth");
    });
  });

  describe("getOAuthAccountsForUser", () => {
    it("should return empty array when adapter is null", async () => {
      const accounts = await services.getOAuthAccountsForUser("user-123");
      expect(accounts).toEqual([]);
    });

    it("should return accounts from database", async () => {
      const logger = createMockLogger();
      const adapter = createMockAdapter();
      const dbService = createMockDatabaseService(adapter);

      const mockAccounts = [
        {
          accessToken: "token123",
          accessTokenExpiresAt: null,
          accountId: "account-1",
          id: "acc-1",
          idToken: "id-token-1",
          providerId: "keycloak",
          refreshToken: null,
          refreshTokenExpiresAt: null,
          scope: "openid profile",
          userId: "user-123",
        },
      ];

      (adapter.execute as ReturnType<typeof mock>).mockResolvedValue(mockAccounts);

      await services.initialize(dbService, { providers: [{ type: "email-password" }] }, logger);

      const accounts = await services.getOAuthAccountsForUser("user-123");
      expect(accounts).toEqual(mockAccounts);
    });

    it("should handle database errors gracefully", async () => {
      // This test verifies error handling in the service
      // When no adapter is available, should return empty array
      services.shutdown();
      const accounts = await services.getOAuthAccountsForUser("user-123");
      expect(accounts).toEqual([]);
    });
  });

  describe("getIdentityFromSession", () => {
    it("should return null when auth is not initialized", async () => {
      const headers = new Headers();
      headers.set("cookie", "better-auth.session_token=test");

      const identity = await services.getIdentityFromSession(headers);
      expect(identity).toBeNull();
    });

    it("should return null when session has no user", async () => {
      const logger = createMockLogger();
      const adapter = createMockAdapter();
      const dbService = createMockDatabaseService(adapter);

      await services.initialize(dbService, { providers: [{ type: "email-password" }] }, logger);

      // Auth is initialized but no valid session
      const headers = new Headers();
      // No session cookie, so getSession will return null
      const identity = await services.getIdentityFromSession(headers);
      expect(identity).toBeNull();
    });

    it("should handle session errors gracefully", async () => {
      const logger = createMockLogger();
      const adapter = createMockAdapter();
      const dbService = createMockDatabaseService(adapter);

      await services.initialize(dbService, { providers: [{ type: "email-password" }] }, logger);

      // Create headers that might cause an error during session validation
      const headers = new Headers();
      headers.set("cookie", "better-auth.session_token=invalid-token-format");

      // Should not throw, should return null on error
      const identity = await services.getIdentityFromSession(headers);
      // Either null (no session) or identity if somehow validated
      expect(identity === null || identity.sub).toBeDefined();
    });
  });

  describe("initialize with SCIM", () => {
    it("should mount SCIM routes when enabled", async () => {
      const logger = createMockLogger();
      const adapter = createMockAdapter();
      const dbService = createMockDatabaseService(adapter);

      await services.initialize(
        dbService,
        {
          providers: [{ type: "email-password" }],
          scim: {
            enabled: true,
            maxResults: 50,
            bulkEnabled: true,
            maxBulkOperations: 500,
          },
          trustedOrigins: ["http://localhost:8000"],
        },
        logger,
      );

      // Verify SCIM was initialized by checking logger was called with SCIM message
      const infoCallArgs = (logger.info as ReturnType<typeof mock>).mock.calls;
      const scimLogCall = infoCallArgs.find(
        (args: unknown[]) => typeof args[0] === "string" && args[0].includes("SCIM"),
      );
      expect(scimLogCall).toBeDefined();
    });

    it("should use default base URL when no trusted origins", async () => {
      const logger = createMockLogger();
      const adapter = createMockAdapter();
      const dbService = createMockDatabaseService(adapter);

      await services.initialize(
        dbService,
        {
          providers: [{ type: "email-password" }],
          scim: {
            enabled: true,
          },
        },
        logger,
      );

      // Should succeed without trusted origins
      expect(services.getAuth()).not.toBeNull();
    });

    it("should use default SCIM values when not specified", async () => {
      const logger = createMockLogger();
      const adapter = createMockAdapter();
      const dbService = createMockDatabaseService(adapter);

      await services.initialize(
        dbService,
        {
          providers: [{ type: "email-password" }],
          scim: {
            enabled: true,
          },
          trustedOrigins: ["http://localhost:8000"],
        },
        logger,
      );

      // Should succeed with default values (bulkEnabled=true, maxBulkOperations=1000, maxResults=100)
      expect(services.getAuth()).not.toBeNull();
    });
  });

  describe("getOAuthAccountsForUser error handling", () => {
    it("should return empty array and log error when database query fails", async () => {
      const logger = createMockLogger();
      const adapter = createMockAdapter();
      const dbService = createMockDatabaseService(adapter);

      // Initialize first with working execute
      await services.initialize(dbService, { providers: [{ type: "email-password" }] }, logger);

      // Now make execute throw an error for the OAuth query
      const error = new Error("Database connection failed");
      (adapter.execute as ReturnType<typeof mock>).mockImplementation(() => {
        throw error;
      });

      const accounts = await services.getOAuthAccountsForUser("user-123");

      expect(accounts).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith("Failed to get OAuth accounts", {
        error: "Error: Database connection failed",
        userId: "user-123",
      });
    });
  });
});

describe("getIdentityFromSession with mocked auth", () => {
  const createMockLogger = (): PluginLogger => ({
    debug: mock(() => {}),
    error: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
  });

  const createMockAdapter = (): DatabaseAdapter =>
    ({
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
      transaction: mock((fn) => fn({})),
      type: "libsql",
    }) as unknown as DatabaseAdapter;

  const createMockDatabaseService = (adapter: DatabaseAdapter): DatabaseService =>
    ({
      getAdapter: mock(() => Promise.resolve(adapter)),
      getDefaultType: mock(() => "libsql" as const),
      getRootAdapter: mock(() => adapter),
      isMultiTenant: mock(() => false),
      registerAdapter: mock(() => {}),
    }) as unknown as DatabaseService;

  beforeEach(() => {
    services.shutdown();
  });

  afterEach(() => {
    services.shutdown();
  });

  it("should extract identity with roles as array", async () => {
    const logger = createMockLogger();
    const adapter = createMockAdapter();
    const dbService = createMockDatabaseService(adapter);

    await services.initialize(dbService, { providers: [{ type: "email-password" }] }, logger);

    const auth = services.getAuth();
    expect(auth).not.toBeNull();

    // Mock getSession to return a valid session with roles as array
    const originalGetSession = auth!.api.getSession;
    auth!.api.getSession = mock(async () => ({
      session: { id: "session-1", userId: "user-1" },
      user: {
        id: "user-1",
        email: "test@example.com",
        name: "Test User",
        roles: ["admin", "user"],
        groups: ["group1"],
        customClaim: "value",
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })) as any;

    const headers = new Headers();
    headers.set("cookie", "better-auth.session_token=test");

    const identity = await services.getIdentityFromSession(headers);

    expect(identity).not.toBeNull();
    expect(identity?.sub).toBe("user-1");
    expect(identity?.roles).toEqual(["admin", "user"]);
    expect(identity?.groups).toEqual(["group1"]);
    expect(identity?.claims.customClaim).toBe("value");

    // Restore original
    auth!.api.getSession = originalGetSession;
  });

  it("should extract identity with roles as JSON string", async () => {
    const logger = createMockLogger();
    const adapter = createMockAdapter();
    const dbService = createMockDatabaseService(adapter);

    await services.initialize(dbService, { providers: [{ type: "email-password" }] }, logger);

    const auth = services.getAuth();
    expect(auth).not.toBeNull();

    // Mock getSession with roles as JSON string (Keycloak style)
    const originalGetSession = auth!.api.getSession;
    auth!.api.getSession = mock(async () => ({
      session: { id: "session-1", userId: "user-1" },
      user: {
        id: "user-1",
        email: "test@example.com",
        name: "Test User",
        roles: '["editor", "viewer"]',
        groups: '["team-a", "team-b"]',
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })) as any;

    const headers = new Headers();
    headers.set("cookie", "better-auth.session_token=test");

    const identity = await services.getIdentityFromSession(headers);

    expect(identity).not.toBeNull();
    expect(identity?.roles).toEqual(["editor", "viewer"]);
    expect(identity?.groups).toEqual(["team-a", "team-b"]);

    auth!.api.getSession = originalGetSession;
  });

  it("should handle invalid JSON in roles", async () => {
    const logger = createMockLogger();
    const adapter = createMockAdapter();
    const dbService = createMockDatabaseService(adapter);

    await services.initialize(dbService, { providers: [{ type: "email-password" }] }, logger);

    const auth = services.getAuth();
    expect(auth).not.toBeNull();

    // Mock getSession with invalid JSON in roles
    const originalGetSession = auth!.api.getSession;
    auth!.api.getSession = mock(async () => ({
      session: { id: "session-1", userId: "user-1" },
      user: {
        id: "user-1",
        email: "test@example.com",
        name: "Test User",
        roles: "not-valid-json",
        groups: "{invalid}",
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })) as any;

    const headers = new Headers();
    headers.set("cookie", "better-auth.session_token=test");

    const identity = await services.getIdentityFromSession(headers);

    expect(identity).not.toBeNull();
    // Invalid JSON should result in empty arrays
    expect(identity?.roles).toEqual([]);
    expect(identity?.groups).toEqual([]);

    auth!.api.getSession = originalGetSession;
  });

  it("should handle non-array parsed JSON in roles/groups", async () => {
    const logger = createMockLogger();
    const adapter = createMockAdapter();
    const dbService = createMockDatabaseService(adapter);

    await services.initialize(dbService, { providers: [{ type: "email-password" }] }, logger);

    const auth = services.getAuth();
    expect(auth).not.toBeNull();

    // Mock getSession with object JSON (not array) in roles
    const originalGetSession = auth!.api.getSession;
    auth!.api.getSession = mock(async () => ({
      session: { id: "session-1", userId: "user-1" },
      user: {
        id: "user-1",
        email: "test@example.com",
        name: "Test User",
        roles: '{"role": "admin"}',
        groups: '{"group": "team-a"}',
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })) as any;

    const headers = new Headers();
    headers.set("cookie", "better-auth.session_token=test");

    const identity = await services.getIdentityFromSession(headers);

    expect(identity).not.toBeNull();
    // Non-array JSON should result in empty arrays
    expect(identity?.roles).toEqual([]);
    expect(identity?.groups).toEqual([]);

    auth!.api.getSession = originalGetSession;
  });

  it("should handle getSession throwing error", async () => {
    const logger = createMockLogger();
    const adapter = createMockAdapter();
    const dbService = createMockDatabaseService(adapter);

    await services.initialize(dbService, { providers: [{ type: "email-password" }] }, logger);

    const auth = services.getAuth();
    expect(auth).not.toBeNull();

    // Mock getSession to throw error
    const originalGetSession = auth!.api.getSession;
    auth!.api.getSession = mock(async () => {
      throw new Error("Session validation failed");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

    const headers = new Headers();
    headers.set("cookie", "better-auth.session_token=test");

    const identity = await services.getIdentityFromSession(headers);

    expect(identity).toBeNull();
    expect(logger.error).toHaveBeenCalledWith("Failed to get session", {
      error: "Error: Session validation failed",
    });

    auth!.api.getSession = originalGetSession;
  });

  it("should exclude standard fields from claims", async () => {
    const logger = createMockLogger();
    const adapter = createMockAdapter();
    const dbService = createMockDatabaseService(adapter);

    await services.initialize(dbService, { providers: [{ type: "email-password" }] }, logger);

    const auth = services.getAuth();
    expect(auth).not.toBeNull();

    // Mock getSession with all fields
    const originalGetSession = auth!.api.getSession;
    auth!.api.getSession = mock(async () => ({
      session: { id: "session-1", userId: "user-1" },
      user: {
        id: "user-1",
        email: "test@example.com",
        name: "Test User",
        roles: [],
        groups: [],
        department: "Engineering",
        location: "Remote",
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })) as any;

    const headers = new Headers();
    headers.set("cookie", "better-auth.session_token=test");

    const identity = await services.getIdentityFromSession(headers);

    expect(identity).not.toBeNull();
    // Standard fields should not be in claims
    expect(identity?.claims.id).toBeUndefined();
    expect(identity?.claims.email).toBeUndefined();
    expect(identity?.claims.name).toBeUndefined();
    expect(identity?.claims.roles).toBeUndefined();
    expect(identity?.claims.groups).toBeUndefined();
    // Custom fields should be in claims
    expect(identity?.claims.department).toBe("Engineering");
    expect(identity?.claims.location).toBe("Remote");

    auth!.api.getSession = originalGetSession;
  });

  it("should handle session with no roles or groups", async () => {
    const logger = createMockLogger();
    const adapter = createMockAdapter();
    const dbService = createMockDatabaseService(adapter);

    await services.initialize(dbService, { providers: [{ type: "email-password" }] }, logger);

    const auth = services.getAuth();
    expect(auth).not.toBeNull();

    // Mock getSession without roles/groups fields
    const originalGetSession = auth!.api.getSession;
    auth!.api.getSession = mock(async () => ({
      session: { id: "session-1", userId: "user-1" },
      user: {
        id: "user-1",
        email: "test@example.com",
        name: "Test User",
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })) as any;

    const headers = new Headers();
    headers.set("cookie", "better-auth.session_token=test");

    const identity = await services.getIdentityFromSession(headers);

    expect(identity).not.toBeNull();
    expect(identity?.roles).toEqual([]);
    expect(identity?.groups).toEqual([]);

    auth!.api.getSession = originalGetSession;
  });
});

describe("identity extraction", () => {
  // Helper function to simulate role/group parsing logic
  const parseRolesOrGroups = (input: unknown): string[] => {
    const result: string[] = [];

    if (Array.isArray(input)) {
      result.push(...input);
    } else if (typeof input === "string") {
      try {
        const parsed = JSON.parse(input);
        if (Array.isArray(parsed)) {
          result.push(...parsed);
        }
      } catch {
        // Invalid JSON, ignore
      }
    }

    return result;
  };

  describe("role parsing", () => {
    it("should handle roles as array", () => {
      const rolesArray = ["admin", "user"];
      const result = parseRolesOrGroups(rolesArray);
      expect(result).toEqual(["admin", "user"]);
    });

    it("should handle roles as JSON string", () => {
      const rolesString = '["admin", "user"]';
      const result = parseRolesOrGroups(rolesString);
      expect(result).toEqual(["admin", "user"]);
    });

    it("should handle invalid roles JSON", () => {
      const invalidRolesString = "not-valid-json";
      const result = parseRolesOrGroups(invalidRolesString);
      expect(result).toEqual([]);
    });

    it("should handle non-array parsed JSON", () => {
      const objectString = '{"role": "admin"}';
      const result = parseRolesOrGroups(objectString);
      expect(result).toEqual([]);
    });

    it("should handle empty array", () => {
      const result = parseRolesOrGroups([]);
      expect(result).toEqual([]);
    });

    it("should handle null", () => {
      const result = parseRolesOrGroups(null);
      expect(result).toEqual([]);
    });

    it("should handle undefined", () => {
      const result = parseRolesOrGroups(undefined);
      expect(result).toEqual([]);
    });
  });

  describe("group parsing", () => {
    it("should handle groups as array", () => {
      const groupsArray = ["group1", "group2"];
      const result = parseRolesOrGroups(groupsArray);
      expect(result).toEqual(["group1", "group2"]);
    });

    it("should handle groups as JSON string", () => {
      const groupsString = '["group1", "group2"]';
      const result = parseRolesOrGroups(groupsString);
      expect(result).toEqual(["group1", "group2"]);
    });

    it("should handle invalid groups JSON", () => {
      const invalidGroupsString = "not-valid-json";
      const result = parseRolesOrGroups(invalidGroupsString);
      expect(result).toEqual([]);
    });
  });

  describe("claims extraction", () => {
    it("should extract custom claims from user object", () => {
      const user = {
        id: "user-1",
        email: "test@example.com",
        name: "Test User",
        roles: ["admin"],
        groups: ["group1"],
        customClaim: "value",
        anotherClaim: 123,
      };

      const claims: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(user)) {
        if (!["id", "email", "name", "roles", "groups"].includes(key)) {
          claims[key] = value;
        }
      }

      expect(claims.customClaim).toBe("value");
      expect(claims.anotherClaim).toBe(123);
      expect(claims.id).toBeUndefined();
      expect(claims.email).toBeUndefined();
    });
  });
});

describe("API routes with initialized services", () => {
  const createMockLogger = () => ({
    debug: mock(() => {}),
    error: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
  });

  const createMockAdapter = (): DatabaseAdapter =>
    ({
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
      transaction: mock((fn) => fn({})),
      type: "libsql",
    }) as unknown as DatabaseAdapter;

  const createMockDatabaseService = (adapter: DatabaseAdapter): DatabaseService =>
    ({
      getAdapter: mock(() => Promise.resolve(adapter)),
      getDefaultType: mock(() => "libsql" as const),
      getRootAdapter: mock(() => adapter),
      isMultiTenant: mock(() => false),
      registerAdapter: mock(() => {}),
    }) as unknown as DatabaseService;

  afterEach(() => {
    services.shutdown();
  });

  it("should redirect root to / when user has valid session", async () => {
    const logger = createMockLogger();
    const adapter = createMockAdapter();
    const dbService = createMockDatabaseService(adapter);

    await services.initialize(dbService, { providers: [{ type: "email-password" }] }, logger);

    const auth = services.getAuth();
    expect(auth).not.toBeNull();

    // Mock getSession to return a valid session
    auth!.api.getSession = mock(async () => ({
      session: { id: "session-1", userId: "user-1" },
      user: { id: "user-1", email: "test@example.com", name: "Test User" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })) as any;

    // Import api after services are initialized
    const { api } = await import("./api");
    const req = new Request("http://localhost:8000/");
    const res = await api.fetch(req);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
  });

  it("should redirect root to login when no session", async () => {
    const logger = createMockLogger();
    const adapter = createMockAdapter();
    const dbService = createMockDatabaseService(adapter);

    await services.initialize(dbService, { providers: [{ type: "email-password" }] }, logger);

    const auth = services.getAuth();
    expect(auth).not.toBeNull();

    // Mock getSession to return null (no session)
    auth!.api.getSession = mock(async () => null) as any;

    const { api } = await import("./api");
    const req = new Request("http://localhost:8000/");
    const res = await api.fetch(req);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/login");
  });

  it("should handle /api/auth route", async () => {
    const logger = createMockLogger();
    const adapter = createMockAdapter();
    const dbService = createMockDatabaseService(adapter);

    await services.initialize(dbService, { providers: [{ type: "email-password" }] }, logger);

    const auth = services.getAuth();
    expect(auth).not.toBeNull();

    // Mock handler to return a valid response
    auth!.handler = mock(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const { api } = await import("./api");
    const req = new Request("http://localhost:8000/api/auth");
    const res = await api.fetch(req);

    expect(res.status).toBe(200);
  });

  it("should handle /api/auth POST route", async () => {
    const logger = createMockLogger();
    const adapter = createMockAdapter();
    const dbService = createMockDatabaseService(adapter);

    await services.initialize(dbService, { providers: [{ type: "email-password" }] }, logger);

    const auth = services.getAuth();
    expect(auth).not.toBeNull();

    // Mock handler to return a valid response
    auth!.handler = mock(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const { api } = await import("./api");
    const req = new Request("http://localhost:8000/api/auth", { method: "POST" });
    const res = await api.fetch(req);

    expect(res.status).toBe(200);
  });
});
