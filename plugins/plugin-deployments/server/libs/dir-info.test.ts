import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DirInfo } from "./dir-info";

const TEST_BASE_PATH = "/tmp/buntime-dirinfo-test";

describe("DirInfo", () => {
  beforeAll(async () => {
    // Ensure clean test directory
    await rm(TEST_BASE_PATH, { force: true, recursive: true });
    await mkdir(TEST_BASE_PATH, { recursive: true });
  });

  afterAll(async () => {
    // Cleanup
    await rm(TEST_BASE_PATH, { force: true, recursive: true });
  });

  beforeEach(() => {
    // Reset global excludes before each test
    DirInfo.globalExcludes = [".git", "node_modules"];
  });

  describe("constructor and properties", () => {
    it("should create instance with base path only", () => {
      const dir = new DirInfo(TEST_BASE_PATH);

      expect(dir.fullPath).toBe(TEST_BASE_PATH);
    });

    it("should create instance with base path and relative path", () => {
      const dir = new DirInfo(TEST_BASE_PATH, "subdir");

      expect(dir.fullPath).toBe(join(TEST_BASE_PATH, "subdir"));
    });

    it("should handle nested relative paths", () => {
      const dir = new DirInfo(TEST_BASE_PATH, "a/b/c");

      expect(dir.fullPath).toBe(join(TEST_BASE_PATH, "a/b/c"));
    });

    it("should handle empty relative path", () => {
      const dir = new DirInfo(TEST_BASE_PATH, "");

      expect(dir.fullPath).toBe(TEST_BASE_PATH);
    });
  });

  describe("globalExcludes", () => {
    it("should have default excludes", () => {
      DirInfo.globalExcludes = [".git", "node_modules"];

      expect(DirInfo.globalExcludes).toContain(".git");
      expect(DirInfo.globalExcludes).toContain("node_modules");
    });

    it("should allow setting custom excludes", () => {
      DirInfo.globalExcludes = ["dist", ".cache"];

      expect(DirInfo.globalExcludes).toEqual(["dist", ".cache"]);
    });

    it("should be a static property shared across instances", () => {
      DirInfo.globalExcludes = ["custom"];

      // Create instances to verify static property is shared
      new DirInfo(TEST_BASE_PATH);
      new DirInfo(TEST_BASE_PATH, "other");

      // Both should reference the same static property
      expect(DirInfo.globalExcludes).toEqual(["custom"]);
    });
  });

  describe("create", () => {
    const createTestPath = join(TEST_BASE_PATH, "create-test");

    afterEach(async () => {
      await rm(createTestPath, { force: true, recursive: true });
    });

    it("should create a directory", async () => {
      const dir = new DirInfo(TEST_BASE_PATH, "create-test");

      await dir.create();

      const file = Bun.file(createTestPath);
      expect(await file.exists()).toBe(false); // It's a directory, not a file
      // Check directory exists using stat
      const stats = await import("node:fs/promises").then((fs) => fs.stat(createTestPath));
      expect(stats.isDirectory()).toBe(true);
    });

    it("should create nested directories", async () => {
      const dir = new DirInfo(TEST_BASE_PATH, "create-test/nested/deep");

      await dir.create();

      const stats = await import("node:fs/promises").then((fs) =>
        fs.stat(join(TEST_BASE_PATH, "create-test/nested/deep")),
      );
      expect(stats.isDirectory()).toBe(true);
    });

    it("should not throw if directory already exists", async () => {
      const dir = new DirInfo(TEST_BASE_PATH, "create-test");
      await mkdir(createTestPath, { recursive: true });

      // Should not throw
      await expect(dir.create()).resolves.toBeUndefined();
    });
  });

  describe("writeFile", () => {
    const writeTestPath = join(TEST_BASE_PATH, "write-test");

    beforeEach(async () => {
      await mkdir(writeTestPath, { recursive: true });
    });

    afterEach(async () => {
      await rm(writeTestPath, { force: true, recursive: true });
    });

    it("should write string content to a file", async () => {
      const dir = new DirInfo(TEST_BASE_PATH, "write-test");

      await dir.writeFile("test.txt", "Hello, World!");

      const file = Bun.file(join(writeTestPath, "test.txt"));
      expect(await file.text()).toBe("Hello, World!");
    });

    it("should write ArrayBuffer content to a file", async () => {
      const dir = new DirInfo(TEST_BASE_PATH, "write-test");
      const content = new TextEncoder().encode("Binary content");

      await dir.writeFile("binary.bin", content.buffer);

      const file = Bun.file(join(writeTestPath, "binary.bin"));
      expect(await file.text()).toBe("Binary content");
    });

    it("should create subdirectories for nested file paths", async () => {
      const dir = new DirInfo(TEST_BASE_PATH, "write-test");

      await dir.writeFile("nested/deep/file.txt", "Nested content");

      const file = Bun.file(join(writeTestPath, "nested/deep/file.txt"));
      expect(await file.text()).toBe("Nested content");
    });

    it("should overwrite existing files", async () => {
      const dir = new DirInfo(TEST_BASE_PATH, "write-test");
      const filePath = join(writeTestPath, "overwrite.txt");
      await writeFile(filePath, "Original content");

      await dir.writeFile("overwrite.txt", "New content");

      const file = Bun.file(filePath);
      expect(await file.text()).toBe("New content");
    });
  });

  describe("delete", () => {
    const deleteTestPath = join(TEST_BASE_PATH, "delete-test");

    beforeEach(async () => {
      await mkdir(deleteTestPath, { recursive: true });
    });

    afterEach(async () => {
      await rm(deleteTestPath, { force: true, recursive: true });
    });

    it("should delete a file", async () => {
      const filePath = join(deleteTestPath, "file.txt");
      await writeFile(filePath, "content");
      const dir = new DirInfo(deleteTestPath, "file.txt");

      await dir.delete();

      const file = Bun.file(filePath);
      expect(await file.exists()).toBe(false);
    });

    it("should delete a directory recursively", async () => {
      const nestedPath = join(deleteTestPath, "nested");
      await mkdir(nestedPath, { recursive: true });
      await writeFile(join(nestedPath, "file.txt"), "content");
      const dir = new DirInfo(TEST_BASE_PATH, "delete-test/nested");

      await dir.delete();

      const stats = await import("node:fs/promises")
        .then((fs) => fs.stat(nestedPath))
        .catch(() => null);
      expect(stats).toBeNull();
    });

    it("should not throw when deleting non-existent path", async () => {
      const dir = new DirInfo(deleteTestPath, "non-existent");

      // Should not throw
      await expect(dir.delete()).resolves.toBeUndefined();
    });
  });

  describe("list", () => {
    const listTestPath = join(TEST_BASE_PATH, "list-test");

    beforeEach(async () => {
      await mkdir(listTestPath, { recursive: true });
      DirInfo.globalExcludes = [".git", "node_modules"];
    });

    afterEach(async () => {
      await rm(listTestPath, { force: true, recursive: true });
    });

    it("should list files and directories", async () => {
      await mkdir(join(listTestPath, "subdir"), { recursive: true });
      await writeFile(join(listTestPath, "file.txt"), "content");
      const dir = new DirInfo(TEST_BASE_PATH, "list-test");

      const entries = await dir.list();

      expect(entries).toHaveLength(2);
      const dirEntry = entries.find((e) => e.name === "subdir");
      const fileEntry = entries.find((e) => e.name === "file.txt");
      expect(dirEntry?.isDirectory).toBe(true);
      expect(fileEntry?.isDirectory).toBe(false);
    });

    it("should exclude global excludes", async () => {
      await mkdir(join(listTestPath, "node_modules"), { recursive: true });
      await mkdir(join(listTestPath, ".git"), { recursive: true });
      await writeFile(join(listTestPath, "file.txt"), "content");
      const dir = new DirInfo(TEST_BASE_PATH, "list-test");

      const entries = await dir.list();

      expect(entries).toHaveLength(1);
      expect(entries[0]?.name).toBe("file.txt");
    });

    it("should exclude .dirinfo cache files", async () => {
      await writeFile(join(listTestPath, ".dirinfo"), '{"files": 1}');
      await writeFile(join(listTestPath, "file.txt"), "content");
      const dir = new DirInfo(TEST_BASE_PATH, "list-test");

      const entries = await dir.list();

      expect(entries).toHaveLength(1);
      expect(entries[0]?.name).toBe("file.txt");
    });

    it("should sort directories before files", async () => {
      await writeFile(join(listTestPath, "aaa.txt"), "content");
      await mkdir(join(listTestPath, "zzz-dir"), { recursive: true });
      const dir = new DirInfo(TEST_BASE_PATH, "list-test");

      const entries = await dir.list();

      expect(entries[0]?.name).toBe("zzz-dir");
      expect(entries[0]?.isDirectory).toBe(true);
      expect(entries[1]?.name).toBe("aaa.txt");
      expect(entries[1]?.isDirectory).toBe(false);
    });

    it("should sort entries alphabetically within type", async () => {
      await writeFile(join(listTestPath, "c.txt"), "content");
      await writeFile(join(listTestPath, "a.txt"), "content");
      await writeFile(join(listTestPath, "b.txt"), "content");
      const dir = new DirInfo(TEST_BASE_PATH, "list-test");

      const entries = await dir.list();

      expect(entries.map((e) => e.name)).toEqual(["a.txt", "b.txt", "c.txt"]);
    });

    it("should return correct file metadata", async () => {
      const content = "Test content";
      const filePath = join(listTestPath, "meta.txt");
      await writeFile(filePath, content);
      const dir = new DirInfo(TEST_BASE_PATH, "list-test");

      const entries = await dir.list();

      const fileEntry = entries.find((e) => e.name === "meta.txt");
      expect(fileEntry).toBeDefined();
      expect(fileEntry?.size).toBe(content.length);
      expect(fileEntry?.updatedAt).toBeDefined();
      expect(fileEntry?.path).toBe("list-test/meta.txt");
    });

    it("should return empty array for non-existent directory", async () => {
      const dir = new DirInfo(TEST_BASE_PATH, "non-existent-dir");

      const entries = await dir.list();

      expect(entries).toEqual([]);
    });

    it("should include hidden files (dot files)", async () => {
      await writeFile(join(listTestPath, ".hidden"), "content");
      await writeFile(join(listTestPath, "visible.txt"), "content");
      const dir = new DirInfo(TEST_BASE_PATH, "list-test");

      const entries = await dir.list();

      expect(entries.map((e) => e.name)).toContain(".hidden");
      expect(entries.map((e) => e.name)).toContain("visible.txt");
    });
  });

  describe("size and files", () => {
    const sizeTestPath = join(TEST_BASE_PATH, "size-test");

    beforeEach(async () => {
      await mkdir(sizeTestPath, { recursive: true });
    });

    afterEach(async () => {
      await rm(sizeTestPath, { force: true, recursive: true });
    });

    it("should calculate total size of files", async () => {
      await writeFile(join(sizeTestPath, "a.txt"), "12345"); // 5 bytes
      await writeFile(join(sizeTestPath, "b.txt"), "1234567890"); // 10 bytes
      const dir = new DirInfo(TEST_BASE_PATH, "size-test");

      const size = await dir.size();

      expect(size).toBe(15);
    });

    it("should count total files", async () => {
      await writeFile(join(sizeTestPath, "a.txt"), "content");
      await writeFile(join(sizeTestPath, "b.txt"), "content");
      await mkdir(join(sizeTestPath, "sub"), { recursive: true });
      await writeFile(join(sizeTestPath, "sub/c.txt"), "content");
      const dir = new DirInfo(TEST_BASE_PATH, "size-test");

      const files = await dir.files();

      expect(files).toBe(3);
    });

    it("should return zero for empty directory", async () => {
      const dir = new DirInfo(TEST_BASE_PATH, "size-test");

      const size = await dir.size();
      const files = await dir.files();

      expect(size).toBe(0);
      expect(files).toBe(0);
    });
  });

  describe("updatedAt", () => {
    const updateTestPath = join(TEST_BASE_PATH, "update-test");

    beforeEach(async () => {
      await mkdir(updateTestPath, { recursive: true });
    });

    afterEach(async () => {
      await rm(updateTestPath, { force: true, recursive: true });
    });

    it("should return latest modification time", async () => {
      const beforeWrite = new Date();
      await writeFile(join(updateTestPath, "file.txt"), "content");
      const dir = new DirInfo(TEST_BASE_PATH, "update-test");

      const updatedAt = await dir.updatedAt();

      const updateDate = new Date(updatedAt);
      expect(updateDate.getTime()).toBeGreaterThanOrEqual(beforeWrite.getTime() - 1000);
      expect(updateDate.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it("should return ISO date string", async () => {
      await writeFile(join(updateTestPath, "file.txt"), "content");
      const dir = new DirInfo(TEST_BASE_PATH, "update-test");

      const updatedAt = await dir.updatedAt();

      expect(() => new Date(updatedAt)).not.toThrow();
      expect(updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe("rename", () => {
    const renameTestPath = join(TEST_BASE_PATH, "rename-test");

    beforeEach(async () => {
      await mkdir(renameTestPath, { recursive: true });
    });

    afterEach(async () => {
      await rm(renameTestPath, { force: true, recursive: true });
      await rm(join(TEST_BASE_PATH, "renamed"), { force: true, recursive: true });
    });

    it("should rename a file", async () => {
      const originalPath = join(renameTestPath, "original.txt");
      await writeFile(originalPath, "content");
      const dir = new DirInfo(TEST_BASE_PATH, "rename-test/original.txt");

      await dir.rename("renamed.txt");

      const originalFile = Bun.file(originalPath);
      expect(await originalFile.exists()).toBe(false);

      const renamedFile = Bun.file(join(renameTestPath, "renamed.txt"));
      expect(await renamedFile.exists()).toBe(true);
      expect(await renamedFile.text()).toBe("content");
    });

    it("should rename a directory", async () => {
      const subdir = join(renameTestPath, "subdir");
      await mkdir(subdir, { recursive: true });
      await writeFile(join(subdir, "file.txt"), "content");
      const dir = new DirInfo(TEST_BASE_PATH, "rename-test/subdir");

      await dir.rename("renamed-dir");

      const stats = await import("node:fs/promises")
        .then((fs) => fs.stat(join(renameTestPath, "renamed-dir")))
        .catch(() => null);
      expect(stats?.isDirectory()).toBe(true);

      const file = Bun.file(join(renameTestPath, "renamed-dir/file.txt"));
      expect(await file.exists()).toBe(true);
    });

    it("should update internal dirPath after rename", async () => {
      const subdir = join(renameTestPath, "original");
      await mkdir(subdir, { recursive: true });
      const dir = new DirInfo(TEST_BASE_PATH, "rename-test/original");

      await dir.rename("new-name");

      expect(dir.fullPath).toBe(join(TEST_BASE_PATH, "rename-test/new-name"));
    });
  });

  describe("move", () => {
    const moveTestPath = join(TEST_BASE_PATH, "move-test");

    beforeEach(async () => {
      await mkdir(moveTestPath, { recursive: true });
      // Create a nested structure for move tests: app/1.0.0/file.txt
      await mkdir(join(moveTestPath, "app/1.0.0"), { recursive: true });
      await mkdir(join(moveTestPath, "app/2.0.0"), { recursive: true });
      await writeFile(join(moveTestPath, "app/1.0.0/file.txt"), "content");
    });

    afterEach(async () => {
      await rm(moveTestPath, { force: true, recursive: true });
    });

    it("should move a file to another version folder", async () => {
      const dir = new DirInfo(moveTestPath, "app/1.0.0/file.txt");

      await dir.move("app/2.0.0");

      const originalFile = Bun.file(join(moveTestPath, "app/1.0.0/file.txt"));
      expect(await originalFile.exists()).toBe(false);

      const movedFile = Bun.file(join(moveTestPath, "app/2.0.0/file.txt"));
      expect(await movedFile.exists()).toBe(true);
    });

    it("should throw when trying to move app folder", async () => {
      const dir = new DirInfo(moveTestPath, "app");

      await expect(dir.move("other")).rejects.toThrow("Cannot move app or version folders");
    });

    it("should throw when trying to move version folder", async () => {
      const dir = new DirInfo(moveTestPath, "app/1.0.0");

      await expect(dir.move("app/2.0.0")).rejects.toThrow("Cannot move app or version folders");
    });

    it("should throw when destination is outside allowed directory", async () => {
      const dir = new DirInfo(moveTestPath, "app/1.0.0/file.txt");

      await expect(dir.move("../../../outside")).rejects.toThrow(
        "Destination path is outside allowed directory",
      );
    });

    it("should throw when destination is not inside a version folder", async () => {
      const dir = new DirInfo(moveTestPath, "app/1.0.0/file.txt");

      await expect(dir.move("app")).rejects.toThrow("Destination must be inside an app version");
    });

    it("should throw when destination directory does not exist", async () => {
      const dir = new DirInfo(moveTestPath, "app/1.0.0/file.txt");

      await expect(dir.move("app/3.0.0")).rejects.toThrow("Destination directory does not exist");
    });

    it("should throw when destination is not a directory", async () => {
      await writeFile(join(moveTestPath, "app/2.0.0/existing.txt"), "content");
      const dir = new DirInfo(moveTestPath, "app/1.0.0/file.txt");

      await expect(dir.move("app/2.0.0/existing.txt")).rejects.toThrow();
    });

    it("should throw when item with same name exists at destination", async () => {
      await writeFile(join(moveTestPath, "app/2.0.0/file.txt"), "existing content");
      const dir = new DirInfo(moveTestPath, "app/1.0.0/file.txt");

      await expect(dir.move("app/2.0.0")).rejects.toThrow(
        "An item with this name already exists at destination",
      );
    });
  });

  describe("extractZip", () => {
    const zipTestPath = join(TEST_BASE_PATH, "zip-test");

    beforeEach(async () => {
      await mkdir(zipTestPath, { recursive: true });
    });

    afterEach(async () => {
      await rm(zipTestPath, { force: true, recursive: true });
    });

    it("should extract zip contents", async () => {
      // Create a simple zip file
      const tempDir = join(TEST_BASE_PATH, "temp-zip-content");
      await mkdir(tempDir, { recursive: true });
      await writeFile(join(tempDir, "file1.txt"), "Content 1");
      await writeFile(join(tempDir, "file2.txt"), "Content 2");

      // Create zip
      const zipPath = join(TEST_BASE_PATH, "test.zip");
      const proc = Bun.spawn(["zip", "-r", "-q", zipPath, "."], { cwd: tempDir });
      await proc.exited;

      // Read zip as ArrayBuffer
      const zipFile = Bun.file(zipPath);
      const zipBuffer = await zipFile.arrayBuffer();

      const dir = new DirInfo(TEST_BASE_PATH, "zip-test");
      await dir.extractZip(zipBuffer);

      // Verify extracted files
      const file1 = Bun.file(join(zipTestPath, "file1.txt"));
      const file2 = Bun.file(join(zipTestPath, "file2.txt"));
      expect(await file1.text()).toBe("Content 1");
      expect(await file2.text()).toBe("Content 2");

      // Cleanup
      await rm(tempDir, { force: true, recursive: true });
      await rm(zipPath, { force: true });
    });

    it("should remove temporary zip file after extraction", async () => {
      const tempDir = join(TEST_BASE_PATH, "temp-zip-content2");
      await mkdir(tempDir, { recursive: true });
      await writeFile(join(tempDir, "file.txt"), "Content");

      const zipPath = join(TEST_BASE_PATH, "test2.zip");
      const proc = Bun.spawn(["zip", "-r", "-q", zipPath, "."], { cwd: tempDir });
      await proc.exited;

      const zipFile = Bun.file(zipPath);
      const zipBuffer = await zipFile.arrayBuffer();

      const dir = new DirInfo(TEST_BASE_PATH, "zip-test");
      await dir.extractZip(zipBuffer);

      // Verify temp zip is removed
      const tempZipFile = Bun.file(join(zipTestPath, ".temp-upload.zip"));
      expect(await tempZipFile.exists()).toBe(false);

      // Cleanup
      await rm(tempDir, { force: true, recursive: true });
      await rm(zipPath, { force: true });
    });
  });

  describe("refresh", () => {
    const refreshTestPath = join(TEST_BASE_PATH, "refresh-test");

    beforeEach(async () => {
      await mkdir(refreshTestPath, { recursive: true });
    });

    afterEach(async () => {
      await rm(refreshTestPath, { force: true, recursive: true });
    });

    it("should invalidate all caches", async () => {
      // Create some files and generate cache
      await writeFile(join(refreshTestPath, "file.txt"), "content");
      const dir = new DirInfo(TEST_BASE_PATH, "refresh-test");

      // Access to generate cache
      await dir.size();

      // Write cache file to verify it gets deleted
      await writeFile(join(refreshTestPath, ".dirinfo"), '{"files":1,"size":7}');

      await dir.refresh();

      // Cache file should be deleted
      const cacheFile = Bun.file(join(refreshTestPath, ".dirinfo"));
      expect(await cacheFile.exists()).toBe(false);
    });
  });

  describe("getVisibility", () => {
    const visibilityTestPath = join(TEST_BASE_PATH, "visibility-test");

    beforeEach(async () => {
      await mkdir(visibilityTestPath, { recursive: true });
    });

    afterEach(async () => {
      await rm(visibilityTestPath, { force: true, recursive: true });
    });

    it("should return undefined when no visibility config exists", async () => {
      const dir = new DirInfo(TEST_BASE_PATH, "visibility-test");

      const visibility = await dir.getVisibility();

      expect(visibility).toBeUndefined();
    });

    it("should read visibility from manifest.jsonc", async () => {
      await writeFile(
        join(visibilityTestPath, "manifest.jsonc"),
        JSON.stringify({ visibility: "internal" }),
      );
      const dir = new DirInfo(TEST_BASE_PATH, "visibility-test");

      const visibility = await dir.getVisibility();

      expect(visibility).toBe("internal");
    });
  });

  describe("cache behavior", () => {
    const cacheTestPath = join(TEST_BASE_PATH, "cache-test");

    beforeEach(async () => {
      await mkdir(cacheTestPath, { recursive: true });
    });

    afterEach(async () => {
      await rm(cacheTestPath, { force: true, recursive: true });
    });

    it("should cache info and reuse it", async () => {
      await writeFile(join(cacheTestPath, "file.txt"), "content");
      const dir = new DirInfo(TEST_BASE_PATH, "cache-test");

      // First call calculates
      const size1 = await dir.size();
      // Second call uses cache
      const size2 = await dir.size();

      expect(size1).toBe(size2);
    });

    it("should invalidate cache when file is written", async () => {
      const dir = new DirInfo(TEST_BASE_PATH, "cache-test");
      await writeFile(join(cacheTestPath, "file.txt"), "initial");

      const size1 = await dir.size();

      // Write more content
      await dir.writeFile("file2.txt", "more content");

      // Force re-read by creating new instance (simulating cache invalidation)
      const dir2 = new DirInfo(TEST_BASE_PATH, "cache-test");
      const size2 = await dir2.size();

      expect(size2).toBeGreaterThan(size1);
    });
  });

  describe("list with version folders", () => {
    const versionTestPath = join(TEST_BASE_PATH, "version-test");

    beforeEach(async () => {
      await mkdir(versionTestPath, { recursive: true });
    });

    afterEach(async () => {
      await rm(versionTestPath, { force: true, recursive: true });
    });

    it("should detect nested version folders", async () => {
      // Create app with version folders
      await mkdir(join(versionTestPath, "my-app/1.0.0"), { recursive: true });
      await writeFile(join(versionTestPath, "my-app/1.0.0/index.js"), "content");
      const dir = new DirInfo(TEST_BASE_PATH, "version-test/my-app");

      const entries = await dir.list();

      expect(entries).toHaveLength(1);
      expect(entries[0]?.name).toBe("1.0.0");
      expect(entries[0]?.isDirectory).toBe(true);
    });

    it("should detect flat version folders", async () => {
      // Create flat version folder
      await mkdir(join(versionTestPath, "my-app@1.0.0"), { recursive: true });
      await writeFile(join(versionTestPath, "my-app@1.0.0/index.js"), "content");
      const dir = new DirInfo(TEST_BASE_PATH, "version-test");

      const entries = await dir.list();

      expect(entries).toHaveLength(1);
      expect(entries[0]?.name).toBe("my-app@1.0.0");
      expect(entries[0]?.isDirectory).toBe(true);
    });

    it("should detect latest version tag", async () => {
      await mkdir(join(versionTestPath, "my-app/latest"), { recursive: true });
      await writeFile(join(versionTestPath, "my-app/latest/index.js"), "content");
      const dir = new DirInfo(TEST_BASE_PATH, "version-test/my-app");

      const entries = await dir.list();

      expect(entries).toHaveLength(1);
      expect(entries[0]?.name).toBe("latest");
    });
  });

  describe("per-app excludes", () => {
    const excludesTestPath = join(TEST_BASE_PATH, "excludes-test");

    beforeEach(async () => {
      await mkdir(excludesTestPath, { recursive: true });
      DirInfo.globalExcludes = [".git", "node_modules"];
    });

    afterEach(async () => {
      await rm(excludesTestPath, { force: true, recursive: true });
    });

    it("should apply per-app excludes from manifest.jsonc", async () => {
      // Create app with version folder and config
      await mkdir(join(excludesTestPath, "my-app/1.0.0/dist"), { recursive: true });
      await writeFile(
        join(excludesTestPath, "my-app/1.0.0/manifest.jsonc"),
        JSON.stringify({ excludes: ["dist"] }),
      );
      await writeFile(join(excludesTestPath, "my-app/1.0.0/index.js"), "content");
      await writeFile(join(excludesTestPath, "my-app/1.0.0/dist/bundle.js"), "bundle");

      const dir = new DirInfo(excludesTestPath, "my-app/1.0.0");
      const entries = await dir.list();

      // dist should be excluded
      expect(entries.map((e) => e.name)).not.toContain("dist");
      expect(entries.map((e) => e.name)).toContain("index.js");
    });

    it("should merge global and per-app excludes", async () => {
      // Create app with version folder and config
      await mkdir(join(excludesTestPath, "my-app/1.0.0/dist"), { recursive: true });
      await mkdir(join(excludesTestPath, "my-app/1.0.0/node_modules"), { recursive: true });
      await writeFile(
        join(excludesTestPath, "my-app/1.0.0/manifest.jsonc"),
        JSON.stringify({ excludes: ["dist"] }),
      );
      await writeFile(join(excludesTestPath, "my-app/1.0.0/index.js"), "content");

      const dir = new DirInfo(excludesTestPath, "my-app/1.0.0");
      const entries = await dir.list();

      // Both dist (per-app) and node_modules (global) should be excluded
      expect(entries.map((e) => e.name)).not.toContain("dist");
      expect(entries.map((e) => e.name)).not.toContain("node_modules");
      expect(entries.map((e) => e.name)).toContain("index.js");
    });
  });
});
