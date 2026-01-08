import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type { DatabaseService } from "@buntime/plugin-database";
import { Kv } from "./lib/kv";
import { initSchema } from "./lib/schema";
import { createTestAdapter } from "./lib/test-helpers";
import { getKv, getLogger, initialize, shutdown } from "./services";

describe("services", () => {
  const adapter = createTestAdapter();

  // Mock DatabaseService
  const mockDatabaseService: DatabaseService = {
    getAdapter: () => adapter,
    getDefaultType: () => "libsql",
    getRootAdapter: () => adapter,
    hasAdapter: () => true,
    listAdapterTypes: () => ["libsql"],
  };

  const mockLogger = {
    debug: () => {},
    error: () => {},
    info: () => {},
    warn: () => {},
  };

  beforeAll(async () => {
    await initSchema(adapter);
  });

  afterAll(async () => {
    await adapter.close();
  });

  beforeEach(async () => {
    await adapter.execute("DELETE FROM kv_entries");
  });

  describe("initialize", () => {
    it("should initialize and return a Kv instance", async () => {
      const kv = await initialize(mockDatabaseService, {}, mockLogger);

      expect(kv).toBeInstanceOf(Kv);

      await shutdown();
    });

    it("should initialize with custom adapter type", async () => {
      const kv = await initialize(mockDatabaseService, { adapterType: "libsql" }, mockLogger);

      expect(kv).toBeInstanceOf(Kv);

      await shutdown();
    });

    it("should initialize with metrics configuration", async () => {
      const kv = await initialize(
        mockDatabaseService,
        {
          metrics: {
            persistent: true,
            flushInterval: 60000,
          },
        },
        mockLogger,
      );

      expect(kv).toBeInstanceOf(Kv);

      await shutdown();
    });

    it("should initialize with queue configuration", async () => {
      const kv = await initialize(
        mockDatabaseService,
        {
          queue: {
            cleanupInterval: 30000,
            lockDuration: 15000,
          },
        },
        mockLogger,
      );

      expect(kv).toBeInstanceOf(Kv);

      await shutdown();
    });

    it("should set API state correctly", async () => {
      const kv = await initialize(mockDatabaseService, {}, mockLogger);

      // The API state should be set - we can verify by using the API
      // but since the API routes are tested in index.test.ts, we just
      // verify that initialization completes without error
      expect(kv).toBeDefined();

      await shutdown();
    });
  });

  describe("getKv", () => {
    it("should return the initialized Kv instance", async () => {
      const kv = await initialize(mockDatabaseService, {}, mockLogger);

      const retrievedKv = getKv();
      expect(retrievedKv).toBe(kv);

      await shutdown();
    });
  });

  describe("getLogger", () => {
    it("should return the logger instance", async () => {
      await initialize(mockDatabaseService, {}, mockLogger);

      const retrievedLogger = getLogger();
      expect(retrievedLogger).toBe(mockLogger);

      await shutdown();
    });
  });

  describe("shutdown", () => {
    it("should close the Kv instance", async () => {
      const kv = await initialize(mockDatabaseService, {}, mockLogger);

      // Verify kv is working
      await kv.set(["test"], { value: 1 });
      const entry = await kv.get(["test"]);
      expect(entry.value).toEqual({ value: 1 });

      // Shutdown
      await shutdown();

      // After shutdown, operations may still work on the adapter
      // but the Kv cleanup intervals should be stopped
    });

    it("should handle shutdown when not initialized", async () => {
      // This should not throw even if kv is undefined
      await shutdown();
    });
  });
});
