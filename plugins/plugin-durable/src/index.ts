import type { BasePluginConfig, BuntimePlugin, PluginContext } from "@buntime/shared/types";
import { type Client, createClient } from "@libsql/client/http";
import { Hono } from "hono";
import { DurableObjectRegistry } from "./registry";
import { initDatabase } from "./storage";

export interface DurableObjectsConfig extends BasePluginConfig {
  /**
   * Time in ms before idle objects hibernate
   * @default 60000
   */
  hibernateAfter?: number;

  /**
   * libSQL auth token (for remote databases)
   * Supports ${ENV_VAR} syntax
   */
  libsqlToken?: string;

  /**
   * libSQL database URL
   * Supports ${ENV_VAR} syntax
   * @default "file:./durable-objects.db"
   */
  libsqlUrl?: string;

  /**
   * Maximum number of objects to keep in memory
   * @default 1000
   */
  maxObjects?: number;
}

let client: Client;
let registry: DurableObjectRegistry;
let logger: PluginContext["logger"];

function substituteEnvVars(str: string): string {
  return str.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? "");
}

const routes = new Hono()
  .get("/", async (ctx) => {
    const objects = await registry.listAll();
    return ctx.json(objects);
  })
  .get("/:id", async (ctx) => {
    const id = ctx.req.param("id");
    const object = await registry.getInfo(id);
    if (!object) {
      return ctx.json({ error: "Object not found" }, 404);
    }
    return ctx.json(object);
  })
  .delete("/:id", async (ctx) => {
    const id = ctx.req.param("id");
    const deleted = await registry.delete(id);
    if (!deleted) {
      return ctx.json({ error: "Object not found" }, 404);
    }
    return ctx.json({ success: true });
  });

/**
 * Durable Objects extension for Buntime
 *
 * Provides Cloudflare-like Durable Objects with:
 * - Singleton instances by ID
 * - Persistent storage via libSQL
 * - Request serialization (single-threaded execution)
 * - Automatic hibernation and wake-up
 *
 * @example
 * ```typescript
 * // buntime.config.ts
 * export default {
 *   plugins: [
 *     ["@buntime/durable", {
 *       libsqlUrl: "${LIBSQL_URL}",
 *       libsqlToken: "${LIBSQL_TOKEN}",
 *     }],
 *   ],
 * }
 * ```
 */
export default function durableObjectsExtension(config: DurableObjectsConfig = {}): BuntimePlugin {
  return {
    name: "@buntime/plugin-durable",
    mountPath: config.mountPath,
    version: "1.0.0",

    async onInit(ctx: PluginContext) {
      logger = ctx.logger;

      const url = config.libsqlUrl
        ? substituteEnvVars(config.libsqlUrl)
        : "file:./durable-objects.db";

      const authToken = config.libsqlToken ? substituteEnvVars(config.libsqlToken) : undefined;

      client = createClient({ url, authToken });
      await initDatabase(client);

      registry = new DurableObjectRegistry(client, {
        hibernateAfter: config.hibernateAfter ?? 60_000,
        maxObjects: config.maxObjects ?? 1000,
      });

      logger.info(`Durable Objects initialized (storage: ${url})`);
    },

    async onShutdown() {
      await registry?.shutdown();
      client?.close();
    },

    routes,
  };
}

// Named exports
export { durableObjectsExtension };
export { DurableObjectRegistry } from "./registry";
export { DurableObjectStorage, initDatabase } from "./storage";
