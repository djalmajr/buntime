/**
 * Tests for SCIM Service
 *
 * Tests:
 * - Token validation and management
 * - User operations (list, get, create, update, delete)
 * - Group operations (list, get, create, update, delete)
 * - Patch operations
 * - Error handling
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { DatabaseAdapter } from "@buntime/plugin-database";
import { ScimService, type ScimServiceConfig } from "./service";
import type { ScimGroup, ScimPatchOperation, ScimUser } from "./types";

describe("ScimService", () => {
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

  const createConfig = (overrides: Partial<ScimServiceConfig> = {}): ScimServiceConfig => ({
    baseUrl: "http://localhost:8000/auth/api",
    bulkEnabled: false,
    maxBulkOperations: 100,
    maxResults: 100,
    ...overrides,
  });

  let adapter: DatabaseAdapter;
  let service: ScimService;

  beforeEach(() => {
    adapter = createMockAdapter();
    service = new ScimService(adapter, createConfig());
  });

  describe("Token Management", () => {
    describe("validateToken", () => {
      it("should return false for invalid token", async () => {
        (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValueOnce(null);

        const result = await service.validateToken("invalid-token");
        expect(result).toBe(false);
      });

      it("should return true for valid token", async () => {
        const mockToken = {
          id: "token-123",
          name: "Test Token",
          tokenHash: "hashed-token",
          createdAt: "2024-01-01T00:00:00Z",
          lastUsedAt: null,
          expiresAt: null,
        };

        (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValueOnce(mockToken);
        (adapter.execute as ReturnType<typeof mock>).mockResolvedValueOnce([]);

        const result = await service.validateToken("valid-token");
        expect(result).toBe(true);
        expect(adapter.execute).toHaveBeenCalled();
      });
    });

    describe("createToken", () => {
      it("should create a new token", async () => {
        (adapter.execute as ReturnType<typeof mock>).mockResolvedValueOnce([]);

        const token = await service.createToken("Test Token");
        expect(token).toBeDefined();
        expect(token.length).toBe(64); // 32 bytes as hex
        expect(adapter.execute).toHaveBeenCalled();
      });

      it("should create a token with expiration", async () => {
        (adapter.execute as ReturnType<typeof mock>).mockResolvedValueOnce([]);

        const token = await service.createToken("Test Token", 30);
        expect(token).toBeDefined();
      });
    });

    describe("listTokens", () => {
      it("should return list of tokens", async () => {
        const mockTokens = [
          {
            id: "token-1",
            name: "Token 1",
            createdAt: "2024-01-01T00:00:00Z",
            lastUsedAt: null,
            expiresAt: null,
          },
          {
            id: "token-2",
            name: "Token 2",
            createdAt: "2024-01-02T00:00:00Z",
            lastUsedAt: "2024-01-03T00:00:00Z",
            expiresAt: "2025-01-02T00:00:00Z",
          },
        ];

        (adapter.execute as ReturnType<typeof mock>).mockResolvedValueOnce(mockTokens);

        const tokens = await service.listTokens();
        expect(tokens).toHaveLength(2);
        expect(tokens[0]?.name).toBe("Token 1");
      });
    });

    describe("deleteToken", () => {
      it("should delete a token", async () => {
        (adapter.execute as ReturnType<typeof mock>).mockResolvedValueOnce([]);

        const result = await service.deleteToken("token-123");
        expect(result).toBe(true);
        expect(adapter.execute).toHaveBeenCalled();
      });
    });
  });

  describe("User Operations", () => {
    describe("listUsers", () => {
      it("should return empty list when no users", async () => {
        (adapter.execute as ReturnType<typeof mock>).mockResolvedValueOnce([]);
        (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValueOnce({ total: 0 });

        const result = await service.listUsers();
        expect(result.totalResults).toBe(0);
        expect(result.Resources).toEqual([]);
      });

      it("should return list of users with correct SCIM format", async () => {
        const mockUsers = [
          {
            id: "user-1",
            email: "john@example.com",
            name: "John Doe",
            emailVerified: 1,
            image: null,
            active: 1,
            externalId: null,
            metadata: null,
            roles: null,
            groups: null,
            createdAt: "2024-01-01T00:00:00Z",
            updatedAt: "2024-01-02T00:00:00Z",
          },
        ];

        (adapter.execute as ReturnType<typeof mock>)
          .mockResolvedValueOnce(mockUsers) // Users query
          .mockResolvedValueOnce([]); // Groups query for user

        (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValueOnce({ total: 1 });

        const result = await service.listUsers();
        expect(result.totalResults).toBe(1);
        expect(result.Resources).toHaveLength(1);
        expect(result.Resources[0]?.userName).toBe("john@example.com");
      });

      it("should support pagination", async () => {
        (adapter.execute as ReturnType<typeof mock>).mockResolvedValueOnce([]);
        (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValueOnce({ total: 0 });

        const result = await service.listUsers({ startIndex: 10, count: 5 });
        expect(result.startIndex).toBe(10);
      });
    });

    describe("getUser", () => {
      it("should return 404 for non-existent user", async () => {
        (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValueOnce(null);

        const result = await service.getUser("non-existent");
        expect("status" in result).toBe(true);
        if ("status" in result) {
          expect(result.status).toBe("404");
        }
      });

      it("should return user in SCIM format", async () => {
        const mockUser = {
          id: "user-1",
          email: "john@example.com",
          name: "John Doe",
          emailVerified: 1,
          image: null,
          active: 1,
          externalId: null,
          metadata: null,
          roles: null,
          groups: null,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
        };

        (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValueOnce(mockUser);
        (adapter.execute as ReturnType<typeof mock>).mockResolvedValueOnce([]); // Groups

        const result = await service.getUser("user-1");
        expect("id" in result).toBe(true);
        if ("id" in result) {
          expect(result.id).toBe("user-1");
          expect(result.userName).toBe("john@example.com");
        }
      });
    });

    describe("createUser", () => {
      it("should return 409 for duplicate email", async () => {
        (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValueOnce({ id: "existing" });

        const scimUser: ScimUser = {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          userName: "john@example.com",
        };

        const result = await service.createUser(scimUser);
        expect("status" in result).toBe(true);
        if ("status" in result) {
          expect(result.status).toBe("409");
        }
      });

      it("should create a new user", async () => {
        const createdUser = {
          id: "new-user-id",
          email: "john@example.com",
          name: "John Doe",
          emailVerified: 0,
          image: null,
          active: 1,
          externalId: null,
          metadata: null,
          roles: null,
          groups: null,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        };

        (adapter.executeOne as ReturnType<typeof mock>)
          .mockResolvedValueOnce(null) // Check duplicate
          .mockResolvedValueOnce(createdUser); // Return created

        (adapter.execute as ReturnType<typeof mock>).mockResolvedValueOnce([]); // Insert

        const scimUser: ScimUser = {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          userName: "john@example.com",
          displayName: "John Doe",
        };

        const result = await service.createUser(scimUser);
        expect("id" in result).toBe(true);
        if ("id" in result) {
          expect(result.userName).toBe("john@example.com");
        }
      });

      it("should return 500 when creation fails", async () => {
        (adapter.executeOne as ReturnType<typeof mock>)
          .mockResolvedValueOnce(null) // Check duplicate
          .mockResolvedValueOnce(null); // Failed to fetch created

        (adapter.execute as ReturnType<typeof mock>).mockResolvedValueOnce([]); // Insert

        const scimUser: ScimUser = {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          userName: "john@example.com",
        };

        const result = await service.createUser(scimUser);
        expect("status" in result).toBe(true);
        if ("status" in result) {
          expect(result.status).toBe("500");
        }
      });
    });

    describe("replaceUser", () => {
      it("should return 404 for non-existent user", async () => {
        (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValueOnce(null);

        const scimUser: ScimUser = {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          userName: "john@example.com",
        };

        const result = await service.replaceUser("non-existent", scimUser);
        expect("status" in result).toBe(true);
        if ("status" in result) {
          expect(result.status).toBe("404");
        }
      });

      it("should replace user", async () => {
        const existingUser = { id: "user-1" };
        const updatedUser = {
          id: "user-1",
          email: "updated@example.com",
          name: "Updated Name",
          emailVerified: 0,
          image: null,
          active: 1,
          externalId: null,
          metadata: null,
          roles: null,
          groups: null,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
        };

        (adapter.executeOne as ReturnType<typeof mock>)
          .mockResolvedValueOnce(existingUser) // Check exists
          .mockResolvedValueOnce(updatedUser); // Get updated

        (adapter.execute as ReturnType<typeof mock>)
          .mockResolvedValueOnce([]) // Update
          .mockResolvedValueOnce([]); // Groups

        const scimUser: ScimUser = {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          userName: "updated@example.com",
          displayName: "Updated Name",
        };

        const result = await service.replaceUser("user-1", scimUser);
        expect("id" in result).toBe(true);
      });
    });

    describe("patchUser", () => {
      it("should return 404 for non-existent user", async () => {
        (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValueOnce(null);

        const operations: ScimPatchOperation[] = [
          { op: "replace", path: "displayName", value: "New Name" },
        ];

        const result = await service.patchUser("non-existent", operations);
        expect("status" in result).toBe(true);
        if ("status" in result) {
          expect(result.status).toBe("404");
        }
      });

      it("should apply patch operations", async () => {
        const existingUser = {
          id: "user-1",
          email: "john@example.com",
          name: "John Doe",
          emailVerified: 0,
          image: null,
          active: 1,
          externalId: null,
          metadata: null,
          roles: null,
          groups: null,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
        };

        (adapter.executeOne as ReturnType<typeof mock>)
          .mockResolvedValueOnce(existingUser) // Check exists
          .mockResolvedValueOnce(existingUser); // Get updated

        (adapter.execute as ReturnType<typeof mock>)
          .mockResolvedValueOnce([]) // Update
          .mockResolvedValueOnce([]); // Groups

        const operations: ScimPatchOperation[] = [
          { op: "replace", path: "displayName", value: "New Name" },
        ];

        const result = await service.patchUser("user-1", operations);
        expect("id" in result).toBe(true);
      });

      it("should apply add operation", async () => {
        const existingUser = {
          id: "user-1",
          email: "john@example.com",
          name: "John Doe",
          emailVerified: 0,
          image: null,
          active: 1,
          externalId: null,
          metadata: null,
          roles: null,
          groups: null,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
        };

        (adapter.executeOne as ReturnType<typeof mock>)
          .mockResolvedValueOnce(existingUser)
          .mockResolvedValueOnce(existingUser);

        (adapter.execute as ReturnType<typeof mock>)
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]);

        const operations: ScimPatchOperation[] = [
          { op: "add", path: "externalId", value: "ext-123" },
        ];

        const result = await service.patchUser("user-1", operations);
        expect("id" in result).toBe(true);
      });

      it("should apply remove operation", async () => {
        const existingUser = {
          id: "user-1",
          email: "john@example.com",
          name: "John Doe",
          emailVerified: 0,
          image: null,
          active: 1,
          externalId: "ext-123",
          metadata: null,
          roles: null,
          groups: null,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
        };

        (adapter.executeOne as ReturnType<typeof mock>)
          .mockResolvedValueOnce(existingUser)
          .mockResolvedValueOnce(existingUser);

        (adapter.execute as ReturnType<typeof mock>)
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]);

        const operations: ScimPatchOperation[] = [{ op: "remove", path: "externalId" }];

        const result = await service.patchUser("user-1", operations);
        expect("id" in result).toBe(true);
      });

      it("should apply replace without path (entire resource)", async () => {
        const existingUser = {
          id: "user-1",
          email: "john@example.com",
          name: "John Doe",
          emailVerified: 0,
          image: null,
          active: 1,
          externalId: null,
          metadata: null,
          roles: null,
          groups: null,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
        };

        (adapter.executeOne as ReturnType<typeof mock>)
          .mockResolvedValueOnce(existingUser)
          .mockResolvedValueOnce(existingUser);

        (adapter.execute as ReturnType<typeof mock>)
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]);

        const operations: ScimPatchOperation[] = [
          {
            op: "replace",
            value: { displayName: "New Name", active: false },
          },
        ];

        const result = await service.patchUser("user-1", operations);
        expect("id" in result).toBe(true);
      });
    });

    describe("deleteUser", () => {
      it("should return 404 for non-existent user", async () => {
        (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValueOnce(null);

        const result = await service.deleteUser("non-existent");
        expect(result).not.toBeNull();
        expect(result?.status).toBe("404");
      });

      it("should delete user", async () => {
        (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValueOnce({ id: "user-1" });
        (adapter.execute as ReturnType<typeof mock>).mockResolvedValueOnce([]);

        const result = await service.deleteUser("user-1");
        expect(result).toBeNull();
      });
    });
  });

  describe("Group Operations", () => {
    describe("listGroups", () => {
      it("should return empty list when no groups", async () => {
        (adapter.execute as ReturnType<typeof mock>).mockResolvedValueOnce([]);
        (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValueOnce({ total: 0 });

        const result = await service.listGroups();
        expect(result.totalResults).toBe(0);
        expect(result.Resources).toEqual([]);
      });

      it("should return list of groups", async () => {
        const mockGroups = [
          {
            id: "group-1",
            displayName: "Admins",
            externalId: null,
            metadata: null,
            createdAt: "2024-01-01T00:00:00Z",
            updatedAt: "2024-01-02T00:00:00Z",
          },
        ];

        (adapter.execute as ReturnType<typeof mock>)
          .mockResolvedValueOnce(mockGroups) // Groups query
          .mockResolvedValueOnce([]); // Members query

        (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValueOnce({ total: 1 });

        const result = await service.listGroups();
        expect(result.totalResults).toBe(1);
        expect(result.Resources).toHaveLength(1);
        expect(result.Resources[0]?.displayName).toBe("Admins");
      });
    });

    describe("getGroup", () => {
      it("should return 404 for non-existent group", async () => {
        (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValueOnce(null);

        const result = await service.getGroup("non-existent");
        expect("status" in result).toBe(true);
        if ("status" in result) {
          expect(result.status).toBe("404");
        }
      });

      it("should return group in SCIM format", async () => {
        const mockGroup = {
          id: "group-1",
          displayName: "Admins",
          externalId: null,
          metadata: null,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
        };

        (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValueOnce(mockGroup);
        (adapter.execute as ReturnType<typeof mock>).mockResolvedValueOnce([]); // Members

        const result = await service.getGroup("group-1");
        expect("id" in result).toBe(true);
        if ("id" in result) {
          expect(result.displayName).toBe("Admins");
        }
      });
    });

    describe("createGroup", () => {
      it("should create a new group", async () => {
        const createdGroup = {
          id: "new-group-id",
          displayName: "Editors",
          externalId: null,
          metadata: null,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        };

        (adapter.execute as ReturnType<typeof mock>)
          .mockResolvedValueOnce([]) // Insert
          .mockResolvedValueOnce([]); // Members

        (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValueOnce(createdGroup);

        const scimGroup: ScimGroup = {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
          displayName: "Editors",
        };

        const result = await service.createGroup(scimGroup);
        expect("id" in result).toBe(true);
        if ("id" in result) {
          expect(result.displayName).toBe("Editors");
        }
      });

      it("should create group with members", async () => {
        const createdGroup = {
          id: "new-group-id",
          displayName: "Editors",
          externalId: null,
          metadata: null,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        };

        (adapter.execute as ReturnType<typeof mock>)
          .mockResolvedValueOnce([]) // Insert group
          .mockResolvedValueOnce([]) // Add member 1
          .mockResolvedValueOnce([]); // Get members

        (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValueOnce(createdGroup);

        const scimGroup: ScimGroup = {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
          displayName: "Editors",
          members: [{ value: "user-1" }],
        };

        const result = await service.createGroup(scimGroup);
        expect("id" in result).toBe(true);
      });
    });

    describe("replaceGroup", () => {
      it("should return 404 for non-existent group", async () => {
        (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValueOnce(null);

        const scimGroup: ScimGroup = {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
          displayName: "Editors",
        };

        const result = await service.replaceGroup("non-existent", scimGroup);
        expect("status" in result).toBe(true);
        if ("status" in result) {
          expect(result.status).toBe("404");
        }
      });

      it("should replace group", async () => {
        const existingGroup = { id: "group-1" };
        const updatedGroup = {
          id: "group-1",
          displayName: "Updated Admins",
          externalId: null,
          metadata: null,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
        };

        (adapter.executeOne as ReturnType<typeof mock>)
          .mockResolvedValueOnce(existingGroup) // Check exists
          .mockResolvedValueOnce(updatedGroup); // Get updated

        (adapter.execute as ReturnType<typeof mock>)
          .mockResolvedValueOnce([]) // Update
          .mockResolvedValueOnce([]) // Delete old members
          .mockResolvedValueOnce([]); // Get members

        const scimGroup: ScimGroup = {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
          displayName: "Updated Admins",
        };

        const result = await service.replaceGroup("group-1", scimGroup);
        expect("id" in result).toBe(true);
      });
    });

    describe("patchGroup", () => {
      it("should return 404 for non-existent group", async () => {
        (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValueOnce(null);

        const operations: ScimPatchOperation[] = [
          { op: "replace", path: "displayName", value: "New Name" },
        ];

        const result = await service.patchGroup("non-existent", operations);
        expect("status" in result).toBe(true);
        if ("status" in result) {
          expect(result.status).toBe("404");
        }
      });

      it("should apply patch operations", async () => {
        const existingGroup = {
          id: "group-1",
          displayName: "Admins",
          externalId: null,
          metadata: null,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
        };

        (adapter.executeOne as ReturnType<typeof mock>)
          .mockResolvedValueOnce(existingGroup)
          .mockResolvedValueOnce(existingGroup);

        (adapter.execute as ReturnType<typeof mock>)
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]);

        const operations: ScimPatchOperation[] = [
          { op: "replace", path: "displayName", value: "New Name" },
        ];

        const result = await service.patchGroup("group-1", operations);
        expect("id" in result).toBe(true);
      });

      it("should handle members add operation", async () => {
        const existingGroup = {
          id: "group-1",
          displayName: "Admins",
          externalId: null,
          metadata: null,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
        };

        (adapter.executeOne as ReturnType<typeof mock>)
          .mockResolvedValueOnce(existingGroup)
          .mockResolvedValueOnce(existingGroup);

        (adapter.execute as ReturnType<typeof mock>)
          .mockResolvedValueOnce([]) // Add member
          .mockResolvedValueOnce([]); // Get members

        const operations: ScimPatchOperation[] = [
          { op: "add", path: "members", value: [{ value: "user-1" }] },
        ];

        const result = await service.patchGroup("group-1", operations);
        expect("id" in result).toBe(true);
      });

      it("should handle members remove operation", async () => {
        const existingGroup = {
          id: "group-1",
          displayName: "Admins",
          externalId: null,
          metadata: null,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
        };

        (adapter.executeOne as ReturnType<typeof mock>)
          .mockResolvedValueOnce(existingGroup)
          .mockResolvedValueOnce(existingGroup);

        (adapter.execute as ReturnType<typeof mock>)
          .mockResolvedValueOnce([]) // Remove all members
          .mockResolvedValueOnce([]); // Get members

        const operations: ScimPatchOperation[] = [{ op: "remove", path: "members" }];

        const result = await service.patchGroup("group-1", operations);
        expect("id" in result).toBe(true);
      });

      it("should handle specific member remove operation", async () => {
        const existingGroup = {
          id: "group-1",
          displayName: "Admins",
          externalId: null,
          metadata: null,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
        };

        (adapter.executeOne as ReturnType<typeof mock>)
          .mockResolvedValueOnce(existingGroup)
          .mockResolvedValueOnce(existingGroup);

        (adapter.execute as ReturnType<typeof mock>)
          .mockResolvedValueOnce([]) // Remove specific member
          .mockResolvedValueOnce([]); // Get members

        const operations: ScimPatchOperation[] = [
          { op: "remove", path: 'members[value eq "user-1"]' },
        ];

        const result = await service.patchGroup("group-1", operations);
        expect("id" in result).toBe(true);
      });

      it("should handle members replace operation", async () => {
        const existingGroup = {
          id: "group-1",
          displayName: "Admins",
          externalId: null,
          metadata: null,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
        };

        (adapter.executeOne as ReturnType<typeof mock>)
          .mockResolvedValueOnce(existingGroup)
          .mockResolvedValueOnce(existingGroup);

        (adapter.execute as ReturnType<typeof mock>)
          .mockResolvedValueOnce([]) // Delete all members
          .mockResolvedValueOnce([]) // Add new member
          .mockResolvedValueOnce([]); // Get members

        const operations: ScimPatchOperation[] = [
          { op: "replace", path: "members", value: [{ value: "user-2" }] },
        ];

        const result = await service.patchGroup("group-1", operations);
        expect("id" in result).toBe(true);
      });
    });

    describe("deleteGroup", () => {
      it("should return 404 for non-existent group", async () => {
        (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValueOnce(null);

        const result = await service.deleteGroup("non-existent");
        expect(result).not.toBeNull();
        expect(result?.status).toBe("404");
      });

      it("should delete group", async () => {
        (adapter.executeOne as ReturnType<typeof mock>).mockResolvedValueOnce({ id: "group-1" });
        (adapter.execute as ReturnType<typeof mock>).mockResolvedValueOnce([]);

        const result = await service.deleteGroup("group-1");
        expect(result).toBeNull();
      });
    });
  });
});
