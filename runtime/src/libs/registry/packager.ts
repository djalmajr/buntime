/**
 * Archive packager for plugin/app uploads
 *
 * Handles extraction and validation of .tgz and .zip packages uploaded via Core API.
 */

import { rename as fsRename, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Package info extracted from manifest.json
 */
export interface PackageInfo {
  name: string;
  version: string;
}

/**
 * Supported archive formats
 */
export type ArchiveFormat = "tgz" | "zip";

/**
 * Detect archive format from filename
 */
export function detectArchiveFormat(filename: string): ArchiveFormat | null {
  if (filename.endsWith(".tgz") || filename.endsWith(".tar.gz")) {
    return "tgz";
  }
  if (filename.endsWith(".zip")) {
    return "zip";
  }
  return null;
}

/**
 * Extract an archive (.tgz or .zip) to a destination directory
 *
 * @param archive - The archive blob to extract
 * @param destPath - Destination directory path
 * @param format - Archive format
 */
export async function extractArchive(
  archive: Blob,
  destPath: string,
  format: ArchiveFormat,
): Promise<void> {
  if (format === "tgz") {
    await extractTarball(archive, destPath);
  } else {
    await extractZip(archive, destPath);
  }
}

/**
 * Extract a tarball (.tgz) to a destination directory
 */
async function extractTarball(tarball: Blob, destPath: string): Promise<void> {
  await mkdir(destPath, { recursive: true });

  const tempFile = join(destPath, ".temp-upload.tgz");
  await Bun.write(tempFile, tarball);

  try {
    // Extract using tar (--strip-components=1 to remove "package/" prefix from npm pack)
    const proc = Bun.spawn(["tar", "-xzf", tempFile, "--strip-components=1", "-C", destPath], {
      stderr: "pipe",
      stdout: "pipe",
    });

    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`Failed to extract tarball: ${stderr}`);
    }
  } finally {
    try {
      await Bun.file(tempFile).unlink();
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Extract a zip file to a destination directory
 */
async function extractZip(zipFile: Blob, destPath: string): Promise<void> {
  await mkdir(destPath, { recursive: true });

  const tempFile = join(destPath, ".temp-upload.zip");
  await Bun.write(tempFile, zipFile);

  try {
    // Extract using unzip
    const proc = Bun.spawn(["unzip", "-o", "-q", tempFile, "-d", destPath], {
      stderr: "pipe",
      stdout: "pipe",
    });

    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`Failed to extract zip: ${stderr}`);
    }

    // Handle "package/" prefix (npm pack convention) - move contents up if exists
    const packageDir = join(destPath, "package");
    if (await directoryExists(packageDir)) {
      const entries = await readdir(packageDir);
      for (const entry of entries) {
        await fsRename(join(packageDir, entry), join(destPath, entry));
      }
      await rm(packageDir, { recursive: true });
    }
  } finally {
    try {
      await Bun.file(tempFile).unlink();
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Read and validate manifest.json from extracted package
 *
 * Requires name and version fields in manifest.json.
 * The location (pluginDirs vs workerDirs) determines if it's a plugin or app.
 *
 * @param packagePath - Path to the extracted package directory
 * @returns Package info with name and version
 */
export async function readPackageInfo(packagePath: string): Promise<PackageInfo> {
  const manifestPath = join(packagePath, "manifest.json");
  const manifestFile = Bun.file(manifestPath);

  if (!(await manifestFile.exists())) {
    throw new Error("manifest.json not found in uploaded package");
  }

  const manifest = (await manifestFile.json()) as {
    name?: string;
    version?: string;
  };

  if (!manifest.name) {
    throw new Error("manifest.json is missing 'name' field");
  }

  if (!manifest.version) {
    throw new Error("manifest.json is missing 'version' field");
  }

  return {
    name: manifest.name,
    version: manifest.version,
  };
}

/**
 * Parse package name into scope and name parts
 *
 * @example parsePackageName("@buntime/plugin-auth") => { scope: "@buntime", name: "plugin-auth" }
 * @example parsePackageName("my-app") => { scope: null, name: "my-app" }
 */
export function parsePackageName(fullName: string): { name: string; scope: string | null } {
  if (fullName.startsWith("@")) {
    const [scope, name] = fullName.split("/");
    return { name: name ?? fullName, scope: scope ?? null };
  }
  return { name: fullName, scope: null };
}

/**
 * Get the installation path for a package
 *
 * @param baseDir - Base directory (pluginDir or appDir)
 * @param packageInfo - Package info with name and version
 * @returns Full path where the package should be installed
 */
export function getInstallPath(baseDir: string, packageInfo: PackageInfo): string {
  const { name, scope } = parsePackageName(packageInfo.name);

  if (scope) {
    // Scoped package: baseDir/@scope/name/version
    return join(baseDir, scope, name, packageInfo.version);
  }

  // Unscoped package: baseDir/name/version
  return join(baseDir, name, packageInfo.version);
}

/**
 * Validate that a path is safe (no path traversal)
 */
export function isPathSafe(basePath: string, targetPath: string): boolean {
  const resolvedBase = resolve(basePath);
  const resolvedTarget = resolve(targetPath);
  return resolvedTarget.startsWith(resolvedBase);
}

/**
 * Check if a directory exists
 */
export async function directoryExists(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Remove a directory recursively
 */
export async function removeDirectory(path: string): Promise<void> {
  await rm(path, { force: true, recursive: true });
}

/**
 * Create a temporary directory for extraction
 */
export async function createTempDir(): Promise<string> {
  const tempDir = `/tmp/buntime-upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await mkdir(tempDir, { recursive: true });
  return tempDir;
}
