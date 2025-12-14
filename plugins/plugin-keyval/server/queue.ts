import type { DatabaseAdapter } from "@buntime/plugin-database";
import { deserializeValue, serializeValue } from "./encoding";
import type { Kv } from "./kv";
import type { KvEnqueueOptions, KvKey, KvQueueListenerConfig, KvQueueMessage } from "./types";

const DEFAULT_BACKOFF_SCHEDULE = [1000, 5000, 10000];
const LOCK_DURATION_MS = 30_000; // 30 seconds
const DEFAULT_CLEANUP_INTERVAL = 60_000; // 60 seconds

/**
 * Queue cleanup configuration options
 */
export interface KvQueueCleanupConfig {
  /**
   * Cleanup interval in ms (0 to disable automatic cleanup)
   * @default 60000
   */
  cleanupInterval?: number;

  /**
   * Lock duration in ms for processing messages
   * Messages locked longer than this will be reset to pending
   * @default 30000
   */
  lockDuration?: number;
}

/**
 * Internal listener state
 */
interface ListenerState {
  activeWorkers: number;
  running: boolean;
}

/**
 * Queue implementation for KeyVal
 * Provides enqueue/dequeue functionality with retry support
 */
export class KvQueue {
  private cleanupInterval: Timer | null = null;
  private readonly cleanupConfig: Required<KvQueueCleanupConfig>;
  private readonly listeners: Set<ListenerState> = new Set();

  constructor(
    private adapter: DatabaseAdapter,
    private kv: Kv,
    config?: KvQueueCleanupConfig,
  ) {
    this.cleanupConfig = {
      cleanupInterval: config?.cleanupInterval ?? DEFAULT_CLEANUP_INTERVAL,
      lockDuration: config?.lockDuration ?? LOCK_DURATION_MS,
    };
    this.startCleanup();
  }

