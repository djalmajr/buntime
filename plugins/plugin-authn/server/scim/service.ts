/**
 * SCIM Service
 *
 * Business logic for SCIM 2.0 operations
 */

import type { DatabaseAdapter } from "@buntime/plugin-database";
import { buildListQuery, type QueryOptions } from "./filter";
import {
  dbGroupsToScimGroupMemberships,
  dbGroupToScimGroup,
  dbMembersToScimMembers,
  dbUserToScimUser,
  getScimGroupUpdateFields,
  getScimUserUpdateFields,
  scimGroupToDbGroup,
  scimUserToDbUser,
} from "./mapper";
import type {
  DbGroup,
  DbGroupMember,
  DbScimToken,
  DbUser,
  ScimError,
  ScimGroup,
  ScimListResponse,
  ScimPatchOperation,
  ScimUser,
} from "./types";
import { SCIM_SCHEMAS } from "./types";

/**
 * SCIM Service configuration
 */
export interface ScimServiceConfig {
  /** Base URL for resource locations */
  baseUrl: string;
  /** Enable bulk operations */
  bulkEnabled?: boolean;
  /** Maximum results per page */
  maxResults?: number;
  /** Maximum operations per bulk request */
  maxBulkOperations?: number;
}

/**
 * SCIM error response factory
 */
function scimError(status: number, detail: string, scimType?: string): ScimError {
  return {
    schemas: [SCIM_SCHEMAS.ERROR] as ["urn:ietf:params:scim:api:messages:2.0:Error"],
    status: String(status),
    detail,
    scimType,
  };
}

/**
 * SCIM Service class
 */
export class ScimService {
  constructor(
    private adapter: DatabaseAdapter,
    private config: ScimServiceConfig,
  ) {}

  // ===========================================================================
  // Token Management
  // ===========================================================================

  /**
   * Validate a SCIM bearer token
   */
  async validateToken(token: string): Promise<boolean> {
    const hash = await this.hashToken(token);

    const result = await this.adapter.executeOne<DbScimToken>(
      `SELECT * FROM scim_token WHERE tokenHash = ? AND (expiresAt IS NULL OR expiresAt > datetime('now'))`,
      [hash],
    );

    if (result) {
      // Update last used timestamp
      await this.adapter.execute(
        `UPDATE scim_token SET lastUsedAt = datetime('now') WHERE id = ?`,
        [result.id],
      );
      return true;
    }

    return false;
  }

  /**
   * Create a new SCIM token
   */
  async createToken(name: string, expiresInDays?: number): Promise<string> {
    const token = this.generateToken();
    const hash = await this.hashToken(token);
    const id = crypto.randomUUID();

    const expiresAt = expiresInDays ? `datetime('now', '+${expiresInDays} days')` : null;

    await this.adapter.execute(
      `INSERT INTO scim_token (id, name, tokenHash, expiresAt) VALUES (?, ?, ?, ${expiresAt ?? "NULL"})`,
      [id, name, hash],
    );

    return token;
  }

  /**
   * List SCIM tokens (without exposing the actual tokens)
   */
  async listTokens(): Promise<Array<Omit<DbScimToken, "tokenHash">>> {
    const tokens = await this.adapter.execute<DbScimToken>(
      `SELECT id, name, createdAt, lastUsedAt, expiresAt FROM scim_token ORDER BY createdAt DESC`,
      [],
    );
    return tokens;
  }

  /**
   * Delete a SCIM token
   */
  async deleteToken(id: string): Promise<boolean> {
    await this.adapter.execute(`DELETE FROM scim_token WHERE id = ?`, [id]);
    return true;
  }

