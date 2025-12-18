import type { ComponentType } from "react";

// Supported database types
export type DatabaseType = "sqlite" | "postgresql" | "mysql";

// Available cell variants
export type CellVariant =
  | "text"
  | "long-text"
  | "number"
  | "checkbox"
  | "date"
  | "datetime"
  | "json"
  | "blob"
  | "uuid"
  | "fk"
  | "enum"
  | "array";

// Row height options
export type RowHeight = "short" | "medium" | "tall";

// Column info from database schema (matches API response)
export interface ColumnInfo {
  name: string;
  nullable: boolean;
  pk: boolean;
  type: string;
}

// Foreign key info
export interface ForeignKeyInfo {
  column: string;
  referencedColumn: string;
  referencedTable: string;
}

// Props passed to all cell variant components
export interface CellVariantProps {
  columnInfo: ColumnInfo;
  databaseType: DatabaseType;
  foreignKey?: ForeignKeyInfo;
  isEditable: boolean;
  isEditing: boolean;
  rowHeight: RowHeight;
  value: unknown;
  onBlur: () => void;
  onSave: (newValue: string) => void;
}

// Cell variant component registration
export interface CellVariantComponent {
  component: ComponentType<CellVariantProps>;
}

// Type mapper function signature
export type TypeMapper = (sqlType: string, columnInfo?: ColumnInfo) => CellVariant;
