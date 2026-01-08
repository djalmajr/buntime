import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { getLogger, getRegistry, initialize, shutdown } from "./services";

const createMockAdapter = () => ({
  batch: mock(() => Promise.resolve([])),
  close: mock(() => Promise.resolve()),
  execute: mock(() => Promise.resolve([])),
  executeOne: mock(() => Promise.resolve(null)),
  type: "libsql",
});

const createMockLogger = () => ({
  debug: mock(() => {}),
  error: mock(() => {}),
  info: mock(() => {}),
  warn: mock(() => {}),
});

describe("services", () => {
  let mockAdapter: ReturnType<typeof createMockAdapter>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockAdapter = createMockAdapter();
    mockLogger = createMockLogger();
  });

  afterEach(async () => {
    await shutdown();
  });

  describe("initialize", () => {
    it("should initialize with adapter and config", async () => {
      const config = {
        hibernateAfter: 60_000,
        maxObjects: 1000,
      };

      await initialize(mockAdapter as never, config, mockLogger as never);

      // Verify database schema was initialized
      expect(mockAdapter.batch).toHaveBeenCalled();
    });

    it("should create registry with provided config", async () => {
      const config = {
        hibernateAfter: 30_000,
        maxObjects: 500,
      };

      await initialize(mockAdapter as never, config, mockLogger as never);

      const registry = getRegistry();
      expect(registry).toBeDefined();
    });

    it("should store logger reference", async () => {
      const config = {
        hibernateAfter: 60_000,
        maxObjects: 1000,
      };

      await initialize(mockAdapter as never, config, mockLogger as never);

      const logger = getLogger();
      expect(logger).toBe(mockLogger);
    });
  });

  describe("shutdown", () => {
    it("should shutdown registry gracefully", async () => {
      const config = {
        hibernateAfter: 60_000,
        maxObjects: 1000,
      };

      await initialize(mockAdapter as never, config, mockLogger as never);
      await shutdown();

      // Should not throw
      expect(true).toBe(true);
    });

    it("should not throw when called without initialization", async () => {
      // Calling shutdown before initialize should be safe
      await expect(shutdown()).resolves.toBeUndefined();
    });
  });

  describe("getRegistry", () => {
    it("should return registry after initialization", async () => {
      const config = {
        hibernateAfter: 60_000,
        maxObjects: 1000,
      };

      await initialize(mockAdapter as never, config, mockLogger as never);

      const registry = getRegistry();
      expect(registry).toBeDefined();
      expect(registry.register).toBeInstanceOf(Function);
      expect(registry.getOrCreate).toBeInstanceOf(Function);
      expect(registry.listAll).toBeInstanceOf(Function);
      expect(registry.getInfo).toBeInstanceOf(Function);
      expect(registry.delete).toBeInstanceOf(Function);
    });
  });

  describe("getLogger", () => {
    it("should return logger after initialization", async () => {
      const config = {
        hibernateAfter: 60_000,
        maxObjects: 1000,
      };

      await initialize(mockAdapter as never, config, mockLogger as never);

      const logger = getLogger();
      expect(logger).toBeDefined();
      expect(logger.info).toBeInstanceOf(Function);
      expect(logger.warn).toBeInstanceOf(Function);
      expect(logger.error).toBeInstanceOf(Function);
      expect(logger.debug).toBeInstanceOf(Function);
    });
  });
});
