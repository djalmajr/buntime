import type { KvFilterOperators, KvFilterValue, KvNowSerialized, KvWhereFilter } from "./types";
import { isNowPlaceholder } from "./types";

/**
 * Result of converting a where filter to SQL
 */
export interface WhereToSqlResult {
  /** SQL WHERE clause (without the WHERE keyword) */
  sql: string;
  /** Parameter values for the SQL query */
  params: unknown[];
}

/**
 * Resolve a comparison value, handling $now placeholder
 * Returns { value, isNow } where isNow indicates if it should use server time
 */
function resolveComparisonValue(value: KvNowSerialized | number | string): {
  isNow: boolean;
  value: number | string;
} {
  if (isNowPlaceholder(value)) {
    return { value: Date.now(), isNow: true };
  }
  return { value, isNow: false };
}

/**
 * Convert a field path to SQLite json_extract expression
 *
 * @example
 * "status" -> "json_extract(value, '$.status')"
 * "profile.name" -> "json_extract(value, '$.profile.name')"
 * "items[0].price" -> "json_extract(value, '$.items[0].price')"
 */
function fieldToJsonExtract(field: string): string {
  // Add $. prefix for json_extract
  const jsonPath = field.startsWith("$") ? field : `$.${field}`;
  return `json_extract(value, '${jsonPath}')`;
}

/**
 * Convert a filter value to SQL-safe value
 */
