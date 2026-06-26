/**
 * Shared plugin-provisioning step.
 *
 * The single, tested implementation of "resolve -> build -> pack -> upload ->
 * reload -> verify" for a set of plugins, used by BOTH the full app provisioner
 * (`scripts/provision.ts`) and the prerequisite-only provisioner
 * (`scripts/provision-prereqs.ts`). Idempotent: upload overwrites the uploaded
 * plugin dir (PVC), reload rescans. A plugin can install yet fail to LOAD (e.g.
 * a missing runtime env var), so the upload step verifies and reports it instead
 * of letting an app silently lose a dependency.
 */
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { RuntimeClient } from "./client.ts";
import { resolveArchive } from "./pack.ts";

/** Minimal shape of a plugin entry from a manifest `deploy.plugins[]`. */
export interface DeployPlugin {
  name: string;
  source: string;
}

export interface ProvisionPluginsOptions {
  /** Skip building a plugin even when `dist/` is missing. */
  skipBuild?: boolean;
  /** Sink for human-readable progress. Defaults to a no-op. */
  log?: (message: string) => void;
}

export interface ProvisionPluginsResult {
  /** Plugin names whose archive was uploaded. */
  uploaded: string[];
  /** Declared plugins that did NOT appear in the loaded set after reload. */
  notLoaded: string[];
}

const noop = (): void => {};

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function sh(cmd: string[], cwd: string, log: (message: string) => void): Promise<void> {
  log(`$ ${cmd.join(" ")}  (cwd: ${cwd})`);
  const proc = Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  if ((await proc.exited) !== 0) {
    throw new Error(`command failed: ${cmd.join(" ")}`);
  }
}

/**
 * Resolve a plugin `source` (a local path relative to `baseDir`, or
 * `git+<url>#<subdir>`) to a built directory. Builds (`bun install` + `bun run
 * build`) when `dist/` is missing and the package declares a build script,
 * unless `skipBuild` is set.
 */
export async function resolvePluginSource(
  source: string,
  baseDir: string,
  options: ProvisionPluginsOptions = {},
): Promise<string> {
  const log = options.log ?? noop;
  let dir: string;
  if (source.startsWith("git+")) {
    const [url, subdir] = source.slice(4).split("#");
    const clone = await mkdtemp(join(tmpdir(), "provision-plugin-"));
    await sh(["git", "clone", "--depth", "1", url ?? "", clone], tmpdir(), log);
    dir = subdir ? join(clone, subdir) : clone;
  } else {
    dir = resolve(baseDir, source);
  }
  if (!(await exists(dir))) {
    throw new Error(`plugin source not found: ${source} -> ${dir}`);
  }
  if (
    !options.skipBuild &&
    (await exists(join(dir, "package.json"))) &&
    !(await exists(join(dir, "dist")))
  ) {
    const pj = JSON.parse(await Bun.file(join(dir, "package.json")).text());
    if (pj.scripts?.build) {
      if (!(await exists(join(dir, "node_modules")))) await sh(["bun", "install"], dir, log);
      await sh(["bun", "run", "build"], dir, log);
    }
  }
  return dir;
}

/**
 * Verify that each declared plugin appears in the runtime's loaded set after a
 * reload. Logs a WARNING per missing plugin and returns the missing names.
 * Never throws (a failed `listLoadedPlugins` is treated as "none loaded").
 */
export async function verifyLoaded(
  client: RuntimeClient,
  plugins: DeployPlugin[],
  log: (message: string) => void = noop,
): Promise<string[]> {
  const loaded = await client.listLoadedPlugins().catch(() => []);
  const loadedNames = new Set(loaded.map((p) => p.name));
  const notLoaded: string[] = [];
  for (const plugin of plugins) {
    if (!loadedNames.has(plugin.name)) {
      notLoaded.push(plugin.name);
      log(
        `WARNING: plugin ${plugin.name} uploaded but did NOT load — check runtime env and plugin logs`,
      );
    }
  }
  return notLoaded;
}

/**
 * Provision a set of plugins onto a runtime: resolve + build + pack + upload
 * each, then a single reload, then verify each declared plugin actually loaded.
 * Idempotent. Returns which uploaded and which failed to load; the caller
 * decides whether a failed load is fatal.
 */
export async function provisionPlugins(
  client: RuntimeClient,
  plugins: DeployPlugin[],
  baseDir: string,
  options: ProvisionPluginsOptions = {},
): Promise<ProvisionPluginsResult> {
  const log = options.log ?? noop;
  const uploaded: string[] = [];
  for (const plugin of plugins) {
    const dir = await resolvePluginSource(plugin.source, baseDir, options);
    log(`upload plugin ${plugin.name}`);
    const { archivePath, cleanup } = await resolveArchive(dir);
    try {
      await client.uploadPlugin(archivePath);
      uploaded.push(plugin.name);
    } finally {
      await cleanup?.();
    }
  }
  log("reload plugins");
  await client.reloadPlugins();
  const notLoaded = await verifyLoaded(client, plugins, log);
  return { uploaded, notLoaded };
}
