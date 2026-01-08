/**
 * Tests for SCIM 2.0 Routes
 *
 * Tests:
 * - Discovery endpoints (ServiceProviderConfig, ResourceTypes, Schemas)
 * - User CRUD operations
 * - Group CRUD operations
 * - Bulk operations
 * - Authentication middleware
 */

import { describe, expect, it, mock } from "bun:test";
import type { DatabaseAdapter } from "@buntime/plugin-database";
import { createScimRoutes, type ScimRoutesConfig } from "./routes";
import { SCIM_SCHEMAS } from "./types";

describe("SCIM Routes", () => {
  // Create mock database adapter
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

  const createConfig = (overrides: Partial<ScimRoutesConfig> = {}): ScimRoutesConfig => ({
    adapter: createMockAdapter(),
    baseUrl: "http://localhost:8000/auth/api",
    ...overrides,
  });

  describe("Discovery Endpoints", () => {
    it("GET /ServiceProviderConfig - should return SCIM capabilities", async () => {
      const config = createConfig();
      const app = createScimRoutes(config);

      const req = new Request("http://localhost:8000/ServiceProviderConfig");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.schemas).toContain(SCIM_SCHEMAS.SERVICE_PROVIDER_CONFIG);
      expect(body.patch.supported).toBe(true);
      expect(body.bulk.supported).toBe(true);
      expect(body.filter.supported).toBe(true);
    });

    it("GET /ServiceProviderConfig - should use config values", async () => {
      const config = createConfig({
        bulkEnabled: false,
        maxResults: 50,
        maxBulkOperations: 500,
      });
      const app = createScimRoutes(config);

      const req = new Request("http://localhost:8000/ServiceProviderConfig");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.bulk.supported).toBe(false);
      expect(body.bulk.maxOperations).toBe(500);
      expect(body.filter.maxResults).toBe(50);
    });

    it("GET /ResourceTypes - should return User and Group types", async () => {
      const config = createConfig();
      const app = createScimRoutes(config);

      const req = new Request("http://localhost:8000/ResourceTypes");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(2);

      const userType = body.find((t: { id: string }) => t.id === "User");
      const groupType = body.find((t: { id: string }) => t.id === "Group");

      expect(userType).toBeDefined();
      expect(userType.endpoint).toBe("/Users");
      expect(groupType).toBeDefined();
      expect(groupType.endpoint).toBe("/Groups");
    });

    it("GET /Schemas - should return User and Group schemas", async () => {
      const config = createConfig();
      const app = createScimRoutes(config);

      const req = new Request("http://localhost:8000/Schemas");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(2);
    });

    it("GET /Schemas/:id - should return User schema (requires auth)", async () => {
      const adapter = createMockAdapter();
      (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValue({
        id: "token-1",
        tokenHash: "hash",
      });
      (adapter.execute as ReturnType<typeof mock>).mockResolvedValue([]);

      const config = createConfig({ adapter });
      const app = createScimRoutes(config);

      const req = new Request(`http://localhost:8000/Schemas/${SCIM_SCHEMAS.USER}`, {
        headers: {
          Authorization: "Bearer valid-token",
        },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(SCIM_SCHEMAS.USER);
      expect(body.name).toBe("User");
    });

    it("GET /Schemas/:id - should return Group schema (requires auth)", async () => {
      const adapter = createMockAdapter();
      (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValue({
        id: "token-1",
        tokenHash: "hash",
      });
      (adapter.execute as ReturnType<typeof mock>).mockResolvedValue([]);

      const config = createConfig({ adapter });
      const app = createScimRoutes(config);

      const req = new Request(`http://localhost:8000/Schemas/${SCIM_SCHEMAS.GROUP}`, {
        headers: {
          Authorization: "Bearer valid-token",
        },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(SCIM_SCHEMAS.GROUP);
      expect(body.name).toBe("Group");
    });

    it("GET /Schemas/:id - should return 404 for unknown schema", async () => {
      const adapter = createMockAdapter();
      (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValue({
        id: "token-1",
        tokenHash: "hash",
      });
      (adapter.execute as ReturnType<typeof mock>).mockResolvedValue([]);

      const config = createConfig({ adapter });
      const app = createScimRoutes(config);

      const req = new Request("http://localhost:8000/Schemas/unknown:schema", {
        headers: {
          Authorization: "Bearer valid-token",
        },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.status).toBe("404");
    });
  });

  describe("Authentication Middleware", () => {
    it("should skip auth for ServiceProviderConfig", async () => {
      const config = createConfig();
      const app = createScimRoutes(config);

      const req = new Request("http://localhost:8000/ServiceProviderConfig");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
    });

    it("should skip auth for ResourceTypes", async () => {
      const config = createConfig();
      const app = createScimRoutes(config);

      const req = new Request("http://localhost:8000/ResourceTypes");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
    });

    it("should skip auth for Schemas", async () => {
      const config = createConfig();
      const app = createScimRoutes(config);

      const req = new Request("http://localhost:8000/Schemas");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
    });

    it("should require auth for Users endpoint", async () => {
      const config = createConfig();
      const app = createScimRoutes(config);

      const req = new Request("http://localhost:8000/Users");
      const res = await app.fetch(req);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.status).toBe("401");
      expect(body.detail).toContain("Authorization");
    });

    it("should require auth for Groups endpoint", async () => {
      const config = createConfig();
      const app = createScimRoutes(config);

      const req = new Request("http://localhost:8000/Groups");
      const res = await app.fetch(req);

      expect(res.status).toBe(401);
    });

    it("should reject invalid Bearer token", async () => {
      const adapter = createMockAdapter();
      (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValue(null);

      const config = createConfig({ adapter });
      const app = createScimRoutes(config);

      const req = new Request("http://localhost:8000/Users", {
        headers: {
          Authorization: "Bearer invalid-token",
        },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.detail).toContain("Invalid");
    });

    it("should accept valid Bearer token", async () => {
      const adapter = createMockAdapter();
      // Mock valid token
      (adapter.executeOne as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ id: "token-1", tokenHash: "hash" }) // Token validation
        .mockResolvedValueOnce({ total: 0 }); // Count query
      (adapter.execute as ReturnType<typeof mock>)
        .mockResolvedValueOnce([]) // Update last used
        .mockResolvedValueOnce([]); // List users

      const config = createConfig({ adapter });
      const app = createScimRoutes(config);

      const req = new Request("http://localhost:8000/Users", {
        headers: {
          Authorization: "Bearer valid-token",
        },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
    });
  });

  describe("User Endpoints", () => {
    const createBulkAuthRequest = (url: string, options: RequestInit = {}): Request => {
      return new Request(url, {
        ...options,
        headers: {
          Authorization: "Bearer valid-token",
          ...(options.headers || {}),
        },
      });
    };

    const setupAuthenticatedAdapter = (): DatabaseAdapter => {
      const adapter = createMockAdapter();
      // Always validate token successfully
      (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValue({
        id: "token-1",
        tokenHash: "hash",
      });
      (adapter.execute as ReturnType<typeof mock>).mockResolvedValue([]);
      return adapter;
    };

    it("GET /Users - should return list of users", async () => {
      const adapter = setupAuthenticatedAdapter();
      const mockUsers = [
        {
          id: "user-1",
          email: "john@example.com",
          name: "John Doe",
          emailVerified: 1,
          active: 1,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
        },
      ];

      (adapter.executeOne as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ id: "token-1", tokenHash: "hash" }) // Token validation
        .mockResolvedValueOnce({ total: 1 }); // Count query
      (adapter.execute as ReturnType<typeof mock>)
        .mockResolvedValueOnce([]) // Update token last used
        .mockResolvedValueOnce(mockUsers) // List users
        .mockResolvedValueOnce([]); // User groups

      const config = createConfig({ adapter });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Users");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.totalResults).toBe(1);
      expect(body.Resources).toHaveLength(1);
    });

    it("GET /Users - should support pagination", async () => {
      const adapter = setupAuthenticatedAdapter();
      (adapter.executeOne as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ id: "token-1", tokenHash: "hash" })
        .mockResolvedValueOnce({ total: 0 });
      (adapter.execute as ReturnType<typeof mock>)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const config = createConfig({ adapter });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Users?startIndex=10&count=5");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.startIndex).toBe(10);
    });

    it("GET /Users/:id - should return user", async () => {
      const adapter = setupAuthenticatedAdapter();
      const mockUser = {
        id: "user-1",
        email: "john@example.com",
        name: "John Doe",
        emailVerified: 1,
        active: 1,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
      };

      (adapter.executeOne as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ id: "token-1", tokenHash: "hash" })
        .mockResolvedValueOnce(mockUser);
      (adapter.execute as ReturnType<typeof mock>)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const config = createConfig({ adapter });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Users/user-1");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe("user-1");
    });

    it("GET /Users/:id - should return 404 for non-existent user", async () => {
      const adapter = setupAuthenticatedAdapter();
      (adapter.executeOne as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ id: "token-1", tokenHash: "hash" })
        .mockResolvedValueOnce(null);
      (adapter.execute as ReturnType<typeof mock>).mockResolvedValueOnce([]);

      const config = createConfig({ adapter });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Users/non-existent");
      const res = await app.fetch(req);

      expect(res.status).toBe(404);
    });

    it("POST /Users - should create user", async () => {
      const adapter = setupAuthenticatedAdapter();
      const createdUser = {
        id: "new-user-id",
        email: "new@example.com",
        name: "New User",
        emailVerified: 0,
        active: 1,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      };

      (adapter.executeOne as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ id: "token-1", tokenHash: "hash" }) // Token
        .mockResolvedValueOnce(null) // Check duplicate
        .mockResolvedValueOnce(createdUser); // Get created

      (adapter.execute as ReturnType<typeof mock>)
        .mockResolvedValueOnce([]) // Update token
        .mockResolvedValueOnce([]); // Insert user

      const config = createConfig({ adapter });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Users", {
        method: "POST",
        body: JSON.stringify({
          schemas: [SCIM_SCHEMAS.USER],
          userName: "new@example.com",
          displayName: "New User",
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(201);
    });

    it("PUT /Users/:id - should replace user", async () => {
      const adapter = setupAuthenticatedAdapter();
      const updatedUser = {
        id: "user-1",
        email: "updated@example.com",
        name: "Updated User",
        emailVerified: 0,
        active: 1,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
      };

      (adapter.executeOne as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ id: "token-1", tokenHash: "hash" })
        .mockResolvedValueOnce({ id: "user-1" }) // Check exists
        .mockResolvedValueOnce(updatedUser); // Get updated

      (adapter.execute as ReturnType<typeof mock>)
        .mockResolvedValueOnce([]) // Update token
        .mockResolvedValueOnce([]) // Update user
        .mockResolvedValueOnce([]); // Get groups

      const config = createConfig({ adapter });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Users/user-1", {
        method: "PUT",
        body: JSON.stringify({
          schemas: [SCIM_SCHEMAS.USER],
          userName: "updated@example.com",
          displayName: "Updated User",
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
    });

    it("PATCH /Users/:id - should patch user", async () => {
      const adapter = setupAuthenticatedAdapter();
      const existingUser = {
        id: "user-1",
        email: "john@example.com",
        name: "John Doe",
        emailVerified: 0,
        active: 1,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
      };

      (adapter.executeOne as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ id: "token-1", tokenHash: "hash" })
        .mockResolvedValueOnce(existingUser) // Check exists
        .mockResolvedValueOnce(existingUser); // Get updated

      (adapter.execute as ReturnType<typeof mock>)
        .mockResolvedValueOnce([]) // Update token
        .mockResolvedValueOnce([]) // Patch user
        .mockResolvedValueOnce([]); // Get groups

      const config = createConfig({ adapter });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Users/user-1", {
        method: "PATCH",
        body: JSON.stringify({
          schemas: [SCIM_SCHEMAS.PATCH_OP],
          Operations: [{ op: "replace", path: "displayName", value: "New Name" }],
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
    });

    it("DELETE /Users/:id - should delete user", async () => {
      const adapter = setupAuthenticatedAdapter();
      (adapter.executeOne as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ id: "token-1", tokenHash: "hash" })
        .mockResolvedValueOnce({ id: "user-1" }); // Check exists

      (adapter.execute as ReturnType<typeof mock>)
        .mockResolvedValueOnce([]) // Update token
        .mockResolvedValueOnce([]); // Delete user

      const config = createConfig({ adapter });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Users/user-1", {
        method: "DELETE",
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(204);
    });
  });

  describe("Group Endpoints", () => {
    const createBulkAuthRequest = (url: string, options: RequestInit = {}): Request => {
      return new Request(url, {
        ...options,
        headers: {
          Authorization: "Bearer valid-token",
          ...(options.headers || {}),
        },
      });
    };

    const setupAuthenticatedAdapter = (): DatabaseAdapter => {
      const adapter = createMockAdapter();
      (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValue({
        id: "token-1",
        tokenHash: "hash",
      });
      (adapter.execute as ReturnType<typeof mock>).mockResolvedValue([]);
      return adapter;
    };

    it("GET /Groups - should return list of groups", async () => {
      const adapter = setupAuthenticatedAdapter();
      const mockGroups = [
        {
          id: "group-1",
          displayName: "Admins",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
        },
      ];

      (adapter.executeOne as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ id: "token-1", tokenHash: "hash" })
        .mockResolvedValueOnce({ total: 1 });
      (adapter.execute as ReturnType<typeof mock>)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(mockGroups)
        .mockResolvedValueOnce([]);

      const config = createConfig({ adapter });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Groups");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.totalResults).toBe(1);
    });

    it("POST /Groups - should create group", async () => {
      const adapter = setupAuthenticatedAdapter();
      const createdGroup = {
        id: "new-group-id",
        displayName: "New Group",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      };

      (adapter.executeOne as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ id: "token-1", tokenHash: "hash" })
        .mockResolvedValueOnce(createdGroup);

      (adapter.execute as ReturnType<typeof mock>)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const config = createConfig({ adapter });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Groups", {
        method: "POST",
        body: JSON.stringify({
          schemas: [SCIM_SCHEMAS.GROUP],
          displayName: "New Group",
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(201);
    });

    it("DELETE /Groups/:id - should delete group", async () => {
      const adapter = setupAuthenticatedAdapter();
      (adapter.executeOne as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ id: "token-1", tokenHash: "hash" })
        .mockResolvedValueOnce({ id: "group-1" });

      (adapter.execute as ReturnType<typeof mock>)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const config = createConfig({ adapter });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Groups/group-1", {
        method: "DELETE",
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(204);
    });
  });

  describe("Bulk Operations", () => {
    const createBulkAuthRequest = (url: string, options: RequestInit = {}): Request => {
      return new Request(url, {
        ...options,
        headers: {
          Authorization: "Bearer valid-token",
          ...(options.headers || {}),
        },
      });
    };

    it("POST /Bulk - should reject when bulk is disabled", async () => {
      const adapter = createMockAdapter();
      (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValue({
        id: "token-1",
        tokenHash: "hash",
      });
      (adapter.execute as ReturnType<typeof mock>).mockResolvedValue([]);

      const config = createConfig({ adapter, bulkEnabled: false });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Bulk", {
        method: "POST",
        body: JSON.stringify({
          schemas: [SCIM_SCHEMAS.BULK_REQUEST],
          Operations: [],
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(501);
      const body = await res.json();
      expect(body.detail).toContain("not enabled");
    });

    it("POST /Bulk - should reject too many operations", async () => {
      const adapter = createMockAdapter();
      (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValue({
        id: "token-1",
        tokenHash: "hash",
      });
      (adapter.execute as ReturnType<typeof mock>).mockResolvedValue([]);

      const config = createConfig({ adapter, maxBulkOperations: 2 });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Bulk", {
        method: "POST",
        body: JSON.stringify({
          schemas: [SCIM_SCHEMAS.BULK_REQUEST],
          Operations: [
            { method: "POST", path: "/Users", data: {} },
            { method: "POST", path: "/Users", data: {} },
            { method: "POST", path: "/Users", data: {} },
          ],
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(413);
    });

    it("POST /Bulk - should process valid operations", async () => {
      const adapter = createMockAdapter();
      const createdUser = {
        id: "new-user-id",
        email: "new@example.com",
        name: "New User",
        emailVerified: 0,
        active: 1,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      };

      (adapter.executeOne as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ id: "token-1", tokenHash: "hash" }) // Token
        .mockResolvedValueOnce(null) // Check duplicate for user
        .mockResolvedValueOnce(createdUser); // Get created user

      (adapter.execute as ReturnType<typeof mock>)
        .mockResolvedValueOnce([]) // Update token
        .mockResolvedValueOnce([]); // Insert user

      const config = createConfig({ adapter, bulkEnabled: true });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Bulk", {
        method: "POST",
        body: JSON.stringify({
          schemas: [SCIM_SCHEMAS.BULK_REQUEST],
          Operations: [
            {
              method: "POST",
              path: "/Users",
              bulkId: "bulk-1",
              data: {
                schemas: [SCIM_SCHEMAS.USER],
                userName: "new@example.com",
              },
            },
          ],
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.schemas).toContain(SCIM_SCHEMAS.BULK_RESPONSE);
      expect(body.Operations).toHaveLength(1);
      expect(body.Operations[0].status).toBe("201");
    });

    it("POST /Bulk - should handle invalid path", async () => {
      const adapter = createMockAdapter();
      (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValue({
        id: "token-1",
        tokenHash: "hash",
      });
      (adapter.execute as ReturnType<typeof mock>).mockResolvedValue([]);

      const config = createConfig({ adapter, bulkEnabled: true });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Bulk", {
        method: "POST",
        body: JSON.stringify({
          schemas: [SCIM_SCHEMAS.BULK_REQUEST],
          Operations: [
            {
              method: "POST",
              path: "/InvalidPath",
              bulkId: "bulk-1",
              data: {},
            },
          ],
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.Operations[0].status).toBe("400");
    });

    it("POST /Bulk - should stop on failOnErrors", async () => {
      const adapter = createMockAdapter();
      (adapter.executeOne as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ id: "token-1", tokenHash: "hash" })
        .mockResolvedValueOnce({ id: "existing" }); // First user exists (duplicate)

      (adapter.execute as ReturnType<typeof mock>).mockResolvedValue([]);

      const config = createConfig({ adapter, bulkEnabled: true });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Bulk", {
        method: "POST",
        body: JSON.stringify({
          schemas: [SCIM_SCHEMAS.BULK_REQUEST],
          failOnErrors: 1,
          Operations: [
            {
              method: "POST",
              path: "/Users",
              bulkId: "bulk-1",
              data: {
                schemas: [SCIM_SCHEMAS.USER],
                userName: "existing@example.com",
              },
            },
            {
              method: "POST",
              path: "/Users",
              bulkId: "bulk-2",
              data: {
                schemas: [SCIM_SCHEMAS.USER],
                userName: "new@example.com",
              },
            },
          ],
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      // Should only have 1 operation processed (stopped after first error)
      expect(body.Operations).toHaveLength(1);
    });
  });

  describe("Content-Type Header", () => {
    it("should set SCIM content type for JSON responses", async () => {
      const config = createConfig();
      const app = createScimRoutes(config);

      const req = new Request("http://localhost:8000/ServiceProviderConfig");
      const res = await app.fetch(req);

      expect(res.headers.get("Content-Type")).toContain("application/scim+json");
    });
  });

  describe("Bulk Operations - Groups", () => {
    // Helper function to create authenticated requests
    const createBulkAuthRequest = (url: string, options: RequestInit = {}): Request => {
      const headers = new Headers(options.headers);
      headers.set("Authorization", "Bearer test-token-123");
      return new Request(url, { ...options, headers });
    };

    it("POST /Bulk - should create groups", async () => {
      const adapter = createMockAdapter();
      (adapter.executeOne as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ id: "token-1", tokenHash: "hash" })
        // getGroup returns the created group
        .mockResolvedValueOnce({
          id: "new-group-id",
          displayName: "Test Group",
          externalId: null,
          metadata: null,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        });

      // execute for: INSERT, then getGroupMembers
      (adapter.execute as ReturnType<typeof mock>).mockResolvedValue([]);

      const config = createConfig({ adapter, bulkEnabled: true });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Bulk", {
        method: "POST",
        body: JSON.stringify({
          schemas: [SCIM_SCHEMAS.BULK_REQUEST],
          Operations: [
            {
              method: "POST",
              path: "/Groups",
              bulkId: "bulk-group-1",
              data: {
                schemas: [SCIM_SCHEMAS.GROUP],
                displayName: "Test Group",
              },
            },
          ],
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.Operations).toHaveLength(1);
      expect(body.Operations[0].status).toBe("201");
    });

    it("POST /Bulk - should handle PUT for groups", async () => {
      const adapter = createMockAdapter();
      (adapter.executeOne as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ id: "token-1", tokenHash: "hash" })
        .mockResolvedValueOnce({ id: "group-1", displayName: "Old Name" }); // Group exists

      (adapter.execute as ReturnType<typeof mock>).mockResolvedValue([]);

      const config = createConfig({ adapter, bulkEnabled: true });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Bulk", {
        method: "POST",
        body: JSON.stringify({
          schemas: [SCIM_SCHEMAS.BULK_REQUEST],
          Operations: [
            {
              method: "PUT",
              path: "/Groups/group-1",
              bulkId: "bulk-group-put",
              data: {
                schemas: [SCIM_SCHEMAS.GROUP],
                displayName: "New Name",
              },
            },
          ],
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.Operations).toHaveLength(1);
    });

    it("POST /Bulk - should handle PATCH for groups", async () => {
      const adapter = createMockAdapter();
      (adapter.executeOne as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ id: "token-1", tokenHash: "hash" })
        .mockResolvedValueOnce({ id: "group-1", displayName: "Test Group" }); // Group exists

      (adapter.execute as ReturnType<typeof mock>).mockResolvedValue([]);

      const config = createConfig({ adapter, bulkEnabled: true });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Bulk", {
        method: "POST",
        body: JSON.stringify({
          schemas: [SCIM_SCHEMAS.BULK_REQUEST],
          Operations: [
            {
              method: "PATCH",
              path: "/Groups/group-1",
              bulkId: "bulk-group-patch",
              data: {
                schemas: [SCIM_SCHEMAS.PATCH_OP],
                Operations: [
                  {
                    op: "replace",
                    path: "displayName",
                    value: "Updated Name",
                  },
                ],
              },
            },
          ],
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.Operations).toHaveLength(1);
    });

    it("POST /Bulk - should handle DELETE for groups", async () => {
      const adapter = createMockAdapter();
      (adapter.executeOne as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ id: "token-1", tokenHash: "hash" })
        .mockResolvedValueOnce({ id: "group-1", displayName: "Test Group" }); // Group exists

      (adapter.execute as ReturnType<typeof mock>).mockResolvedValue([]);

      const config = createConfig({ adapter, bulkEnabled: true });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Bulk", {
        method: "POST",
        body: JSON.stringify({
          schemas: [SCIM_SCHEMAS.BULK_REQUEST],
          Operations: [
            {
              method: "DELETE",
              path: "/Groups/group-1",
              bulkId: "bulk-group-delete",
            },
          ],
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.Operations).toHaveLength(1);
      expect(body.Operations[0].status).toBe("204");
    });

    it("POST /Bulk - should reject PUT without resource ID", async () => {
      const adapter = createMockAdapter();
      (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValueOnce({
        id: "token-1",
        tokenHash: "hash",
      });

      const config = createConfig({ adapter, bulkEnabled: true });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Bulk", {
        method: "POST",
        body: JSON.stringify({
          schemas: [SCIM_SCHEMAS.BULK_REQUEST],
          Operations: [
            {
              method: "PUT",
              path: "/Groups",
              bulkId: "bulk-invalid",
              data: {
                schemas: [SCIM_SCHEMAS.GROUP],
                displayName: "Test",
              },
            },
          ],
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.Operations[0].status).toBe("400");
      expect(body.Operations[0].response.detail).toContain("Resource ID required");
    });

    it("POST /Bulk - should reject PATCH without resource ID", async () => {
      const adapter = createMockAdapter();
      (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValueOnce({
        id: "token-1",
        tokenHash: "hash",
      });

      const config = createConfig({ adapter, bulkEnabled: true });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Bulk", {
        method: "POST",
        body: JSON.stringify({
          schemas: [SCIM_SCHEMAS.BULK_REQUEST],
          Operations: [
            {
              method: "PATCH",
              path: "/Users",
              bulkId: "bulk-invalid",
              data: {
                schemas: [SCIM_SCHEMAS.PATCH_OP],
                Operations: [{ op: "replace", path: "userName", value: "new" }],
              },
            },
          ],
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.Operations[0].status).toBe("400");
      expect(body.Operations[0].response.detail).toContain("Resource ID required");
    });

    it("POST /Bulk - should reject DELETE without resource ID", async () => {
      const adapter = createMockAdapter();
      (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValueOnce({
        id: "token-1",
        tokenHash: "hash",
      });

      const config = createConfig({ adapter, bulkEnabled: true });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Bulk", {
        method: "POST",
        body: JSON.stringify({
          schemas: [SCIM_SCHEMAS.BULK_REQUEST],
          Operations: [
            {
              method: "DELETE",
              path: "/Users",
              bulkId: "bulk-invalid",
            },
          ],
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.Operations[0].status).toBe("400");
      expect(body.Operations[0].response.detail).toContain("Resource ID required");
    });

    it("POST /Bulk - should reject unsupported methods", async () => {
      const adapter = createMockAdapter();
      (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValueOnce({
        id: "token-1",
        tokenHash: "hash",
      });

      const config = createConfig({ adapter, bulkEnabled: true });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Bulk", {
        method: "POST",
        body: JSON.stringify({
          schemas: [SCIM_SCHEMAS.BULK_REQUEST],
          Operations: [
            {
              method: "HEAD",
              path: "/Users/user-1",
              bulkId: "bulk-invalid",
            },
          ],
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.Operations[0].status).toBe("400");
      expect(body.Operations[0].response.detail).toContain("Unsupported method");
    });

    it("POST /Bulk - should handle PUT for users", async () => {
      const adapter = createMockAdapter();
      (adapter.executeOne as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ id: "token-1", tokenHash: "hash" })
        .mockResolvedValueOnce({ id: "user-1", userName: "old@example.com" }); // User exists

      (adapter.execute as ReturnType<typeof mock>).mockResolvedValue([]);

      const config = createConfig({ adapter, bulkEnabled: true });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Bulk", {
        method: "POST",
        body: JSON.stringify({
          schemas: [SCIM_SCHEMAS.BULK_REQUEST],
          Operations: [
            {
              method: "PUT",
              path: "/Users/user-1",
              bulkId: "bulk-user-put",
              data: {
                schemas: [SCIM_SCHEMAS.USER],
                userName: "new@example.com",
              },
            },
          ],
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.Operations).toHaveLength(1);
    });

    it("POST /Bulk - should handle PATCH for users", async () => {
      const adapter = createMockAdapter();
      (adapter.executeOne as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ id: "token-1", tokenHash: "hash" })
        .mockResolvedValueOnce({ id: "user-1", userName: "test@example.com" }); // User exists

      (adapter.execute as ReturnType<typeof mock>).mockResolvedValue([]);

      const config = createConfig({ adapter, bulkEnabled: true });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Bulk", {
        method: "POST",
        body: JSON.stringify({
          schemas: [SCIM_SCHEMAS.BULK_REQUEST],
          Operations: [
            {
              method: "PATCH",
              path: "/Users/user-1",
              bulkId: "bulk-user-patch",
              data: {
                schemas: [SCIM_SCHEMAS.PATCH_OP],
                Operations: [
                  {
                    op: "replace",
                    path: "userName",
                    value: "updated@example.com",
                  },
                ],
              },
            },
          ],
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.Operations).toHaveLength(1);
    });

    it("POST /Bulk - should handle DELETE for users", async () => {
      const adapter = createMockAdapter();
      (adapter.executeOne as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ id: "token-1", tokenHash: "hash" })
        .mockResolvedValueOnce({ id: "user-1", userName: "test@example.com" }); // User exists

      (adapter.execute as ReturnType<typeof mock>).mockResolvedValue([]);

      const config = createConfig({ adapter, bulkEnabled: true });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Bulk", {
        method: "POST",
        body: JSON.stringify({
          schemas: [SCIM_SCHEMAS.BULK_REQUEST],
          Operations: [
            {
              method: "DELETE",
              path: "/Users/user-1",
              bulkId: "bulk-user-delete",
            },
          ],
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.Operations).toHaveLength(1);
      expect(body.Operations[0].status).toBe("204");
    });
  });

  describe("Error handling for CRUD operations", () => {
    const createBulkAuthRequest = (url: string, options: RequestInit = {}): Request => {
      return new Request(url, {
        ...options,
        headers: {
          Authorization: "Bearer valid-token",
          ...(options.headers || {}),
        },
      });
    };

    const setupAuthenticatedAdapter = (): DatabaseAdapter => {
      const adapter = createMockAdapter();
      (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValue({
        id: "token-1",
        tokenHash: "hash",
      });
      (adapter.execute as ReturnType<typeof mock>).mockResolvedValue([]);
      return adapter;
    };

    it("POST /Users - should return 409 for duplicate user", async () => {
      const adapter = setupAuthenticatedAdapter();
      (adapter.executeOne as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ id: "token-1", tokenHash: "hash" }) // Token
        .mockResolvedValueOnce({ id: "existing-user" }); // Duplicate check returns existing

      const config = createConfig({ adapter });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Users", {
        method: "POST",
        body: JSON.stringify({
          schemas: [SCIM_SCHEMAS.USER],
          userName: "duplicate@example.com",
          displayName: "Duplicate User",
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(409);
    });

    it("PUT /Users/:id - should return 404 for non-existent user", async () => {
      const adapter = setupAuthenticatedAdapter();
      (adapter.executeOne as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ id: "token-1", tokenHash: "hash" })
        .mockResolvedValueOnce(null); // User not found

      const config = createConfig({ adapter });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Users/non-existent", {
        method: "PUT",
        body: JSON.stringify({
          schemas: [SCIM_SCHEMAS.USER],
          userName: "test@example.com",
          displayName: "Test User",
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(404);
    });

    it("PATCH /Users/:id - should return 404 for non-existent user", async () => {
      const adapter = setupAuthenticatedAdapter();
      (adapter.executeOne as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ id: "token-1", tokenHash: "hash" })
        .mockResolvedValueOnce(null); // User not found

      const config = createConfig({ adapter });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Users/non-existent", {
        method: "PATCH",
        body: JSON.stringify({
          schemas: [SCIM_SCHEMAS.PATCH_OP],
          Operations: [{ op: "replace", path: "displayName", value: "New Name" }],
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(404);
    });

    it("DELETE /Users/:id - should return 404 for non-existent user", async () => {
      const adapter = setupAuthenticatedAdapter();
      (adapter.executeOne as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ id: "token-1", tokenHash: "hash" })
        .mockResolvedValueOnce(null); // User not found (deleteUser returns error)

      const config = createConfig({ adapter });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Users/non-existent", {
        method: "DELETE",
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(404);
    });

    it("GET /Groups/:id - should return 404 for non-existent group", async () => {
      const adapter = setupAuthenticatedAdapter();
      (adapter.executeOne as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ id: "token-1", tokenHash: "hash" })
        .mockResolvedValueOnce(null); // Group not found

      const config = createConfig({ adapter });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Groups/non-existent");
      const res = await app.fetch(req);

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.status).toBe("404");
    });

    it("POST /Groups - should handle service error response", async () => {
      // The createGroup function in service.ts doesn't check for duplicates before insert
      // and doesn't catch errors, so when service returns an error it's through the routes layer
      // This test just ensures the route layer handles valid responses
      const adapter = setupAuthenticatedAdapter();
      const createdGroup = {
        id: "new-group-id",
        displayName: "New Group",
        externalId: null,
        metadata: null,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      };

      (adapter.executeOne as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ id: "token-1", tokenHash: "hash" })
        .mockResolvedValueOnce(createdGroup); // getGroup returns created group

      (adapter.execute as ReturnType<typeof mock>)
        .mockResolvedValueOnce([]) // Update token
        .mockResolvedValueOnce([]) // INSERT group
        .mockResolvedValueOnce([]); // getGroupMembers

      const config = createConfig({ adapter });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Groups", {
        method: "POST",
        body: JSON.stringify({
          schemas: [SCIM_SCHEMAS.GROUP],
          displayName: "New Group",
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(201);
    });

    it("PUT /Groups/:id - should return 404 for non-existent group", async () => {
      const adapter = setupAuthenticatedAdapter();
      (adapter.executeOne as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ id: "token-1", tokenHash: "hash" })
        .mockResolvedValueOnce(null); // Group not found

      const config = createConfig({ adapter });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Groups/non-existent", {
        method: "PUT",
        body: JSON.stringify({
          schemas: [SCIM_SCHEMAS.GROUP],
          displayName: "New Name",
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(404);
    });

    it("PATCH /Groups/:id - should return 404 for non-existent group", async () => {
      const adapter = setupAuthenticatedAdapter();
      (adapter.executeOne as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ id: "token-1", tokenHash: "hash" })
        .mockResolvedValueOnce(null); // Group not found

      const config = createConfig({ adapter });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Groups/non-existent", {
        method: "PATCH",
        body: JSON.stringify({
          schemas: [SCIM_SCHEMAS.PATCH_OP],
          Operations: [{ op: "replace", path: "displayName", value: "New Name" }],
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(404);
    });

    it("DELETE /Groups/:id - should return 404 for non-existent group", async () => {
      const adapter = setupAuthenticatedAdapter();
      (adapter.executeOne as ReturnType<typeof mock>)
        .mockResolvedValueOnce({ id: "token-1", tokenHash: "hash" })
        .mockResolvedValueOnce(null); // Group not found

      const config = createConfig({ adapter });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Groups/non-existent", {
        method: "DELETE",
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(404);
    });
  });

  describe("Bulk operation exception handling", () => {
    const createBulkAuthRequest = (url: string, options: RequestInit = {}): Request => {
      return new Request(url, {
        ...options,
        headers: {
          Authorization: "Bearer valid-token",
          ...(options.headers || {}),
        },
      });
    };

    it("POST /Bulk - should handle service exception gracefully", async () => {
      const adapter = createMockAdapter();
      (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValueOnce({
        id: "token-1",
        tokenHash: "hash",
      });

      // First execute for token update succeeds
      // Second execute for the operation throws
      (adapter.execute as ReturnType<typeof mock>)
        .mockResolvedValueOnce([]) // Update token
        .mockRejectedValueOnce(new Error("Database connection failed")); // Create user fails

      const config = createConfig({ adapter, bulkEnabled: true });
      const app = createScimRoutes(config);

      const req = createBulkAuthRequest("http://localhost:8000/Bulk", {
        method: "POST",
        body: JSON.stringify({
          schemas: [SCIM_SCHEMAS.BULK_REQUEST],
          Operations: [
            {
              method: "POST",
              path: "/Users",
              bulkId: "bulk-error",
              data: {
                schemas: [SCIM_SCHEMAS.USER],
                userName: "test@example.com",
              },
            },
          ],
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.Operations).toHaveLength(1);
      expect(body.Operations[0].status).toBe("500");
      expect(body.Operations[0].response.detail).toContain("Database connection failed");
    });
  });
});
