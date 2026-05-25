/**
 * Archive packager for plugin/app uploads
 *
 * Handles extraction and validation of .tgz and .zip packages uploaded via Core API.
 */

import { existsSync } from "node:fs";
import { cp, rename as fsRename, mkdir, readdir, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";

/**
 * Package info extracted from manifest.yaml or package.json.
 */
export interface PackageInfo {
  name: string;
  version: string;
}

export type InstallSource = "built-in" | "uploaded";

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
 * Read package metadata from extracted package.
 *
 * manifest.yaml is preferred, with package.json as a fallback. Version
 * defaults to "latest" to support simple folder deploys from the TUI.
 *
 * @param packagePath - Path to the extracted package directory
 * @returns Package info with name and version
 */
export async function readPackageInfo(packagePath: string): Promise<PackageInfo> {
  let name: string | undefined;
  let version: string | undefined;

  // Try manifest.yaml first, then manifest.yml
  for (const filename of ["manifest.yaml", "manifest.yml"]) {
    const manifestPath = join(packagePath, filename);
    const manifestFile = Bun.file(manifestPath);

    if (await manifestFile.exists()) {
      const content = await manifestFile.text();
      const manifest = Bun.YAML.parse(content) as {
        name?: string;
        version?: string;
      };

      name = manifest.name;
      version = manifest.version;
      break;
    }
  }

  const packageJson = Bun.file(join(packagePath, "package.json"));
  if (await packageJson.exists()) {
    const pkg = (await packageJson.json()) as {
      name?: string;
      version?: string;
    };
    name ??= pkg.name;
    version ??= pkg.version;
  }

  if (!name) {
    throw new Error("Package name not found: set manifest.yaml name or package.json name");
  }

  return {
    name,
    version: version ?? "latest",
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
 * Get the package root path without a version segment.
 *
 * Plugins are loaded from pluginDirs/{name}; the runtime loader does not scan
 * plugin version subdirectories.
 */
export function getPackageRootPath(baseDir: string, packageInfo: PackageInfo): string {
  const { name, scope } = parsePackageName(packageInfo.name);

  if (scope) {
    return join(baseDir, scope, name);
  }

  return join(baseDir, name);
}

function isHiddenInstallDir(dir: string): boolean {
  return basename(resolve(dir)).startsWith(".");
}

function findProjectRoot(startDir: string): string {
  let current = resolve(startDir);

  while (true) {
    if (
      existsSync(join(current, "package.json")) &&
      existsSync(join(current, "apps")) &&
      existsSync(join(current, "plugins"))
    ) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) return resolve(startDir);
    current = parent;
  }
}

function isInsideDir(dir: string, parentDir: string): boolean {
  const resolvedDir = resolve(dir);
  const resolvedParent = resolve(parentDir);

  return resolvedDir === resolvedParent || resolvedDir.startsWith(`${resolvedParent}${sep}`);
}

function isProjectInstallDir(dir: string): boolean {
  return isInsideDir(dir, findProjectRoot(process.cwd()));
}

function selectUploadInstallDir(dirs: string[]): string | undefined {
  return dirs.find((dir) => getInstallSource(dir, dirs) === "uploaded");
}

export function getInstallSource(dir: string, dirs: string[]): InstallSource {
  if (isHiddenInstallDir(dir) || isProjectInstallDir(dir)) return "built-in";
  return dirs.map((candidate) => resolve(candidate)).includes(resolve(dir))
    ? "uploaded"
    : "built-in";
}

export function isRemovableInstallDir(dir: string, dirs: string[]): boolean {
  return getInstallSource(dir, dirs) === "uploaded";
}

/**
 * Select the external upload directory from configured dirs.
 *
 * Hidden dirs such as /data/.apps and /data/.plugins are image-provided
 * built-ins in the Helm chart. Local project dirs are also built-in. Runtime
 * uploads must go into the first configured dir outside both categories.
 */
export function selectInstallDir(dirs: string[]): string | undefined {
  return selectUploadInstallDir(dirs);
}

/**
 * Move an extracted package into its final installation path.
 *
 * PVCs can live on a different filesystem from /tmp, where upload extraction
 * happens. In that case rename fails with EXDEV, so fall back to recursive copy.
 */
export async function moveDirectory(sourcePath: string, targetPath: string): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true });

  try {
    await fsRename(sourcePath, targetPath);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
    if (code !== "EXDEV") throw error;

    await cp(sourcePath, targetPath, { recursive: true });
    await rm(sourcePath, { force: true, recursive: true });
  }
}

/**
 * Validate that a path is safe (no path traversal)
 */
export function isPathSafe(basePath: string, targetPath: string): boolean {
  const resolvedBase = resolve(basePath);
  const resolvedTarget = resolve(targetPath);
  return resolvedTarget === resolvedBase || resolvedTarget.startsWith(`${resolvedBase}${sep}`);
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
