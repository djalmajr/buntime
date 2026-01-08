import { describe, expect, it, mock } from "bun:test";
import { createLogger } from "./logger";
import type { LogEntry, LogTransport } from "./types";

describe("logger/logger", () => {
  function createMockTransport(): LogTransport & {
    closeCalled: boolean;
    entries: LogEntry[];
    flushCalled: boolean;
  } {
    return {
      closeCalled: false,
      entries: [] as LogEntry[],
      flushCalled: false,
      close() {
        this.closeCalled = true;
        return Promise.resolve();
      },
      flush() {
        this.flushCalled = true;
        return Promise.resolve();
      },
      write(entry: LogEntry) {
        this.entries.push(entry);
      },
    };
  }

  describe("createLogger()", () => {
    it("should create logger with default console transport", () => {
      // ARRANGE & ACT
      const logger = createLogger();

      // ASSERT
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe("function");
    });

    it("should create logger with custom transport", () => {
      // ARRANGE
      const mockTransport = createMockTransport();

      // ACT
      const logger = createLogger({
        level: "info",
        transports: [mockTransport],
      });
      logger.info("test message");

      // ASSERT
      expect(mockTransport.entries).toHaveLength(1);
      expect(mockTransport.entries[0].message).toBe("test message");
    });

    it("should throw error when file transport is specified without filePath", () => {
      // ARRANGE & ACT & ASSERT
      expect(() =>
        createLogger({
          transports: ["file"],
        }),
      ).toThrow("filePath is required when using file transport");
    });

    it("should create file transport when filePath is provided", () => {
      // ARRANGE & ACT
      const logger = createLogger({
        transports: ["file"],
        filePath: "/tmp/test.log",
      });

      // ASSERT
      expect(logger).toBeDefined();
    });
  });

  describe("log levels", () => {
    it("should log debug messages when level is debug", () => {
      // ARRANGE
      const mockTransport = createMockTransport();
      const logger = createLogger({
        level: "debug",
        transports: [mockTransport],
      });

      // ACT
      logger.debug("debug message");

      // ASSERT
      expect(mockTransport.entries).toHaveLength(1);
      expect(mockTransport.entries[0].level).toBe("debug");
      expect(mockTransport.entries[0].message).toBe("debug message");
    });

    it("should log info messages when level is info", () => {
      // ARRANGE
      const mockTransport = createMockTransport();
      const logger = createLogger({
        level: "info",
        transports: [mockTransport],
      });

      // ACT
      logger.info("info message");

      // ASSERT
      expect(mockTransport.entries).toHaveLength(1);
      expect(mockTransport.entries[0].level).toBe("info");
    });

    it("should log warn messages when level is warn", () => {
      // ARRANGE
      const mockTransport = createMockTransport();
      const logger = createLogger({
        level: "warn",
        transports: [mockTransport],
      });

      // ACT
      logger.warn("warn message");

      // ASSERT
      expect(mockTransport.entries).toHaveLength(1);
      expect(mockTransport.entries[0].level).toBe("warn");
    });

    it("should log error messages when level is error", () => {
      // ARRANGE
      const mockTransport = createMockTransport();
      const logger = createLogger({
        level: "error",
        transports: [mockTransport],
      });

      // ACT
      logger.error("error message");

      // ASSERT
      expect(mockTransport.entries).toHaveLength(1);
      expect(mockTransport.entries[0].level).toBe("error");
    });

    it("should not log debug messages when level is info", () => {
      // ARRANGE
      const mockTransport = createMockTransport();
      const logger = createLogger({
        level: "info",
        transports: [mockTransport],
      });

      // ACT
      logger.debug("should not appear");

      // ASSERT
      expect(mockTransport.entries).toHaveLength(0);
    });

    it("should not log info or debug when level is warn", () => {
      // ARRANGE
      const mockTransport = createMockTransport();
      const logger = createLogger({
        level: "warn",
        transports: [mockTransport],
      });

      // ACT
      logger.debug("should not appear");
      logger.info("should not appear");
      logger.warn("should appear");

      // ASSERT
      expect(mockTransport.entries).toHaveLength(1);
      expect(mockTransport.entries[0].level).toBe("warn");
    });

    it("should only log error when level is error", () => {
      // ARRANGE
      const mockTransport = createMockTransport();
      const logger = createLogger({
        level: "error",
        transports: [mockTransport],
      });

      // ACT
      logger.debug("should not appear");
      logger.info("should not appear");
      logger.warn("should not appear");
      logger.error("should appear");

      // ASSERT
      expect(mockTransport.entries).toHaveLength(1);
      expect(mockTransport.entries[0].level).toBe("error");
    });
  });

  describe("debug()", () => {
    it("should log with debug level", () => {
      // ARRANGE
      const mockTransport = createMockTransport();
      const logger = createLogger({
        level: "debug",
        transports: [mockTransport],
      });

      // ACT
      logger.debug("debug test");

      // ASSERT
      expect(mockTransport.entries[0].level).toBe("debug");
    });

    it("should include meta data in debug logs", () => {
      // ARRANGE
      const mockTransport = createMockTransport();
      const logger = createLogger({
        level: "debug",
        transports: [mockTransport],
      });

      // ACT
      logger.debug("debug with meta", { key: "value" });

      // ASSERT
      expect(mockTransport.entries[0].meta).toEqual({ key: "value" });
    });
  });

  describe("info()", () => {
    it("should log with info level", () => {
      // ARRANGE
      const mockTransport = createMockTransport();
      const logger = createLogger({
        level: "info",
        transports: [mockTransport],
      });

      // ACT
      logger.info("info test");

      // ASSERT
      expect(mockTransport.entries[0].level).toBe("info");
    });

    it("should include meta data in info logs", () => {
      // ARRANGE
      const mockTransport = createMockTransport();
      const logger = createLogger({
        level: "info",
        transports: [mockTransport],
      });

      // ACT
      logger.info("info with meta", { userId: 123 });

      // ASSERT
      expect(mockTransport.entries[0].meta).toEqual({ userId: 123 });
    });
  });

  describe("error()", () => {
    it("should log with error level", () => {
      // ARRANGE
      const mockTransport = createMockTransport();
      const logger = createLogger({
        level: "error",
        transports: [mockTransport],
      });

      // ACT
      logger.error("error test");

      // ASSERT
      expect(mockTransport.entries[0].level).toBe("error");
    });

    it("should include meta data in error logs", () => {
      // ARRANGE
      const mockTransport = createMockTransport();
      const logger = createLogger({
        level: "error",
        transports: [mockTransport],
      });

      // ACT
      logger.error("error with meta", { errorCode: 500 });

      // ASSERT
      expect(mockTransport.entries[0].meta).toEqual({ errorCode: 500 });
    });
  });

  describe("child()", () => {
    it("should create child logger with context", () => {
      // ARRANGE
      const mockTransport = createMockTransport();
      const logger = createLogger({
        level: "info",
        transports: [mockTransport],
      });

      // ACT
      const childLogger = logger.child("my-context");
      childLogger.info("child message");

      // ASSERT
      expect(mockTransport.entries[0].context).toBe("my-context");
    });

    it("should chain child contexts with colon separator", () => {
      // ARRANGE
      const mockTransport = createMockTransport();
      const logger = createLogger({
        level: "info",
        transports: [mockTransport],
      });

      // ACT
      const child1 = logger.child("parent");
      const child2 = child1.child("child");
      child2.info("nested message");

      // ASSERT
      expect(mockTransport.entries[0].context).toBe("parent:child");
    });

    it("should inherit log level from parent", () => {
      // ARRANGE
      const mockTransport = createMockTransport();
      const logger = createLogger({
        level: "warn",
        transports: [mockTransport],
      });

      // ACT
      const childLogger = logger.child("test");
      childLogger.info("should not appear");
      childLogger.warn("should appear");

      // ASSERT
      expect(mockTransport.entries).toHaveLength(1);
      expect(mockTransport.entries[0].message).toBe("should appear");
    });

    it("should share transports with parent", () => {
      // ARRANGE
      const mockTransport = createMockTransport();
      const logger = createLogger({
        level: "info",
        transports: [mockTransport],
      });

      // ACT
      const childLogger = logger.child("child");
      logger.info("parent message");
      childLogger.info("child message");

      // ASSERT
      expect(mockTransport.entries).toHaveLength(2);
    });
  });

  describe("close()", () => {
    it("should call close on all transports", async () => {
      // ARRANGE
      const mockTransport1 = createMockTransport();
      const mockTransport2 = createMockTransport();
      const logger = createLogger({
        level: "info",
        transports: [mockTransport1, mockTransport2],
      });

      // ACT
      await logger.close();

      // ASSERT
      expect(mockTransport1.closeCalled).toBe(true);
      expect(mockTransport2.closeCalled).toBe(true);
    });

    it("should handle transports without close method", async () => {
      // ARRANGE
      const transportWithoutClose = {
        write: mock(() => {}),
      };
      const logger = createLogger({
        level: "info",
        transports: [transportWithoutClose],
      });

      // ACT & ASSERT - should not throw
      await expect(logger.close()).resolves.toBeUndefined();
    });
  });

  describe("flush()", () => {
    it("should call flush on all transports", async () => {
      // ARRANGE
      const mockTransport1 = createMockTransport();
      const mockTransport2 = createMockTransport();
      const logger = createLogger({
        level: "info",
        transports: [mockTransport1, mockTransport2],
      });

      // ACT
      await logger.flush();

      // ASSERT
      expect(mockTransport1.flushCalled).toBe(true);
      expect(mockTransport2.flushCalled).toBe(true);
    });

    it("should handle transports without flush method", async () => {
      // ARRANGE
      const transportWithoutFlush = {
        write: mock(() => {}),
      };
      const logger = createLogger({
        level: "info",
        transports: [transportWithoutFlush],
      });

      // ACT & ASSERT - should not throw
      await expect(logger.flush()).resolves.toBeUndefined();
    });
  });

  describe("meta data", () => {
    it("should include timestamp in all log entries", () => {
      // ARRANGE
      const mockTransport = createMockTransport();
      const logger = createLogger({
        level: "info",
        transports: [mockTransport],
      });

      // ACT
      logger.info("test message");

      // ASSERT
      expect(mockTransport.entries[0].timestamp).toBeDefined();
      expect(mockTransport.entries[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("should write to multiple transports", () => {
      // ARRANGE
      const transport1 = createMockTransport();
      const transport2 = createMockTransport();
      const logger = createLogger({
        level: "info",
        transports: [transport1, transport2],
      });

      // ACT
      logger.info("multi-transport message");

      // ASSERT
      expect(transport1.entries).toHaveLength(1);
      expect(transport2.entries).toHaveLength(1);
      expect(transport1.entries[0].message).toBe("multi-transport message");
      expect(transport2.entries[0].message).toBe("multi-transport message");
    });
  });
});
