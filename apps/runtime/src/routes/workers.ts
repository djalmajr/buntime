/**
 * Workers API Routes (/api/workers)
 *
 * Provides worker management endpoints for:
 * - Listing installed workers
 * - Uploading new workers (tarball or zip)
 * - Removing workers
 *
 * A "worker" here is a deployed serverless artifact that the WorkerPool can
 * execute. The runtime treats workers and apps as the same concept — these
 * routes manage them on the filesystem (workerDirs).
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { ForbiddenError, NotFoundError, ValidationError } from "@buntime/shared/errors";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { getConfig } from "@/config";
import { namespaceOf, principalCanAccessNamespace } from "@/libs/api-keys";
import { SuccessResponse, WorkerInfoSchema } from "@/libs/openapi";
import { clearWorkerConfigCache } from "@/libs/pool/config";
import { setManifestEnabled } from "@/libs/registry/manifest-enabled";
import {
  createTempDir,
  detectArchiveFormat,
  directoryExists,
  extractArchive,
  getInstallPath,
  getInstallSource,
  type InstallSource,
  isPathSafe,
  isRemovableInstallDir,
  moveDirectory,
  type PackageInfo,
  readPackageInfo,
  removeDirectory,
  selectInstallDir,
} from "@/libs/registry/packager";
import { readUploadFile } from "@/routes/upload-form";

/**
 * Worker info for API responses
 */
interface WorkerInfo {
  /** Versions whose manifest sets `enabled: false` (subset of `versions`). */
  disabledVersions: string[];
  name: string;
  path: string;
  removable: boolean;
  source: InstallSource;
  versions: string[];
}

/**
 * Read the `enabled` flag from a version dir's manifest (default true). Used to
 * surface per-version enabled state in the workers list for the cpanel toggle.
 */
async function isVersionDisabled(versionPath: string): Promise<boolean> {
  for (const filename of ["manifest.yaml", "manifest.yml"]) {
    const file = Bun.file(join(versionPath, filename));
    if (!(await file.exists())) continue;
    const parsed = Bun.YAML.parse(await file.text()) as { enabled?: boolean } | null;
    return parsed?.enabled === false;
  }
  return false;
}

async function collectDisabledVersions(versionPaths: Map<string, string>): Promise<string[]> {
  const disabled: string[] = [];
  for (const [version, path] of versionPaths) {
    if (await isVersionDisabled(path)) disabled.push(version);
  }
  return disabled;
}

interface InstalledWorkerPackage extends WorkerInfo {
  directoryName: string;
  versionPaths: Map<string, string>;
}

interface InstalledWorkerVersion extends PackageInfo {
  path: string;
}

async function readPackageInfoOrNull(packagePath: string): Promise<PackageInfo | null> {
  try {
    return await readPackageInfo(packagePath);
  } catch {
    return null;
  }
}

async function readInstalledWorker(
  workerDir: string,
  workerDirs: string[],
  packagePath: string,
  directoryName: string,
): Promise<InstalledWorkerPackage | null> {
  const packageInfo = await readPackageInfoOrNull(packagePath);

  if (packageInfo) {
    const versionPaths = new Map([[packageInfo.version, packagePath]]);
    return {
      directoryName,
      disabledVersions: await collectDisabledVersions(versionPaths),
      name: packageInfo.name,
      path: packagePath,
      removable: isRemovableInstallDir(workerDir, workerDirs),
      source: getInstallSource(workerDir, workerDirs),
      versionPaths,
      versions: [packageInfo.version],
    };
  }

  const versionInfos = await getVersionInfos(packagePath);
  if (versionInfos.length === 0) return null;

  const firstVersion = versionInfos[0];
  if (!firstVersion) return null;

  const versions = versionInfos.filter((versionInfo) => versionInfo.name === firstVersion.name);
  const versionPaths = new Map(versions.map((v) => [v.version, v.path]));

  return {
    directoryName,
    disabledVersions: await collectDisabledVersions(versionPaths),
    name: firstVersion.name,
    path: packagePath,
    removable: isRemovableInstallDir(workerDir, workerDirs),
    source: getInstallSource(workerDir, workerDirs),
    versionPaths,
    versions: versions.map((versionInfo) => versionInfo.version),
  };
}

