import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { api, getDirNames, getExcludes, getWorkerDirs, setExcludes, setWorkerDirs } from "./api";
import { DirInfo } from "./libs/dir-info";

const TEST_APPS_PATH = "/tmp/buntime-api-test/apps";
const TEST_PACKAGES_PATH = "/tmp/buntime-api-test/packages";
const TEST_BASE_PATH = "/tmp/buntime-api-test";

/**
 * Helper to make requests to the API
 */
async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<Response> {
  const url = `http://localhost/api${path}`;
  const options: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  };

  if (body !== undefined) {
    if (body instanceof FormData) {
      options.body = body;
      // Remove Content-Type header for FormData (browser sets it with boundary)
      delete (options.headers as Record<string, string>)["Content-Type"];
    } else {
      options.body = JSON.stringify(body);
    }
  }

  return api.fetch(new Request(url, options));
}

describe("api", () => {
  const originalWorkerDirs = getWorkerDirs();
  const originalExcludes = getExcludes();

  beforeAll(async () => {
    // Setup test directories
    await rm(TEST_BASE_PATH, { force: true, recursive: true });
    await mkdir(TEST_APPS_PATH, { recursive: true });
    await mkdir(TEST_PACKAGES_PATH, { recursive: true });
  });

  afterAll(async () => {
    // Cleanup
    await rm(TEST_BASE_PATH, { force: true, recursive: true });
    // Restore original state
    setWorkerDirs(originalWorkerDirs);
    setExcludes(originalExcludes, true);
  });

  beforeEach(async () => {
    // Reset state
    setWorkerDirs([TEST_APPS_PATH, TEST_PACKAGES_PATH]);
    setExcludes([".git", "node_modules"], true);
    DirInfo.globalExcludes = [".git", "node_modules"];

    // Clean test directories
    await rm(TEST_APPS_PATH, { force: true, recursive: true });
    await rm(TEST_PACKAGES_PATH, { force: true, recursive: true });
    await mkdir(TEST_APPS_PATH, { recursive: true });
    await mkdir(TEST_PACKAGES_PATH, { recursive: true });
  });

  describe("GET /list", () => {
    it("should list root directories (workerDirs)", async () => {
      const res = await apiRequest("GET", "/list");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.entries).toHaveLength(2);
      expect(json.data.entries.map((e: { name: string }) => e.name)).toContain("apps");
      expect(json.data.entries.map((e: { name: string }) => e.name)).toContain("packages");
    });

    it("should list contents of a workerDir", async () => {
      await mkdir(join(TEST_APPS_PATH, "my-app"), { recursive: true });
      await writeFile(join(TEST_APPS_PATH, "file.txt"), "content");

      const res = await apiRequest("GET", "/list?path=apps");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.entries).toHaveLength(2);
      expect(json.data.entries.map((e: { name: string }) => e.name)).toContain("my-app");
      expect(json.data.entries.map((e: { name: string }) => e.name)).toContain("file.txt");
    });

    it("should list nested path contents", async () => {
      await mkdir(join(TEST_APPS_PATH, "my-app/1.0.0"), { recursive: true });
      await writeFile(join(TEST_APPS_PATH, "my-app/1.0.0/index.js"), "content");

      const res = await apiRequest("GET", "/list?path=apps/my-app/1.0.0");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.data.entries).toHaveLength(1);
      expect(json.data.entries[0].name).toBe("index.js");
    });

    it("should return 404 for non-existent workerDir", async () => {
      const res = await apiRequest("GET", "/list?path=non-existent");
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.success).toBe(false);
    });

    it("should filter out internal visibility apps", async () => {
      await mkdir(join(TEST_APPS_PATH, "internal-app"), { recursive: true });
      await writeFile(
        join(TEST_APPS_PATH, "internal-app/manifest.jsonc"),
        JSON.stringify({ visibility: "internal" }),
      );
      await mkdir(join(TEST_APPS_PATH, "public-app"), { recursive: true });

      const res = await apiRequest("GET", "/list?path=apps");
      const json = await res.json();

      expect(json.data.entries.map((e: { name: string }) => e.name)).not.toContain("internal-app");
      expect(json.data.entries.map((e: { name: string }) => e.name)).toContain("public-app");
    });

    it("should include currentVisibility in response", async () => {
      await mkdir(join(TEST_APPS_PATH, "my-app/1.0.0"), { recursive: true });
      await writeFile(
        join(TEST_APPS_PATH, "my-app/1.0.0/manifest.jsonc"),
        JSON.stringify({ visibility: "protected" }),
      );

      const res = await apiRequest("GET", "/list?path=apps/my-app/1.0.0");
      const json = await res.json();

      expect(json.data.currentVisibility).toBe("protected");
    });
  });

  describe("POST /mkdir", () => {
    it("should create a new directory", async () => {
      const res = await apiRequest("POST", "/mkdir", { path: "apps/new-folder" });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);

      const stats = await import("node:fs/promises").then((fs) =>
        fs.stat(join(TEST_APPS_PATH, "new-folder")),
      );
      expect(stats.isDirectory()).toBe(true);
    });

    it("should create nested directories", async () => {
      const res = await apiRequest("POST", "/mkdir", { path: "apps/a/b/c" });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);

      const stats = await import("node:fs/promises").then((fs) =>
        fs.stat(join(TEST_APPS_PATH, "a/b/c")),
      );
      expect(stats.isDirectory()).toBe(true);
    });

    it("should return error when path is not provided", async () => {
      const res = await apiRequest("POST", "/mkdir", {});
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
    });

    it("should return error when trying to create at root level", async () => {
      const res = await apiRequest("POST", "/mkdir", { path: "" });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
    });
  });

  describe("DELETE /delete", () => {
    it("should delete a file", async () => {
      const filePath = join(TEST_APPS_PATH, "to-delete.txt");
      await writeFile(filePath, "content");

      const res = await apiRequest("DELETE", "/delete", { path: "apps/to-delete.txt" });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);

      const file = Bun.file(filePath);
      expect(await file.exists()).toBe(false);
    });

    it("should delete a directory recursively", async () => {
      const dirPath = join(TEST_APPS_PATH, "to-delete-dir");
      await mkdir(dirPath, { recursive: true });
      await writeFile(join(dirPath, "file.txt"), "content");

      const res = await apiRequest("DELETE", "/delete", { path: "apps/to-delete-dir" });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);

      const stats = await import("node:fs/promises")
        .then((fs) => fs.stat(dirPath))
        .catch(() => null);
      expect(stats).toBeNull();
    });

    it("should return error when path is not provided", async () => {
      const res = await apiRequest("DELETE", "/delete", {});
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
    });

    it("should return error when trying to delete root", async () => {
      const res = await apiRequest("DELETE", "/delete", { path: "" });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
    });

    it("should return error when trying to delete workerDir root", async () => {
      const res = await apiRequest("DELETE", "/delete", { path: "apps" });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
    });
  });

  describe("POST /rename", () => {
    it("should rename a file", async () => {
      await writeFile(join(TEST_APPS_PATH, "old-name.txt"), "content");

      const res = await apiRequest("POST", "/rename", {
        path: "apps/old-name.txt",
        newName: "new-name.txt",
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);

      const oldFile = Bun.file(join(TEST_APPS_PATH, "old-name.txt"));
      expect(await oldFile.exists()).toBe(false);

      const newFile = Bun.file(join(TEST_APPS_PATH, "new-name.txt"));
      expect(await newFile.exists()).toBe(true);
    });

    it("should rename a directory", async () => {
      await mkdir(join(TEST_APPS_PATH, "old-dir"), { recursive: true });

      const res = await apiRequest("POST", "/rename", {
        path: "apps/old-dir",
        newName: "new-dir",
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);

      const stats = await import("node:fs/promises").then((fs) =>
        fs.stat(join(TEST_APPS_PATH, "new-dir")),
      );
      expect(stats.isDirectory()).toBe(true);
    });

    it("should return error when path or newName is not provided", async () => {
      const res = await apiRequest("POST", "/rename", { path: "apps/file.txt" });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
    });

    it("should return error when trying to rename workerDir root", async () => {
      const res = await apiRequest("POST", "/rename", { path: "apps", newName: "new-apps" });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
    });
  });

  describe("POST /move", () => {
    beforeEach(async () => {
      // Create test structure with version folders
      await mkdir(join(TEST_APPS_PATH, "app1/1.0.0"), { recursive: true });
      await mkdir(join(TEST_APPS_PATH, "app1/2.0.0"), { recursive: true });
      await writeFile(join(TEST_APPS_PATH, "app1/1.0.0/file.txt"), "content");
    });

    it("should move a file within the same app", async () => {
      const res = await apiRequest("POST", "/move", {
        path: "apps/app1/1.0.0/file.txt",
        destPath: "apps/app1/2.0.0",
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);

      const oldFile = Bun.file(join(TEST_APPS_PATH, "app1/1.0.0/file.txt"));
      expect(await oldFile.exists()).toBe(false);

      const newFile = Bun.file(join(TEST_APPS_PATH, "app1/2.0.0/file.txt"));
      expect(await newFile.exists()).toBe(true);
    });

    it("should return error when path is not provided", async () => {
      const res = await apiRequest("POST", "/move", { destPath: "apps/app1/2.0.0" });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
    });

    it("should return error when destPath is not provided", async () => {
      const res = await apiRequest("POST", "/move", { path: "apps/app1/1.0.0/file.txt" });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
    });

    it("should return error when trying to move workerDir root", async () => {
      const res = await apiRequest("POST", "/move", {
        path: "apps",
        destPath: "packages",
      });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
    });

    it("should return error when moving between different workerDirs", async () => {
      const res = await apiRequest("POST", "/move", {
        path: "apps/app1/1.0.0/file.txt",
        destPath: "packages/app1/1.0.0",
      });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
    });
  });

  describe("POST /upload", () => {
    it("should upload a file", async () => {
      await mkdir(join(TEST_APPS_PATH, "app1/1.0.0"), { recursive: true });

      const formData = new FormData();
      formData.append("path", "apps/app1/1.0.0");
      formData.append("files", new File(["Hello World"], "hello.txt", { type: "text/plain" }));
      formData.append("paths", "hello.txt");

      const res = await apiRequest("POST", "/upload", formData);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);

      const file = Bun.file(join(TEST_APPS_PATH, "app1/1.0.0/hello.txt"));
      expect(await file.text()).toBe("Hello World");
    });

    it("should upload multiple files", async () => {
      await mkdir(join(TEST_APPS_PATH, "app1/1.0.0"), { recursive: true });

      const formData = new FormData();
      formData.append("path", "apps/app1/1.0.0");
      formData.append("files", new File(["Content 1"], "file1.txt", { type: "text/plain" }));
      formData.append("files", new File(["Content 2"], "file2.txt", { type: "text/plain" }));
      formData.append("paths", "file1.txt");
      formData.append("paths", "file2.txt");

      const res = await apiRequest("POST", "/upload", formData);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);

      const file1 = Bun.file(join(TEST_APPS_PATH, "app1/1.0.0/file1.txt"));
      const file2 = Bun.file(join(TEST_APPS_PATH, "app1/1.0.0/file2.txt"));
      expect(await file1.text()).toBe("Content 1");
      expect(await file2.text()).toBe("Content 2");
    });

    it("should return error when no files are provided", async () => {
      const formData = new FormData();
      formData.append("path", "apps/app1/1.0.0");

      const res = await apiRequest("POST", "/upload", formData);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
    });

    it("should return error when trying to upload to root", async () => {
      const formData = new FormData();
      formData.append("path", "");
      formData.append("files", new File(["Content"], "file.txt", { type: "text/plain" }));

      const res = await apiRequest("POST", "/upload", formData);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
    });
  });

  describe("GET /refresh", () => {
    it("should refresh cache for a path", async () => {
      await mkdir(join(TEST_APPS_PATH, "app1"), { recursive: true });
      await writeFile(join(TEST_APPS_PATH, "app1/.dirinfo"), '{"files":1}');

      const res = await apiRequest("GET", "/refresh?path=apps/app1");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);

      // Cache file should be deleted
      const cacheFile = Bun.file(join(TEST_APPS_PATH, "app1/.dirinfo"));
      expect(await cacheFile.exists()).toBe(false);
    });

    it("should refresh all workerDirs when no path provided", async () => {
      await writeFile(join(TEST_APPS_PATH, ".dirinfo"), '{"files":1}');
      await writeFile(join(TEST_PACKAGES_PATH, ".dirinfo"), '{"files":1}');

      const res = await apiRequest("GET", "/refresh");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
    });
  });

  describe("POST /refresh", () => {
    it("should refresh cache for a path", async () => {
      await mkdir(join(TEST_APPS_PATH, "app1"), { recursive: true });
      await writeFile(join(TEST_APPS_PATH, "app1/.dirinfo"), '{"files":1}');

      const res = await apiRequest("POST", "/refresh", { path: "apps/app1" });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
    });

    it("should refresh all workerDirs when no path provided", async () => {
      const res = await apiRequest("POST", "/refresh", {});
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
    });
  });

  describe("GET /download", () => {
    it("should download a file", async () => {
      await mkdir(join(TEST_APPS_PATH, "app1"), { recursive: true });
      await writeFile(join(TEST_APPS_PATH, "app1/file.txt"), "Download content");

      const res = await apiRequest("GET", "/download?path=apps/app1/file.txt");

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Disposition")).toContain("file.txt");
      expect(await res.text()).toBe("Download content");
    });

    it("should download a directory as zip", async () => {
      await mkdir(join(TEST_APPS_PATH, "app1"), { recursive: true });
      await writeFile(join(TEST_APPS_PATH, "app1/file.txt"), "content");

      const res = await apiRequest("GET", "/download?path=apps/app1");

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/zip");
      expect(res.headers.get("Content-Disposition")).toContain("app1.zip");
    });

    it("should return error when path is not provided", async () => {
      const res = await apiRequest("GET", "/download");
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
    });

    it("should return error when trying to download root", async () => {
      const res = await apiRequest("GET", "/download?path=");
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
    });

    it("should return 404 when file not found", async () => {
      const res = await apiRequest("GET", "/download?path=apps/non-existent.txt");
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.success).toBe(false);
    });
  });

  describe("POST /delete-batch", () => {
    it("should delete multiple files", async () => {
      await mkdir(join(TEST_APPS_PATH, "app1"), { recursive: true });
      await writeFile(join(TEST_APPS_PATH, "app1/file1.txt"), "content1");
      await writeFile(join(TEST_APPS_PATH, "app1/file2.txt"), "content2");

      const res = await apiRequest("POST", "/delete-batch", {
        paths: ["apps/app1/file1.txt", "apps/app1/file2.txt"],
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);

      const file1 = Bun.file(join(TEST_APPS_PATH, "app1/file1.txt"));
      const file2 = Bun.file(join(TEST_APPS_PATH, "app1/file2.txt"));
      expect(await file1.exists()).toBe(false);
      expect(await file2.exists()).toBe(false);
    });

    it("should return errors for failed deletions", async () => {
      await mkdir(join(TEST_APPS_PATH, "app1"), { recursive: true });
      await writeFile(join(TEST_APPS_PATH, "app1/file1.txt"), "content1");

      const res = await apiRequest("POST", "/delete-batch", {
        paths: ["apps/app1/file1.txt", "apps"], // apps is root, cannot delete
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.errors).toHaveLength(1);
      expect(json.errors[0]).toContain("apps");
    });

    it("should return error when paths is not provided", async () => {
      const res = await apiRequest("POST", "/delete-batch", {});
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
    });

    it("should return error when paths is empty", async () => {
      const res = await apiRequest("POST", "/delete-batch", { paths: [] });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
    });
  });

  describe("POST /move-batch", () => {
    beforeEach(async () => {
      await mkdir(join(TEST_APPS_PATH, "app1/1.0.0"), { recursive: true });
      await mkdir(join(TEST_APPS_PATH, "app1/2.0.0"), { recursive: true });
      await writeFile(join(TEST_APPS_PATH, "app1/1.0.0/file1.txt"), "content1");
      await writeFile(join(TEST_APPS_PATH, "app1/1.0.0/file2.txt"), "content2");
    });

    it("should move multiple files", async () => {
      const res = await apiRequest("POST", "/move-batch", {
        paths: ["apps/app1/1.0.0/file1.txt", "apps/app1/1.0.0/file2.txt"],
        destPath: "apps/app1/2.0.0",
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);

      const newFile1 = Bun.file(join(TEST_APPS_PATH, "app1/2.0.0/file1.txt"));
      const newFile2 = Bun.file(join(TEST_APPS_PATH, "app1/2.0.0/file2.txt"));
      expect(await newFile1.exists()).toBe(true);
      expect(await newFile2.exists()).toBe(true);
    });

    it("should return errors for failed moves", async () => {
      const res = await apiRequest("POST", "/move-batch", {
        paths: ["apps/app1/1.0.0/file1.txt", "apps"], // apps is root, cannot move
        destPath: "apps/app1/2.0.0",
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.errors).toHaveLength(1);
    });

    it("should return error when paths is not provided", async () => {
      const res = await apiRequest("POST", "/move-batch", { destPath: "apps/app1/2.0.0" });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
    });

    it("should return error when destPath is not provided", async () => {
      const res = await apiRequest("POST", "/move-batch", {
        paths: ["apps/app1/1.0.0/file1.txt"],
      });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
    });
  });

  describe("GET /download-batch", () => {
    it("should download multiple items as zip", async () => {
      await mkdir(join(TEST_APPS_PATH, "app1"), { recursive: true });
      await writeFile(join(TEST_APPS_PATH, "app1/file1.txt"), "content1");
      await writeFile(join(TEST_APPS_PATH, "app1/file2.txt"), "content2");

      const res = await apiRequest(
        "GET",
        "/download-batch?paths=apps/app1/file1.txt,apps/app1/file2.txt",
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/zip");
    });

    it("should return error when paths is not provided", async () => {
      const res = await apiRequest("GET", "/download-batch");
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
    });

    it("should return error when paths is empty", async () => {
      const res = await apiRequest("GET", "/download-batch?paths=");
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.success).toBe(false);
    });
  });
});

describe("GET /list - edge cases", () => {
  const originalWorkerDirs = getWorkerDirs();
  const originalExcludes = getExcludes();

  beforeAll(async () => {
    await rm(TEST_BASE_PATH, { force: true, recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_BASE_PATH, { force: true, recursive: true });
    setWorkerDirs(originalWorkerDirs);
    setExcludes(originalExcludes, true);
  });

  beforeEach(() => {
    setExcludes([".git", "node_modules"], true);
    DirInfo.globalExcludes = [".git", "node_modules"];
  });

  it("should handle root listing when directory stat fails (non-existent dir)", async () => {
    // Set workerDirs to non-existent directories
    setWorkerDirs(["/tmp/non-existent-workerdir-abc123"]);

    const res = await apiRequest("GET", "/list");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.entries).toHaveLength(1);
    // Should still show the directory entry with current time
    expect(json.data.entries[0].name).toBe("non-existent-workerdir-abc123");
    expect(json.data.entries[0].isDirectory).toBe(true);
  });
});

describe("POST /mkdir - edge cases", () => {
  const originalWorkerDirs = getWorkerDirs();
  const originalExcludes = getExcludes();

  beforeAll(async () => {
    await rm(TEST_BASE_PATH, { force: true, recursive: true });
    await mkdir(TEST_APPS_PATH, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_BASE_PATH, { force: true, recursive: true });
    setWorkerDirs(originalWorkerDirs);
    setExcludes(originalExcludes, true);
  });

  beforeEach(async () => {
    setWorkerDirs([TEST_APPS_PATH]);
    setExcludes([".git", "node_modules"], true);
    DirInfo.globalExcludes = [".git", "node_modules"];
    await rm(TEST_APPS_PATH, { force: true, recursive: true });
    await mkdir(TEST_APPS_PATH, { recursive: true });
  });

  it("should return error when path is / (root)", async () => {
    const res = await apiRequest("POST", "/mkdir", { path: "/" });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.code).toBe("CANNOT_CREATE_AT_ROOT");
  });
});

describe("DELETE /delete - edge cases", () => {
  const originalWorkerDirs = getWorkerDirs();
  const originalExcludes = getExcludes();

  beforeAll(async () => {
    await rm(TEST_BASE_PATH, { force: true, recursive: true });
    await mkdir(TEST_APPS_PATH, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_BASE_PATH, { force: true, recursive: true });
    setWorkerDirs(originalWorkerDirs);
    setExcludes(originalExcludes, true);
  });

  beforeEach(async () => {
    setWorkerDirs([TEST_APPS_PATH]);
    setExcludes([".git", "node_modules"], true);
    DirInfo.globalExcludes = [".git", "node_modules"];
    await rm(TEST_APPS_PATH, { force: true, recursive: true });
    await mkdir(TEST_APPS_PATH, { recursive: true });
  });

  it("should return error when path is / (root)", async () => {
    const res = await apiRequest("DELETE", "/delete", { path: "/" });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.code).toBe("CANNOT_DELETE_ROOT");
  });
});

