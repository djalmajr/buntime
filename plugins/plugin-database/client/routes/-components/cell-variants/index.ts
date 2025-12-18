// Export types

// Export registry
export { cellRegistry } from "./registry";
export * from "./types";

// Database adapters
import { mysqlTypeMapper } from "./adapters/mysql";
import { postgresTypeMapper } from "./adapters/postgresql";
import { sqliteTypeMapper } from "./adapters/sqlite";
// Common variants
import { CheckboxCell } from "./common/checkbox-cell";
import { NumberCell } from "./common/number-cell";
import { TextCell } from "./common/text-cell";
// Import and register all variants
import { cellRegistry } from "./registry";
// Special variants
import { JsonCell } from "./special/json-cell";
import { UuidCell } from "./special/uuid-cell";

// Register common cell variants
cellRegistry.register("text", { component: TextCell });
cellRegistry.register("long-text", { component: TextCell }); // Same as text for now
cellRegistry.register("number", { component: NumberCell });
cellRegistry.register("checkbox", { component: CheckboxCell });

// Register special cell variants
cellRegistry.register("json", { component: JsonCell });
cellRegistry.register("uuid", { component: UuidCell });

// Fallback variants (use text for unimplemented variants)
cellRegistry.register("date", { component: TextCell });
cellRegistry.register("datetime", { component: TextCell });
cellRegistry.register("blob", { component: TextCell });
cellRegistry.register("fk", { component: TextCell });
cellRegistry.register("enum", { component: TextCell });
cellRegistry.register("array", { component: TextCell });

// Register database type mappers
cellRegistry.registerTypeMapper("sqlite", sqliteTypeMapper);
cellRegistry.registerTypeMapper("postgresql", postgresTypeMapper);
cellRegistry.registerTypeMapper("mysql", mysqlTypeMapper);