  /**
   * Add a message to the queue
   */
  async enqueue(value: unknown, options?: KvEnqueueOptions): Promise<{ ok: true; id: string }> {
    const start = performance.now();
    let error = false;

    try {
      const id = crypto.randomUUID();
      const now = Date.now();
      const readyAt = now + (options?.delay ?? 0);
      const backoffSchedule = options?.backoffSchedule ?? DEFAULT_BACKOFF_SCHEDULE;
      const maxAttempts = backoffSchedule.length + 1;

      await this.adapter.execute(
        `INSERT INTO kv_queue
         (id, value, ready_at, max_attempts, backoff_schedule, keys_if_undelivered, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          serializeValue(value),
          readyAt,
          maxAttempts,
          JSON.stringify(backoffSchedule),
          options?.keysIfUndelivered ? JSON.stringify(options.keysIfUndelivered) : null,
          now,
          now,
        ],
      );

      return { ok: true, id };
    } catch (err) {
      error = true;
      throw err;
    } finally {
      this.kv.metrics.recordOperation("queue_enqueue", performance.now() - start, error);
    }
  }

  /**
   * Dequeue a message from the queue
   * Uses atomic UPDATE...RETURNING to prevent duplicate processing
   */
  async dequeue<T = unknown>(): Promise<KvQueueMessage<T> | null> {
    const start = performance.now();
    let error = false;

    try {
      const now = Date.now();
      const lockedUntil = now + this.cleanupConfig.lockDuration;

      // Atomic: select and lock the next available message
      const rows = await this.adapter.execute<{
        attempts: number;
        id: string;
        value: unknown;
      }>(
        `UPDATE kv_queue
         SET status = 'processing',
             locked_until = ?,
             attempts = attempts + 1,
             updated_at = ?
         WHERE id = (
           SELECT id FROM kv_queue
           WHERE status = 'pending'
             AND ready_at <= ?
           ORDER BY ready_at ASC
           LIMIT 1
         )
         RETURNING id, value, attempts`,
        [lockedUntil, now, now],
      );

      if (rows.length === 0) {
        return null;
      }

      const row = rows[0];
      if (!row) return null;

      return {
        id: row.id,
        value: deserializeValue<T>(row.value) as T,
        attempts: row.attempts,
      };
    } catch (err) {
      error = true;
      throw err;
    } finally {
      this.kv.metrics.recordOperation("queue_dequeue", performance.now() - start, error);
    }
  }

  /**
   * Acknowledge successful processing of a message
   */
  async ack(id: string): Promise<void> {
    const start = performance.now();
    let error = false;

    try {
      await this.adapter.execute("DELETE FROM kv_queue WHERE id = ?", [id]);
    } catch (err) {
      error = true;
      throw err;
    } finally {
      this.kv.metrics.recordOperation("queue_ack", performance.now() - start, error);
    }
  }

  /**
   * Negative acknowledgment - message processing failed
   * Will retry according to backoff schedule or save to fallback keys
   */
  async nack(id: string): Promise<void> {
    const start = performance.now();
    let error = false;

    try {
      const now = Date.now();

      // Get message info
      const rows = await this.adapter.execute<{
        attempts: number;
        backoff_schedule: string | null;
        created_at: number;
        keys_if_undelivered: string | null;
        max_attempts: number;
        value: unknown;
      }>(
        `SELECT attempts, max_attempts, backoff_schedule, keys_if_undelivered, value, created_at
         FROM kv_queue WHERE id = ?`,
        [id],
      );

      if (rows.length === 0) return;

      const row = rows[0];
      if (!row) return;

      const backoffSchedule = row.backoff_schedule
        ? (JSON.parse(row.backoff_schedule) as number[])
        : DEFAULT_BACKOFF_SCHEDULE;

      if (row.attempts >= row.max_attempts) {
        // All retries exhausted - move to DLQ and save to fallback keys if configured
        if (row.keys_if_undelivered) {
          const keysIfUndelivered = JSON.parse(row.keys_if_undelivered) as KvKey[];
          const value = deserializeValue(row.value);

          for (const key of keysIfUndelivered) {
            await this.kv.set(key, value);
          }
        }

        // Move to DLQ
        const valueBlob = row.value as unknown as Uint8Array;
        await this.adapter.execute(
          `INSERT INTO kv_dlq (id, original_id, value, error_message, attempts, original_created_at, failed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            crypto.randomUUID(),
            id,
            valueBlob,
            "Max attempts exceeded",
            row.attempts,
            row.created_at,
            now,
          ],
        );

        // Delete from main queue
        await this.adapter.execute("DELETE FROM kv_queue WHERE id = ?", [id]);
      } else {
        // Schedule retry with backoff
        const backoffIndex = Math.min(row.attempts - 1, backoffSchedule.length - 1);
        const delay = backoffSchedule[backoffIndex] ?? 1000;

        await this.adapter.execute(
          `UPDATE kv_queue
           SET status = 'pending',
               ready_at = ?,
               locked_until = NULL,
               updated_at = ?
           WHERE id = ?`,
          [now + delay, now, id],
        );
      }
    } catch (err) {
      error = true;
      throw err;
    } finally {
      this.kv.metrics.recordOperation("queue_nack", performance.now() - start, error);
    }
  }

  /**
   * Get queue statistics
   */
  async stats(): Promise<{
    dlq: number;
    pending: number;
    processing: number;
    total: number;
  }> {
    const rows = await this.adapter.execute<{ count: number; status: string }>(
      "SELECT status, COUNT(*) as count FROM kv_queue GROUP BY status",
    );

    const dlqRows = await this.adapter.execute<{ count: number }>(
      "SELECT COUNT(*) as count FROM kv_dlq",
    );

    const stats = { dlq: 0, pending: 0, processing: 0, total: 0 };
    stats.dlq = dlqRows[0]?.count ?? 0;

    for (const row of rows) {
      stats.total += row.count;

      if (row.status === "pending") stats.pending = row.count;
      else if (row.status === "processing") stats.processing = row.count;
    }

    stats.total += stats.dlq;

    return stats;
  }

  /**
   * List messages in the Dead Letter Queue
   */
  async listDlq<T = unknown>(options?: {
    limit?: number;
    offset?: number;
  }): Promise<
    Array<{
      attempts: number;
      errorMessage: string | null;
      failedAt: number;
      id: string;
      originalCreatedAt: number;
      originalId: string;
      value: T;
    }>
  > {
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;

    const rows = await this.adapter.execute<{
      attempts: number;
      error_message: string | null;
      failed_at: number;
      id: string;
      original_created_at: number;
      original_id: string;
      value: unknown;
    }>(
      `SELECT id, original_id, value, error_message, attempts, original_created_at, failed_at
       FROM kv_dlq
       ORDER BY failed_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset],
    );

    return rows.map((row) => ({
      attempts: row.attempts,
      errorMessage: row.error_message,
      failedAt: row.failed_at,
      id: row.id,
      originalCreatedAt: row.original_created_at,
      originalId: row.original_id,
      value: deserializeValue<T>(row.value) as T,
    }));
  }

  /**
   * Get a specific message from the DLQ
   */
  async getDlqMessage<T = unknown>(
    id: string,
  ): Promise<{
    attempts: number;
    errorMessage: string | null;
    failedAt: number;
    id: string;
    originalCreatedAt: number;
    originalId: string;
    value: T;
  } | null> {
    const rows = await this.adapter.execute<{
      attempts: number;
      error_message: string | null;
      failed_at: number;
      id: string;
      original_created_at: number;
      original_id: string;
      value: unknown;
    }>(
      `SELECT id, original_id, value, error_message, attempts, original_created_at, failed_at
       FROM kv_dlq WHERE id = ?`,
      [id],
    );

    if (rows.length === 0) return null;

    const row = rows[0];
    if (!row) return null;

    return {
      attempts: row.attempts,
      errorMessage: row.error_message,
      failedAt: row.failed_at,
      id: row.id,
      originalCreatedAt: row.original_created_at,
      originalId: row.original_id,
      value: deserializeValue<T>(row.value) as T,
    };
  }

  /**
   * Requeue a message from the DLQ back to the main queue
   */
  async requeueDlq(
    id: string,
  ): Promise<{ ok: true; newId: string } | { ok: false; error: string }> {
    const rows = await this.adapter.execute<{ value: unknown }>(
      "SELECT value FROM kv_dlq WHERE id = ?",
      [id],
    );

    if (rows.length === 0) {
      return { ok: false, error: "Message not found in DLQ" };
    }

    const row = rows[0];
    if (!row) {
      return { ok: false, error: "Message not found in DLQ" };
    }

    const value = deserializeValue(row.value);
    const enqueueResult = await this.enqueue(value);

    // Delete from DLQ
    await this.adapter.execute("DELETE FROM kv_dlq WHERE id = ?", [id]);

    return { ok: true, newId: enqueueResult.id };
  }

  /**
   * Delete a message from the DLQ
   */
  async deleteDlq(id: string): Promise<void> {
    await this.adapter.execute("DELETE FROM kv_dlq WHERE id = ?", [id]);
  }

  /**
   * Purge all messages from the DLQ
   */
  async purgeDlq(): Promise<{ deletedCount: number }> {
    // Note: DatabaseAdapter doesn't return rowsAffected, so we count first
    const countRows = await this.adapter.execute<{ count: number }>(
      "SELECT COUNT(*) as count FROM kv_dlq",
    );
    const deletedCount = countRows[0]?.count ?? 0;

    await this.adapter.execute("DELETE FROM kv_dlq");

    return { deletedCount };
  }

  /**
   * Start a listener that processes messages from the queue
   * @returns Function to stop the listener
   */
  listen<T = unknown>(config: KvQueueListenerConfig<T>): () => Promise<void> {
    const { concurrency = 1, handler, onError, pollInterval = 1000 } = config;

    const state: ListenerState = {
      activeWorkers: 0,
      running: true,
    };
    this.listeners.add(state);

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const processMessage = async (msg: KvQueueMessage<T>) => {
      state.activeWorkers++;
      try {
        await handler(msg);
        await this.ack(msg.id);
      } catch (err) {
        onError?.(err as Error, msg);
        await this.nack(msg.id);
      } finally {
        state.activeWorkers--;
      }
    };

    const work = async () => {
      while (state.running) {
        // Wait if at concurrency limit
        if (state.activeWorkers >= concurrency) {
          await sleep(pollInterval);
          continue;
        }

        try {
          const msg = await this.dequeue<T>();
          if (!msg) {
            await sleep(pollInterval);
            continue;
          }

          // Process message without blocking the loop
          processMessage(msg);
        } catch (err) {
          this.kv.getLogger()?.error("Queue listener error", {
            error: err instanceof Error ? err.message : String(err),
          });
          await sleep(pollInterval);
        }
      }
    };

    // Start the worker loop
    work();

    // Return stop function
    return async () => {
      state.running = false;
      this.listeners.delete(state);

      // Wait for active workers to finish
      while (state.activeWorkers > 0) {
        await sleep(100);
      }
    };
  }

  /**
   * Close the queue and cleanup resources
   */
  close(): void {
    // Stop all listeners
    for (const listener of this.listeners) {
      listener.running = false;
    }
    this.listeners.clear();
    this.stopCleanup();
  }

  /**
   * Start periodic cleanup to reset expired locks
   */
  private startCleanup(): void {
    // Skip cleanup if interval is 0
    if (this.cleanupConfig.cleanupInterval <= 0) {
      return;
    }

    this.cleanupInterval = setInterval(async () => {
      try {
        // Reset stuck processing messages (locked too long)
        const now = Date.now();
        await this.adapter.execute(
          `UPDATE kv_queue
           SET status = 'pending',
               locked_until = NULL,
               updated_at = ?
           WHERE status = 'processing'
             AND locked_until < ?`,
          [now, now],
        );
      } catch (error) {
        this.kv.getLogger()?.error("Queue cleanup failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, this.cleanupConfig.cleanupInterval);
  }

  /**
   * Stop periodic cleanup
   */
  private stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}
