import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Kv } from "./kv";
import { initSchema } from "./schema";
import { createTestAdapter } from "./test-helpers";

describe("KvQueue", () => {
  const adapter = createTestAdapter();
  let kv: Kv;

  beforeAll(async () => {
    await initSchema(adapter);
    kv = new Kv(adapter);
  });

  afterAll(async () => {
    kv.close();
    await adapter.close();
  });

  beforeEach(async () => {
    await adapter.execute("DELETE FROM kv_queue", []);
    await adapter.execute("DELETE FROM kv_dlq", []);
    await adapter.execute("DELETE FROM kv_entries", []);
  });

  describe("enqueue/dequeue", () => {
    it("should enqueue and dequeue messages", async () => {
      const message = { type: "email", to: "user@example.com" };

      const { id, ok } = await kv.queue.enqueue(message);
      expect(ok).toBe(true);
      expect(id).toBeDefined();

      const msg = await kv.queue.dequeue<typeof message>();
      expect(msg).not.toBe(null);
      expect(msg?.id).toBe(id);
      expect(msg?.value).toEqual(message);
      expect(msg?.attempts).toBe(1);
    });

    it("should return null when queue is empty", async () => {
      const msg = await kv.queue.dequeue();
      expect(msg).toBe(null);
    });

    it("should process messages in FIFO order", async () => {
      await kv.queue.enqueue({ order: 1 });
      await kv.queue.enqueue({ order: 2 });
      await kv.queue.enqueue({ order: 3 });

      const msg1 = await kv.queue.dequeue<{ order: number }>();
      await kv.queue.ack(msg1!.id);
      expect(msg1?.value.order).toBe(1);

      const msg2 = await kv.queue.dequeue<{ order: number }>();
      await kv.queue.ack(msg2!.id);
      expect(msg2?.value.order).toBe(2);

      const msg3 = await kv.queue.dequeue<{ order: number }>();
      await kv.queue.ack(msg3!.id);
      expect(msg3?.value.order).toBe(3);
    });

    it("should not return same message twice (atomic lock)", async () => {
      await kv.queue.enqueue({ value: "test" });

      const msg1 = await kv.queue.dequeue();
      const msg2 = await kv.queue.dequeue();

      expect(msg1).not.toBe(null);
      expect(msg2).toBe(null); // Same message is locked
    });
  });

  describe("delay", () => {
    it("should respect delay option", async () => {
      await kv.queue.enqueue({ value: "delayed" }, { delay: 200 });

      // Message should not be available yet
      const msg1 = await kv.queue.dequeue();
      expect(msg1).toBe(null);

      // Wait for delay
      await new Promise((r) => setTimeout(r, 250));

      const msg2 = await kv.queue.dequeue();
      expect(msg2).not.toBe(null);
      expect(msg2?.value).toEqual({ value: "delayed" });
    });
  });

  describe("ack/nack", () => {
    it("should remove message on ack", async () => {
      await kv.queue.enqueue({ value: "test" });

      const msg = await kv.queue.dequeue();
      expect(msg).not.toBe(null);

      await kv.queue.ack(msg!.id);

      // Message should be gone
      const stats = await kv.queue.stats();
      expect(stats.total).toBe(0);
    });

    it("should retry with backoff on nack", async () => {
      await kv.queue.enqueue({ value: "retry" }, { backoffSchedule: [50, 100] });

      const msg1 = await kv.queue.dequeue();
      expect(msg1?.attempts).toBe(1);
      await kv.queue.nack(msg1!.id);

      // Message should be pending again with delay
      const immediate = await kv.queue.dequeue();
      expect(immediate).toBe(null);

      // Wait for backoff
      await new Promise((r) => setTimeout(r, 60));

      const msg2 = await kv.queue.dequeue();
      expect(msg2).not.toBe(null);
      expect(msg2?.attempts).toBe(2);
    });

    it("should mark as failed after max attempts", async () => {
      await kv.queue.enqueue({ value: "fail" }, { backoffSchedule: [10] });

      // First attempt
      const msg1 = await kv.queue.dequeue();
      await kv.queue.nack(msg1!.id);

      await new Promise((r) => setTimeout(r, 20));

      // Second attempt (max = backoffSchedule.length + 1 = 2)
      const msg2 = await kv.queue.dequeue();
      expect(msg2?.attempts).toBe(2);
      await kv.queue.nack(msg2!.id);

      // Should be in DLQ now
      const stats = await kv.queue.stats();
      expect(stats.dlq).toBe(1);
      expect(stats.pending).toBe(0);
    });
  });

  describe("keysIfUndelivered", () => {
    it("should save to fallback keys after max attempts", async () => {
      const fallbackKey = ["failed_jobs", "test"];
      await kv.queue.enqueue(
        { data: "important" },
        {
          backoffSchedule: [10],
          keysIfUndelivered: [fallbackKey],
        },
      );

      // First attempt
      const msg1 = await kv.queue.dequeue();
      await kv.queue.nack(msg1!.id);

      await new Promise((r) => setTimeout(r, 20));

      // Second attempt - will fail and save to fallback
      const msg2 = await kv.queue.dequeue();
      await kv.queue.nack(msg2!.id);

      // Check fallback key
      const entry = await kv.get<{ data: string }>(fallbackKey);
      expect(entry.value).toEqual({ data: "important" });
    });
  });

  describe("stats", () => {
    it("should return queue statistics", async () => {
      // Empty queue
      let stats = await kv.queue.stats();
      expect(stats).toEqual({ dlq: 0, pending: 0, processing: 0, total: 0 });

      // Add some messages
      await kv.queue.enqueue({ v: 1 });
      await kv.queue.enqueue({ v: 2 });
      await kv.queue.enqueue({ v: 3 });

      stats = await kv.queue.stats();
      expect(stats.pending).toBe(3);
      expect(stats.total).toBe(3);

      // Dequeue one
      const msg = await kv.queue.dequeue();
      stats = await kv.queue.stats();
      expect(stats.pending).toBe(2);
      expect(stats.processing).toBe(1);

      // Ack it
      await kv.queue.ack(msg!.id);
      stats = await kv.queue.stats();
      expect(stats.pending).toBe(2);
      expect(stats.processing).toBe(0);
      expect(stats.total).toBe(2);
    });
  });

  describe("different value types", () => {
    it("should handle string values", async () => {
      await kv.queue.enqueue("simple string");
      const msg = await kv.queue.dequeue<string>();
      expect(msg?.value).toBe("simple string");
    });

    it("should handle number values", async () => {
      await kv.queue.enqueue(42);
      const msg = await kv.queue.dequeue<number>();
      expect(msg?.value).toBe(42);
    });

    it("should handle array values", async () => {
      await kv.queue.enqueue([1, 2, 3]);
      const msg = await kv.queue.dequeue<number[]>();
      expect(msg?.value).toEqual([1, 2, 3]);
    });

    it("should handle complex objects", async () => {
      const complex = {
        items: [{ id: 1 }, { id: 2 }],
        nested: { deep: { value: true } },
        timestamp: 1234567890,
      };
      await kv.queue.enqueue(complex);
      const msg = await kv.queue.dequeue<typeof complex>();
      expect(msg?.value).toEqual(complex);
    });
  });

  describe("dead letter queue", () => {
    it("should move failed messages to DLQ", async () => {
      await kv.queue.enqueue({ data: "will-fail" }, { backoffSchedule: [10] });

      // First attempt
      const msg1 = await kv.queue.dequeue();
      await kv.queue.nack(msg1!.id);

      await new Promise((r) => setTimeout(r, 20));

      // Second attempt - will fail
      const msg2 = await kv.queue.dequeue();
      await kv.queue.nack(msg2!.id);

      // Check DLQ
      const dlqMessages = await kv.queue.listDlq();
      expect(dlqMessages).toHaveLength(1);
      expect(dlqMessages[0]?.value).toEqual({ data: "will-fail" });
      expect(dlqMessages[0]?.errorMessage).toBe("Max attempts exceeded");
      expect(dlqMessages[0]?.attempts).toBe(2);
    });

    it("should get a specific DLQ message", async () => {
      await kv.queue.enqueue({ data: "dlq-test" }, { backoffSchedule: [10] });

      const msg1 = await kv.queue.dequeue();
      await kv.queue.nack(msg1!.id);
      await new Promise((r) => setTimeout(r, 20));
      const msg2 = await kv.queue.dequeue();
      await kv.queue.nack(msg2!.id);

      const dlqMessages = await kv.queue.listDlq();
      const message = await kv.queue.getDlqMessage(dlqMessages[0]!.id);

      expect(message).not.toBeNull();
      expect(message?.value).toEqual({ data: "dlq-test" });
    });

    it("should requeue message from DLQ", async () => {
      await kv.queue.enqueue({ data: "retry-me" }, { backoffSchedule: [10] });

      const msg1 = await kv.queue.dequeue();
      await kv.queue.nack(msg1!.id);
      await new Promise((r) => setTimeout(r, 20));
      const msg2 = await kv.queue.dequeue();
      await kv.queue.nack(msg2!.id);

      // Get from DLQ
      const dlqMessages = await kv.queue.listDlq();
      expect(dlqMessages).toHaveLength(1);

      // Requeue
      const result = await kv.queue.requeueDlq(dlqMessages[0]!.id);
      expect(result.ok).toBe(true);

      // Verify DLQ is empty
      const dlqAfter = await kv.queue.listDlq();
      expect(dlqAfter).toHaveLength(0);

      // Verify message is back in queue
      const requeuedMsg = await kv.queue.dequeue<{ data: string }>();
      expect(requeuedMsg?.value).toEqual({ data: "retry-me" });
    });

    it("should delete message from DLQ", async () => {
      await kv.queue.enqueue({ data: "delete-me" }, { backoffSchedule: [10] });

      const msg1 = await kv.queue.dequeue();
      await kv.queue.nack(msg1!.id);
      await new Promise((r) => setTimeout(r, 20));
      const msg2 = await kv.queue.dequeue();
      await kv.queue.nack(msg2!.id);

      const dlqMessages = await kv.queue.listDlq();
      await kv.queue.deleteDlq(dlqMessages[0]!.id);

      const dlqAfter = await kv.queue.listDlq();
      expect(dlqAfter).toHaveLength(0);
    });

    it("should purge all DLQ messages", async () => {
      // Create multiple failed messages
      for (let i = 0; i < 3; i++) {
        await kv.queue.enqueue({ index: i }, { backoffSchedule: [5] });
        const msg1 = await kv.queue.dequeue();
        await kv.queue.nack(msg1!.id);
        await new Promise((r) => setTimeout(r, 10));
        const msg2 = await kv.queue.dequeue();
        await kv.queue.nack(msg2!.id);
      }

      const dlqBefore = await kv.queue.listDlq();
      expect(dlqBefore).toHaveLength(3);

      const result = await kv.queue.purgeDlq();
      expect(result.deletedCount).toBe(3);

      const dlqAfter = await kv.queue.listDlq();
      expect(dlqAfter).toHaveLength(0);
    });

    it("should include DLQ count in stats", async () => {
      await kv.queue.enqueue({ data: "stats-test" }, { backoffSchedule: [10] });

      const msg1 = await kv.queue.dequeue();
      await kv.queue.nack(msg1!.id);
      await new Promise((r) => setTimeout(r, 20));
      const msg2 = await kv.queue.dequeue();
      await kv.queue.nack(msg2!.id);

      const stats = await kv.queue.stats();
      expect(stats.dlq).toBe(1);
      expect(stats.total).toBe(1); // Total includes DLQ
    });

    it("should return error when requeuing non-existent message", async () => {
      const result = await kv.queue.requeueDlq("non-existent-id");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("Message not found in DLQ");
      }
    });

    it("should return null when getting non-existent DLQ message", async () => {
      const message = await kv.queue.getDlqMessage("non-existent-id");
      expect(message).toBeNull();
    });

    it("should support pagination in listDlq", async () => {
      // Create multiple failed messages
      for (let i = 0; i < 3; i++) {
        await kv.queue.enqueue({ index: i }, { backoffSchedule: [5] });
        const msg1 = await kv.queue.dequeue();
        await kv.queue.nack(msg1!.id);
        await new Promise((r) => setTimeout(r, 10));
        const msg2 = await kv.queue.dequeue();
        await kv.queue.nack(msg2!.id);
      }

      // Get first page
      const page1 = await kv.queue.listDlq({ limit: 2 });
      expect(page1).toHaveLength(2);

      // Get second page
      const page2 = await kv.queue.listDlq({ limit: 2, offset: 2 });
      expect(page2).toHaveLength(1);
    });
  });

  describe("cleanup configuration", () => {
    it("should work with cleanup disabled", async () => {
      const tempAdapter = createTestAdapter();
      await initSchema(tempAdapter);
      const tempKv = new Kv(tempAdapter, {
        queueCleanup: { cleanupInterval: 0 },
      });

      // Should work without cleanup interval
      await tempKv.queue.enqueue({ data: "test" });
      const msg = await tempKv.queue.dequeue();
      expect(msg?.value).toEqual({ data: "test" });

      tempKv.close();
      await tempAdapter.close();
    });

    it("should not have delivered status (messages are deleted on ack)", async () => {
      const tempAdapter = createTestAdapter();
      await initSchema(tempAdapter);
      const tempKv = new Kv(tempAdapter, {
        queueCleanup: {
          cleanupInterval: 100,
        },
      });

      // Enqueue and immediately ack a message
      await tempKv.queue.enqueue({ data: "test" });
      const msg = await tempKv.queue.dequeue();
      if (msg) {
        await tempKv.queue.ack(msg.id);
      }

      // Verify acked messages are deleted, not marked as delivered
      const rows = await tempAdapter.execute("SELECT COUNT(*) as count FROM kv_queue");
      expect((rows[0] as { count: number }).count).toBe(0);

      tempKv.close();
      await tempAdapter.close();
    });

    it("should reset stuck processing messages", async () => {
      const tempAdapter = createTestAdapter();
      await initSchema(tempAdapter);
      const tempKv = new Kv(tempAdapter, {
        queueCleanup: {
          cleanupInterval: 100,
          lockDuration: 50,
        },
      });

      // Enqueue a message
      await tempKv.queue.enqueue({ data: "stuck" });

      // Manually dequeue and don't ack (simulating stuck message)
      const msg = await tempKv.queue.dequeue();
      expect(msg).not.toBeNull();

      // Wait for lock to expire and cleanup to run
      await new Promise((r) => setTimeout(r, 200));

      // Message should be reset to pending
      const pending = await tempAdapter.execute<{ status: string }>(
        "SELECT status FROM kv_queue WHERE id = ?",
        [msg!.id],
      );
      expect(pending[0]?.status).toBe("pending");

      tempKv.close();
      await tempAdapter.close();
    });
  });

  describe("listen", () => {
    it("should process messages with listener", async () => {
      const processed: unknown[] = [];

      await kv.queue.enqueue({ id: 1 });
      await kv.queue.enqueue({ id: 2 });

      const stop = kv.queue.listen<{ id: number }>({
        handler: (msg) => {
          processed.push(msg.value);
        },
        pollInterval: 50,
      });

      // Wait for processing
      await new Promise((r) => setTimeout(r, 200));
      await stop();

      expect(processed).toContainEqual({ id: 1 });
      expect(processed).toContainEqual({ id: 2 });
    });

    it("should auto-ack on successful handler", async () => {
      await kv.queue.enqueue({ data: "test" });

      const stop = kv.queue.listen({
        handler: () => {},
        pollInterval: 50,
      });

      await new Promise((r) => setTimeout(r, 150));
      await stop();

      const stats = await kv.queue.stats();
      expect(stats.total).toBe(0);
    });

    it("should auto-nack on handler error", async () => {
      await kv.queue.enqueue({ data: "fail" }, { backoffSchedule: [10] });

      let errorCalled = false;
      const stop = kv.queue.listen({
        handler: () => {
          throw new Error("Handler error");
        },
        onError: () => {
          errorCalled = true;
        },
        pollInterval: 50,
      });

      await new Promise((r) => setTimeout(r, 100));
      await stop();

      expect(errorCalled).toBe(true);
    });

    it("should respect concurrency limit", async () => {
      for (let i = 0; i < 5; i++) {
        await kv.queue.enqueue({ index: i });
      }

      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const stop = kv.queue.listen({
        handler: async () => {
          currentConcurrent++;
          maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
          await new Promise((r) => setTimeout(r, 50));
          currentConcurrent--;
        },
        concurrency: 2,
        pollInterval: 10,
      });

      await new Promise((r) => setTimeout(r, 500));
      await stop();

      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it("should stop processing on stop()", async () => {
      await kv.queue.enqueue({ id: 1 });
      await kv.queue.enqueue({ id: 2 });

      const processed: number[] = [];

      const stop = kv.queue.listen<{ id: number }>({
        handler: async (msg) => {
          processed.push(msg.value.id);
          await new Promise((r) => setTimeout(r, 100));
        },
        pollInterval: 10,
      });

      // Stop immediately after first message starts processing
      await new Promise((r) => setTimeout(r, 50));
      await stop();

      // Should have processed at least first message
      expect(processed.length).toBeGreaterThanOrEqual(1);
    });

    it("should wait for active workers on stop()", async () => {
      await kv.queue.enqueue({ data: "slow" });

      let completed = false;

      const stop = kv.queue.listen({
        handler: async () => {
          await new Promise((r) => setTimeout(r, 100));
          completed = true;
        },
        pollInterval: 10,
      });

      // Wait for handler to start
      await new Promise((r) => setTimeout(r, 30));

      // Stop should wait for handler to complete
      await stop();

      expect(completed).toBe(true);
    });

    it("should close all listeners on kv.close()", async () => {
      const tempAdapter = createTestAdapter();
      await initSchema(tempAdapter);
      const tempKv = new Kv(tempAdapter);

      let handlerCalls = 0;

      tempKv.queue.listen({
        handler: () => {
          handlerCalls++;
        },
        pollInterval: 50,
      });

      await tempKv.queue.enqueue({ data: "test" });
      await new Promise((r) => setTimeout(r, 100));

      tempKv.close();

      const callsAfterClose = handlerCalls;
      await tempKv.queue.enqueue({ data: "test2" });
      await new Promise((r) => setTimeout(r, 100));

      // Should not process more messages after close
      expect(handlerCalls).toBe(callsAfterClose);

      await tempAdapter.close();
    });
  });
});