/**
 * List all installed workers from workerDirs
 */
async function discoverInstalledWorkers(workerDirs: string[]): Promise<InstalledWorkerPackage[]> {
  const workers: InstalledWorkerPackage[] = [];

  for (const workerDir of workerDirs) {
    if (!(await directoryExists(workerDir))) continue;

    const entries = await readdir(workerDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const name = entry.name;
      const fullPath = join(workerDir, name);

      if (name.startsWith("@")) {
        // Scoped package: @scope/name/version
        const scopeDir = fullPath;
        const scopeEntries = await readdir(scopeDir, { withFileTypes: true });

        for (const scopeEntry of scopeEntries) {
          if (!scopeEntry.isDirectory()) continue;

          const packagePath = join(scopeDir, scopeEntry.name);
          const directoryName = `${name}/${scopeEntry.name}`;
          const worker = await readInstalledWorker(
            workerDir,
            workerDirs,
            packagePath,
            directoryName,
          );

          if (worker) workers.push(worker);
        }
      } else {
        const worker = await readInstalledWorker(workerDir, workerDirs, fullPath, name);

        if (worker) workers.push(worker);
      }
    }
  }

  return workers;
}

async function listInstalledWorkers(workerDirs: string[]): Promise<WorkerInfo[]> {
  return (await discoverInstalledWorkers(workerDirs)).map((worker) => ({
    disabledVersions: worker.disabledVersions,
    name: worker.name,
    path: worker.path,
    removable: worker.removable,
    source: worker.source,
    versions: worker.versions,
  }));
}

/**
 * Get package metadata from version directories under a package path.
 */
async function getVersionInfos(packagePath: string): Promise<InstalledWorkerVersion[]> {
  try {
    const entries = await readdir(packagePath, { withFileTypes: true });
    const versions: InstalledWorkerVersion[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

      const versionPath = join(packagePath, entry.name);
      const packageInfo = await readPackageInfoOrNull(versionPath);
      if (!packageInfo) continue;

      versions.push({ ...packageInfo, path: versionPath });
    }

    return versions.sort((left, right) =>
      right.version.localeCompare(left.version, undefined, { numeric: true }),
    );
  } catch {
    return [];
  }
}

interface WorkersRoutesDeps {
  workerDirs?: string[];
}

function getWorkerDirs(deps: WorkersRoutesDeps): string[] {
  return deps.workerDirs ?? getConfig().workerDirs;
}

/**
 * Create workers core routes
 */
