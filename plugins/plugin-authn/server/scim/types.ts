/**
 * SCIM 2.0 Types (RFC 7643/7644)
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7643 - SCIM Core Schema
 * @see https://datatracker.ietf.org/doc/html/rfc7644 - SCIM Protocol
 */

// =============================================================================
// SCIM Core Types
// =============================================================================

/**
 * SCIM Meta information (common to all resources)
 */
export interface ScimMeta {
  created?: string;
  lastModified?: string;
  location?: string;
  resourceType: string;
  version?: string;
}

/**
 * SCIM Name complex type
 */
export interface ScimName {
  familyName?: string;
  formatted?: string;
  givenName?: string;
  honorificPrefix?: string;
  honorificSuffix?: string;
  middleName?: string;
}

/**
 * SCIM Email complex type
 */
export interface ScimEmail {
  display?: string;
  primary?: boolean;
  type?: "home" | "other" | "work";
  value: string;
}

/**
 * SCIM Phone number complex type
 */
export interface ScimPhoneNumber {
  display?: string;
  primary?: boolean;
  type?: "fax" | "home" | "mobile" | "other" | "pager" | "work";
  value: string;
}

/**
 * SCIM Address complex type
 */
export interface ScimAddress {
  country?: string;
  formatted?: string;
  locality?: string;
  postalCode?: string;
  primary?: boolean;
  region?: string;
  streetAddress?: string;
  type?: "home" | "other" | "work";
}

/**
 * SCIM Group membership reference (for User.groups)
 */
export interface ScimGroupMembership {
  $ref?: string;
  display?: string;
  type?: "direct" | "indirect";
  value: string;
}

/**
 * SCIM User member reference (for Group.members)
 */
export interface ScimMember {
  $ref?: string;
  display?: string;
  type?: "Group" | "User";
  value: string;
}

// =============================================================================
// SCIM User Resource
// =============================================================================

/**
 * SCIM User Resource (RFC 7643 Section 4.1)
 */
export interface ScimUser {
  /** Always ["urn:ietf:params:scim:schemas:core:2.0:User"] */
  schemas: string[];

  /** Unique identifier (UUID) */
  id?: string;

  /** Unique identifier from the provisioning source */
  externalId?: string;

  /** Metadata */
  meta?: ScimMeta;

  /** Unique identifier used for authentication (usually email) */
  userName: string;

  /** User's name */
  name?: ScimName;

  /** Human-readable name */
  displayName?: string;

  /** Informal name */
  nickName?: string;

  /** URL to user's profile */
  profileUrl?: string;

  /** User's title */
  title?: string;

  /** User's type (e.g., "Employee", "Contractor") */
  userType?: string;

  /** Preferred language (BCP 47) */
  preferredLanguage?: string;

  /** Locale (BCP 47) */
  locale?: string;

  /** Timezone (IANA) */
  timezone?: string;

  /** Whether user is active */
  active?: boolean;

  /** Password (write-only) */
  password?: string;

  /** Email addresses */
  emails?: ScimEmail[];

  /** Phone numbers */
  phoneNumbers?: ScimPhoneNumber[];

  /** Addresses */
  addresses?: ScimAddress[];

  /** Groups the user belongs to (read-only) */
  groups?: ScimGroupMembership[];

  /** Photos (URLs) */
  photos?: Array<{
    display?: string;
    primary?: boolean;
    type?: "photo" | "thumbnail";
    value: string;
  }>;

  /** Entitlements */
  entitlements?: Array<{
    display?: string;
    primary?: boolean;
    type?: string;
    value: string;
  }>;

  /** Roles */
  roles?: Array<{
    display?: string;
    primary?: boolean;
    type?: string;
    value: string;
  }>;

  /** X509 certificates */
  x509Certificates?: Array<{
    display?: string;
    primary?: boolean;
    type?: string;
    value: string;
  }>;
}

// =============================================================================
// SCIM Group Resource
// =============================================================================

/**
 * SCIM Group Resource (RFC 7643 Section 4.2)
 */
export interface ScimGroup {
  /** Always ["urn:ietf:params:scim:schemas:core:2.0:Group"] */
  schemas: string[];

  /** Unique identifier (UUID) */
  id?: string;

  /** Unique identifier from the provisioning source */
  externalId?: string;

  /** Metadata */
  meta?: ScimMeta;

  /** Human-readable name */
  displayName: string;

  /** Group members */
  members?: ScimMember[];
}

// =============================================================================
// SCIM Protocol Types
// =============================================================================

/**
 * SCIM List Response (RFC 7644 Section 3.4.2)
 */
export interface ScimListResponse<T> {
  schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"];
  itemsPerPage?: number;
  Resources: T[];
  startIndex?: number;
  totalResults: number;
}

/**
 * SCIM Error Response (RFC 7644 Section 3.12)
 */
export interface ScimError {
  schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"];
  detail?: string;
  scimType?: string;
  status: string;
}

/**
 * SCIM Patch Operation (RFC 7644 Section 3.5.2)
 */
export interface ScimPatchOperation {
  op: "add" | "remove" | "replace";
  path?: string;
  value?: unknown;
}

/**
 * SCIM Patch Request (RFC 7644 Section 3.5.2)
 */
export interface ScimPatchRequest {
  schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"];
  Operations: ScimPatchOperation[];
}

