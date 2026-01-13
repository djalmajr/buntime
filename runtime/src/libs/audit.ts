/**
 * Audit Logging
 *
 * Records all actions performed in the system for security and compliance.
 * Actions are stored in the audit_logs table with actor info, action type,
 * resource details, and request metadata.
 */

import { getChildLogger } from "@buntime/shared/logger";
import type { ValidatedKey } from "@/libs/api-keys";
import { execute, query, queryOne } from "@/libs/database";

const logger = getChildLogger("Audit");

// ============================================================================
// Types
// ============================================================================

/** Audit action types */
export type AuditAction =
  // Key management
  | "key.create"
  | "key.revoke"
  | "key.update"
  // Plugin management
  | "plugin.config"
  | "plugin.disable"
  | "plugin.enable"
  | "plugin.install"
  | "plugin.reload"
  | "plugin.remove"
  | "plugin.reset"
  // App management
  | "app.install"
  | "app.remove";

/** Resource types */
export type ResourceType = "app" | "key" | "plugin";

/** Input for creating an audit log entry */
export interface AuditLogInput {
  action: AuditAction;
  actor: ValidatedKey;
  details?: Record<string, unknown>;
  ipAddress?: string;
  resourceId?: number | string;
  resourceName?: string;
  resourceType?: ResourceType;
  userAgent?: string;
}

/** Database row for audit_logs table */
interface AuditLogRow {
  action: string;
  actor_id: number | null;
  actor_name: string;
  details: string | null;
  id: number;
  ip_address: string | null;
  resource_id: string | null;
  resource_name: string | null;
  resource_type: string | null;
  timestamp: number;
  user_agent: string | null;
}

/** Audit log data returned by queries */
export interface AuditLogData {
  action: AuditAction;
  actorId: number | null;
  actorName: string;
  details: Record<string, unknown> | null;
  id: number;
  ipAddress: string | null;
  resourceId: string | null;
  resourceName: string | null;
  resourceType: ResourceType | null;
  timestamp: number;
  userAgent: string | null;
}

/** Options for listing audit logs */
export interface ListAuditLogsOptions {
  action?: AuditAction;
  actorId?: number;
  limit?: number;
  offset?: number;
}

// ============================================================================
// Row Conversion
// ============================================================================

/**
 * Convert database row to AuditLogData
 */
function rowToAuditLogData(row: AuditLogRow): AuditLogData {
  return {
    action: row.action as AuditAction,
    actorId: row.actor_id,
    actorName: row.actor_name,
    details: row.details ? (JSON.parse(row.details) as Record<string, unknown>) : null,
    id: row.id,
    ipAddress: row.ip_address,
    resourceId: row.resource_id,
    resourceName: row.resource_name,
    resourceType: row.resource_type as ResourceType | null,
    timestamp: row.timestamp,
    userAgent: row.user_agent,
  };
}

// ============================================================================
// Operations
// ============================================================================

/**
 * Create an audit log entry
 */
