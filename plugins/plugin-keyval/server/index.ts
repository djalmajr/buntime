import { errorToResponse } from "@buntime/shared/errors";
import type { PluginContext } from "@buntime/shared/types";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type {
  KvCreateIndexOptions,
  KvDeleteOptions,
  KvKey,
  KvSearchOptions,
  KvWhereFilter,
} from "./lib/types";
import {
  validateBigInt,
  validateExpiresIn,
  validateKey,
  validateKeyPath,
  validateKeys,
  validateLimit,
} from "./lib/validation";

// Module-level state (set by services.ts)
let kv: import("./lib/kv").Kv;
let adapter: import("@buntime/plugin-database").DatabaseAdapter;
let logger: PluginContext["logger"];

/**
 * Set module state from services
 */
export function setApiState(
  kvInstance: import("./lib/kv").Kv,
  dbAdapter: import("@buntime/plugin-database").DatabaseAdapter,
  pluginLogger: PluginContext["logger"],
): void {
  kv = kvInstance;
  adapter = dbAdapter;
  logger = pluginLogger;
}

async function getStorageStats(): Promise<{ entries: number; sizeBytes: number }> {
  const countResult = await adapter.execute<{ count: number }>(
    "SELECT COUNT(*) as count FROM kv_entries WHERE expires_at IS NULL OR expires_at > unixepoch()",
  );

  const sizeResult = await adapter.execute<{ size: number }>(
    "SELECT SUM(LENGTH(key) + LENGTH(value)) as size FROM kv_entries WHERE expires_at IS NULL OR expires_at > unixepoch()",
  );

  return {
    entries: countResult[0]?.count ?? 0,
    sizeBytes: sizeResult[0]?.size ?? 0,
  };
}

/**
 * KeyVal REST API
 *
 * Provides endpoints for key-value operations, queues, FTS, and metrics
 */
