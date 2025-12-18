import type { CellVariant, TypeMapper } from "../types";

/**
 * PostgreSQL type mapper
 *
 * PostgreSQL has a rich type system with many specialized types.
 */
export const postgresTypeMapper: TypeMapper = (sqlType: string): CellVariant => {
  const type = sqlType.toLowerCase();

  // UUID
  if (type === "uuid") {
    return "uuid";
  }

  // JSON types
  if (type === "json" || type === "jsonb") {
    return "json";
  }

  // Binary data
  if (type === "bytea") {
    return "blob";
  }

  // Boolean
  if (type === "boolean" || type === "bool") {
    return "checkbox";
  }

  // Integer types
  if (
    type === "smallint" ||
    type === "integer" ||
    type === "bigint" ||
    type === "int2" ||
    type === "int4" ||
    type === "int8" ||
    type === "serial" ||
    type === "smallserial" ||
    type === "bigserial"
  ) {
    return "number";
  }

  // Floating point types
  if (
    type === "real" ||
    type === "double precision" ||
    type === "float4" ||
    type === "float8" ||
    type === "numeric" ||
    type === "decimal" ||
    type === "money"
  ) {
    return "number";
  }

  // Date/Time types
  if (
    type === "timestamp" ||
    type === "timestamptz" ||
    type === "timestamp with time zone" ||
    type === "timestamp without time zone"
  ) {
    return "datetime";
  }

  if (type === "date") {
    return "date";
  }

  // Array types
  if (type.endsWith("[]") || type.startsWith("_")) {
    return "array";
  }

  // Enum types (would need additional schema info to detect)
  // For now, fall through to text

  // Text types: text, varchar, char, name, etc.
  return "text";
};
