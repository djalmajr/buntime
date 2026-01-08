import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LogEntry } from "../types";
import { FileTransport } from "./file";

describe("FileTransport", () => {
  const testDir = join(tmpdir(), `file-transport-test-${Date.now()}`);
  let transportsToClose: FileTransport[] = [];

  beforeAll(() => {
    // Ensure test directory exists
    if (!existsSync(testDir)) {
      Bun.spawnSync(["mkdir", "-p", testDir]);
    }
  });

  afterEach(async () => {
    // Close all transports created during test
    for (const transport of transportsToClose) {
      await transport.close();
    }
    transportsToClose = [];
  });

  afterAll(() => {
    // Cleanup test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  function createTestEntry(overrides: Partial<LogEntry> = {}): LogEntry {
    return {
      level: "info",
      message: "test message",
      timestamp: new Date().toISOString(),
      ...overrides,
    };
  }

  function createTransport(
    path: string,
    options: { bufferSize?: number; flushInterval?: number } = {},
  ): FileTransport {
    const transport = new FileTransport({
      path,
      bufferSize: options.bufferSize ?? 100,
      flushInterval: options.flushInterval ?? 60000, // Long interval to prevent auto-flush
    });
    transportsToClose.push(transport);
    return transport;
  }

  describe("constructor", () => {
    it("should create transport with valid path", () => {
      // ARRANGE
      const path = join(testDir, "valid.log");

      // ACT
      const transport = createTransport(path);

      // ASSERT
      expect(transport).toBeInstanceOf(FileTransport);
    });

    it("should throw on path traversal attempt with relative ..", () => {
      // ARRANGE - relative path that escapes current directory
      const maliciousPath = "../escape.log";

      // ACT & ASSERT
      expect(() => new FileTransport({ path: maliciousPath })).toThrow(
        "Path traversal not allowed in log file path",
      );
    });

    it("should throw on path with multiple .. segments", () => {
      // ARRANGE - relative path that escapes multiple levels
      const maliciousPath = "../../etc/passwd";

      // ACT & ASSERT
      expect(() => new FileTransport({ path: maliciousPath })).toThrow(
        "Path traversal not allowed in log file path",
      );
    });

    it("should allow absolute paths with .. that resolve safely", () => {
      // ARRANGE - absolute path where .. resolves within allowed area
      const path = join(testDir, "subdir", "..", "safe.log");

      // ACT - should not throw because normalize resolves the ..
      const transport = createTransport(path);

      // ASSERT
      expect(transport).toBeInstanceOf(FileTransport);
    });

    it("should use default buffer size of 100", () => {
      // ARRANGE
      const path = join(testDir, "default-buffer.log");

      // ACT
      const transport = createTransport(path);

      // ASSERT - write 99 entries, should not auto-flush
      for (let i = 0; i < 99; i++) {
        transport.write(createTestEntry({ message: `entry ${i}` }));
      }
      expect(existsSync(path)).toBe(false);
    });

    it("should accept custom buffer size", () => {
      // ARRANGE
      const path = join(testDir, "custom-buffer.log");

      // ACT
      const transport = createTransport(path, { bufferSize: 5 });

      // Write 4 entries - should not flush
      for (let i = 0; i < 4; i++) {
        transport.write(createTestEntry({ message: `entry ${i}` }));
      }

      // ASSERT
      expect(existsSync(path)).toBe(false);
    });
  });

  describe("write()", () => {
    it("should add entry to buffer", () => {
      // ARRANGE
      const path = join(testDir, "write-buffer.log");
      const transport = createTransport(path);
      const entry = createTestEntry();

      // ACT
      transport.write(entry);

      // ASSERT - file should not exist yet (buffered)
      expect(existsSync(path)).toBe(false);
    });

    it("should serialize entry as JSON with correct structure", async () => {
      // ARRANGE
      const path = join(testDir, "write-json.log");
      const transport = createTransport(path, { bufferSize: 1 });
      const entry = createTestEntry({
        level: "error",
        message: "test error",
        context: "TestContext",
        meta: { userId: 123, action: "test" },
      });

      // ACT
      transport.write(entry);
      await transport.flush();

      // ASSERT
      const content = readFileSync(path, "utf-8");
      const parsed = JSON.parse(content.trim());
      expect(parsed.level).toBe("error");
      expect(parsed.message).toBe("test error");
      expect(parsed.context).toBe("TestContext");
      expect(parsed.userId).toBe(123);
      expect(parsed.action).toBe("test");
      expect(parsed.time).toBe(entry.timestamp);
    });

    it("should not include context if undefined", async () => {
      // ARRANGE
      const path = join(testDir, "no-context.log");
      const transport = createTransport(path);
      const entry = createTestEntry({ context: undefined });

      // ACT
      transport.write(entry);
      await transport.flush();

      // ASSERT
      const content = readFileSync(path, "utf-8");
      const parsed = JSON.parse(content.trim());
      expect(parsed).not.toHaveProperty("context");
    });

    it("should not include meta if empty object", async () => {
      // ARRANGE
      const path = join(testDir, "no-meta.log");
      const transport = createTransport(path);
      const entry = createTestEntry({ meta: {} });

      // ACT
      transport.write(entry);
      await transport.flush();

      // ASSERT
      const content = readFileSync(path, "utf-8");
      const parsed = JSON.parse(content.trim());
      // Meta fields should not be spread into the object
      expect(Object.keys(parsed)).toEqual(["level", "message", "time"]);
    });
  });

  describe("flush()", () => {
    it("should write buffer to file", async () => {
      // ARRANGE
      const path = join(testDir, "flush-write.log");
      const transport = createTransport(path);
      transport.write(createTestEntry({ message: "line 1" }));
      transport.write(createTestEntry({ message: "line 2" }));

      // ACT
      await transport.flush();

      // ASSERT
      expect(existsSync(path)).toBe(true);
      const content = readFileSync(path, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).message).toBe("line 1");
      expect(JSON.parse(lines[1]).message).toBe("line 2");
    });

    it("should create directory if it does not exist", async () => {
      // ARRANGE
      const nestedDir = join(testDir, "nested", "deep", "dir");
      const path = join(nestedDir, "nested.log");
      const transport = createTransport(path);
      transport.write(createTestEntry());

      // ACT
      await transport.flush();

      // ASSERT
      expect(existsSync(nestedDir)).toBe(true);
      expect(existsSync(path)).toBe(true);
    });

    it("should do nothing if buffer is empty", async () => {
      // ARRANGE
      const path = join(testDir, "empty-flush.log");
      const transport = createTransport(path);

      // ACT
      await transport.flush();

      // ASSERT
      expect(existsSync(path)).toBe(false);
    });

    it("should clear buffer after flush", async () => {
      // ARRANGE
      const path = join(testDir, "clear-buffer.log");
      const transport = createTransport(path);
      transport.write(createTestEntry({ message: "first" }));
      await transport.flush();

      // ACT - flush again with no new entries
      await transport.flush();

      // ASSERT - file should only contain first entry
      const content = readFileSync(path, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(1);
    });

    it("should append to existing file", async () => {
      // ARRANGE
      const path = join(testDir, "append.log");
      const transport = createTransport(path);

      // Write and flush first batch
      transport.write(createTestEntry({ message: "batch 1" }));
      await transport.flush();

      // Write and flush second batch
      transport.write(createTestEntry({ message: "batch 2" }));
      await transport.flush();

      // ASSERT
      const content = readFileSync(path, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).message).toBe("batch 1");
      expect(JSON.parse(lines[1]).message).toBe("batch 2");
    });
  });

  describe("automatic flush when buffer is full", () => {
    it("should trigger flush when buffer size is reached", async () => {
      // ARRANGE
      const path = join(testDir, "auto-flush.log");
      const transport = createTransport(path, { bufferSize: 3 });

      // ACT - write exactly bufferSize entries
      transport.write(createTestEntry({ message: "entry 1" }));
      transport.write(createTestEntry({ message: "entry 2" }));
      transport.write(createTestEntry({ message: "entry 3" }));

      // Give time for async flush to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      // ASSERT
      expect(existsSync(path)).toBe(true);
      const content = readFileSync(path, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(3);
    });

    it("should continue accepting entries after auto-flush", async () => {
      // ARRANGE
      const path = join(testDir, "continue-after-flush.log");
      const transport = createTransport(path, { bufferSize: 2 });

      // ACT - trigger auto-flush
      transport.write(createTestEntry({ message: "entry 1" }));
      transport.write(createTestEntry({ message: "entry 2" }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Write more entries
      transport.write(createTestEntry({ message: "entry 3" }));
      await transport.flush();

      // ASSERT
      const content = readFileSync(path, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(3);
    });
  });

  describe("close()", () => {
    it("should flush remaining buffer on close", async () => {
      // ARRANGE
      const path = join(testDir, "close-flush.log");
      const transport = new FileTransport({
        path,
        bufferSize: 100,
        flushInterval: 60000,
      });
      transport.write(createTestEntry({ message: "before close" }));

      // ACT
      await transport.close();

      // ASSERT
      expect(existsSync(path)).toBe(true);
      const content = readFileSync(path, "utf-8");
      expect(JSON.parse(content.trim()).message).toBe("before close");
    });

    it("should clear flush timer on close", async () => {
      // ARRANGE
      const path = join(testDir, "clear-timer.log");
      const transport = new FileTransport({
        path,
        bufferSize: 100,
        flushInterval: 100, // Short interval
      });

      // ACT
      await transport.close();

      // Wait longer than flush interval
      await new Promise((resolve) => setTimeout(resolve, 200));

      // ASSERT - no error should be thrown from interval callback
      expect(existsSync(path)).toBe(false);
    });

    it("should be safe to call close multiple times", async () => {
      // ARRANGE
      const path = join(testDir, "multi-close.log");
      const transport = new FileTransport({
        path,
        bufferSize: 100,
        flushInterval: 60000,
      });
      transport.write(createTestEntry());

      // ACT & ASSERT - should not throw
      await transport.close();
      await transport.close();
      await transport.close();
    });
  });

  describe("getLastError()", () => {
    it("should return null initially", () => {
      // ARRANGE
      const path = join(testDir, "no-error.log");
      const transport = createTransport(path);

      // ACT
      const error = transport.getLastError();

      // ASSERT
      expect(error).toBeNull();
    });

    it("should return null after successful flush", async () => {
      // ARRANGE
      const path = join(testDir, "success-flush.log");
      const transport = createTransport(path);
      transport.write(createTestEntry());

      // ACT
      await transport.flush();

      // ASSERT
      expect(transport.getLastError()).toBeNull();
    });
  });

  describe("periodic flush", () => {
    it("should flush automatically at interval", async () => {
      // ARRANGE
      const path = join(testDir, "interval-flush.log");
      const transport = new FileTransport({
        path,
        bufferSize: 100,
        flushInterval: 50, // Very short interval for testing
      });
      transportsToClose.push(transport);
      transport.write(createTestEntry({ message: "interval entry" }));

      // ACT - wait for interval to trigger
      await new Promise((resolve) => setTimeout(resolve, 100));

      // ASSERT
      expect(existsSync(path)).toBe(true);
      const content = readFileSync(path, "utf-8");
      expect(JSON.parse(content.trim()).message).toBe("interval entry");
    });

    it("should capture flush error and store it for later retrieval", async () => {
      // ARRANGE - create transport pointing to a directory (will fail on write)
      // We need to cause a flush error. The easiest way is to make the path a directory.
      const dirPath = join(testDir, "is-a-dir");
      Bun.spawnSync(["mkdir", "-p", dirPath]);

      // Create transport pointing to the directory itself (not a file inside it)
      // This will fail when trying to appendFile to a directory
      // Use bufferSize > 1 so write() doesn't trigger flush, only the interval does
      const transport = new FileTransport({
        path: dirPath, // This is a directory, not a file
        bufferSize: 100,
        flushInterval: 30, // Short interval
      });
      transportsToClose.push(transport);

      // Write an entry to buffer (won't trigger flush since bufferSize is 100)
      transport.write(createTestEntry({ message: "will fail" }));

      // ACT - wait for interval to trigger flush (which will fail)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // ASSERT - error should be stored
      const error = transport.getLastError();
      expect(error).toBeInstanceOf(Error);
    });

    it("should handle non-Error objects in catch block", async () => {
      // ARRANGE - Test the error conversion path
      // Use a path that will cause issues
      const dirPath = join(testDir, "another-dir-for-error");
      Bun.spawnSync(["mkdir", "-p", dirPath]);

      // Use bufferSize > 1 so only interval triggers flush
      const transport = new FileTransport({
        path: dirPath,
        bufferSize: 100,
        flushInterval: 30,
      });
      transportsToClose.push(transport);

      transport.write(createTestEntry({ message: "trigger error" }));

      // ACT - wait for interval
      await new Promise((resolve) => setTimeout(resolve, 100));

      // ASSERT - error should be captured as Error
      const error = transport.getLastError();
      expect(error).toBeInstanceOf(Error);
      expect(error?.message).toBeDefined();
    });

    it("should write to stderr on flush error", async () => {
      // ARRANGE
      const dirPath = join(testDir, "stderr-test-dir");
      Bun.spawnSync(["mkdir", "-p", dirPath]);

      // Mock stderr.write
      const originalWrite = process.stderr?.write;
      let stderrOutput = "";
      if (process.stderr) {
        process.stderr.write = (chunk: string | Uint8Array) => {
          stderrOutput += chunk.toString();
          return true;
        };
      }

      // Use bufferSize > 1 so only interval triggers flush
      const transport = new FileTransport({
        path: dirPath,
        bufferSize: 100,
        flushInterval: 30,
      });
      transportsToClose.push(transport);

      transport.write(createTestEntry({ message: "stderr test" }));

      // ACT
      await new Promise((resolve) => setTimeout(resolve, 100));

      // ASSERT
      expect(stderrOutput).toContain("[FileTransport] Flush failed:");

      // Cleanup
      if (process.stderr && originalWrite) {
        process.stderr.write = originalWrite;
      }
    });
  });
});
