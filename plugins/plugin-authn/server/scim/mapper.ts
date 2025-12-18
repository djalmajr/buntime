/**
 * SCIM Mapper
 *
 * Converts between database records and SCIM resources
 */

import type {
  DbGroup,
  DbGroupMember,
  DbUser,
  ScimGroup,
  ScimGroupMembership,
  ScimMember,
  ScimUser,
} from "./types";
import { SCIM_SCHEMAS } from "./types";

/**
 * Generate SCIM location URL
 */
function getLocation(baseUrl: string, resourceType: "Groups" | "Users", id: string): string {
  return `${baseUrl}/scim/v2/${resourceType}/${id}`;
}

/**
 * Parse name from display name
 * Attempts to split "First Last" into givenName and familyName
 */
function parseName(displayName: string | null): { familyName?: string; givenName?: string } {
  if (!displayName) return {};

  const parts = displayName.trim().split(/\s+/);
  if (parts.length === 1) {
    return { givenName: parts[0] };
  }

  const familyName = parts.pop();
  const givenName = parts.join(" ");

  return { familyName, givenName };
}

/**
 * Format name from parts
 */
function formatName(givenName?: string, familyName?: string): string {
  return [givenName, familyName].filter(Boolean).join(" ");
}

// =============================================================================
// User Mapping
// =============================================================================

/**
 * Convert database user to SCIM User resource
 */
export function dbUserToScimUser(
  user: DbUser,
  baseUrl: string,
  groups?: ScimGroupMembership[],
): ScimUser {
  const nameParts = parseName(user.name);

  return {
    schemas: [SCIM_SCHEMAS.USER],
    id: user.id,
    externalId: user.externalId ?? undefined,
    meta: {
      resourceType: "User",
      created: user.createdAt,
      lastModified: user.updatedAt,
      location: getLocation(baseUrl, "Users", user.id),
    },
    userName: user.email,
    name: {
      formatted: user.name,
      ...nameParts,
    },
    displayName: user.name,
    active: user.active === 1,
    emails: [
      {
        value: user.email,
        type: "work",
        primary: true,
      },
    ],
    photos: user.image
      ? [
          {
            value: user.image,
            type: "photo",
            primary: true,
          },
        ]
      : undefined,
    groups,
    // Parse roles from JSON string
    roles: user.roles
      ? (() => {
          try {
            const parsed = JSON.parse(user.roles) as string[];
            return parsed.map((role) => ({ value: role }));
          } catch {
            return undefined;
          }
        })()
      : undefined,
  };
}

/**
 * Convert SCIM User to database fields for INSERT
 */
export function scimUserToDbUser(
  scimUser: ScimUser,
  existingId?: string,
): Omit<DbUser, "createdAt" | "updatedAt"> {
  const primaryEmail =
    scimUser.emails?.find((e) => e.primary)?.value ?? scimUser.emails?.[0]?.value;
  const email = primaryEmail ?? scimUser.userName;

  const name =
    scimUser.displayName ??
    scimUser.name?.formatted ??
    formatName(scimUser.name?.givenName, scimUser.name?.familyName) ??
    email;

  const primaryPhoto =
    scimUser.photos?.find((p) => p.primary)?.value ?? scimUser.photos?.[0]?.value;

  // Convert roles array to JSON string
  const roles = scimUser.roles?.length ? JSON.stringify(scimUser.roles.map((r) => r.value)) : null;

  return {
    id: existingId ?? scimUser.id ?? crypto.randomUUID(),
    email,
    emailVerified: 0,
    name,
    image: primaryPhoto ?? null,
    active: scimUser.active !== false ? 1 : 0,
    externalId: scimUser.externalId ?? null,
    metadata: null,
    roles,
    groups: null,
  };
}

/**
 * Get SQL fields and values for user update from SCIM User
 */
