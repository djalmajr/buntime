import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getPackageRootPath,
  isPathSafe,
  moveDirectory,
  readPackageInfo,
  selectInstallDir,
} from "./packager";

let testDirs: string[] = [];

async function createTestDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "buntime-packager-"));
  testDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(testDirs.map((dir) => rm(dir, { force: true, recursive: true })));
  testDirs = [];
});

describe("packager", () => {
  describe("readPackageInfo", () => {
    it("should read name and version from manifest.yaml", async () => {
      const dir = await createTestDir();
      await writeFile(join(dir, "manifest.yaml"), 'name: "my-plugin"\nversion: "1.2.3"\n');

      const info = await readPackageInfo(dir);

      expect(info).toEqual({ name: "my-plugin", version: "1.2.3" });
    });

    it("should fall back to package.json fields", async () => {
      const dir = await createTestDir();
      await writeFile(join(dir, "package.json"), '{"name":"my-app","version":"2.0.0"}');

      const info = await readPackageInfo(dir);

      expect(info).toEqual({ name: "my-app", version: "2.0.0" });
    });

    it("should default version to latest for simple folder uploads", async () => {
      const dir = await createTestDir();
      await writeFile(join(dir, "manifest.yaml"), 'name: "folder-app"\n');

      const info = await readPackageInfo(dir);

      expect(info).toEqual({ name: "folder-app", version: "latest" });
    });
  });

  describe("paths", () => {
    it("should prefer external install dirs over hidden built-in dirs", () => {
      expect(selectInstallDir(["/data/.apps", "/data/apps"])).toBe("/data/apps");
      expect(selectInstallDir(["/data/.plugins", "/data/plugins"])).toBe("/data/plugins");
    });

    it("should build plugin root paths without version segments", () => {
      expect(getPackageRootPath("/data/plugins", { name: "plugin-one", version: "1.0.0" })).toBe(
        "/data/plugins/plugin-one",
      );
      expect(
        getPackageRootPath("/data/plugins", { name: "@scope/plugin-one", version: "1.0.0" }),
      ).toBe("/data/plugins/@scope/plugin-one");
    });

    it("should reject sibling paths that only share a prefix", () => {
      expect(isPathSafe("/data/apps", "/data/apps/my-app")).toBe(true);
      expect(isPathSafe("/data/apps", "/data/apps2/my-app")).toBe(false);
      expect(isPathSafe("/data/apps", "/data/apps/../plugins/my-plugin")).toBe(false);
    });

    it("should create parent directories when moving packages into place", async () => {
      const dir = await createTestDir();
      const source = join(dir, "source");
      const target = join(dir, "apps", "my-app", "1.0.0");
      await mkdir(source, { recursive: true });
      await writeFile(join(source, "index.ts"), "export default {};");

      await moveDirectory(source, target);

      expect(await Bun.file(join(target, "index.ts")).text()).toBe("export default {};");
      expect(await Bun.file(join(source, "index.ts")).exists()).toBe(false);
    });
  });
});
