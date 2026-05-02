import { afterAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateUploadFile } from "./upload-validation";

const TEST_DIR = await mkdtemp(join(tmpdir(), "buntime-upload-validation-"));
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_EOCD_SIGNATURE = 0x06054b50;

async function createArchive(sourceDir: string, archiveName: string): Promise<File> {
  const archivePath = join(TEST_DIR, archiveName);
  const proc = Bun.spawn(["zip", "-r", "-q", archivePath, "."], {
    cwd: sourceDir,
    stderr: "pipe",
    stdout: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(await new Response(proc.stderr).text());
  }

  const buffer = await Bun.file(archivePath).arrayBuffer();
  return new File([buffer], archiveName, { type: "application/zip" });
}

async function createWrappedArchive(sourceDir: string, folderName: string): Promise<File> {
  const archivePath = join(TEST_DIR, `${folderName}.zip`);
  const proc = Bun.spawn(["zip", "-r", "-q", archivePath, folderName], {
    cwd: sourceDir,
    stderr: "pipe",
    stdout: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(await new Response(proc.stderr).text());
  }

  const buffer = await Bun.file(archivePath).arrayBuffer();
  return new File([buffer], `${folderName}.zip`, { type: "application/zip" });
}

function createZipWithEntries(entryNames: string[], archiveName: string): File {
  const encoder = new TextEncoder();
  const records: Array<Uint8Array<ArrayBuffer>> = [];

  for (const entryName of entryNames) {
    const name = encoder.encode(entryName);
    const record = new Uint8Array(46 + name.length);
    const view = new DataView(record.buffer);
    view.setUint32(0, ZIP_CENTRAL_DIRECTORY_SIGNATURE, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(28, name.length, true);
    record.set(name, 46);
    records.push(record);
  }

  const centralDirectorySize = records.reduce((sum, record) => sum + record.byteLength, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, ZIP_EOCD_SIGNATURE, true);
  eocdView.setUint16(8, entryNames.length, true);
  eocdView.setUint16(10, entryNames.length, true);
  eocdView.setUint32(12, centralDirectorySize, true);
  eocdView.setUint32(16, 0, true);

  const archive = new Uint8Array(centralDirectorySize + eocd.byteLength);
  let offset = 0;
  for (const record of records) {
    archive.set(record, offset);
    offset += record.byteLength;
  }
  archive.set(eocd, offset);

  const buffer = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength);
  return new File([buffer], archiveName, { type: "application/zip" });
}

describe("validateUploadFile", () => {
  afterAll(async () => {
    await rm(TEST_DIR, { force: true, recursive: true });
  });

  it("accepts a valid plugin zip", async () => {
    const sourceDir = join(TEST_DIR, "plugin-valid");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, "manifest.yaml"),
      'name: "@buntime/plugin-test"\nversion: "0.1.0"\nbase: "/test"\npluginEntry: plugin.js\n',
    );
    await writeFile(
      join(sourceDir, "plugin.js"),
      "export default function plugin() { return {}; }\n",
    );

    const result = await validateUploadFile(
      await createArchive(sourceDir, "plugin-valid.zip"),
      "plugin",
    );

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.entries).toContain("manifest.yaml");
    expect(result.entries).toContain("plugin.js");
  });

  it("accepts a valid app zip", async () => {
    const sourceDir = join(TEST_DIR, "app-valid");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "manifest.yaml"), 'name: "app-test"\nversion: "0.1.0"\n');
    await writeFile(join(sourceDir, "index.html"), "<!doctype html><html></html>\n");

    const result = await validateUploadFile(await createArchive(sourceDir, "app-valid.zip"), "app");

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.entries).toContain("manifest.yaml");
    expect(result.entries).toContain("index.html");
  });

  it("rejects a wrapped zip that the runtime would not unwrap", async () => {
    const parentDir = join(TEST_DIR, "wrapped-parent");
    const sourceDir = join(parentDir, "wrapped-plugin");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, "manifest.yaml"),
      'name: "@buntime/plugin-wrapped"\nversion: "0.1.0"\nbase: "/wrapped"\n',
    );
    await writeFile(
      join(sourceDir, "plugin.js"),
      "export default function plugin() { return {}; }\n",
    );

    const result = await validateUploadFile(
      await createWrappedArchive(parentDir, "wrapped-plugin"),
      "plugin",
    );

    expect(result.ok).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toContain("wrappedFolder");
  });

  it("rejects unsupported archive types", async () => {
    const file = new File(["hello"], "plugin.txt", { type: "text/plain" });

    const result = await validateUploadFile(file, "plugin");

    expect(result.ok).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toContain("unsupportedType");
  });

  it("rejects an empty file", async () => {
    const file = new File([], "plugin.zip", { type: "application/zip" });

    const result = await validateUploadFile(file, "plugin");

    expect(result.ok).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toContain("emptyFile");
  });

  it("rejects an unreadable zip", async () => {
    const file = new File(["not a zip"], "plugin.zip", { type: "application/zip" });

    const result = await validateUploadFile(file, "plugin");

    expect(result.ok).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toContain("zipUnreadable");
  });

  it("rejects app archives without an entrypoint", async () => {
    const sourceDir = join(TEST_DIR, "app-missing-entrypoint");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "manifest.yaml"), 'name: "app-test"\nversion: "0.1.0"\n');

    const result = await validateUploadFile(
      await createArchive(sourceDir, "app-missing-entrypoint.zip"),
      "app",
    );

    expect(result.ok).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toContain("missingAppEntrypoint");
  });

  it("rejects plugin archives without metadata", async () => {
    const sourceDir = join(TEST_DIR, "plugin-missing-metadata");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, "plugin.js"),
      "export default function plugin() { return {}; }\n",
    );

    const result = await validateUploadFile(
      await createArchive(sourceDir, "plugin-missing-metadata.zip"),
      "plugin",
    );

    expect(result.ok).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toContain("missingMetadata");
  });

  it("rejects archives with path traversal entries", async () => {
    const result = await validateUploadFile(
      createZipWithEntries(["../manifest.yaml", "plugin.js"], "plugin-traversal.zip"),
      "plugin",
    );

    expect(result.ok).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toContain("pathTraversal");
  });

  it("warns when tgz structure validation is deferred to the runtime", async () => {
    const file = new File(["placeholder"], "plugin.tgz", { type: "application/gzip" });

    const result = await validateUploadFile(file, "plugin");

    expect(result.ok).toBe(true);
    expect(result.warnings.map((issue) => issue.code)).toContain("structureDeferred");
  });
});