function valueToSql(value: KvFilterValue): unknown {
  if (value === null) {
    return null;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  return value;
}

/** All supported filter operator keys */
const FILTER_OPERATOR_KEYS = [
  // Comparison
  "$eq",
  "$ne",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  "$between",
  // Array
  "$in",
  "$nin",
  // String (case-sensitive)
  "$contains",
  "$notContains",
  "$startsWith",
  "$endsWith",
  // String (case-insensitive)
  "$containsi",
  "$notContainsi",
  "$startsWithi",
  "$endsWithi",
  // Existence
  "$null",
  "$empty",
  "$notEmpty",
];

/**
 * Check if a value is a filter operators object
 */
function isFilterOperators(value: unknown): value is KvFilterOperators {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const keys = Object.keys(value);
  return keys.some((k) => FILTER_OPERATOR_KEYS.includes(k));
}

/**
 * Escape special LIKE characters in SQLite
 * The characters %, _, and \ have special meaning in LIKE patterns
 */
function escapeLikePattern(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}

/**
 * Convert filter operators to SQL conditions
 * Handles $now placeholder by resolving it to current server timestamp
 */
function operatorsToSql(field: string, operators: KvFilterOperators, params: unknown[]): string {
  const jsonField = fieldToJsonExtract(field);
  const conditions: string[] = [];

  // ============================================================================
  // Comparison operators
  // ============================================================================

  if (operators.$eq !== undefined) {
    params.push(valueToSql(operators.$eq));
    conditions.push(`${jsonField} = ?`);
  }

  if (operators.$ne !== undefined) {
    params.push(valueToSql(operators.$ne));
    conditions.push(`${jsonField} != ?`);
  }

  if (operators.$gt !== undefined) {
    const resolved = resolveComparisonValue(operators.$gt);
    params.push(resolved.value);
    conditions.push(`${jsonField} > ?`);
  }

  if (operators.$gte !== undefined) {
    const resolved = resolveComparisonValue(operators.$gte);
    params.push(resolved.value);
    conditions.push(`${jsonField} >= ?`);
  }

  if (operators.$lt !== undefined) {
    const resolved = resolveComparisonValue(operators.$lt);
    params.push(resolved.value);
    conditions.push(`${jsonField} < ?`);
  }

  if (operators.$lte !== undefined) {
    const resolved = resolveComparisonValue(operators.$lte);
    params.push(resolved.value);
    conditions.push(`${jsonField} <= ?`);
  }

  if (operators.$between !== undefined) {
    const [min, max] = operators.$between;
    params.push(min, max);
    conditions.push(`${jsonField} BETWEEN ? AND ?`);
  }

  // ============================================================================
  // Array operators
  // ============================================================================

  if (operators.$in !== undefined) {
    const placeholders = operators.$in.map(() => "?").join(", ");
    params.push(...operators.$in.map(valueToSql));
    conditions.push(`${jsonField} IN (${placeholders})`);
  }

  if (operators.$nin !== undefined) {
    const placeholders = operators.$nin.map(() => "?").join(", ");
    params.push(...operators.$nin.map(valueToSql));
    conditions.push(`${jsonField} NOT IN (${placeholders})`);
  }

  // ============================================================================
  // String operators (case-sensitive)
  // Using instr() for case-sensitive operations since SQLite LIKE is case-insensitive
  // ============================================================================

  if (operators.$contains !== undefined) {
    params.push(operators.$contains);
    conditions.push(`instr(${jsonField}, ?) > 0`);
  }

  if (operators.$notContains !== undefined) {
    params.push(operators.$notContains);
    conditions.push(`instr(${jsonField}, ?) = 0`);
  }

  if (operators.$startsWith !== undefined) {
    params.push(operators.$startsWith);
    const len = operators.$startsWith.length;
    conditions.push(`substr(${jsonField}, 1, ${len}) = ?`);
  }

  if (operators.$endsWith !== undefined) {
    params.push(operators.$endsWith);
    const len = operators.$endsWith.length;
    conditions.push(`substr(${jsonField}, -${len}) = ?`);
  }

  // ============================================================================
  // String operators (case-insensitive)
  // Using LOWER() for case-insensitive comparison
  // ============================================================================

  if (operators.$containsi !== undefined) {
    params.push(`%${escapeLikePattern(operators.$containsi.toLowerCase())}%`);
    conditions.push(`LOWER(${jsonField}) LIKE ? ESCAPE '\\'`);
  }

  if (operators.$notContainsi !== undefined) {
    params.push(`%${escapeLikePattern(operators.$notContainsi.toLowerCase())}%`);
    conditions.push(`LOWER(${jsonField}) NOT LIKE ? ESCAPE '\\'`);
  }

  if (operators.$startsWithi !== undefined) {
    params.push(`${escapeLikePattern(operators.$startsWithi.toLowerCase())}%`);
    conditions.push(`LOWER(${jsonField}) LIKE ? ESCAPE '\\'`);
  }

  if (operators.$endsWithi !== undefined) {
    params.push(`%${escapeLikePattern(operators.$endsWithi.toLowerCase())}`);
    conditions.push(`LOWER(${jsonField}) LIKE ? ESCAPE '\\'`);
  }

  // ============================================================================
  // Existence operators
  // ============================================================================

  if (operators.$null !== undefined) {
    if (operators.$null) {
      conditions.push(`${jsonField} IS NULL`);
    } else {
      conditions.push(`${jsonField} IS NOT NULL`);
    }
  }

  if (operators.$empty !== undefined) {
    // Empty means: null, empty string, or empty array
    // Note: json_array_length only works on valid JSON arrays, so we wrap it in CASE
    // Using COALESCE to handle non-array types safely
    if (operators.$empty) {
      conditions.push(
        `(${jsonField} IS NULL OR ${jsonField} = '' OR (json_valid(${jsonField}) AND json_type(${jsonField}) = 'array' AND json_array_length(${jsonField}) = 0))`,
      );
    } else {
      conditions.push(
        `(${jsonField} IS NOT NULL AND ${jsonField} != '' AND (NOT json_valid(${jsonField}) OR json_type(${jsonField}) != 'array' OR json_array_length(${jsonField}) > 0))`,
      );
    }
  }

  if (operators.$notEmpty !== undefined) {
    // $notEmpty is the inverse of $empty
    if (operators.$notEmpty) {
      conditions.push(
        `(${jsonField} IS NOT NULL AND ${jsonField} != '' AND (NOT json_valid(${jsonField}) OR json_type(${jsonField}) != 'array' OR json_array_length(${jsonField}) > 0))`,
      );
    } else {
      conditions.push(
        `(${jsonField} IS NULL OR ${jsonField} = '' OR (json_valid(${jsonField}) AND json_type(${jsonField}) = 'array' AND json_array_length(${jsonField}) = 0))`,
      );
    }
  }

  return conditions.length > 0 ? conditions.join(" AND ") : "1=1";
}

/**
 * Convert a where filter to SQL WHERE clause
 *
 * @param where - The where filter object
 * @returns SQL clause and parameters
 *
 * @example
 * ```typescript
 * const { sql, params } = whereToSql({ status: { $eq: "active" } });
 * // sql: "json_extract(value, '$.status') = ?"
 * // params: ["active"]
 *
 * const { sql, params } = whereToSql({
 *   $or: [
 *     { status: { $eq: "expired" } },
 *     { expiresAt: { $lt: Date.now() } }
 *   ]
 * });
 * // sql: "(json_extract(value, '$.status') = ? OR json_extract(value, '$.expiresAt') < ?)"
 * // params: ["expired", 1234567890]
 * ```
 */
export function whereToSql(where: KvWhereFilter): WhereToSqlResult {
  const params: unknown[] = [];
  const conditions: string[] = [];

  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) {
      continue;
    }

    // Handle logical operators
    if (key === "$and" && Array.isArray(value)) {
      const andConditions = value.map((v) => {
        const result = whereToSql(v as KvWhereFilter);
        params.push(...result.params);
        return `(${result.sql})`;
      });
      if (andConditions.length > 0) {
        conditions.push(`(${andConditions.join(" AND ")})`);
      }
      continue;
    }

    if (key === "$or" && Array.isArray(value)) {
      const orConditions = value.map((v) => {
        const result = whereToSql(v as KvWhereFilter);
        params.push(...result.params);
        return `(${result.sql})`;
      });
      if (orConditions.length > 0) {
        conditions.push(`(${orConditions.join(" OR ")})`);
      }
      continue;
    }

    if (key === "$not" && typeof value === "object" && !Array.isArray(value)) {
      const result = whereToSql(value as KvWhereFilter);
      params.push(...result.params);
      conditions.push(`NOT (${result.sql})`);
      continue;
    }

    // Handle field filters
    if (isFilterOperators(value)) {
      conditions.push(operatorsToSql(key, value, params));
    } else if (typeof value !== "object" || value === null) {
      // Shorthand: { field: value } is equivalent to { field: { $eq: value } }
      params.push(valueToSql(value as KvFilterValue));
      conditions.push(`${fieldToJsonExtract(key)} = ?`);
    }
  }

  return {
    sql: conditions.length > 0 ? conditions.join(" AND ") : "1=1",
    params,
  };
}
