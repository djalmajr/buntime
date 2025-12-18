import type {
  CellVariant,
  CellVariantComponent,
  ColumnInfo,
  DatabaseType,
  TypeMapper,
} from "./types";

class CellVariantRegistry {
  private typeMappers = new Map<DatabaseType, TypeMapper>();
  private variants = new Map<CellVariant, CellVariantComponent>();

  /**
   * Register a cell variant component
   */
  register(variant: CellVariant, component: CellVariantComponent): void {
    this.variants.set(variant, component);
  }

  /**
   * Register a type mapper for a specific database
   */
  registerTypeMapper(db: DatabaseType, mapper: TypeMapper): void {
    this.typeMappers.set(db, mapper);
  }

  /**
   * Get a registered cell variant component
   */
  getVariant(variant: CellVariant): CellVariantComponent | undefined {
    return this.variants.get(variant);
  }

  /**
   * Map a SQL type to a cell variant for a specific database
   */
  mapTypeToVariant(db: DatabaseType, sqlType: string, columnInfo?: ColumnInfo): CellVariant {
    const mapper = this.typeMappers.get(db);
    if (mapper) {
      return mapper(sqlType, columnInfo);
    }
    // Default fallback
    return "text";
  }

  /**
   * Check if a variant is registered
   */
  hasVariant(variant: CellVariant): boolean {
    return this.variants.has(variant);
  }

  /**
   * Get all registered variant names
   */
  getRegisteredVariants(): CellVariant[] {
    return Array.from(this.variants.keys());
  }
}

// Singleton instance
export const cellRegistry = new CellVariantRegistry();
