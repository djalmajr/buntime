/**
 * Tests for SCIM mapper functions
 *
 * Tests:
 * - User mapping (DB to SCIM and SCIM to DB)
 * - Group mapping (DB to SCIM and SCIM to DB)
 * - Member mapping
 * - Update field generation
 */

import { describe, expect, it } from "bun:test";
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
import type { DbGroup, DbGroupMember, DbUser, ScimGroup, ScimUser } from "./types";
import { SCIM_SCHEMAS } from "./types";

const BASE_URL = "https://example.com/auth/api";

describe("dbUserToScimUser", () => {
  const createDbUser = (overrides: Partial<DbUser> = {}): DbUser => ({
    active: 1,
    createdAt: "2024-01-01T00:00:00Z",
    email: "john@example.com",
    emailVerified: 1,
    externalId: null,
    groups: null,
    id: "user-123",
    image: null,
    metadata: null,
    name: "John Doe",
    roles: null,
    updatedAt: "2024-01-02T00:00:00Z",
    ...overrides,
  });

  it("should convert basic user", () => {
    const dbUser = createDbUser();
    const scimUser = dbUserToScimUser(dbUser, BASE_URL);

    expect(scimUser.schemas).toEqual([SCIM_SCHEMAS.USER]);
    expect(scimUser.id).toBe("user-123");
    expect(scimUser.userName).toBe("john@example.com");
    expect(scimUser.displayName).toBe("John Doe");
    expect(scimUser.active).toBe(true);
  });

  it("should set correct meta information", () => {
    const dbUser = createDbUser();
    const scimUser = dbUserToScimUser(dbUser, BASE_URL);

    expect(scimUser.meta?.resourceType).toBe("User");
    expect(scimUser.meta?.created).toBe("2024-01-01T00:00:00Z");
    expect(scimUser.meta?.lastModified).toBe("2024-01-02T00:00:00Z");
    expect(scimUser.meta?.location).toBe(`${BASE_URL}/scim/v2/Users/user-123`);
  });

  it("should parse name into components", () => {
    const dbUser = createDbUser({ name: "John Michael Doe" });
    const scimUser = dbUserToScimUser(dbUser, BASE_URL);

    expect(scimUser.name?.formatted).toBe("John Michael Doe");
    expect(scimUser.name?.givenName).toBe("John Michael");
    expect(scimUser.name?.familyName).toBe("Doe");
  });

  it("should handle single name", () => {
    const dbUser = createDbUser({ name: "John" });
    const scimUser = dbUserToScimUser(dbUser, BASE_URL);

    expect(scimUser.name?.givenName).toBe("John");
    expect(scimUser.name?.familyName).toBeUndefined();
  });

  it("should set email in emails array", () => {
    const dbUser = createDbUser();
    const scimUser = dbUserToScimUser(dbUser, BASE_URL);

    expect(scimUser.emails).toHaveLength(1);
    expect(scimUser.emails?.[0]?.value).toBe("john@example.com");
    expect(scimUser.emails?.[0]?.type).toBe("work");
    expect(scimUser.emails?.[0]?.primary).toBe(true);
  });

  it("should include photo if image exists", () => {
    const dbUser = createDbUser({ image: "https://example.com/photo.jpg" });
    const scimUser = dbUserToScimUser(dbUser, BASE_URL);

    expect(scimUser.photos).toHaveLength(1);
    expect(scimUser.photos?.[0]?.value).toBe("https://example.com/photo.jpg");
    expect(scimUser.photos?.[0]?.type).toBe("photo");
    expect(scimUser.photos?.[0]?.primary).toBe(true);
  });

  it("should not include photos if no image", () => {
    const dbUser = createDbUser({ image: null });
    const scimUser = dbUserToScimUser(dbUser, BASE_URL);

    expect(scimUser.photos).toBeUndefined();
  });

  it("should include externalId if set", () => {
    const dbUser = createDbUser({ externalId: "ext-456" });
    const scimUser = dbUserToScimUser(dbUser, BASE_URL);

    expect(scimUser.externalId).toBe("ext-456");
  });

  it("should parse roles from JSON string", () => {
    const dbUser = createDbUser({ roles: '["admin", "editor"]' });
    const scimUser = dbUserToScimUser(dbUser, BASE_URL);

    expect(scimUser.roles).toHaveLength(2);
    expect(scimUser.roles?.[0]?.value).toBe("admin");
    expect(scimUser.roles?.[1]?.value).toBe("editor");
  });

  it("should handle invalid roles JSON", () => {
    const dbUser = createDbUser({ roles: "invalid-json" });
    const scimUser = dbUserToScimUser(dbUser, BASE_URL);

    expect(scimUser.roles).toBeUndefined();
  });

  it("should include groups if provided", () => {
    const groups = [{ value: "group-1", display: "Admins", type: "direct" as const }];
    const dbUser = createDbUser();
    const scimUser = dbUserToScimUser(dbUser, BASE_URL, groups);

    expect(scimUser.groups).toEqual(groups);
  });

  it("should handle inactive user", () => {
    const dbUser = createDbUser({ active: 0 });
    const scimUser = dbUserToScimUser(dbUser, BASE_URL);

    expect(scimUser.active).toBe(false);
  });
});

