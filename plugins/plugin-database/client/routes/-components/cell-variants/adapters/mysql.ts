import type { CellVariant, TypeMapper } from "../types";

/**
 * MySQL type mapper
 *
 * MySQL has various data types with some overlap with standard SQL.
 */
export const mysqlTypeMapper: TypeMapper = (sqlType: string): CellVariant => {
  const type = sqlType.toLowerCase();

  // JSON
  if (type === "json") {
    return "json";
  }

  // Binary/BLOB types
  if (
    type === "blob" ||
    type === "tinyblob" ||
    type === "mediumblob" ||
    type === "longblob" ||
    type === "binary" ||
    type === "varbinary"
  ) {
    return "blob";
  }

  // Boolean (TINYINT(1) is MySQL's boolean)
  if (type === "tinyint(1)" || type === "bool" || type === "boolean") {
    return "checkbox";
  }

  // Integer types
  if (
    type.includes("int") ||
    type === "tinyint" ||
    type === "smallint" ||
    type === "mediumint" ||
    type === "bigint"
  ) {
    return "number";
  }

  // Floating point types
  if (
    type === "float" ||
    type === "double" ||
    type === "decimal" ||
    type === "numeric" ||
    type.startsWith("decimal") ||
    type.startsWith("float") ||
    type.startsWith("double")
  ) {
    return "number";
  }

  // Date/Time types
  if (type === "datetime" || type === "timestamp") {
    return "datetime";
  }

  if (type === "date") {
    return "date";
  }

  // Enum type
  if (type.startsWith("enum")) {
    return "enum";
  }

  // Set type (multiple values from enum)
  if (type.startsWith("set")) {
    return "array";
  }

  // Text types: varchar, char, text, tinytext, mediumtext, longtext
  return "text";
};
