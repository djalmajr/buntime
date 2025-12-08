import type { BasePluginConfig, BuntimePlugin, PluginContext } from "@buntime/shared/types";
import { type Client, createClient } from "@libsql/client";
import { Hono } from "hono";
import { Kv } from "./kv";
import { initSchema } from "./schema";

export interface KeyValConfig extends BasePluginConfig {
  /**
   * libSQL database URL
   * Supports ${ENV_VAR} syntax
   * @default "file:./keyval.db"
   */
  libsqlUrl?: string;

  /**
   * libSQL auth token (for remote databases)
   * Supports ${ENV_VAR} syntax
   */
  libsqlToken?: string;
}

let client: Client;
let kv: Kv;
let logger: PluginContext["logger"];

function substituteEnvVars(str: string): string {
  return str.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? "");
}

const routes = new Hono()
  .get("/keys", async (ctx) => {
    const prefix = ctx.req.query("prefix");
    const limit = parseInt(ctx.req.query("limit") || "100", 10);

    const entries = [];
    const prefixKey = prefix ? prefix.split("/").filter(Boolean) : [];

    for await (const entry of kv.list({ prefix: prefixKey, limit })) {
      entries.push({
        key: entry.key,
        versionstamp: entry.versionstamp,
      });
    }

    return ctx.json(entries);
  })
  .get("/keys/*", async (ctx) => {
    const keyPath = ctx.req.path.replace("/keys/", "");
    const key = keyPath.split("/").filter(Boolean);

    const entry = await kv.get(key);
    if (entry.value === null) {
      return ctx.json({ error: "Key not found" }, 404);
    }

    return ctx.json(entry);
  })
  .put("/keys/*", async (ctx) => {
    const keyPath = ctx.req.path.replace("/keys/", "");
    const key = keyPath.split("/").filter(Boolean);
    const body = await ctx.req.json();
    const expireIn = ctx.req.query("expireIn");

    const result = await kv.set(key, body, {
      expireIn: expireIn ? parseInt(expireIn, 10) : undefined,
    });

    return ctx.json(result);
  })
  .delete("/keys/*", async (ctx) => {
    const keyPath = ctx.req.path.replace("/keys/", "");
    const key = keyPath.split("/").filter(Boolean);

    await kv.delete(key);
    return ctx.json({ success: true });
  });

/**
 * KeyVal extension for Buntime
 *
 * Provides a Deno KV-like key-value store with:
 * - Composite keys (array of parts)
 * - TTL support (expireIn)
 * - Atomic transactions with optimistic concurrency control
 * - Prefix-based listing
 *
 * @example
 * ```typescript
 * // buntime.config.ts
 * export default {
 *   plugins: [
 *     ["@buntime/keyval", {
 *       libsqlUrl: "${LIBSQL_URL}",
 *       libsqlToken: "${LIBSQL_TOKEN}",
 *     }],
 *   ],
 * }
 * ```
 */
export default function keyvalExtension(config: KeyValConfig = {}): BuntimePlugin {
  return {
    name: "@buntime/plugin-keyval",
    mountPath: config.mountPath,
    priority: 30,
    version: "1.0.0",

    async onInit(ctx: PluginContext) {
      logger = ctx.logger;

      const url = config.libsqlUrl
        ? substituteEnvVars(config.libsqlUrl)
        : "file:./keyval.db";

      const authToken = config.libsqlToken
        ? substituteEnvVars(config.libsqlToken)
        : undefined;

      client = createClient({ url, authToken });
      await initSchema(client);

      kv = new Kv(client);

      logger.info(`KeyVal initialized (storage: ${url})`);
    },

    async onShutdown() {
      kv?.close();
      client?.close();
    },

    routes,
  };
}

// Named exports
export { keyvalExtension };
export { AtomicOperation } from "./atomic";
export { Kv } from "./kv";
export { initSchema } from "./schema";
export type {
  KvCheck,
  KvCommitError,
  KvCommitResult,
  KvEntry,
  KvKey,
  KvKeyPart,
  KvListOptions,
  KvMutation,
  KvSetOptions,
} from "./types";
