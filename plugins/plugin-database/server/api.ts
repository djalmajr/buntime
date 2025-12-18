import type { PluginLogger } from "@buntime/shared/types";
import { Hono } from "hono";
import type { DatabaseServiceImpl } from "./service";
import type { AdapterType } from "./types";

let service: DatabaseServiceImpl | null = null;
let logger: PluginLogger;

export function setService(svc: DatabaseServiceImpl, log: PluginLogger) {
  service = svc;
  logger = log;
}

export const api = new Hono()
  .basePath("/api")
  .onError((err, ctx) => {
    logger?.error("Database plugin error", { error: err.message });
    return ctx.json({ error: err.message }, 500);
  })
  // List available adapters
  .get("/adapters", (ctx) => {
    if (!service) {
      return ctx.json({ error: "Service not initialized" }, 500);
    }

    return ctx.json({
      adapters: service.getAvailableTypes(),
      default: service.getDefaultType(),
    });
  })
  // List tenants (optional type query param)
  .get("/tenants", async (ctx) => {
    if (!service) {
      return ctx.json({ error: "Service not initialized" }, 500);
    }

    const type = ctx.req.query("type") as AdapterType | undefined;
    const tenants = await service.listTenants(type);
    return ctx.json({ tenants, type: type ?? service.getDefaultType() });
  })
  // Create tenant
  .post("/tenants", async (ctx) => {
    if (!service) {
      return ctx.json({ error: "Service not initialized" }, 500);
    }

    const body = await ctx.req.json<{ id?: string; type?: AdapterType }>();
    if (!body.id || typeof body.id !== "string") {
      return ctx.json({ error: "Missing or invalid tenant id" }, 400);
    }

    await service.createTenant(body.id, body.type);
    return ctx.json({ ok: true, id: body.id, type: body.type ?? service.getDefaultType() }, 201);
  })
  // Delete tenant
  .delete("/tenants/:id", async (ctx) => {
    if (!service) {
      return ctx.json({ error: "Service not initialized" }, 500);
    }

    const id = ctx.req.param("id");
    const type = ctx.req.query("type") as AdapterType | undefined;
    await service.deleteTenant(id, type);
    return ctx.json({ ok: true });
  })
  // List tables in database
  .get("/tables", async (ctx) => {
    if (!service) {
      return ctx.json({ error: "Service not initialized" }, 500);
    }

    const type = ctx.req.query("type") as AdapterType | undefined;
    const tenantId = ctx.req.query("tenant") || undefined;

    try {
      const adapter = await service.getAdapter(type, tenantId);
      const resolvedType = type ?? service.getDefaultType();

      // Query to list tables varies by database type
      let tables: Array<{ name: string; type: string }> = [];

      if (resolvedType === "libsql" || resolvedType === "sqlite") {
        const result = await adapter.execute<{ name: string; type: string }>(
          "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
        );
        tables = result;
      } else if (resolvedType === "postgres") {
        const result = await adapter.execute<{ name: string; type: string }>(
          "SELECT table_name as name, table_type as type FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
        );
        tables = result;
      } else if (resolvedType === "mysql") {
        const result = await adapter.execute<{ name: string; type: string }>(
          "SELECT table_name as name, table_type as type FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name",
        );
        tables = result;
      }

      return ctx.json({ tables, type: resolvedType });
    } catch (error) {
      return ctx.json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
    }
  })
  // Get table schema (columns)
  .get("/tables/:name/schema", async (ctx) => {
    if (!service) {
      return ctx.json({ error: "Service not initialized" }, 500);
    }

    const tableName = ctx.req.param("name");
    const type = ctx.req.query("type") as AdapterType | undefined;
    const tenantId = ctx.req.query("tenant") || undefined;

    try {
      const adapter = await service.getAdapter(type, tenantId);
      const resolvedType = type ?? service.getDefaultType();

      let columns: Array<{ name: string; type: string; nullable: boolean; pk: boolean }> = [];

      if (resolvedType === "libsql" || resolvedType === "sqlite") {
        const result = await adapter.execute<{
          cid: number;
          dflt_value: unknown;
          name: string;
          notnull: number;
          pk: number;
          type: string;
        }>(`PRAGMA table_info("${tableName}")`);
        columns = result.map((col) => ({
          name: col.name,
          nullable: col.notnull === 0,
          pk: col.pk === 1,
          type: col.type,
        }));
      } else if (resolvedType === "postgres") {
        const result = await adapter.execute<{
          column_name: string;
          data_type: string;
          is_nullable: string;
          is_pk: boolean;
        }>(`
          SELECT c.column_name, c.data_type, c.is_nullable,
            EXISTS(SELECT 1 FROM information_schema.table_constraints tc
              JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
              WHERE tc.table_name = c.table_name AND tc.constraint_type = 'PRIMARY KEY' AND kcu.column_name = c.column_name
            ) as is_pk
          FROM information_schema.columns c
          WHERE c.table_name = '${tableName}' AND c.table_schema = 'public'
          ORDER BY c.ordinal_position
        `);
        columns = result.map((col) => ({
          name: col.column_name,
          nullable: col.is_nullable === "YES",
          pk: col.is_pk,
          type: col.data_type,
        }));
      } else if (resolvedType === "mysql") {
        const result = await adapter.execute<{
          COLUMN_KEY: string;
          COLUMN_NAME: string;
          DATA_TYPE: string;
          IS_NULLABLE: string;
        }>(`
          SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY
          FROM information_schema.columns
          WHERE table_name = '${tableName}' AND table_schema = DATABASE()
          ORDER BY ordinal_position
        `);
        columns = result.map((col) => ({
          name: col.COLUMN_NAME,
          nullable: col.IS_NULLABLE === "YES",
          pk: col.COLUMN_KEY === "PRI",
          type: col.DATA_TYPE,
        }));
      }

      return ctx.json({ columns, table: tableName, type: resolvedType });
    } catch (error) {
      return ctx.json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
    }
  })
  // Query table data
  .get("/tables/:name/rows", async (ctx) => {
    if (!service) {
      return ctx.json({ error: "Service not initialized" }, 500);
    }

    const tableName = ctx.req.param("name");
    const type = ctx.req.query("type") as AdapterType | undefined;
    const tenantId = ctx.req.query("tenant") || undefined;
    const limit = Math.min(Number(ctx.req.query("limit")) || 100, 1000);
    const offset = Number(ctx.req.query("offset")) || 0;

    try {
      const adapter = await service.getAdapter(type, tenantId);
      const resolvedType = type ?? service.getDefaultType();

      // Get total count
      const countResult = await adapter.executeOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM "${tableName}"`,
      );
      const total = countResult?.count ?? 0;

      // For SQLite/libSQL, get schema to identify BLOB columns and cast them to TEXT
      let selectColumns = "*";
      if (resolvedType === "libsql" || resolvedType === "sqlite") {
        const schema = await adapter.execute<{ name: string; type: string }>(
          `PRAGMA table_info("${tableName}")`,
        );
        const columnExprs = schema.map((col) =>
          col.type.toUpperCase() === "BLOB"
            ? `CAST("${col.name}" AS TEXT) as "${col.name}"`
            : `"${col.name}"`,
        );
        if (columnExprs.length > 0) {
          selectColumns = columnExprs.join(", ");
        }
      }

      // Get rows with BLOB columns cast to TEXT
      const rows = await adapter.execute(
        `SELECT ${selectColumns} FROM "${tableName}" LIMIT ${limit} OFFSET ${offset}`,
      );

      return ctx.json({ limit, offset, rows, table: tableName, total });
    } catch (error) {
      return ctx.json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
    }
  })
  // Execute raw SQL query (for studio)
  .post("/query", async (ctx) => {
    if (!service) {
      return ctx.json({ error: "Service not initialized" }, 500);
    }

    const body = await ctx.req.json<{ sql?: string; tenant?: string; type?: AdapterType }>();
    if (!body.sql || typeof body.sql !== "string") {
      return ctx.json({ error: "Missing or invalid SQL query" }, 400);
    }

    const type = body.type;
    const tenantId = body.tenant || undefined;

    try {
      const adapter = await service.getAdapter(type, tenantId);
      const startTime = performance.now();
      const rows = await adapter.execute(body.sql);
      const duration = Math.round(performance.now() - startTime);

      return ctx.json({ duration, rowCount: rows.length, rows });
    } catch (error) {
      return ctx.json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
    }
  })
  // Health check (checks all adapters or specific one)
  .get("/health", async (ctx) => {
    if (!service) {
      return ctx.json({ error: "Service not initialized", status: "unhealthy" }, 500);
    }

    const type = ctx.req.query("type") as AdapterType | undefined;

    try {
      if (type) {
        // Check specific adapter
        const adapter = service.getRootAdapter(type);
        await adapter.execute("SELECT 1");
        return ctx.json({ status: "healthy", type });
      }

      // Check all adapters
      const results: Record<string, string> = {};
      for (const adapterType of service.getAvailableTypes()) {
        try {
          const adapter = service.getRootAdapter(adapterType);
          await adapter.execute("SELECT 1");
          results[adapterType] = "healthy";
        } catch (error) {
          results[adapterType] = error instanceof Error ? error.message : "unhealthy";
        }
      }

      const allHealthy = Object.values(results).every((s) => s === "healthy");
      return ctx.json({ status: allHealthy ? "healthy" : "degraded", adapters: results });
    } catch (error) {
      return ctx.json(
        {
          error: error instanceof Error ? error.message : "Unknown error",
          status: "unhealthy",
        },
        500,
      );
    }
  });