/**
 * SCIM Bulk Operation (RFC 7644 Section 3.7)
 */
export interface ScimBulkOperation {
  bulkId?: string;
  data?: ScimUser | ScimGroup | ScimPatchRequest;
  method: "DELETE" | "PATCH" | "POST" | "PUT";
  path: string;
  version?: string;
}

/**
 * SCIM Bulk Request (RFC 7644 Section 3.7)
 */
export interface ScimBulkRequest {
  schemas: ["urn:ietf:params:scim:api:messages:2.0:BulkRequest"];
  failOnErrors?: number;
  Operations: ScimBulkOperation[];
}

/**
 * SCIM Bulk Response Operation
 */
export interface ScimBulkResponseOperation {
  bulkId?: string;
  location?: string;
  method: string;
  response?: ScimError | ScimGroup | ScimUser;
  status: string;
  version?: string;
}

/**
 * SCIM Bulk Response (RFC 7644 Section 3.7)
 */
export interface ScimBulkResponse {
  schemas: ["urn:ietf:params:scim:api:messages:2.0:BulkResponse"];
  Operations: ScimBulkResponseOperation[];
}

// =============================================================================
// SCIM Service Provider Configuration
// =============================================================================

/**
 * SCIM Service Provider Config (RFC 7643 Section 5)
 */
export interface ScimServiceProviderConfig {
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"];
  authenticationSchemes: Array<{
    description: string;
    documentationUri?: string;
    name: string;
    primary?: boolean;
    specUri?: string;
    type: "httpbasic" | "oauth" | "oauth2" | "oauthbearertoken";
  }>;
  bulk: {
    maxOperations: number;
    maxPayloadSize: number;
    supported: boolean;
  };
  changePassword: {
    supported: boolean;
  };
  documentationUri?: string;
  etag: {
    supported: boolean;
  };
  filter: {
    maxResults: number;
    supported: boolean;
  };
  meta?: ScimMeta;
  patch: {
    supported: boolean;
  };
  sort: {
    supported: boolean;
  };
}

/**
 * SCIM Resource Type (RFC 7643 Section 6)
 */
export interface ScimResourceType {
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"];
  description?: string;
  endpoint: string;
  id?: string;
  meta?: ScimMeta;
  name: string;
  schema: string;
  schemaExtensions?: Array<{
    required: boolean;
    schema: string;
  }>;
}

// =============================================================================
// SCIM Schema Definition
// =============================================================================

/**
 * SCIM Schema Attribute (RFC 7643 Section 7)
 */
export interface ScimSchemaAttribute {
  canonicalValues?: string[];
  caseExact?: boolean;
  description?: string;
  multiValued: boolean;
  mutability: "immutable" | "readOnly" | "readWrite" | "writeOnly";
  name: string;
  referenceTypes?: string[];
  required: boolean;
  returned: "always" | "default" | "never" | "request";
  subAttributes?: ScimSchemaAttribute[];
  type:
    | "binary"
    | "boolean"
    | "complex"
    | "dateTime"
    | "decimal"
    | "integer"
    | "reference"
    | "string";
  uniqueness: "global" | "none" | "server";
}

/**
 * SCIM Schema (RFC 7643 Section 7)
 */
export interface ScimSchema {
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:Schema"];
  attributes: ScimSchemaAttribute[];
  description?: string;
  id: string;
  meta?: ScimMeta;
  name?: string;
}

// =============================================================================
// Internal Database Types
// =============================================================================

/**
 * User record from database
 */
export interface DbUser {
  active: number;
  createdAt: string;
  email: string;
  emailVerified: number;
  externalId: string | null;
  groups: string | null;
  id: string;
  image: string | null;
  metadata: string | null;
  name: string;
  roles: string | null;
  updatedAt: string;
}

/**
 * Group record from database
 */
export interface DbGroup {
  createdAt: string;
  displayName: string;
  externalId: string | null;
  id: string;
  metadata: string | null;
  updatedAt: string;
}

/**
 * Group member record from database
 */
export interface DbGroupMember {
  createdAt: string;
  groupId: string;
  id: string;
  userId: string;
}

/**
 * SCIM token record from database
 */
export interface DbScimToken {
  createdAt: string;
  expiresAt: string | null;
  id: string;
  lastUsedAt: string | null;
  name: string;
  tokenHash: string;
}

// =============================================================================
// SCIM Constants
// =============================================================================

export const SCIM_SCHEMAS = {
  BULK_REQUEST: "urn:ietf:params:scim:api:messages:2.0:BulkRequest",
  BULK_RESPONSE: "urn:ietf:params:scim:api:messages:2.0:BulkResponse",
  ERROR: "urn:ietf:params:scim:api:messages:2.0:Error",
  GROUP: "urn:ietf:params:scim:schemas:core:2.0:Group",
  LIST_RESPONSE: "urn:ietf:params:scim:api:messages:2.0:ListResponse",
  PATCH_OP: "urn:ietf:params:scim:api:messages:2.0:PatchOp",
  RESOURCE_TYPE: "urn:ietf:params:scim:schemas:core:2.0:ResourceType",
  SCHEMA: "urn:ietf:params:scim:schemas:core:2.0:Schema",
  SERVICE_PROVIDER_CONFIG: "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig",
  USER: "urn:ietf:params:scim:schemas:core:2.0:User",
} as const;

export const SCIM_CONTENT_TYPE = "application/scim+json";