export const api = new Hono()
  .basePath("/api")
  // Atomic operations endpoint
  .post("/atomic", async (ctx) => {
    const body = await ctx.req.json<{
      checks?: Array<{ key: KvKey; versionstamp: string | null }>;
      mutations: Array<{
        type: "append" | "delete" | "max" | "min" | "prepend" | "set" | "sum";
        key: KvKey;
        value?: unknown;
        expiresIn?: number;
      }>;
    }>();

    const atomic = kv.atomic();

    // Add checks with validation
    if (body.checks) {
      for (const check of body.checks) {
        const validatedKey = validateKey(check.key);
        atomic.check({ key: validatedKey, versionstamp: check.versionstamp });
      }
    }

    // Add mutations with validation
    for (const mutation of body.mutations) {
      const key = validateKey(mutation.key);

      switch (mutation.type) {
        case "set":
          atomic.set(key, mutation.value, {
            expiresIn: validateExpiresIn(mutation.expiresIn),
          });
          break;
        case "delete":
          atomic.delete(key);
          break;
        case "sum":
          atomic.sum(key, validateBigInt(mutation.value, "sum value"));
          break;
        case "max":
          atomic.max(key, validateBigInt(mutation.value, "max value"));
          break;
        case "min":
          atomic.min(key, validateBigInt(mutation.value, "min value"));
          break;
        case "append":
          if (!Array.isArray(mutation.value)) {
            return ctx.json({ error: "append value must be an array" }, 400);
          }
          atomic.append(key, mutation.value);
          break;
        case "prepend":
          if (!Array.isArray(mutation.value)) {
            return ctx.json({ error: "prepend value must be an array" }, 400);
          }
          atomic.prepend(key, mutation.value);
          break;
      }
    }

    const result = await atomic.commit();
    return ctx.json(result);
  })
  // Batch get - single request for multiple keys
  .post("/keys/batch", async (ctx) => {
    const body = await ctx.req.json<{ keys: unknown }>();
    const keys = validateKeys(body.keys);

    const entries = await kv.get(keys);
    return ctx.json(entries);
  })
  // Batch delete - single request to delete multiple keys
  .post("/keys/delete-batch", async (ctx) => {
    const body = await ctx.req.json<{
      keys: unknown;
      exact?: boolean;
      where?: KvWhereFilter;
    }>();
    const keys = validateKeys(body.keys);
    const options: KvDeleteOptions | undefined =
      body.exact !== undefined || body.where ? { exact: body.exact, where: body.where } : undefined;

    let totalDeleted = 0;
    for (const key of keys) {
      const result = await kv.delete(key, options);
      totalDeleted += result.deletedCount;
    }

    return ctx.json({ deletedCount: totalDeleted });
  })
  .get("/keys", async (ctx) => {
    const prefix = ctx.req.query("prefix");
    const start = ctx.req.query("start");
    const end = ctx.req.query("end");
    const limit = validateLimit(ctx.req.query("limit"), 100, 1000);
    const reverse = ctx.req.query("reverse") === "true";

    const entries = [];
    const prefixKey = prefix ? validateKeyPath(prefix) : [];
    const startKey = start ? validateKeyPath(start) : undefined;
    const endKey = end ? validateKeyPath(end) : undefined;

    for await (const entry of kv.list(prefixKey, {
      start: startKey,
      end: endKey,
      limit,
      reverse,
    })) {
      entries.push({
        key: entry.key,
        value: entry.value,
        versionstamp: entry.versionstamp,
      });
    }

    return ctx.json(entries);
  })
  // List with where filter (POST for complex filters)
  .post("/keys/list", async (ctx) => {
    const body = await ctx.req.json<{
      prefix?: KvKey;
      start?: KvKey;
      end?: KvKey;
      limit?: number;
      reverse?: boolean;
      where?: KvWhereFilter;
    }>();

    const entries = [];
    const prefixKey = body.prefix ? validateKey(body.prefix) : [];
    const startKey = body.start ? validateKey(body.start) : undefined;
    const endKey = body.end ? validateKey(body.end) : undefined;
    const limit = validateLimit(body.limit?.toString(), 100, 1000);
    const reverse = body.reverse ?? false;

    for await (const entry of kv.list(prefixKey, {
      start: startKey,
      end: endKey,
      limit,
      reverse,
      where: body.where,
    })) {
      entries.push({
        key: entry.key,
        value: entry.value,
        versionstamp: entry.versionstamp,
      });
    }

    return ctx.json(entries);
  })
  // Count entries by prefix
  .get("/keys/count", async (ctx) => {
    const prefix = ctx.req.query("prefix");
    const prefixKey = prefix ? validateKeyPath(prefix) : [];

    const count = await kv.count(prefixKey);
    return ctx.json({ count });
  })
  // Paginate with cursor
  .get("/keys/paginate", async (ctx) => {
    const prefix = ctx.req.query("prefix");
    const cursor = ctx.req.query("cursor");
    const limit = validateLimit(ctx.req.query("limit"), 100, 1000);
    const reverse = ctx.req.query("reverse") === "true";

    const prefixKey = prefix ? validateKeyPath(prefix) : [];

    const result = await kv.paginate(prefixKey, {
      cursor: cursor || undefined,
      limit,
      reverse,
    });

    return ctx.json(result);
  })
  .get("/keys/*", async (ctx) => {
    const keyPath = ctx.req.path.replace(/.*\/keys\//, "");
    const key = validateKeyPath(keyPath);

    const entry = await kv.get(key);
    if (entry.value === null) {
      return ctx.json({ error: "Key not found" }, 404);
    }

    return ctx.json(entry);
  })
  .put("/keys/*", async (ctx) => {
    const keyPath = ctx.req.path.replace(/.*\/keys\//, "");
    const key = validateKeyPath(keyPath);
    const body = await ctx.req.json();
    const expiresIn = validateExpiresIn(ctx.req.query("expiresIn"));

    const result = await kv.set(key, body, { expiresIn });

    return ctx.json(result);
  })
  .delete("/keys/*", async (ctx) => {
    const keyPath = ctx.req.path.replace(/.*\/keys\//, "");
    const key = validateKeyPath(keyPath);

    // Check if there's a request body with where filter or exact option
    let options: KvDeleteOptions | undefined;
    const contentType = ctx.req.header("content-type");
    if (contentType?.includes("application/json")) {
      try {
        const body = await ctx.req.json<{ exact?: boolean; where?: KvWhereFilter }>();
        if (body?.where || body?.exact !== undefined) {
          options = { exact: body.exact, where: body.where };
        }
      } catch {
        // No body or invalid JSON, proceed without filter
      }
    }

    const result = await kv.delete(key, options);
    return ctx.json({ deletedCount: result.deletedCount });
  })
  // Queue routes
  .post("/queue/enqueue", async (ctx) => {
    const body = await ctx.req.json<{
      value: unknown;
      options?: {
        delay?: number;
        backoffSchedule?: number[];
        keysIfUndelivered?: unknown;
      };
    }>();
    const options = body.options
      ? {
          delay: body.options.delay,
          backoffSchedule: body.options.backoffSchedule,
          keysIfUndelivered: body.options.keysIfUndelivered
            ? validateKeys(body.options.keysIfUndelivered)
            : undefined,
        }
      : undefined;
    const result = await kv.queue.enqueue(body.value, options);
    return ctx.json(result);
  })
  .get("/queue/listen", async (ctx) => {
    return streamSSE(ctx, async (stream) => {
      const abortController = new AbortController();

      ctx.req.raw.signal.addEventListener("abort", () => {
        abortController.abort();
      });

      while (!abortController.signal.aborted) {
        const msg = await kv.queue.dequeue();

        if (msg) {
          await stream.writeSSE({
            data: JSON.stringify(msg),
            event: "message",
            id: msg.id,
          });
        } else {
          // Heartbeat to keep connection alive
          await stream.writeSSE({ data: "", event: "ping" });
        }

        // Small delay to prevent CPU overload
        await new Promise((r) => setTimeout(r, 100));
      }
    });
  })
  .get("/queue/poll", async (ctx) => {
    const msg = await kv.queue.dequeue();
    return ctx.json({ message: msg });
  })
  .post("/queue/ack", async (ctx) => {
    const body = await ctx.req.json<{ id: unknown }>();
    if (typeof body.id !== "string" || !body.id) {
      return ctx.json({ error: "id must be a non-empty string" }, 400);
    }
    await kv.queue.ack(body.id);
    return ctx.json({ ok: true });
  })
  .post("/queue/nack", async (ctx) => {
    const body = await ctx.req.json<{ id: unknown }>();
    if (typeof body.id !== "string" || !body.id) {
      return ctx.json({ error: "id must be a non-empty string" }, 400);
    }
    await kv.queue.nack(body.id);
    return ctx.json({ ok: true });
  })
  .get("/queue/stats", async (ctx) => {
    const stats = await kv.queue.stats();
    return ctx.json(stats);
  })
  // DLQ routes
  .get("/queue/dlq", async (ctx) => {
    const limit = validateLimit(ctx.req.query("limit"), 100, 1000);
    const offset = parseInt(ctx.req.query("offset") || "0", 10);
    const messages = await kv.queue.listDlq({ limit, offset });
    return ctx.json(messages);
  })
  .get("/queue/dlq/:id", async (ctx) => {
    const id = ctx.req.param("id");
    const message = await kv.queue.getDlqMessage(id);
    if (!message) {
      return ctx.json({ error: "Message not found in DLQ" }, 404);
    }
    return ctx.json(message);
  })
  .post("/queue/dlq/:id/requeue", async (ctx) => {
    const id = ctx.req.param("id");
    const result = await kv.queue.requeueDlq(id);
    if (!result.ok) {
      return ctx.json({ error: result.error }, 404);
    }
    return ctx.json(result);
  })
  .delete("/queue/dlq/:id", async (ctx) => {
    const id = ctx.req.param("id");
    await kv.queue.deleteDlq(id);
    return ctx.json({ ok: true });
  })
  .delete("/queue/dlq", async (ctx) => {
    const result = await kv.queue.purgeDlq();
    return ctx.json(result);
  })
  // Metrics routes
  .get("/metrics", async (ctx) => {
    const queueStats = await kv.queue.stats();
    const storageStats = await getStorageStats();

    return ctx.json({
      operations: kv.metrics.toJSON(),
      queue: queueStats,
      storage: storageStats,
    });
  })
  .get("/metrics/prometheus", async (ctx) => {
    const queueStats = await kv.queue.stats();
    const storageStats = await getStorageStats();

    const lines: string[] = [];

    // Operation metrics
    lines.push(kv.metrics.toPrometheus("keyval"));

    // Queue metrics
    lines.push("# HELP keyval_queue_pending Pending messages in queue");
    lines.push("# TYPE keyval_queue_pending gauge");
    lines.push(`keyval_queue_pending ${queueStats.pending}`);

    lines.push("# HELP keyval_queue_processing Messages being processed");
    lines.push("# TYPE keyval_queue_processing gauge");
    lines.push(`keyval_queue_processing ${queueStats.processing}`);

    lines.push("# HELP keyval_queue_dlq Messages in dead letter queue");
    lines.push("# TYPE keyval_queue_dlq gauge");
    lines.push(`keyval_queue_dlq ${queueStats.dlq}`);

    lines.push("# HELP keyval_queue_total Total messages in queue");
    lines.push("# TYPE keyval_queue_total gauge");
    lines.push(`keyval_queue_total ${queueStats.total}`);

    // Storage metrics
    lines.push("# HELP keyval_entries_total Total entries in store");
    lines.push("# TYPE keyval_entries_total gauge");
    lines.push(`keyval_entries_total ${storageStats.entries}`);

    lines.push("# HELP keyval_storage_bytes Storage size in bytes");
    lines.push("# TYPE keyval_storage_bytes gauge");
    lines.push(`keyval_storage_bytes ${storageStats.sizeBytes}`);

    ctx.header("Content-Type", "text/plain; version=0.0.4");
    return ctx.text(lines.join("\n"));
  })
  // Watch routes
  .get("/watch", async (ctx) => {
    // Watch multiple keys via query param: ?keys=users/123,posts/456
    const keysParam = ctx.req.query("keys");
    if (!keysParam) {
      return ctx.json({ error: "Missing 'keys' query parameter" }, 400);
    }

    const keys = keysParam.split(",").map((k) => validateKeyPath(k));
    const emitInitial = ctx.req.query("initial") !== "false";

    return streamSSE(ctx, async (stream) => {
      const abortController = new AbortController();
      const versionstamps = new Map<string, string | null>();

      ctx.req.raw.signal.addEventListener("abort", () => {
        abortController.abort();
      });

      // Initialize versionstamps
      for (const key of keys) {
        const keyStr = key.join("/");
        versionstamps.set(keyStr, null);
      }

      let isFirst = true;

      while (!abortController.signal.aborted) {
        const changedEntries: Array<{
          key: unknown[];
          value: unknown;
          versionstamp: string | null;
        }> = [];

        // Check each key for changes
        for (const key of keys) {
          const keyStr = key.join("/");
          const entry = await kv.get(key);
          const lastVs = versionstamps.get(keyStr);

          // Emit if versionstamp changed or if initial emit requested
          if (entry.versionstamp !== lastVs || (isFirst && emitInitial)) {
            versionstamps.set(keyStr, entry.versionstamp);
            changedEntries.push({
              key: entry.key,
              value: entry.value,
              versionstamp: entry.versionstamp,
            });
          }
        }

        isFirst = false;

        if (changedEntries.length > 0) {
          await stream.writeSSE({
            data: JSON.stringify(changedEntries),
            event: "change",
          });
        } else {
          // Heartbeat to keep connection alive
          await stream.writeSSE({ data: "", event: "ping" });
        }

        // Poll interval (100ms for low latency)
        await new Promise((r) => setTimeout(r, 100));
      }
    });
  })
  .get("/watch/poll", async (ctx) => {
    // Poll mode: single request to check for changes
    const keysParam = ctx.req.query("keys");
    const versionstampsParam = ctx.req.query("versionstamps");

    if (!keysParam) {
      return ctx.json({ error: "Missing 'keys' query parameter" }, 400);
    }

    const keys = keysParam.split(",").map((k) => validateKeyPath(k));
    const lastVersionstamps = versionstampsParam ? versionstampsParam.split(",") : [];

    const entries: Array<{ key: unknown[]; value: unknown; versionstamp: string | null }> = [];
    const currentVersionstamps: string[] = [];

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (!key) continue;

      const entry = await kv.get(key);
      const lastVs = lastVersionstamps[i] || null;

      currentVersionstamps.push(entry.versionstamp || "");

      // Only include if changed
      if (entry.versionstamp !== lastVs) {
        entries.push({
          key: entry.key,
          value: entry.value,
          versionstamp: entry.versionstamp,
        });
      }
    }

    return ctx.json({
      entries,
      versionstamps: currentVersionstamps,
    });
  })
  // Watch by prefix (SSE)
  .get("/watch/prefix", async (ctx) => {
    const prefixParam = ctx.req.query("prefix");
    if (!prefixParam) {
      return ctx.json({ error: "Missing 'prefix' query parameter" }, 400);
    }

    const prefix = validateKeyPath(prefixParam);
    const emitInitial = ctx.req.query("initial") !== "false";
    const limit = validateLimit(ctx.req.query("limit"), 100, 1000);

    return streamSSE(ctx, async (stream) => {
      const abortController = new AbortController();
      const versionstamps = new Map<string, string | null>();

      ctx.req.raw.signal.addEventListener("abort", () => {
        abortController.abort();
      });

      let isFirst = true;

      while (!abortController.signal.aborted) {
        const changedEntries: Array<{
          key: unknown[];
          value: unknown;
          versionstamp: string | null;
        }> = [];

        // Get all entries with the prefix
        const currentKeys = new Set<string>();

        for await (const entry of kv.list(prefix, { limit })) {
          const keyStr = entry.key.join("/");
          currentKeys.add(keyStr);
          const lastVs = versionstamps.get(keyStr);

          // Emit if versionstamp changed, key is new, or initial emit
          if (entry.versionstamp !== lastVs || (isFirst && emitInitial)) {
            versionstamps.set(keyStr, entry.versionstamp);
            changedEntries.push({
              key: entry.key,
              value: entry.value,
              versionstamp: entry.versionstamp,
            });
          }
        }

        // Check for deleted keys
        for (const [keyStr, lastVs] of versionstamps) {
          if (!currentKeys.has(keyStr) && lastVs !== null) {
            // Key was deleted
            const keyParts = keyStr.split("/");
            changedEntries.push({
              key: keyParts,
              value: null,
              versionstamp: null,
            });
            versionstamps.set(keyStr, null);
          }
        }

        isFirst = false;

        if (changedEntries.length > 0) {
          await stream.writeSSE({
            data: JSON.stringify(changedEntries),
            event: "change",
          });
        } else {
          // Heartbeat
          await stream.writeSSE({ data: "", event: "ping" });
        }

        // Poll interval
        await new Promise((r) => setTimeout(r, 100));
      }
    });
  })
  // Watch by prefix (poll mode)
  .get("/watch/prefix/poll", async (ctx) => {
    const prefixParam = ctx.req.query("prefix");
    const lastVersionstampsParam = ctx.req.query("versionstamps");

    if (!prefixParam) {
      return ctx.json({ error: "Missing 'prefix' query parameter" }, 400);
    }

    const prefix = validateKeyPath(prefixParam);
    const limit = validateLimit(ctx.req.query("limit"), 100, 1000);

    // Parse last versionstamps: "key1:vs1,key2:vs2"
    const lastVsMap = new Map<string, string>();
    if (lastVersionstampsParam) {
      for (const pair of lastVersionstampsParam.split(",")) {
        const [key, vs] = pair.split(":");
        if (key && vs) {
          lastVsMap.set(key, vs);
        }
      }
    }

    const entries: Array<{ key: unknown[]; value: unknown; versionstamp: string | null }> = [];
    const currentVsMap = new Map<string, string>();

    for await (const entry of kv.list(prefix, { limit })) {
      const keyStr = entry.key.join("/");
      if (entry.versionstamp) {
        currentVsMap.set(keyStr, entry.versionstamp);
      }

      const lastVs = lastVsMap.get(keyStr);

      // Include if changed or new
      if (entry.versionstamp !== lastVs) {
        entries.push({
          key: entry.key,
          value: entry.value,
          versionstamp: entry.versionstamp,
        });
      }
    }

    // Check for deleted keys
    for (const [keyStr, lastVs] of lastVsMap) {
      if (!currentVsMap.has(keyStr) && lastVs) {
        const keyParts = keyStr.split("/");
        entries.push({
          key: keyParts,
          value: null,
          versionstamp: null,
        });
      }
    }

    // Format versionstamps for response: "key1:vs1,key2:vs2"
    const versionstamps = Array.from(currentVsMap.entries())
      .map(([k, v]) => `${k}:${v}`)
      .join(",");

    return ctx.json({
      entries,
      versionstamps,
    });
  })
  // FTS routes
  .post("/indexes", async (ctx) => {
    const body = await ctx.req.json<{
      prefix: KvKey;
      options: KvCreateIndexOptions;
    }>();

    const prefix = validateKey(body.prefix);

    if (!body.options?.fields || !Array.isArray(body.options.fields)) {
      return ctx.json({ error: "options.fields must be a non-empty array" }, 400);
    }

    if (body.options.fields.length === 0) {
      return ctx.json({ error: "At least one field must be specified" }, 400);
    }

    await kv.fts.createIndex(prefix, body.options);

    return ctx.json({ ok: true });
  })
  .get("/indexes", async (ctx) => {
    const indexes = await kv.fts.listIndexes();
    return ctx.json(indexes);
  })
  .delete("/indexes", async (ctx) => {
    const prefixParam = ctx.req.query("prefix");
    if (!prefixParam) {
      return ctx.json({ error: "Missing 'prefix' query parameter" }, 400);
    }

    const prefix = validateKeyPath(prefixParam);
    await kv.fts.removeIndex(prefix);

    return ctx.json({ ok: true });
  })
  .get("/search", async (ctx) => {
    const prefixParam = ctx.req.query("prefix");
    const query = ctx.req.query("query");

    if (!prefixParam) {
      return ctx.json({ error: "Missing 'prefix' query parameter" }, 400);
    }
    if (!query) {
      return ctx.json({ error: "Missing 'query' query parameter" }, 400);
    }

    const prefix = validateKeyPath(prefixParam);
    const limit = validateLimit(ctx.req.query("limit"), 100, 1000);

    const results = await kv.fts.search(prefix, query, { limit });

    return ctx.json(results);
  })
  // Search with POST for complex filters
  .post("/search", async (ctx) => {
    const body = await ctx.req.json<{
      prefix: KvKey;
      query: string;
      options?: KvSearchOptions;
    }>();

    if (!body.prefix) {
      return ctx.json({ error: "prefix is required" }, 400);
    }
    if (!body.query) {
      return ctx.json({ error: "query is required" }, 400);
    }

    const prefix = validateKey(body.prefix);
    const limit = validateLimit(body.options?.limit?.toString(), 100, 1000);

    const results = await kv.fts.search(prefix, body.query, {
      limit,
      where: body.options?.where,
    });

    return ctx.json(results);
  })
  // Error handler for validation errors
  .onError((err, ctx) => {
    if (err.name === "HTTPException" && "status" in err) {
      const status = (err as unknown as { status: number }).status;
      return ctx.json({ error: err.message }, status as 400 | 404 | 500);
    }
    logger?.error("KeyVal route error", { error: err.message });
    return ctx.json({ error: "Internal server error" }, 500);
  });

export type KeyvalRoutesType = typeof api;