export function getScimUserUpdateFields(scimUser: Partial<ScimUser>): {
  args: unknown[];
  fields: string[];
} {
  const fields: string[] = [];
  const args: unknown[] = [];

  if (scimUser.userName !== undefined) {
    fields.push("email = ?");
    args.push(scimUser.userName);
  }

  if (scimUser.displayName !== undefined || scimUser.name !== undefined) {
    const name =
      scimUser.displayName ??
      scimUser.name?.formatted ??
      formatName(scimUser.name?.givenName, scimUser.name?.familyName);
    if (name) {
      fields.push("name = ?");
      args.push(name);
    }
  }

  if (scimUser.active !== undefined) {
    fields.push("active = ?");
    args.push(scimUser.active ? 1 : 0);
  }

  if (scimUser.externalId !== undefined) {
    fields.push("externalId = ?");
    args.push(scimUser.externalId);
  }

  if (scimUser.emails !== undefined) {
    const primaryEmail = scimUser.emails.find((e) => e.primary)?.value ?? scimUser.emails[0]?.value;
    if (primaryEmail) {
      fields.push("email = ?");
      args.push(primaryEmail);
    }
  }

  if (scimUser.photos !== undefined) {
    const primaryPhoto =
      scimUser.photos?.find((p) => p.primary)?.value ?? scimUser.photos?.[0]?.value;
    fields.push("image = ?");
    args.push(primaryPhoto ?? null);
  }

  if (scimUser.roles !== undefined) {
    const roles = scimUser.roles?.length
      ? JSON.stringify(scimUser.roles.map((r) => r.value))
      : null;
    fields.push("roles = ?");
    args.push(roles);
  }

  // Always update updatedAt
  fields.push("updatedAt = datetime('now')");

  return { fields, args };
}

// =============================================================================
// Group Mapping
// =============================================================================

/**
 * Convert database group to SCIM Group resource
 */
export function dbGroupToScimGroup(
  group: DbGroup,
  baseUrl: string,
  members?: ScimMember[],
): ScimGroup {
  return {
    schemas: [SCIM_SCHEMAS.GROUP],
    id: group.id,
    externalId: group.externalId ?? undefined,
    meta: {
      resourceType: "Group",
      created: group.createdAt,
      lastModified: group.updatedAt,
      location: getLocation(baseUrl, "Groups", group.id),
    },
    displayName: group.displayName,
    members,
  };
}

/**
 * Convert SCIM Group to database fields for INSERT
 */
export function scimGroupToDbGroup(
  scimGroup: ScimGroup,
  existingId?: string,
): Omit<DbGroup, "createdAt" | "updatedAt"> {
  return {
    id: existingId ?? scimGroup.id ?? crypto.randomUUID(),
    displayName: scimGroup.displayName,
    externalId: scimGroup.externalId ?? null,
    metadata: null,
  };
}

/**
 * Get SQL fields and values for group update from SCIM Group
 */
export function getScimGroupUpdateFields(scimGroup: Partial<ScimGroup>): {
  args: unknown[];
  fields: string[];
} {
  const fields: string[] = [];
  const args: unknown[] = [];

  if (scimGroup.displayName !== undefined) {
    fields.push("displayName = ?");
    args.push(scimGroup.displayName);
  }

  if (scimGroup.externalId !== undefined) {
    fields.push("externalId = ?");
    args.push(scimGroup.externalId);
  }

  // Always update updatedAt
  fields.push("updatedAt = datetime('now')");

  return { fields, args };
}

// =============================================================================
// Group Member Mapping
// =============================================================================

/**
 * Convert database group members to SCIM Member array
 */
export function dbMembersToScimMembers(
  members: Array<DbGroupMember & { userName?: string; userDisplayName?: string }>,
  baseUrl: string,
): ScimMember[] {
  return members.map((member) => ({
    value: member.userId,
    $ref: getLocation(baseUrl, "Users", member.userId),
    display: member.userDisplayName ?? member.userName,
    type: "User" as const,
  }));
}

/**
 * Convert database groups to SCIM GroupMembership array (for user.groups)
 */
export function dbGroupsToScimGroupMemberships(
  groups: Array<DbGroup & { membershipType?: string }>,
  baseUrl: string,
): ScimGroupMembership[] {
  return groups.map((group) => ({
    value: group.id,
    $ref: getLocation(baseUrl, "Groups", group.id),
    display: group.displayName,
    type: (group.membershipType as "direct" | "indirect") ?? "direct",
  }));
}
