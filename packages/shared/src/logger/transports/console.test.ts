import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { LogEntry } from "../types";
import { ConsoleTransport } from "./console";

describe("ConsoleTransport", () => {
  let originalLog: typeof console.log;
  let originalError: typeof console.error;
  let mockLog: ReturnType<typeof mock<(...args: unknown[]) => void>>;
  let mockError: ReturnType<typeof mock<(...args: unknown[]) => void>>;

  beforeEach(() => {
    originalLog = console.log;
    originalError = console.error;
    mockLog = mock(() => {});
    mockError = mock(() => {});
    console.log = mockLog;
    console.error = mockError;
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  function createTestEntry(overrides: Partial<LogEntry> = {}): LogEntry {
    return {
      level: "info",
      message: "test message",
      timestamp: "2024-01-15T10:30:45.123Z",
      ...overrides,
    };
  }

  describe("constructor", () => {
    it("should create transport with default options", () => {
      // ARRANGE & ACT
      const transport = new ConsoleTransport();

      // ASSERT
      expect(transport).toBeInstanceOf(ConsoleTransport);
    });

    it("should accept custom format option", () => {
      // ARRANGE & ACT
      const transport = new ConsoleTransport({ format: "json" });

      // ASSERT
      expect(transport).toBeInstanceOf(ConsoleTransport);
    });

    it("should accept custom colors option", () => {
      // ARRANGE & ACT
      const transport = new ConsoleTransport({ colors: false });

      // ASSERT
      expect(transport).toBeInstanceOf(ConsoleTransport);
    });
  });

  describe("close()", () => {
    it("should return resolved promise", async () => {
      // ARRANGE
      const transport = new ConsoleTransport();

      // ACT
      const result = transport.close();

      // ASSERT
      await expect(result).resolves.toBeUndefined();
    });

    it("should be callable multiple times", async () => {
      // ARRANGE
      const transport = new ConsoleTransport();

      // ACT & ASSERT - should not throw
      await transport.close();
      await transport.close();
      await transport.close();
    });
  });

  describe("flush()", () => {
    it("should return resolved promise", async () => {
      // ARRANGE
      const transport = new ConsoleTransport();

      // ACT
      const result = transport.flush();

      // ASSERT
      await expect(result).resolves.toBeUndefined();
    });

    it("should be callable multiple times", async () => {
      // ARRANGE
      const transport = new ConsoleTransport();

      // ACT & ASSERT - should not throw
      await transport.flush();
      await transport.flush();
      await transport.flush();
    });
  });

  describe("write() - pretty format", () => {
    it("should write info message to console.log", () => {
      // ARRANGE
      const transport = new ConsoleTransport({ format: "pretty", colors: false });
      const entry = createTestEntry({ level: "info" });

      // ACT
      transport.write(entry);

      // ASSERT
      expect(mockLog).toHaveBeenCalledTimes(1);
      expect(mockError).not.toHaveBeenCalled();
    });

    it("should write debug message to console.log", () => {
      // ARRANGE
      const transport = new ConsoleTransport({ format: "pretty", colors: false });
      const entry = createTestEntry({ level: "debug" });

      // ACT
      transport.write(entry);

      // ASSERT
      expect(mockLog).toHaveBeenCalledTimes(1);
      expect(mockError).not.toHaveBeenCalled();
    });

    it("should write warn message to console.log", () => {
      // ARRANGE
      const transport = new ConsoleTransport({ format: "pretty", colors: false });
      const entry = createTestEntry({ level: "warn" });

      // ACT
      transport.write(entry);

      // ASSERT
      expect(mockLog).toHaveBeenCalledTimes(1);
      expect(mockError).not.toHaveBeenCalled();
    });

    it("should write error message to console.error", () => {
      // ARRANGE
      const transport = new ConsoleTransport({ format: "pretty", colors: false });
      const entry = createTestEntry({ level: "error" });

      // ACT
      transport.write(entry);

      // ASSERT
      expect(mockError).toHaveBeenCalledTimes(1);
      expect(mockLog).not.toHaveBeenCalled();
    });

    it("should include context in output when provided", () => {
      // ARRANGE
      const transport = new ConsoleTransport({ format: "pretty", colors: false });
      const entry = createTestEntry({ context: "my-module" });

      // ACT
      transport.write(entry);

      // ASSERT
      const output = mockLog.mock.calls[0][0];
      expect(output).toContain("[my-module]");
    });

    it("should include short meta inline when less than 80 chars", () => {
      // ARRANGE
      const transport = new ConsoleTransport({ format: "pretty", colors: false });
      const entry = createTestEntry({ meta: { key: "value" } });

      // ACT
      transport.write(entry);

      // ASSERT
      const output = mockLog.mock.calls[0][0];
      expect(output).toContain('{"key":"value"}');
    });

    it("should include long meta on new line when more than 80 chars", () => {
      // ARRANGE
      const transport = new ConsoleTransport({ format: "pretty", colors: false });
      const longMeta = {
        key1: "a very long value that makes the total length exceed 80 characters",
        key2: "another long value to ensure we go over the limit for inline display",
      };
      const entry = createTestEntry({ meta: longMeta });

      // ACT
      transport.write(entry);

      // ASSERT
      const output = mockLog.mock.calls[0][0];
      expect(output).toContain("\n");
    });

    it("should not include empty meta object", () => {
      // ARRANGE
      const transport = new ConsoleTransport({ format: "pretty", colors: false });
      const entry = createTestEntry({ meta: {} });

      // ACT
      transport.write(entry);

      // ASSERT
      const output = mockLog.mock.calls[0][0];
      expect(output).not.toContain("{}");
    });

    it("should format timestamp correctly", () => {
      // ARRANGE
      const transport = new ConsoleTransport({ format: "pretty", colors: false });
      const entry = createTestEntry({ timestamp: "2024-01-15T10:30:45.123Z" });

      // ACT
      transport.write(entry);

      // ASSERT
      const output = mockLog.mock.calls[0][0];
      expect(output).toContain("10:30:45.123");
    });

    it("should handle timestamp without T separator", () => {
      // ARRANGE
      const transport = new ConsoleTransport({ format: "pretty", colors: false });
      const entry = createTestEntry({ timestamp: "no-t-separator" });

      // ACT
      transport.write(entry);

      // ASSERT
      const output = mockLog.mock.calls[0][0];
      // Should fall back to full timestamp
      expect(output).toContain("no-t-separator");
    });

    it("should use level abbreviations", () => {
      // ARRANGE
      const transport = new ConsoleTransport({ format: "pretty", colors: false });

      // ACT & ASSERT
      transport.write(createTestEntry({ level: "debug" }));
      expect(mockLog.mock.calls[0][0]).toContain("DBG");

      transport.write(createTestEntry({ level: "info" }));
      expect(mockLog.mock.calls[1][0]).toContain("INF");

      transport.write(createTestEntry({ level: "warn" }));
      expect(mockLog.mock.calls[2][0]).toContain("WRN");

      transport.write(createTestEntry({ level: "error" }));
      expect(mockError.mock.calls[0][0]).toContain("ERR");
    });

    it("should include color codes when colors enabled", () => {
      // ARRANGE
      const transport = new ConsoleTransport({ format: "pretty", colors: true });
      const entry = createTestEntry({ level: "error" });

      // ACT
      transport.write(entry);

      // ASSERT
      const output = mockError.mock.calls[0][0];
      // Should contain ANSI escape codes
      expect(output).toContain("\x1b[");
    });

    it("should not include color codes when colors disabled", () => {
      // ARRANGE
      const transport = new ConsoleTransport({ format: "pretty", colors: false });
      const entry = createTestEntry({ level: "info" });

      // ACT
      transport.write(entry);

      // ASSERT
      const output = mockLog.mock.calls[0][0];
      // Should not contain ANSI escape codes
      expect(output).not.toContain("\x1b[");
    });
  });

  describe("write() - json format", () => {
    it("should write valid JSON to console.log for info level", () => {
      // ARRANGE
      const transport = new ConsoleTransport({ format: "json" });
      const entry = createTestEntry({ level: "info", message: "json test" });

      // ACT
      transport.write(entry);

      // ASSERT
      expect(mockLog).toHaveBeenCalledTimes(1);
      const output = mockLog.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe("info");
      expect(parsed.message).toBe("json test");
    });

    it("should write valid JSON to console.error for error level", () => {
      // ARRANGE
      const transport = new ConsoleTransport({ format: "json" });
      const entry = createTestEntry({ level: "error", message: "error json" });

      // ACT
      transport.write(entry);

      // ASSERT
      expect(mockError).toHaveBeenCalledTimes(1);
      const output = mockError.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe("error");
      expect(parsed.message).toBe("error json");
    });

    it("should include time field from timestamp", () => {
      // ARRANGE
      const transport = new ConsoleTransport({ format: "json" });
      const entry = createTestEntry({ timestamp: "2024-01-15T10:30:45.123Z" });

      // ACT
      transport.write(entry);

      // ASSERT
      const output = mockLog.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.time).toBe("2024-01-15T10:30:45.123Z");
    });

    it("should include context when provided", () => {
      // ARRANGE
      const transport = new ConsoleTransport({ format: "json" });
      const entry = createTestEntry({ context: "my-context" });

      // ACT
      transport.write(entry);

      // ASSERT
      const output = mockLog.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.context).toBe("my-context");
    });

    it("should not include context when undefined", () => {
      // ARRANGE
      const transport = new ConsoleTransport({ format: "json" });
      const entry = createTestEntry({ context: undefined });

      // ACT
      transport.write(entry);

      // ASSERT
      const output = mockLog.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed).not.toHaveProperty("context");
    });

    it("should spread meta fields into JSON output", () => {
      // ARRANGE
      const transport = new ConsoleTransport({ format: "json" });
      const entry = createTestEntry({
        meta: { userId: 123, action: "login" },
      });

      // ACT
      transport.write(entry);

      // ASSERT
      const output = mockLog.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.userId).toBe(123);
      expect(parsed.action).toBe("login");
    });

    it("should not spread empty meta object", () => {
      // ARRANGE
      const transport = new ConsoleTransport({ format: "json" });
      const entry = createTestEntry({ meta: {} });

      // ACT
      transport.write(entry);

      // ASSERT
      const output = mockLog.mock.calls[0][0];
      const parsed = JSON.parse(output);
      // Should only have level, message, time
      expect(Object.keys(parsed)).toEqual(["level", "message", "time"]);
    });

    it("should write debug level to console.log", () => {
      // ARRANGE
      const transport = new ConsoleTransport({ format: "json" });
      const entry = createTestEntry({ level: "debug" });

      // ACT
      transport.write(entry);

      // ASSERT
      expect(mockLog).toHaveBeenCalledTimes(1);
      expect(mockError).not.toHaveBeenCalled();
    });

    it("should write warn level to console.log", () => {
      // ARRANGE
      const transport = new ConsoleTransport({ format: "json" });
      const entry = createTestEntry({ level: "warn" });

      // ACT
      transport.write(entry);

      // ASSERT
      expect(mockLog).toHaveBeenCalledTimes(1);
      expect(mockError).not.toHaveBeenCalled();
    });
  });
});