export async function createAuditLog(input: AuditLogInput): Promise<void> {
  const actorId = input.actor.id;
  const actorName = input.actor.name;
  const resourceId = input.resourceId?.toString() ?? null;
  const details = input.details ? JSON.stringify(input.details) : null;

  await execute(
    `
    INSERT INTO audit_logs (
      actor_id, actor_name, action, resource_type, resource_id, resource_name,
      details, ip_address, user_agent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    [
      actorId,
      actorName,
      input.action,
      input.resourceType ?? null,
      resourceId,
      input.resourceName ?? null,
      details,
      input.ipAddress ?? null,
      input.userAgent ?? null,
    ],
  );

  logger.debug(
    `Audit: ${actorName} ${input.action} ${input.resourceType ?? ""}:${input.resourceName ?? ""}`,
  );
}

/**
 * Get audit logs with optional filtering
 */
export async function getAuditLogs(
  options: ListAuditLogsOptions = {},
): Promise<{ logs: AuditLogData[]; total: number }> {
  const limit = Math.min(options.limit ?? 50, 200);
  const offset = options.offset ?? 0;

  const conditions: string[] = [];
  const params: (number | string)[] = [];

  if (options.action) {
    conditions.push("action = ?");
    params.push(options.action);
  }

  if (options.actorId !== undefined) {
    conditions.push("actor_id = ?");
    params.push(options.actorId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Get total count
  const countRow = await queryOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM audit_logs ${whereClause}`,
    params,
  );

  // Get paginated results
  const rows = await query<AuditLogRow>(
    `SELECT * FROM audit_logs ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return {
    logs: rows.map(rowToAuditLogData),
    total: countRow?.count ?? 0,
  };
}

/**
 * Get a single audit log by ID
 */
export async function getAuditLogById(id: number): Promise<AuditLogData | null> {
  const row = await queryOne<AuditLogRow>("SELECT * FROM audit_logs WHERE id = ?", [id]);
  return row ? rowToAuditLogData(row) : null;
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Log a key creation event
 */
export async function logKeyCreate(
  actor: ValidatedKey,
  keyId: number,
  keyName: string,
  details?: Record<string, unknown>,
): Promise<void> {
  await createAuditLog({
    action: "key.create",
    actor,
    details,
    resourceId: keyId,
    resourceName: keyName,
    resourceType: "key",
  });
}

/**
 * Log a key revocation event
 */
export async function logKeyRevoke(
  actor: ValidatedKey,
  keyId: number,
  keyName: string,
): Promise<void> {
  await createAuditLog({
    action: "key.revoke",
    actor,
    resourceId: keyId,
    resourceName: keyName,
    resourceType: "key",
  });
}

/**
 * Log a key update event
 */
export async function logKeyUpdate(
  actor: ValidatedKey,
  keyId: number,
  keyName: string,
  details?: Record<string, unknown>,
): Promise<void> {
  await createAuditLog({
    action: "key.update",
    actor,
    details,
    resourceId: keyId,
    resourceName: keyName,
    resourceType: "key",
  });
}

/**
 * Log a plugin installation event
 */
export async function logPluginInstall(
  actor: ValidatedKey,
  pluginName: string,
  version: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  await createAuditLog({
    action: "plugin.install",
    actor,
    details: { version },
    ipAddress,
    resourceName: pluginName,
    resourceType: "plugin",
    userAgent,
  });
}

/**
 * Log a plugin removal event
 */
export async function logPluginRemove(
  actor: ValidatedKey,
  pluginId: number,
  pluginName: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  await createAuditLog({
    action: "plugin.remove",
    actor,
    ipAddress,
    resourceId: pluginId,
    resourceName: pluginName,
    resourceType: "plugin",
    userAgent,
  });
}

/**
 * Log a plugin enable event
 */
export async function logPluginEnable(
  actor: ValidatedKey,
  pluginId: number,
  pluginName: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  await createAuditLog({
    action: "plugin.enable",
    actor,
    ipAddress,
    resourceId: pluginId,
    resourceName: pluginName,
    resourceType: "plugin",
    userAgent,
  });
}

/**
 * Log a plugin disable event
 */
export async function logPluginDisable(
  actor: ValidatedKey,
  pluginId: number,
  pluginName: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  await createAuditLog({
    action: "plugin.disable",
    actor,
    ipAddress,
    resourceId: pluginId,
    resourceName: pluginName,
    resourceType: "plugin",
    userAgent,
  });
}

/**
 * Log an app installation event
 */
export async function logAppInstall(
  actor: ValidatedKey,
  appName: string,
  version: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  await createAuditLog({
    action: "app.install",
    actor,
    details: { version },
    ipAddress,
    resourceName: appName,
    resourceType: "app",
    userAgent,
  });
}

/**
 * Log an app removal event
 */
export async function logAppRemove(
  actor: ValidatedKey,
  appName: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  await createAuditLog({
    action: "app.remove",
    actor,
    ipAddress,
    resourceName: appName,
    resourceType: "app",
    userAgent,
  });
}
