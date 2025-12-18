import type { CellVariant, TypeMapper } from "../types";

/**
 * SQLite type mapper
 *
 * SQLite uses dynamic typing with 5 storage classes:
 * - NULL, INTEGER, REAL, TEXT, BLOB
 *
 * Type affinity rules determine storage class from declared type.
 */
export const sqliteTypeMapper: TypeMapper = (sqlType: string): CellVariant => {
  const type = sqlType.toUpperCase();

  // Integer types
  if (
    type.includes("INT") ||
    type.includes("INTEGER") ||
    type.includes("TINYINT") ||
    type.includes("SMALLINT") ||
    type.includes("MEDIUMINT") ||
    type.includes("BIGINT")
  ) {
    return "number";
  }

  // Real/Float types
  if (
    type.includes("REAL") ||
    type.includes("FLOAT") ||
    type.includes("DOUBLE") ||
    type.includes("NUMERIC") ||
    type.includes("DECIMAL")
  ) {
    return "number";
  }

  // Boolean (SQLite stores as INTEGER 0/1)
  if (type.includes("BOOL") || type.includes("BOOLEAN")) {
    return "checkbox";
  }

  // Binary data
  if (type.includes("BLOB")) {
    return "blob";
  }

  // JSON (SQLite 3.38+)
  if (type.includes("JSON")) {
    return "json";
  }

  // Date/Time types (stored as TEXT, REAL, or INTEGER in SQLite)
  if (type.includes("DATETIME") || type.includes("TIMESTAMP")) {
    return "datetime";
  }

  if (type.includes("DATE")) {
    return "date";
  }

  // Default: text (SQLite's fallback for all other types)
  return "text";
};
