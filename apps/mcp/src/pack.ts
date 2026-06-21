import { cp, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppError, ValidationError } from "@buntime/shared/errors";

/** Entries packed by default when a worker/plugin directory is given. */
const DEFAULT_INCLUDE = [
  "manifest.yaml",
  "manifest.yml",
  "package.json",
  "index.ts",
  "index.js",
  "dist",
];

const ARCHIVE_RE = /\.(tgz|tar\.gz|zip)$/i;

export interface ResolvedArchive {
  /** Path to an archive ready to upload. */
  archivePath: string;
  /** Removes a temporary archive when packing was needed; absent for passthrough. */
  cleanup?: () => Promise<void>;
}

/**
 * Resolve an upload source into an archive path. A file must be a
 * `.tgz`/`.tar.gz`/`.zip` (passed through unchanged); a directory is packed into
 * a temporary tarball whose entries are wrapped in a top-level `package/` folder
 * (npm-pack convention) — the runtime extracts tgz with `tar --strip-components=1`,
 * which removes that prefix.
 */
export async function resolveArchive(
  inputPath: string,
  include?: string[],
): Promise<ResolvedArchive> {
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(inputPath);
  } catch {
    throw new ValidationError(`Path not found: ${inputPath}`, "PATH_NOT_FOUND");
  }

  if (info.isFile()) {
    if (!ARCHIVE_RE.test(inputPath)) {
      throw new ValidationError(
        `Archive must be .tgz, .tar.gz, or .zip: ${inputPath}`,
        "INVALID_ARCHIVE",
      );
    }
    return { archivePath: inputPath };
  }

  if (!info.isDirectory()) {
    throw new ValidationError(
      `Path is neither a file nor a directory: ${inputPath}`,
      "INVALID_PATH",
    );
  }

  const candidates = include ?? DEFAULT_INCLUDE;
  const entries: string[] = [];
  for (const candidate of candidates) {
    try {
      await stat(join(inputPath, candidate));
      entries.push(candidate);
    } catch {
      // Skip entries that do not exist in the directory.
    }
  }

  const hasManifest = entries.includes("manifest.yaml") || entries.includes("manifest.yml");
  const hasPackage = entries.includes("package.json");
  if (!hasManifest && !hasPackage) {
    throw new ValidationError(
      `Directory must contain manifest.yaml or package.json: ${inputPath}`,
      "MISSING_PACKAGE_METADATA",
    );
  }

  // Stage the entries under `package/` so the runtime's `--strip-components=1`
  // unwraps them back to the archive root.
  const staging = await mkdtemp(join(tmpdir(), "buntime-pack-"));
  const packageDir = join(staging, "package");
  await mkdir(packageDir, { recursive: true });
  for (const entry of entries) {
    await cp(join(inputPath, entry), join(packageDir, entry), { recursive: true });
  }

  const out = join(tmpdir(), `buntime-pkg-${process.pid}-${Date.now()}.tgz`);
  const proc = Bun.spawn(["tar", "-czf", out, "-C", staging, "package"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  await rm(staging, { recursive: true, force: true });
  if (code !== 0) {
    const stderr = (await new Response(proc.stderr).text()).trim();
    throw new AppError(`Failed to pack directory (tar exit ${code}): ${stderr}`, "PACK_FAILED");
  }

  return {
    archivePath: out,
    cleanup: async () => {
      await rm(out, { force: true });
    },
  };
}