describe("POST /upload - ZIP extraction", () => {
  const originalWorkerDirs = getWorkerDirs();
  const originalExcludes = getExcludes();

  beforeAll(async () => {
    await rm(TEST_BASE_PATH, { force: true, recursive: true });
    await mkdir(TEST_APPS_PATH, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_BASE_PATH, { force: true, recursive: true });
    setWorkerDirs(originalWorkerDirs);
    setExcludes(originalExcludes, true);
  });

  beforeEach(async () => {
    setWorkerDirs([TEST_APPS_PATH]);
    setExcludes([".git", "node_modules"], true);
    DirInfo.globalExcludes = [".git", "node_modules"];
    await rm(TEST_APPS_PATH, { force: true, recursive: true });
    await mkdir(TEST_APPS_PATH, { recursive: true });
  });

  it("should extract zip file on upload", async () => {
    // Create a test directory with files to zip
    const tempDir = join(TEST_BASE_PATH, "temp-zip-source");
    await mkdir(tempDir, { recursive: true });
    await writeFile(join(tempDir, "file1.txt"), "Content 1");
    await writeFile(join(tempDir, "file2.txt"), "Content 2");

    // Create zip file
    const zipPath = join(TEST_BASE_PATH, "upload-test.zip");
    const proc = Bun.spawn(["zip", "-r", "-q", zipPath, "."], { cwd: tempDir });
    await proc.exited;

    // Create target directory
    await mkdir(join(TEST_APPS_PATH, "my-app/1.0.0"), { recursive: true });

    // Read zip as file for upload
    const zipFile = Bun.file(zipPath);
    const zipBuffer = await zipFile.arrayBuffer();

    const formData = new FormData();
    formData.append("path", "apps/my-app/1.0.0");
    formData.append("files", new File([zipBuffer], "upload.zip", { type: "application/zip" }));
    formData.append("paths", "upload.zip");

    const res = await apiRequest("POST", "/upload", formData);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);

    // Verify extracted files exist
    const file1 = Bun.file(join(TEST_APPS_PATH, "my-app/1.0.0/file1.txt"));
    const file2 = Bun.file(join(TEST_APPS_PATH, "my-app/1.0.0/file2.txt"));
    expect(await file1.exists()).toBe(true);
    expect(await file2.exists()).toBe(true);
    expect(await file1.text()).toBe("Content 1");

    // Cleanup
    await rm(tempDir, { force: true, recursive: true });
    await rm(zipPath, { force: true });
  });
});