export function createWorkersRoutes(deps: WorkersRoutesDeps = {}) {
  return (
    new Hono()
      .get(
        "/",
        describeRoute({
          tags: ["Workers"],
          summary: "List installed workers",
          description: "Returns all workers installed in workerDirs",
          responses: {
            200: {
              description: "List of installed workers",
              content: {
                "application/json": {
                  schema: { type: "array", items: WorkerInfoSchema },
                },
              },
            },
          },
        }),
        async (ctx) => {
          const workers = await listInstalledWorkers(getWorkerDirs(deps));
          const principal = ctx.get("principal");
          const visible =
            principal && !principal.isRoot
              ? workers.filter((w) => principalCanAccessNamespace(principal, namespaceOf(w.name)))
              : workers;
          return ctx.json(visible);
        },
      )
      .post(
        "/upload",
        describeRoute({
          tags: ["Workers"],
          summary: "Upload worker",
          description: "Upload a new worker (tarball or zip)",
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    file: {
                      type: "string",
                      format: "binary",
                      description: "Worker archive (.tgz, .tar.gz, or .zip)",
                    },
                  },
                  required: ["file"],
                },
              },
            },
          },
          responses: {
            200: {
              description: "Worker uploaded successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      data: {
                        type: "object",
                        properties: {
                          worker: {
                            type: "object",
                            properties: {
                              name: { type: "string" },
                              version: { type: "string" },
                              installedAt: { type: "string" },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        }),
        async (ctx) => {
          const workerDirs = getWorkerDirs(deps);

          if (workerDirs.length === 0) {
            throw new ValidationError("No workerDirs configured", "NO_WORKER_DIRS");
          }

          const file = await readUploadFile(ctx);

          // Detect archive format
          const format = detectArchiveFormat(file.name);
          if (!format) {
            throw new ValidationError("File must be .tgz, .tar.gz, or .zip", "INVALID_FILE_TYPE");
          }

          // Extract to temp directory
          const tempDir = await createTempDir();

          try {
            await extractArchive(file, tempDir, format);

            // Read package info (only name and version)
            const packageInfo = await readPackageInfo(tempDir);

            // Namespace gate: a restricted key may only deploy into its own
            // namespace(s). The archive's package name carries the `@scope`.
            const principal = ctx.get("principal");
            if (
              principal &&
              !principal.isRoot &&
              !principalCanAccessNamespace(principal, namespaceOf(packageInfo.name))
            ) {
              const ns = namespaceOf(packageInfo.name);
              throw new ForbiddenError(
                ns ? `Access denied for namespace: ${ns}` : "Access denied for unscoped resources",
                "NAMESPACE_DENIED",
              );
            }

            // Use the first external/writable workerDir as installation target.
            // In Helm this avoids writing uploads into image-provided /data/.apps.
            const targetDir = selectInstallDir(workerDirs);
            if (!targetDir) {
              throw new ValidationError("No workerDirs configured", "NO_WORKER_DIRS");
            }
            const installPath = getInstallPath(targetDir, packageInfo);

            // Validate path is safe
            if (!isPathSafe(targetDir, installPath)) {
              throw new ValidationError("Invalid package name (path traversal)", "PATH_TRAVERSAL");
            }

            // Remove existing version if exists
            if (await directoryExists(installPath)) {
              await removeDirectory(installPath);
            }

            // Move from temp to install path
            await moveDirectory(tempDir, installPath);

            return ctx.json({
              data: {
                worker: {
                  installedAt: installPath,
                  name: packageInfo.name,
                  version: packageInfo.version,
                },
              },
              success: true,
            });
          } catch (err) {
            // Clean up temp directory on error
            await removeDirectory(tempDir).catch(() => {});
            throw err;
          }
        },
      )
      .delete(
        "/:scope/:name",
        describeRoute({
          tags: ["Workers"],
          summary: "Delete worker",
          description: "Remove a worker (all versions)",
          parameters: [
            {
              name: "scope",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Worker scope (e.g., @buntime)",
            },
            {
              name: "name",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Worker name",
            },
          ],
          responses: {
            200: {
              description: "Worker deleted successfully",
              content: { "application/json": { schema: SuccessResponse } },
            },
          },
        }),
        async (ctx) => {
          const workerDirs = getWorkerDirs(deps);
          const scope = ctx.req.param("scope");
          const name = ctx.req.param("name");

          if (!scope || !name) {
            throw new ValidationError("Scope and name are required", "MISSING_PARAMS");
          }

          const fullName = scope.startsWith("@") ? `${scope}/${name}` : name;

          let builtInFound = false;
          let found = false;

          for (const worker of await discoverInstalledWorkers(workerDirs)) {
            if (worker.name !== fullName && worker.directoryName !== fullName) continue;

            if (!worker.removable) {
              builtInFound = true;
              continue;
            }

            await removeDirectory(worker.path);
            found = true;
            break;
          }

          if (!found) {
            if (builtInFound) {
              throw new ForbiddenError(
                `Built-in worker cannot be removed: ${fullName}`,
                "BUILT_IN_WORKER_REMOVE_FORBIDDEN",
              );
            }

            throw new NotFoundError(`Worker not found: ${fullName}`, "WORKER_NOT_FOUND");
          }

          return ctx.json({ success: true });
        },
      )
      .delete(
        "/:scope/:name/:version",
        describeRoute({
          tags: ["Workers"],
          summary: "Delete worker version",
          description: "Remove a specific version of a worker",
          parameters: [
            {
              name: "scope",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Worker scope",
            },
            {
              name: "name",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Worker name",
            },
            {
              name: "version",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Version to delete",
            },
          ],
          responses: {
            200: {
              description: "Version deleted successfully",
              content: { "application/json": { schema: SuccessResponse } },
            },
          },
        }),
        async (ctx) => {
          const workerDirs = getWorkerDirs(deps);
          const scope = ctx.req.param("scope");
          const name = ctx.req.param("name");
          const version = ctx.req.param("version");

          if (!scope || !name || !version) {
            throw new ValidationError("Scope, name and version are required", "MISSING_PARAMS");
          }

          const fullName = scope.startsWith("@") ? `${scope}/${name}` : name;

          let builtInFound = false;
          let found = false;

          for (const worker of await discoverInstalledWorkers(workerDirs)) {
            if (worker.name !== fullName && worker.directoryName !== fullName) continue;

            const versionPath = worker.versionPaths.get(version);
            if (!versionPath) continue;

            if (!worker.removable) {
              builtInFound = true;
              continue;
            }

            await removeDirectory(versionPath);
            found = true;
            break;
          }

          if (!found) {
            if (builtInFound) {
              throw new ForbiddenError(
                `Built-in worker version cannot be removed: ${fullName}@${version}`,
                "BUILT_IN_WORKER_VERSION_REMOVE_FORBIDDEN",
              );
            }

            throw new NotFoundError(
              `Worker version not found: ${fullName}@${version}`,
              "WORKER_VERSION_NOT_FOUND",
            );
          }

          return ctx.json({ success: true });
        },
      )

      // Enable or disable a specific worker version at runtime (no restart).
      // Toggles the version's manifest.enabled and clears the config cache so
      // resolveTargetApp sees the change immediately. A disabled version 404s.
      .post(
        "/:scope/:name/:version/:action{enable|disable}",
        describeRoute({
          tags: ["Workers"],
          summary: "Enable or disable a worker version",
          description:
            "Flips the version's manifest `enabled` flag. A disabled version is " +
            "treated as not-installed (its base path 404s). No restart required.",
          parameters: [
            { name: "scope", in: "path", required: true, schema: { type: "string" } },
            { name: "name", in: "path", required: true, schema: { type: "string" } },
            { name: "version", in: "path", required: true, schema: { type: "string" } },
            {
              name: "action",
              in: "path",
              required: true,
              schema: { enum: ["enable", "disable"], type: "string" },
            },
          ],
          responses: {
            200: {
              description: "Worker version toggled",
              content: { "application/json": { schema: SuccessResponse } },
            },
          },
        }),
        async (ctx) => {
          const workerDirs = getWorkerDirs(deps);
          const scope = ctx.req.param("scope");
          const name = ctx.req.param("name");
          const version = ctx.req.param("version");
          const enabled = ctx.req.param("action") === "enable";

          if (!scope || !name || !version) {
            throw new ValidationError("Scope, name and version are required", "MISSING_PARAMS");
          }

          const fullName = scope.startsWith("@") ? `${scope}/${name}` : name;

          let versionPath: string | undefined;
          for (const worker of await discoverInstalledWorkers(workerDirs)) {
            if (worker.name !== fullName && worker.directoryName !== fullName) continue;
            versionPath = worker.versionPaths.get(version);
            if (versionPath) break;
          }

          if (!versionPath) {
            throw new NotFoundError(
              `Worker version not found: ${fullName}@${version}`,
              "WORKER_VERSION_NOT_FOUND",
            );
          }

          const updated = await setManifestEnabled(versionPath, enabled);
          if (!updated) {
            throw new NotFoundError(
              `Worker manifest not found for: ${fullName}@${version}`,
              "WORKER_MANIFEST_NOT_FOUND",
            );
          }

          // Drop the cached config so the next request sees the new enabled state.
          clearWorkerConfigCache(versionPath);

          return ctx.json({ data: { enabled, name: fullName, version }, success: true });
        },
      )
  );
}

export type WorkersRoutesType = ReturnType<typeof createWorkersRoutes>;
