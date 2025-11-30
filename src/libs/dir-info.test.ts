import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DirInfo } from "./dir-info";

const TEST_DIR = join(import.meta.dir, ".test-dir-info");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("DirInfo", () => {
  describe("constructor", () => {
    it("should create instance with basePath and dirPath", () => {
      const dir = new DirInfo(TEST_DIR, "subdir");
      expect(dir.fullPath).toBe(join(TEST_DIR, "subdir"));
    });

    it("should create instance with only basePath", () => {
      const dir = new DirInfo(TEST_DIR);
      expect(dir.fullPath).toBe(TEST_DIR);
    });
  });

  describe("create", () => {
    it("should create directory", async () => {
      const dir = new DirInfo(TEST_DIR, "new-dir");
      await dir.create();

      const file = Bun.file(dir.fullPath);
      expect(await file.exists()).toBe(false); // directories return false for exists()

      // Verify by listing parent
      const parent = new DirInfo(TEST_DIR);
      const entries = await parent.list();
      expect(entries.some((e) => e.name === "new-dir")).toBe(true);
    });

    it("should create nested directories", async () => {
      const dir = new DirInfo(TEST_DIR, "a/b/c");
      await dir.create();

      const parent = new DirInfo(TEST_DIR, "a/b");
      const entries = await parent.list();
      expect(entries.some((e) => e.name === "c")).toBe(true);
    });
  });

  describe("delete", () => {
    it("should delete file", async () => {
      const filePath = join(TEST_DIR, "test.txt");
      writeFileSync(filePath, "content");

      const dir = new DirInfo(TEST_DIR, "test.txt");
      await dir.delete();

      const file = Bun.file(filePath);
      expect(await file.exists()).toBe(false);
    });

    it("should delete directory recursively", async () => {
      mkdirSync(join(TEST_DIR, "to-delete/nested"), { recursive: true });
      writeFileSync(join(TEST_DIR, "to-delete/nested/file.txt"), "content");

      const dir = new DirInfo(TEST_DIR, "to-delete");
      await dir.delete();

      const parent = new DirInfo(TEST_DIR);
      const entries = await parent.list();
      expect(entries.some((e) => e.name === "to-delete")).toBe(false);
    });
  });

  describe("list", () => {
    it("should list files and directories", async () => {
      mkdirSync(join(TEST_DIR, "subdir"));
      writeFileSync(join(TEST_DIR, "file.txt"), "content");

      const dir = new DirInfo(TEST_DIR);
      const entries = await dir.list();

      expect(entries).toHaveLength(2);
      expect(entries[0]!.name).toBe("subdir");
      expect(entries[0]!.isDirectory).toBe(true);
      expect(entries[1]!.name).toBe("file.txt");
      expect(entries[1]!.isDirectory).toBe(false);
    });

    it("should sort directories first, then by name", async () => {
      writeFileSync(join(TEST_DIR, "z-file.txt"), "");
      mkdirSync(join(TEST_DIR, "a-dir"));
      writeFileSync(join(TEST_DIR, "a-file.txt"), "");
      mkdirSync(join(TEST_DIR, "z-dir"));

      const dir = new DirInfo(TEST_DIR);
      const entries = await dir.list();

      expect(entries.map((e) => e.name)).toEqual(["a-dir", "z-dir", "a-file.txt", "z-file.txt"]);
    });

    it("should return empty array for non-existent directory", async () => {
      const dir = new DirInfo(TEST_DIR, "non-existent");
      const entries = await dir.list();
      expect(entries).toEqual([]);
    });

    it("should not include .dirinfo file in listing", async () => {
      writeFileSync(join(TEST_DIR, ".dirinfo"), "{}");
      writeFileSync(join(TEST_DIR, "file.txt"), "content");

      const dir = new DirInfo(TEST_DIR);
      const entries = await dir.list();

      expect(entries).toHaveLength(1);
      expect(entries[0]!.name).toBe("file.txt");
    });

    it("should include file count for directories", async () => {
      mkdirSync(join(TEST_DIR, "subdir"));
      writeFileSync(join(TEST_DIR, "subdir/a.txt"), "a");
      writeFileSync(join(TEST_DIR, "subdir/b.txt"), "b");

      const dir = new DirInfo(TEST_DIR);
      const entries = await dir.list();

      const subdir = entries.find((e) => e.name === "subdir");
      expect(subdir?.files).toBe(2);
    });
  });

  describe("rename", () => {
    it("should rename file", async () => {
      writeFileSync(join(TEST_DIR, "old.txt"), "content");

      const dir = new DirInfo(TEST_DIR, "old.txt");
      await dir.rename("new.txt");

      const parent = new DirInfo(TEST_DIR);
      const entries = await parent.list();
      expect(entries.some((e) => e.name === "old.txt")).toBe(false);
      expect(entries.some((e) => e.name === "new.txt")).toBe(true);
    });

    it("should rename directory", async () => {
      mkdirSync(join(TEST_DIR, "old-dir"));

      const dir = new DirInfo(TEST_DIR, "old-dir");
      await dir.rename("new-dir");

      const parent = new DirInfo(TEST_DIR);
      const entries = await parent.list();
      expect(entries.some((e) => e.name === "old-dir")).toBe(false);
      expect(entries.some((e) => e.name === "new-dir")).toBe(true);
    });

    it("should update dirPath after rename", async () => {
      mkdirSync(join(TEST_DIR, "old-dir"));

      const dir = new DirInfo(TEST_DIR, "old-dir");
      await dir.rename("new-dir");

      expect(dir.fullPath).toBe(join(TEST_DIR, "new-dir"));
    });
  });

  describe("writeFile", () => {
    it("should write string content", async () => {
      const dir = new DirInfo(TEST_DIR);
      await dir.writeFile("test.txt", "hello world");

      const file = Bun.file(join(TEST_DIR, "test.txt"));
      expect(await file.text()).toBe("hello world");
    });

    it("should write ArrayBuffer content", async () => {
      const dir = new DirInfo(TEST_DIR);
      const content = new TextEncoder().encode("binary content").buffer;
      await dir.writeFile("test.bin", content);

      const file = Bun.file(join(TEST_DIR, "test.bin"));
      expect(await file.text()).toBe("binary content");
    });
  });

  describe("size", () => {
    it("should return total size of files in directory", async () => {
      writeFileSync(join(TEST_DIR, "a.txt"), "12345"); // 5 bytes
      writeFileSync(join(TEST_DIR, "b.txt"), "1234567890"); // 10 bytes

      const dir = new DirInfo(TEST_DIR);
      const size = await dir.size();

      expect(size).toBe(15);
    });

    it("should include nested files in size", async () => {
      mkdirSync(join(TEST_DIR, "nested"));
      writeFileSync(join(TEST_DIR, "a.txt"), "12345"); // 5 bytes
      writeFileSync(join(TEST_DIR, "nested/b.txt"), "1234567890"); // 10 bytes

      const dir = new DirInfo(TEST_DIR);
      const size = await dir.size();

      expect(size).toBe(15);
    });

    it("should return 0 for empty directory", async () => {
      const dir = new DirInfo(TEST_DIR);
      const size = await dir.size();

      expect(size).toBe(0);
    });
  });

  describe("files", () => {
    it("should return count of files in directory", async () => {
      writeFileSync(join(TEST_DIR, "a.txt"), "");
      writeFileSync(join(TEST_DIR, "b.txt"), "");
      writeFileSync(join(TEST_DIR, "c.txt"), "");

      const dir = new DirInfo(TEST_DIR);
      const count = await dir.files();

      expect(count).toBe(3);
    });

    it("should include nested files in count", async () => {
      mkdirSync(join(TEST_DIR, "nested"));
      writeFileSync(join(TEST_DIR, "a.txt"), "");
      writeFileSync(join(TEST_DIR, "nested/b.txt"), "");

      const dir = new DirInfo(TEST_DIR);
      const count = await dir.files();

      expect(count).toBe(2);
    });

    it("should not count directories", async () => {
      mkdirSync(join(TEST_DIR, "subdir"));
      writeFileSync(join(TEST_DIR, "file.txt"), "");

      const dir = new DirInfo(TEST_DIR);
      const count = await dir.files();

      expect(count).toBe(1);
    });
  });

  describe("updatedAt", () => {
    it("should return ISO date string", async () => {
      writeFileSync(join(TEST_DIR, "file.txt"), "content");

      const dir = new DirInfo(TEST_DIR);
      const updatedAt = await dir.updatedAt();

      expect(updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe("caching", () => {
    it("should cache info after first call", async () => {
      writeFileSync(join(TEST_DIR, "file.txt"), "12345");

      const dir = new DirInfo(TEST_DIR);

      // First call calculates
      const size1 = await dir.size();
      expect(size1).toBe(5);

      // Modify file (but cache should still return old value)
      writeFileSync(join(TEST_DIR, "file.txt"), "1234567890");

      // Second call uses in-memory cache
      const size2 = await dir.size();
      expect(size2).toBe(5);
    });

    it("should create .dirinfo cache file", async () => {
      writeFileSync(join(TEST_DIR, "file.txt"), "content");

      const dir = new DirInfo(TEST_DIR);
      await dir.size();

      // Wait for fire-and-forget write
      await Bun.sleep(50);

      const cacheFile = Bun.file(join(TEST_DIR, ".dirinfo"));
      expect(await cacheFile.exists()).toBe(true);

      const cache = await cacheFile.json();
      expect(cache.files).toBe(1);
      expect(cache.size).toBe(7);
    });

    it("should invalidate cache after writeFile", async () => {
      writeFileSync(join(TEST_DIR, "file.txt"), "12345");

      const dir = new DirInfo(TEST_DIR);
      const size1 = await dir.size();
      expect(size1).toBe(5);

      // writeFile should invalidate cache
      await dir.writeFile("new.txt", "1234567890");

      // New instance to avoid in-memory cache
      const dir2 = new DirInfo(TEST_DIR);
      const size2 = await dir2.size();
      expect(size2).toBe(15);
    });
  });

  describe("extractZip", () => {
    it("should extract zip file contents", async () => {
      // Create a simple zip using Bun
      const proc = Bun.spawn(["zip", "-j", join(TEST_DIR, "test.zip"), "-"], {
        stdin: "pipe",
      });
      proc.stdin.write("file content");
      proc.stdin.end();
      await proc.exited;

      // Skip test if zip command failed (not available)
      const zipFile = Bun.file(join(TEST_DIR, "test.zip"));
      if (!(await zipFile.exists())) {
        console.log("Skipping extractZip test - zip command not available");
        return;
      }

      const zipBuffer = await zipFile.arrayBuffer();
      mkdirSync(join(TEST_DIR, "extracted"));

      const dir = new DirInfo(TEST_DIR, "extracted");
      await dir.extractZip(zipBuffer);

      // Verify temp file is removed
      const tempFile = Bun.file(join(TEST_DIR, "extracted/.temp-upload.zip"));
      expect(await tempFile.exists()).toBe(false);
    });
  });
});