  private generateToken(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  private async hashToken(token: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(token);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // ===========================================================================
  // User Operations
  // ===========================================================================

  /**
   * List users with optional filtering and pagination
   */
  async listUsers(options: QueryOptions = {}): Promise<ScimListResponse<ScimUser>> {
    const { count = this.config.maxResults ?? 100, startIndex = 1 } = options;

    const { sql, params, countSql, countParams } = buildListQuery("user", "User", {
      ...options,
      count,
      startIndex,
    });

    const [users, countResult] = await Promise.all([
      this.adapter.execute<DbUser>(sql, params),
      this.adapter.executeOne<{ total: number }>(countSql, countParams),
    ]);

    const totalResults = countResult?.total ?? 0;

    // Convert to SCIM format with groups
    const scimUsers = await Promise.all(
      users.map(async (user) => {
        const groups = await this.getUserGroups(user.id);
        return dbUserToScimUser(user, this.config.baseUrl, groups);
      }),
    );

    return {
      schemas: [SCIM_SCHEMAS.LIST_RESPONSE] as [
        "urn:ietf:params:scim:api:messages:2.0:ListResponse",
      ],
      totalResults,
      startIndex,
      itemsPerPage: scimUsers.length,
      Resources: scimUsers,
    };
  }

  /**
   * Get a user by ID
   */
  async getUser(id: string): Promise<ScimUser | ScimError> {
    const user = await this.adapter.executeOne<DbUser>(`SELECT * FROM user WHERE id = ?`, [id]);

    if (!user) {
      return scimError(404, `User ${id} not found`, "invalidValue");
    }

    const groups = await this.getUserGroups(id);
    return dbUserToScimUser(user, this.config.baseUrl, groups);
  }

  /**
   * Create a new user
   */
  async createUser(scimUser: ScimUser): Promise<ScimUser | ScimError> {
    // Check for duplicate email/userName
    const existing = await this.adapter.executeOne<DbUser>(`SELECT id FROM user WHERE email = ?`, [
      scimUser.userName,
    ]);

    if (existing) {
      return scimError(409, `User with userName ${scimUser.userName} already exists`, "uniqueness");
    }

    const dbUser = scimUserToDbUser(scimUser);

    await this.adapter.execute(
      `INSERT INTO user (id, email, emailVerified, name, image, active, externalId, metadata, roles, groups)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        dbUser.id,
        dbUser.email,
        dbUser.emailVerified,
        dbUser.name,
        dbUser.image,
        dbUser.active,
        dbUser.externalId,
        dbUser.metadata,
        dbUser.roles,
        dbUser.groups,
      ],
    );

    const created = await this.adapter.executeOne<DbUser>(`SELECT * FROM user WHERE id = ?`, [
      dbUser.id,
    ]);

    if (!created) {
      return scimError(500, "Failed to create user");
    }

    return dbUserToScimUser(created, this.config.baseUrl);
  }

  /**
   * Replace a user (PUT)
   */
  async replaceUser(id: string, scimUser: ScimUser): Promise<ScimUser | ScimError> {
    const existing = await this.adapter.executeOne<DbUser>(`SELECT id FROM user WHERE id = ?`, [
      id,
    ]);

    if (!existing) {
      return scimError(404, `User ${id} not found`, "invalidValue");
    }

    const dbUser = scimUserToDbUser(scimUser, id);

    await this.adapter.execute(
      `UPDATE user SET
        email = ?, name = ?, image = ?, active = ?, externalId = ?, metadata = ?, roles = ?, groups = ?,
        updatedAt = datetime('now')
       WHERE id = ?`,
      [
        dbUser.email,
        dbUser.name,
        dbUser.image,
        dbUser.active,
        dbUser.externalId,
        dbUser.metadata,
        dbUser.roles,
        dbUser.groups,
        id,
      ],
    );

    return this.getUser(id) as Promise<ScimUser>;
  }

  /**
   * Patch a user (PATCH)
   */
  async patchUser(id: string, operations: ScimPatchOperation[]): Promise<ScimUser | ScimError> {
    const existing = await this.adapter.executeOne<DbUser>(`SELECT * FROM user WHERE id = ?`, [id]);

    if (!existing) {
      return scimError(404, `User ${id} not found`, "invalidValue");
    }

    for (const op of operations) {
      await this.applyUserPatchOperation(id, op);
    }

    return this.getUser(id) as Promise<ScimUser>;
  }

  /**
   * Delete a user
   */
  async deleteUser(id: string): Promise<ScimError | null> {
    const existing = await this.adapter.executeOne<DbUser>(`SELECT id FROM user WHERE id = ?`, [
      id,
    ]);

    if (!existing) {
      return scimError(404, `User ${id} not found`, "invalidValue");
    }

    // Delete user (cascades to group memberships via FK)
    await this.adapter.execute(`DELETE FROM user WHERE id = ?`, [id]);

    return null;
  }

  private async applyUserPatchOperation(userId: string, op: ScimPatchOperation): Promise<void> {
    const { op: operation, path, value } = op;

    switch (operation) {
      case "add":
      case "replace": {
        if (!path && typeof value === "object" && value !== null) {
          // Replace entire resource
          const { fields, args } = getScimUserUpdateFields(value as Partial<ScimUser>);
          if (fields.length > 0) {
            await this.adapter.execute(`UPDATE user SET ${fields.join(", ")} WHERE id = ?`, [
              ...args,
              userId,
            ]);
          }
        } else if (path) {
          // Update specific field
          const partialUser: Partial<ScimUser> = {};
          this.setNestedValue(partialUser, path, value);
          const { fields, args } = getScimUserUpdateFields(partialUser);
          if (fields.length > 0) {
            await this.adapter.execute(`UPDATE user SET ${fields.join(", ")} WHERE id = ?`, [
              ...args,
              userId,
            ]);
          }
        }
        break;
      }
      case "remove": {
        if (path) {
          const partialUser: Partial<ScimUser> = {};
          this.setNestedValue(partialUser, path, null);
          const { fields, args } = getScimUserUpdateFields(partialUser);
          if (fields.length > 0) {
            await this.adapter.execute(`UPDATE user SET ${fields.join(", ")} WHERE id = ?`, [
              ...args,
              userId,
            ]);
          }
        }
        break;
      }
    }
  }

  private async getUserGroups(userId: string) {
    const groups = await this.adapter.execute<DbGroup & { membershipType: string }>(
      `SELECT g.*, 'direct' as membershipType
       FROM scim_group g
       INNER JOIN scim_group_member gm ON g.id = gm.groupId
       WHERE gm.userId = ?`,
      [userId],
    );

    return dbGroupsToScimGroupMemberships(groups, this.config.baseUrl);
  }

  // ===========================================================================
  // Group Operations
  // ===========================================================================

  /**
   * List groups with optional filtering and pagination
   */
  async listGroups(options: QueryOptions = {}): Promise<ScimListResponse<ScimGroup>> {
    const { count = this.config.maxResults ?? 100, startIndex = 1 } = options;

    const { sql, params, countSql, countParams } = buildListQuery("scim_group", "Group", {
      ...options,
      count,
      startIndex,
    });

    const [groups, countResult] = await Promise.all([
      this.adapter.execute<DbGroup>(sql, params),
      this.adapter.executeOne<{ total: number }>(countSql, countParams),
    ]);

    const totalResults = countResult?.total ?? 0;

    // Convert to SCIM format with members
    const scimGroups = await Promise.all(
      groups.map(async (group) => {
        const members = await this.getGroupMembers(group.id);
        return dbGroupToScimGroup(group, this.config.baseUrl, members);
      }),
    );

    return {
      schemas: [SCIM_SCHEMAS.LIST_RESPONSE] as [
        "urn:ietf:params:scim:api:messages:2.0:ListResponse",
      ],
      totalResults,
      startIndex,
      itemsPerPage: scimGroups.length,
      Resources: scimGroups,
    };
  }

  /**
   * Get a group by ID
   */
  async getGroup(id: string): Promise<ScimError | ScimGroup> {
    const group = await this.adapter.executeOne<DbGroup>(`SELECT * FROM scim_group WHERE id = ?`, [
      id,
    ]);

    if (!group) {
      return scimError(404, `Group ${id} not found`, "invalidValue");
    }

    const members = await this.getGroupMembers(id);
    return dbGroupToScimGroup(group, this.config.baseUrl, members);
  }

  /**
   * Create a new group
   */
  async createGroup(scimGroup: ScimGroup): Promise<ScimError | ScimGroup> {
    const dbGroup = scimGroupToDbGroup(scimGroup);

    await this.adapter.execute(
      `INSERT INTO scim_group (id, displayName, externalId, metadata)
       VALUES (?, ?, ?, ?)`,
      [dbGroup.id, dbGroup.displayName, dbGroup.externalId, dbGroup.metadata],
    );

    // Add members if provided
    if (scimGroup.members?.length) {
      for (const member of scimGroup.members) {
        await this.addGroupMember(dbGroup.id, member.value);
      }
    }

    return this.getGroup(dbGroup.id) as Promise<ScimGroup>;
  }

  /**
   * Replace a group (PUT)
   */
  async replaceGroup(id: string, scimGroup: ScimGroup): Promise<ScimError | ScimGroup> {
    const existing = await this.adapter.executeOne<DbGroup>(
      `SELECT id FROM scim_group WHERE id = ?`,
      [id],
    );

    if (!existing) {
      return scimError(404, `Group ${id} not found`, "invalidValue");
    }

    const dbGroup = scimGroupToDbGroup(scimGroup, id);

    await this.adapter.execute(
      `UPDATE scim_group SET displayName = ?, externalId = ?, metadata = ?, updatedAt = datetime('now')
       WHERE id = ?`,
      [dbGroup.displayName, dbGroup.externalId, dbGroup.metadata, id],
    );

    // Replace members
    await this.adapter.execute(`DELETE FROM scim_group_member WHERE groupId = ?`, [id]);
    if (scimGroup.members?.length) {
      for (const member of scimGroup.members) {
        await this.addGroupMember(id, member.value);
      }
    }

    return this.getGroup(id) as Promise<ScimGroup>;
  }

  /**
   * Patch a group (PATCH)
   */
  async patchGroup(id: string, operations: ScimPatchOperation[]): Promise<ScimError | ScimGroup> {
    const existing = await this.adapter.executeOne<DbGroup>(
      `SELECT * FROM scim_group WHERE id = ?`,
      [id],
    );

    if (!existing) {
      return scimError(404, `Group ${id} not found`, "invalidValue");
    }

    for (const op of operations) {
      await this.applyGroupPatchOperation(id, op);
    }

    return this.getGroup(id) as Promise<ScimGroup>;
  }

  /**
   * Delete a group
   */
  async deleteGroup(id: string): Promise<ScimError | null> {
    const existing = await this.adapter.executeOne<DbGroup>(
      `SELECT id FROM scim_group WHERE id = ?`,
      [id],
    );

    if (!existing) {
      return scimError(404, `Group ${id} not found`, "invalidValue");
    }

    // Delete group (cascades to memberships via FK)
    await this.adapter.execute(`DELETE FROM scim_group WHERE id = ?`, [id]);

    return null;
  }

  private async applyGroupPatchOperation(groupId: string, op: ScimPatchOperation): Promise<void> {
    const { op: operation, path, value } = op;

    // Handle members operations specially
    if (path === "members" || path?.startsWith("members[")) {
      await this.applyMembersPatchOperation(groupId, operation, path, value);
      return;
    }

    switch (operation) {
      case "add":
      case "replace": {
        if (!path && typeof value === "object" && value !== null) {
          const { fields, args } = getScimGroupUpdateFields(value as Partial<ScimGroup>);
          if (fields.length > 0) {
            await this.adapter.execute(`UPDATE scim_group SET ${fields.join(", ")} WHERE id = ?`, [
              ...args,
              groupId,
            ]);
          }
        } else if (path) {
          const partialGroup: Partial<ScimGroup> = {};
          this.setNestedValue(partialGroup, path, value);
          const { fields, args } = getScimGroupUpdateFields(partialGroup);
          if (fields.length > 0) {
            await this.adapter.execute(`UPDATE scim_group SET ${fields.join(", ")} WHERE id = ?`, [
              ...args,
              groupId,
            ]);
          }
        }
        break;
      }
      case "remove": {
        if (path) {
          const partialGroup: Partial<ScimGroup> = {};
          this.setNestedValue(partialGroup, path, null);
          const { fields, args } = getScimGroupUpdateFields(partialGroup);
          if (fields.length > 0) {
            await this.adapter.execute(`UPDATE scim_group SET ${fields.join(", ")} WHERE id = ?`, [
              ...args,
              groupId,
            ]);
          }
        }
        break;
      }
    }
  }

  private async applyMembersPatchOperation(
    groupId: string,
    operation: "add" | "remove" | "replace",
    path: string | undefined,
    value: unknown,
  ): Promise<void> {
    switch (operation) {
      case "add": {
        // Add members
        const members = Array.isArray(value) ? value : [value];
        for (const member of members) {
          if (typeof member === "object" && member !== null && "value" in member) {
            await this.addGroupMember(groupId, (member as { value: string }).value);
          }
        }
        break;
      }
      case "remove": {
        if (path === "members") {
          // Remove all members
          await this.adapter.execute(`DELETE FROM scim_group_member WHERE groupId = ?`, [groupId]);
        } else {
          // Remove specific member: members[value eq "userId"]
          const match = path?.match(/members\[value eq "([^"]+)"\]/);
          if (match?.[1]) {
            await this.removeGroupMember(groupId, match[1]);
          }
        }
        break;
      }
      case "replace": {
        // Replace all members
        await this.adapter.execute(`DELETE FROM scim_group_member WHERE groupId = ?`, [groupId]);
        const members = Array.isArray(value) ? value : [value];
        for (const member of members) {
          if (typeof member === "object" && member !== null && "value" in member) {
            await this.addGroupMember(groupId, (member as { value: string }).value);
          }
        }
        break;
      }
    }
  }

  private async getGroupMembers(groupId: string) {
    const members = await this.adapter.execute<
      DbGroupMember & { userName: string; userDisplayName: string }
    >(
      `SELECT gm.*, u.email as userName, u.name as userDisplayName
       FROM scim_group_member gm
       INNER JOIN user u ON gm.userId = u.id
       WHERE gm.groupId = ?`,
      [groupId],
    );

    return dbMembersToScimMembers(members, this.config.baseUrl);
  }

  private async addGroupMember(groupId: string, userId: string): Promise<void> {
    const id = crypto.randomUUID();
    try {
      await this.adapter.execute(
        `INSERT INTO scim_group_member (id, groupId, userId) VALUES (?, ?, ?)`,
        [id, groupId, userId],
      );
    } catch {
      // Ignore duplicate key errors
    }
  }

  private async removeGroupMember(groupId: string, userId: string): Promise<void> {
    await this.adapter.execute(`DELETE FROM scim_group_member WHERE groupId = ? AND userId = ?`, [
      groupId,
      userId,
    ]);
  }

  // ===========================================================================
  // Utility
  // ===========================================================================

  private setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    // Handle simple paths like "displayName" or nested like "name.familyName"
    const parts = path.split(".");
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      if (!(part in current)) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    const lastPart = parts.at(-1)!;
    current[lastPart] = value;
  }
}