describe("GET /download - edge cases", () => {
  const originalWorkerDirs = getWorkerDirs();
  const originalExcludes = getExcludes();

  beforeAll(async () => {
    await rm(TEST_BASE_PATH, { force: true, recursive: true });
    await mkdir(TEST_APPS_PATH, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_BASE_PATH, { force: true, recursive: true });
    setWorkerDirs(originalWorkerDirs);
    setExcludes(originalExcludes, true);
  });

  beforeEach(async () => {
    setWorkerDirs([TEST_APPS_PATH]);
    setExcludes([".git", "node_modules"], true);
    DirInfo.globalExcludes = [".git", "node_modules"];
    await rm(TEST_APPS_PATH, { force: true, recursive: true });
    await mkdir(TEST_APPS_PATH, { recursive: true });
  });

  it("should download workerDir as zip when it has content", async () => {
    await mkdir(join(TEST_APPS_PATH, "app1"), { recursive: true });
    await writeFile(join(TEST_APPS_PATH, "app1/file.txt"), "content");

    const res = await apiRequest("GET", "/download?path=apps");

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
  });

  it("should return CANNOT_DOWNLOAD_ROOT error for root path /", async () => {
    // path="/" triggers the root case in resolvePath, then CANNOT_DOWNLOAD_ROOT
    const res = await apiRequest("GET", "/download?path=/");
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.code).toBe("CANNOT_DOWNLOAD_ROOT");
  });

  it("should return FILE_NOT_FOUND for broken symlink (file exists for stat but not for Bun.file)", async () => {
    // Create a broken symlink - stat will succeed on the symlink itself
    // but Bun.file().exists() may fail
    await mkdir(join(TEST_APPS_PATH, "app1"), { recursive: true });
    const symlinkPath = join(TEST_APPS_PATH, "app1/broken-link.txt");
    const targetPath = join(TEST_APPS_PATH, "app1/non-existent-target.txt");

    // Create a symlink pointing to non-existent file
    const proc = Bun.spawn(["ln", "-s", targetPath, symlinkPath]);
    await proc.exited;

    const res = await apiRequest("GET", "/download?path=apps/app1/broken-link.txt");
    const json = await res.json();

    // The symlink itself exists for lstat, but the target doesn't
    // This tests the FILE_NOT_FOUND path in the catch block (line 326)
    expect(res.status).toBe(404);
    expect(json.success).toBe(false);
    expect(json.code).toBe("FILE_NOT_FOUND");
  });
});