describe("scimUserToDbUser", () => {
  const createScimUser = (overrides: Partial<ScimUser> = {}): ScimUser => ({
    emails: [{ value: "jane@example.com", primary: true, type: "work" }],
    schemas: [SCIM_SCHEMAS.USER],
    userName: "jane@example.com",
    ...overrides,
  });

  it("should convert basic SCIM user", () => {
    const scimUser = createScimUser();
    const dbUser = scimUserToDbUser(scimUser);

    expect(dbUser.email).toBe("jane@example.com");
    // Name defaults to empty string when no displayName or name parts are provided
    // because formatName returns "" for undefined inputs
    expect(dbUser.name).toBe("");
    expect(dbUser.active).toBe(1);
    expect(dbUser.emailVerified).toBe(0);
  });

  it("should use displayName for name", () => {
    const scimUser = createScimUser({ displayName: "Jane Smith" });
    const dbUser = scimUserToDbUser(scimUser);

    expect(dbUser.name).toBe("Jane Smith");
  });

  it("should use name.formatted for name", () => {
    const scimUser = createScimUser({
      name: { formatted: "Jane Marie Smith" },
    });
    const dbUser = scimUserToDbUser(scimUser);

    expect(dbUser.name).toBe("Jane Marie Smith");
  });

  it("should combine givenName and familyName", () => {
    const scimUser = createScimUser({
      name: { givenName: "Jane", familyName: "Smith" },
    });
    const dbUser = scimUserToDbUser(scimUser);

    expect(dbUser.name).toBe("Jane Smith");
  });

  it("should use primary email from emails array", () => {
    const scimUser = createScimUser({
      emails: [
        { value: "secondary@example.com", primary: false },
        { value: "primary@example.com", primary: true },
      ],
    });
    const dbUser = scimUserToDbUser(scimUser);

    expect(dbUser.email).toBe("primary@example.com");
  });

  it("should fallback to userName if no emails", () => {
    const scimUser = createScimUser({ emails: undefined });
    const dbUser = scimUserToDbUser(scimUser);

    expect(dbUser.email).toBe("jane@example.com");
  });

  it("should use primary photo", () => {
    const scimUser = createScimUser({
      photos: [
        { value: "https://example.com/thumb.jpg", primary: false, type: "thumbnail" },
        { value: "https://example.com/photo.jpg", primary: true, type: "photo" },
      ],
    });
    const dbUser = scimUserToDbUser(scimUser);

    expect(dbUser.image).toBe("https://example.com/photo.jpg");
  });

  it("should set externalId", () => {
    const scimUser = createScimUser({ externalId: "ext-789" });
    const dbUser = scimUserToDbUser(scimUser);

    expect(dbUser.externalId).toBe("ext-789");
  });

  it("should convert roles to JSON string", () => {
    const scimUser = createScimUser({
      roles: [{ value: "admin" }, { value: "user" }],
    });
    const dbUser = scimUserToDbUser(scimUser);

    expect(dbUser.roles).toBe('["admin","user"]');
  });

  it("should handle inactive user", () => {
    const scimUser = createScimUser({ active: false });
    const dbUser = scimUserToDbUser(scimUser);

    expect(dbUser.active).toBe(0);
  });

  it("should use existing ID if provided", () => {
    const scimUser = createScimUser({ id: "new-id" });
    const dbUser = scimUserToDbUser(scimUser, "existing-id");

    expect(dbUser.id).toBe("existing-id");
  });

  it("should use SCIM ID if no existing ID", () => {
    const scimUser = createScimUser({ id: "scim-id" });
    const dbUser = scimUserToDbUser(scimUser);

    expect(dbUser.id).toBe("scim-id");
  });

  it("should generate UUID if no IDs provided", () => {
    const scimUser = createScimUser({ id: undefined });
    const dbUser = scimUserToDbUser(scimUser);

    expect(dbUser.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("getScimUserUpdateFields", () => {
  it("should update userName", () => {
    const result = getScimUserUpdateFields({ userName: "new@example.com" });

    expect(result.fields).toContain("email = ?");
    expect(result.args).toContain("new@example.com");
  });

  it("should update displayName", () => {
    const result = getScimUserUpdateFields({ displayName: "New Name" });

    expect(result.fields).toContain("name = ?");
    expect(result.args).toContain("New Name");
  });

  it("should update name.formatted", () => {
    const result = getScimUserUpdateFields({ name: { formatted: "Full Name" } });

    expect(result.fields).toContain("name = ?");
    expect(result.args).toContain("Full Name");
  });

  it("should combine name parts", () => {
    const result = getScimUserUpdateFields({
      name: { givenName: "First", familyName: "Last" },
    });

    expect(result.fields).toContain("name = ?");
    expect(result.args).toContain("First Last");
  });

  it("should update active status", () => {
    const result = getScimUserUpdateFields({ active: false });

    expect(result.fields).toContain("active = ?");
    expect(result.args).toContain(0);
  });

  it("should update externalId", () => {
    const result = getScimUserUpdateFields({ externalId: "new-ext" });

    expect(result.fields).toContain("externalId = ?");
    expect(result.args).toContain("new-ext");
  });

  it("should update email from emails array", () => {
    const result = getScimUserUpdateFields({
      emails: [{ value: "updated@example.com", primary: true }],
    });

    expect(result.fields).toContain("email = ?");
    expect(result.args).toContain("updated@example.com");
  });

  it("should update image from photos", () => {
    const result = getScimUserUpdateFields({
      photos: [{ value: "https://new-photo.jpg", primary: true }],
    });

    expect(result.fields).toContain("image = ?");
    expect(result.args).toContain("https://new-photo.jpg");
  });

  it("should clear image if photos empty", () => {
    const result = getScimUserUpdateFields({ photos: [] });

    expect(result.fields).toContain("image = ?");
    expect(result.args).toContain(null);
  });

  it("should update roles", () => {
    const result = getScimUserUpdateFields({
      roles: [{ value: "newrole" }],
    });

    expect(result.fields).toContain("roles = ?");
    expect(result.args).toContain('["newrole"]');
  });

  it("should always include updatedAt", () => {
    const result = getScimUserUpdateFields({});

    expect(result.fields).toContain("updatedAt = datetime('now')");
  });

  it("should handle multiple updates", () => {
    const result = getScimUserUpdateFields({
      active: true,
      displayName: "Updated Name",
      externalId: "ext-new",
    });

    expect(result.fields.length).toBeGreaterThanOrEqual(4); // 3 fields + updatedAt
    expect(result.args).toContain("Updated Name");
    expect(result.args).toContain("ext-new");
    expect(result.args).toContain(1);
  });
});

describe("dbGroupToScimGroup", () => {
  const createDbGroup = (overrides: Partial<DbGroup> = {}): DbGroup => ({
    createdAt: "2024-01-01T00:00:00Z",
    displayName: "Admins",
    externalId: null,
    id: "group-123",
    metadata: null,
    updatedAt: "2024-01-02T00:00:00Z",
    ...overrides,
  });

  it("should convert basic group", () => {
    const dbGroup = createDbGroup();
    const scimGroup = dbGroupToScimGroup(dbGroup, BASE_URL);

    expect(scimGroup.schemas).toEqual([SCIM_SCHEMAS.GROUP]);
    expect(scimGroup.id).toBe("group-123");
    expect(scimGroup.displayName).toBe("Admins");
  });

  it("should set correct meta information", () => {
    const dbGroup = createDbGroup();
    const scimGroup = dbGroupToScimGroup(dbGroup, BASE_URL);

    expect(scimGroup.meta?.resourceType).toBe("Group");
    expect(scimGroup.meta?.created).toBe("2024-01-01T00:00:00Z");
    expect(scimGroup.meta?.lastModified).toBe("2024-01-02T00:00:00Z");
    expect(scimGroup.meta?.location).toBe(`${BASE_URL}/scim/v2/Groups/group-123`);
  });

  it("should include externalId if set", () => {
    const dbGroup = createDbGroup({ externalId: "ext-group" });
    const scimGroup = dbGroupToScimGroup(dbGroup, BASE_URL);

    expect(scimGroup.externalId).toBe("ext-group");
  });

  it("should include members if provided", () => {
    const members = [
      {
        value: "user-1",
        $ref: `${BASE_URL}/scim/v2/Users/user-1`,
        display: "User 1",
        type: "User" as const,
      },
    ];
    const dbGroup = createDbGroup();
    const scimGroup = dbGroupToScimGroup(dbGroup, BASE_URL, members);

    expect(scimGroup.members).toEqual(members);
  });
});

describe("scimGroupToDbGroup", () => {
  const createScimGroup = (overrides: Partial<ScimGroup> = {}): ScimGroup => ({
    displayName: "Editors",
    schemas: [SCIM_SCHEMAS.GROUP],
    ...overrides,
  });

  it("should convert basic SCIM group", () => {
    const scimGroup = createScimGroup();
    const dbGroup = scimGroupToDbGroup(scimGroup);

    expect(dbGroup.displayName).toBe("Editors");
    expect(dbGroup.externalId).toBeNull();
    expect(dbGroup.metadata).toBeNull();
  });

  it("should use existing ID if provided", () => {
    const scimGroup = createScimGroup({ id: "new-id" });
    const dbGroup = scimGroupToDbGroup(scimGroup, "existing-id");

    expect(dbGroup.id).toBe("existing-id");
  });

  it("should use SCIM ID if no existing ID", () => {
    const scimGroup = createScimGroup({ id: "scim-id" });
    const dbGroup = scimGroupToDbGroup(scimGroup);

    expect(dbGroup.id).toBe("scim-id");
  });

  it("should generate UUID if no IDs provided", () => {
    const scimGroup = createScimGroup({ id: undefined });
    const dbGroup = scimGroupToDbGroup(scimGroup);

    expect(dbGroup.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("should set externalId", () => {
    const scimGroup = createScimGroup({ externalId: "ext-group" });
    const dbGroup = scimGroupToDbGroup(scimGroup);

    expect(dbGroup.externalId).toBe("ext-group");
  });
});

describe("getScimGroupUpdateFields", () => {
  it("should update displayName", () => {
    const result = getScimGroupUpdateFields({ displayName: "New Group Name" });

    expect(result.fields).toContain("displayName = ?");
    expect(result.args).toContain("New Group Name");
  });

  it("should update externalId", () => {
    const result = getScimGroupUpdateFields({ externalId: "new-ext" });

    expect(result.fields).toContain("externalId = ?");
    expect(result.args).toContain("new-ext");
  });

  it("should always include updatedAt", () => {
    const result = getScimGroupUpdateFields({});

    expect(result.fields).toContain("updatedAt = datetime('now')");
  });
});

describe("dbMembersToScimMembers", () => {
  it("should convert members with display names", () => {
    const members: Array<DbGroupMember & { userName?: string; userDisplayName?: string }> = [
      {
        createdAt: "2024-01-01T00:00:00Z",
        groupId: "group-1",
        id: "member-1",
        userDisplayName: "John Doe",
        userId: "user-1",
        userName: "john@example.com",
      },
    ];

    const result = dbMembersToScimMembers(members, BASE_URL);

    expect(result).toHaveLength(1);
    expect(result[0]?.value).toBe("user-1");
    expect(result[0]?.$ref).toBe(`${BASE_URL}/scim/v2/Users/user-1`);
    expect(result[0]?.display).toBe("John Doe");
    expect(result[0]?.type).toBe("User");
  });

  it("should fallback to userName if no displayName", () => {
    const members: Array<DbGroupMember & { userName?: string; userDisplayName?: string }> = [
      {
        createdAt: "2024-01-01T00:00:00Z",
        groupId: "group-1",
        id: "member-1",
        userId: "user-1",
        userName: "john@example.com",
      },
    ];

    const result = dbMembersToScimMembers(members, BASE_URL);

    expect(result[0]?.display).toBe("john@example.com");
  });
});

describe("dbGroupsToScimGroupMemberships", () => {
  it("should convert groups to memberships", () => {
    const groups: Array<DbGroup & { membershipType?: string }> = [
      {
        createdAt: "2024-01-01T00:00:00Z",
        displayName: "Admins",
        externalId: null,
        id: "group-1",
        membershipType: "direct",
        metadata: null,
        updatedAt: "2024-01-02T00:00:00Z",
      },
    ];

    const result = dbGroupsToScimGroupMemberships(groups, BASE_URL);

    expect(result).toHaveLength(1);
    expect(result[0]?.value).toBe("group-1");
    expect(result[0]?.$ref).toBe(`${BASE_URL}/scim/v2/Groups/group-1`);
    expect(result[0]?.display).toBe("Admins");
    expect(result[0]?.type).toBe("direct");
  });

  it("should default to direct membership type", () => {
    const groups: Array<DbGroup & { membershipType?: string }> = [
      {
        createdAt: "2024-01-01T00:00:00Z",
        displayName: "Users",
        externalId: null,
        id: "group-2",
        metadata: null,
        updatedAt: "2024-01-02T00:00:00Z",
      },
    ];

    const result = dbGroupsToScimGroupMemberships(groups, BASE_URL);

    expect(result[0]?.type).toBe("direct");
  });
});
