import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveArchive } from "./pack.ts";

async function tarListing(archivePath: string): Promise<string> {
  const proc = Bun.spawn(["tar", "-tzf", archivePath], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out;
}

describe("resolveArchive", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pack-test-"));
    await writeFile(join(dir, "manifest.yaml"), "entrypoint: dist/index.js\n");
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }));
    await mkdir(join(dir, "dist"), { recursive: true });
    await writeFile(join(dir, "dist", "index.js"), "export default {};");
    await writeFile(join(dir, "index.ts"), "export default {};");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("packs a directory into a package/-wrapped tarball (npm-pack convention)", async () => {
    const { archivePath, cleanup } = await resolveArchive(dir);
    const listing = await tarListing(archivePath);
    expect(listing).toContain("package/manifest.yaml");
    expect(listing).toContain("package/package.json");
    expect(listing).toContain("package/index.ts");
    expect(listing).toContain("package/dist/index.js");
    await cleanup?.();
  });

  it("passes an existing archive through unchanged", async () => {
    const tgz = join(dir, "prebuilt.tgz");
    await Bun.spawn(["tar", "-czf", tgz, "-C", dir, "manifest.yaml"]).exited;
    const { archivePath, cleanup } = await resolveArchive(tgz);
    expect(archivePath).toBe(tgz);
    expect(cleanup).toBeUndefined();
  });

  it("rejects a directory without manifest.yaml or package.json", async () => {
    const empty = await mkdtemp(join(tmpdir(), "pack-empty-"));
    await expect(resolveArchive(empty)).rejects.toThrow(/manifest\.yaml or package\.json/);
    await rm(empty, { recursive: true, force: true });
  });

  it("rejects a non-archive file", async () => {
    const file = join(dir, "notes.txt");
    await writeFile(file, "hi");
    await expect(resolveArchive(file)).rejects.toThrow(/\.tgz/);
  });
});