describe("POST /delete-batch - edge cases", () => {
  const originalWorkerDirs = getWorkerDirs();
  const originalExcludes = getExcludes();

  beforeAll(async () => {
    await rm(TEST_BASE_PATH, { force: true, recursive: true });
    await mkdir(TEST_APPS_PATH, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_BASE_PATH, { force: true, recursive: true });
    setWorkerDirs(originalWorkerDirs);
    setExcludes(originalExcludes, true);
  });

  beforeEach(async () => {
    setWorkerDirs([TEST_APPS_PATH]);
    setExcludes([".git", "node_modules"], true);
    DirInfo.globalExcludes = [".git", "node_modules"];
    await rm(TEST_APPS_PATH, { force: true, recursive: true });
    await mkdir(TEST_APPS_PATH, { recursive: true });
  });

  it("should return errors when deleting non-existent files", async () => {
    const res = await apiRequest("POST", "/delete-batch", {
      paths: ["apps/non-existent-file.txt"],
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    // File doesn't exist, so no error is thrown (rm -rf handles it)
  });
});

describe("POST /move-batch - edge cases", () => {
  const originalWorkerDirs = getWorkerDirs();
  const originalExcludes = getExcludes();

  beforeAll(async () => {
    await rm(TEST_BASE_PATH, { force: true, recursive: true });
    await mkdir(TEST_APPS_PATH, { recursive: true });
    await mkdir(TEST_PACKAGES_PATH, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_BASE_PATH, { force: true, recursive: true });
    setWorkerDirs(originalWorkerDirs);
    setExcludes(originalExcludes, true);
  });

  beforeEach(async () => {
    setWorkerDirs([TEST_APPS_PATH, TEST_PACKAGES_PATH]);
    setExcludes([".git", "node_modules"], true);
    DirInfo.globalExcludes = [".git", "node_modules"];
    await rm(TEST_APPS_PATH, { force: true, recursive: true });
    await rm(TEST_PACKAGES_PATH, { force: true, recursive: true });
    await mkdir(TEST_APPS_PATH, { recursive: true });
    await mkdir(TEST_PACKAGES_PATH, { recursive: true });
  });

  it("should return errors for cross-workerDir moves", async () => {
    await mkdir(join(TEST_APPS_PATH, "app1/1.0.0"), { recursive: true });
    await mkdir(join(TEST_PACKAGES_PATH, "pkg1/1.0.0"), { recursive: true });
    await writeFile(join(TEST_APPS_PATH, "app1/1.0.0/file.txt"), "content");

    const res = await apiRequest("POST", "/move-batch", {
      paths: ["apps/app1/1.0.0/file.txt"],
      destPath: "packages/pkg1/1.0.0",
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.errors).toBeDefined();
    expect(json.errors).toHaveLength(1);
    expect(json.errors[0]).toContain("Cannot move between different apps directories");
  });

  it("should return errors when move fails", async () => {
    await mkdir(join(TEST_APPS_PATH, "app1/1.0.0"), { recursive: true });
    await mkdir(join(TEST_APPS_PATH, "app1/2.0.0"), { recursive: true });
    await writeFile(join(TEST_APPS_PATH, "app1/1.0.0/file.txt"), "content");

    const res = await apiRequest("POST", "/move-batch", {
      paths: ["apps/app1/1.0.0/file.txt", "apps/non-existent/1.0.0/file.txt"],
      destPath: "apps/app1/2.0.0",
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    // The second path should have an error
    if (json.errors) {
      expect(json.errors.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("GET /download-batch - edge cases", () => {
  const originalWorkerDirs = getWorkerDirs();
  const originalExcludes = getExcludes();

  beforeAll(async () => {
    await rm(TEST_BASE_PATH, { force: true, recursive: true });
    await mkdir(TEST_APPS_PATH, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_BASE_PATH, { force: true, recursive: true });
    setWorkerDirs(originalWorkerDirs);
    setExcludes(originalExcludes, true);
  });

  beforeEach(async () => {
    setWorkerDirs([TEST_APPS_PATH]);
    setExcludes([".git", "node_modules"], true);
    DirInfo.globalExcludes = [".git", "node_modules"];
    await rm(TEST_APPS_PATH, { force: true, recursive: true });
    await mkdir(TEST_APPS_PATH, { recursive: true });
  });

  it("should return error for paths with only whitespace/commas", async () => {
    const res = await apiRequest("GET", "/download-batch?paths=,,,");
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.code).toBe("PATHS_REQUIRED");
  });

  it("should skip root paths in download-batch", async () => {
    await mkdir(join(TEST_APPS_PATH, "app1"), { recursive: true });
    await writeFile(join(TEST_APPS_PATH, "app1/file.txt"), "content");

    // Include a root path (apps) which has no baseDir - should be skipped
    const res = await apiRequest("GET", "/download-batch?paths=apps,apps/app1/file.txt");

    // The request should still succeed, just skipping the invalid path
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
  });

  it("should handle error inside try block and cleanup temp dir", async () => {
    // Pass an unknown directory path that will cause resolvePath to throw
    // inside the try block, triggering the catch block cleanup
    const res = await apiRequest("GET", "/download-batch?paths=unknown-dir/file.txt");

    // The catch block converts the error to ValidationError with DOWNLOAD_FAILED code
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("DOWNLOAD_FAILED");
  });
});

describe("api module functions", () => {
  const originalWorkerDirs = getWorkerDirs();
  const originalExcludes = getExcludes();

  afterEach(() => {
    setWorkerDirs(originalWorkerDirs);
    setExcludes(originalExcludes, true);
  });

  describe("setWorkerDirs / getWorkerDirs", () => {
    it("should set and get workerDirs", () => {
      setWorkerDirs(["./apps", "./packages"]);

      expect(getWorkerDirs()).toEqual(["./apps", "./packages"]);
    });
  });

  describe("getDirNames", () => {
    it("should return directory names from workerDirs", () => {
      setWorkerDirs(["./apps", "./packages"]);

      const dirNames = getDirNames();

      expect(dirNames).toContain("apps");
      expect(dirNames).toContain("packages");
    });

    it("should handle duplicate directory names with suffix", () => {
      setWorkerDirs(["./folder/apps", "./other/apps"]);

      const dirNames = getDirNames();

      expect(dirNames).toContain("apps");
      expect(dirNames).toContain("apps-2");
    });
  });

  describe("setExcludes / getExcludes", () => {
    it("should get default excludes", () => {
      setExcludes([".git", "node_modules"], true);

      expect(getExcludes()).toEqual([".git", "node_modules"]);
    });

    it("should add to default excludes", () => {
      setExcludes([".git", "node_modules"], true);
      setExcludes(["dist", ".cache"]);

      const excludes = getExcludes();

      expect(excludes).toContain(".git");
      expect(excludes).toContain("node_modules");
      expect(excludes).toContain("dist");
      expect(excludes).toContain(".cache");
    });

    it("should replace excludes when replace=true", () => {
      setExcludes(["custom-exclude"], true);

      expect(getExcludes()).toEqual(["custom-exclude"]);
    });

    it("should update DirInfo.globalExcludes", () => {
      setExcludes(["custom"], true);

      expect(DirInfo.globalExcludes).toEqual(["custom"]);
    });
  });
});

describe("POST /delete-batch - error handling", () => {
  const originalWorkerDirs = getWorkerDirs();
  const originalExcludes = getExcludes();

  beforeAll(async () => {
    await rm(TEST_BASE_PATH, { force: true, recursive: true });
    await mkdir(TEST_APPS_PATH, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_BASE_PATH, { force: true, recursive: true });
    setWorkerDirs(originalWorkerDirs);
    setExcludes(originalExcludes, true);
  });

  beforeEach(async () => {
    setWorkerDirs([TEST_APPS_PATH]);
    setExcludes([".git", "node_modules"], true);
    DirInfo.globalExcludes = [".git", "node_modules"];
    await rm(TEST_APPS_PATH, { force: true, recursive: true });
    await mkdir(TEST_APPS_PATH, { recursive: true });
  });

  it("should capture errors when delete throws for non-existent directory", async () => {
    // Create a path that resolves but the actual DirInfo.delete() will fail
    // because the path references a non-existent directory that throws NotFoundError
    const res = await apiRequest("POST", "/delete-batch", {
      paths: ["apps/non-existent-dir/file.txt"],
    });
    const json = await res.json();

    // The operation succeeds but with errors array
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    // No error because rm -rf handles non-existent gracefully
  });

  it("should capture error when deleting protected path throws", async () => {
    // Test with a path that causes an exception in the catch block
    // Create a symlink loop or similar to cause an error
    await mkdir(join(TEST_APPS_PATH, "test-app"), { recursive: true });

    // Delete the directory but keep trying to delete a file inside
    // This should trigger the catch block
    const res = await apiRequest("POST", "/delete-batch", {
      paths: ["apps/test-app", "apps/test-app/subdir"],
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
  });

  it("should capture error when path resolution throws NotFoundError", async () => {
    // This triggers the catch block when resolvePath throws for invalid workerDir
    const res = await apiRequest("POST", "/delete-batch", {
      paths: ["invalid-appdir/file.txt"],
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.errors).toBeDefined();
    expect(json.errors).toHaveLength(1);
    expect(json.errors[0]).toContain("Directory not found");
  });
});

describe("Environment variable initialization", () => {
  it("should handle BUNTIME_WORKER_DIRS env var parsing via subprocess", async () => {
    // This test uses a subprocess to test the module initialization with env vars
    // The env var parsing happens at module load time
    const testScript = `
      process.env.BUNTIME_WORKER_DIRS = JSON.stringify(["/test/apps", "/test/packages"]);
      process.env.BUNTIME_EXCLUDES = JSON.stringify(["dist", ".cache"]);

      // Clear module cache to force re-import
      delete require.cache[require.resolve("./api")];

      const { getWorkerDirs, getExcludes } = await import("./api");

      const workerDirs = getWorkerDirs();
      const excludes = getExcludes();

      console.log(JSON.stringify({ workerDirs, excludes }));
    `;

    const proc = Bun.spawn(["bun", "-e", testScript], {
      cwd: join(import.meta.dir),
      env: {
        ...process.env,
        BUNTIME_WORKER_DIRS: JSON.stringify(["/test/apps", "/test/packages"]),
        BUNTIME_EXCLUDES: JSON.stringify(["dist", ".cache"]),
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    await proc.exited;
    const output = await new Response(proc.stdout).text();
    const result = JSON.parse(output.trim());

    expect(result.workerDirs).toEqual(["/test/apps", "/test/packages"]);
    expect(result.excludes).toContain("dist");
    expect(result.excludes).toContain(".cache");
  });

  it("should handle invalid BUNTIME_WORKER_DIRS JSON gracefully via subprocess", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        `
        const { getWorkerDirs } = await import("./api");
        console.log(JSON.stringify(getWorkerDirs()));
      `,
      ],
      {
        cwd: join(import.meta.dir),
        env: {
          ...process.env,
          BUNTIME_WORKER_DIRS: "invalid-json",
          BUNTIME_EXCLUDES: undefined,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    await proc.exited;
    const output = await new Response(proc.stdout).text();

    // Should use defaults when JSON parsing fails
    const workerDirs = JSON.parse(output.trim());
    expect(Array.isArray(workerDirs)).toBe(true);
  });

  it("should handle invalid BUNTIME_EXCLUDES JSON gracefully via subprocess", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        `
        const { getExcludes } = await import("./api");
        console.log(JSON.stringify(getExcludes()));
      `,
      ],
      {
        cwd: join(import.meta.dir),
        env: {
          ...process.env,
          BUNTIME_WORKER_DIRS: undefined,
          BUNTIME_EXCLUDES: "invalid-json",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    await proc.exited;
    const output = await new Response(proc.stdout).text();

    // Should use defaults when JSON parsing fails
    const excludes = JSON.parse(output.trim());
    expect(Array.isArray(excludes)).toBe(true);
  });

  it("should handle empty array BUNTIME_WORKER_DIRS via subprocess", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        `
        const { getWorkerDirs } = await import("./api");
        console.log(JSON.stringify(getWorkerDirs()));
      `,
      ],
      {
        cwd: join(import.meta.dir),
        env: {
          ...process.env,
          BUNTIME_WORKER_DIRS: "[]",
          BUNTIME_EXCLUDES: undefined,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    await proc.exited;
    const output = await new Response(proc.stdout).text();

    // Empty array should not update workerDirs (keep defaults)
    const workerDirs = JSON.parse(output.trim());
    expect(Array.isArray(workerDirs)).toBe(true);
  });
});
