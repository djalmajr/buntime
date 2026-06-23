#!/usr/bin/env bun
/**
 * Deterministic app provisioner.
 *
 * Reads an app's worker `manifest.yaml` deploy spec (see
 * `@buntime/shared/utils/deploy-spec`) and sets up the app's full footprint on a
 * Buntime runtime via the management API: required plugins (build + upload +
 * reload), proxy redirects (idempotent upsert), the worker (build + upload), and
 * the app-shell role (global default or per-tenant). Idempotent and re-runnable.
 *
 * Usage:
 *   BUNTIME_URL=... BUNTIME_API_KEY=... \
 *     bun scripts/provision.ts --manifest <path/to/manifest.yaml> [--skip-build] [--env KEY=VAL ...]
 *
 * `${VAR}` in redirect targets is interpolated from: the manifest's own `env:`
 * block, then process.env, then any `--env KEY=VAL` overrides.
 */
import { cp, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseDeploySpec } from "@buntime/shared/utils/deploy-spec";
import { parse as parseYaml } from "yaml";
import { RuntimeClient } from "../src/client.ts";
import { loadConfig } from "../src/config.ts";
import { provisionPlugins } from "../src/provision-plugins.ts";

const args = process.argv.slice(2);
const skipBuild = args.includes("--skip-build");

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function log(message: string): void {
  process.stderr.write(`[provision] ${message}\n`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function sh(cmd: string[], cwd: string): Promise<void> {
  log(`$ ${cmd.join(" ")}  (cwd: ${cwd})`);
  const proc = Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  if ((await proc.exited) !== 0) {
    throw new Error(`command failed: ${cmd.join(" ")}`);
  }
}

/** Pack the app dir into a tgz, using the chosen manifest as `package/manifest.yaml`. */
async function packWorker(appDir: string, manifestPath: string): Promise<string> {
  const staging = await mkdtemp(join(tmpdir(), "provision-pkg-"));
  const pkgDir = join(staging, "package");
  await mkdir(pkgDir, { recursive: true });
  await cp(manifestPath, join(pkgDir, "manifest.yaml"));
  for (const entry of ["package.json", "index.ts", "index.js", "dist"]) {
    const src = join(appDir, entry);
    if (await exists(src)) await cp(src, join(pkgDir, entry), { recursive: true });
  }
  const out = join(tmpdir(), `provision-worker-${process.pid}-${Date.now()}.tgz`);
  const proc = Bun.spawn(["tar", "-czf", out, "-C", staging, "package"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  await rm(staging, { recursive: true, force: true });
  if (code !== 0) {
    throw new Error(`tar failed (${code}) packing ${appDir}`);
  }
  return out;
}

async function main(): Promise<void> {
  const manifestArg = flag("manifest");
  if (!manifestArg) {
    log("error: --manifest <path> is required");
    process.exit(1);
  }
  const manifestPath = resolve(manifestArg);
  const appDir = dirname(manifestPath);

  const manifest = parseYaml(await Bun.file(manifestPath).text()) as Record<string, unknown>;
  const manifestEnv = (manifest.env ?? {}) as Record<string, string>;
  const envOverrides: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--env") {
      const kv = args[i + 1] ?? "";
      const eq = kv.indexOf("=");
      if (eq > 0) envOverrides[kv.slice(0, eq)] = kv.slice(eq + 1);
    }
  }
  const interpEnv = { ...manifestEnv, ...process.env, ...envOverrides };
  const spec = parseDeploySpec(manifest, interpEnv);

  const client = new RuntimeClient(loadConfig());
  log(`runtime: ${process.env.BUNTIME_URL}`);
  log(`app: ${appDir}`);

  // 1. Plugins: resolve + build + pack + upload, then a single reload + verify.
  if (spec?.plugins.length) {
    await provisionPlugins(client, spec.plugins, appDir, { skipBuild, log });
  }

  // 2. Redirects: idempotent upsert keyed by pattern.
  if (spec?.redirects.length) {
    const existing = (await client.listRedirects()) as Array<{ id: string; pattern: string }>;
    for (const rule of spec.redirects) {
      const match = Array.isArray(existing)
        ? existing.find((e) => e.pattern === rule.pattern)
        : undefined;
      log(`${match ? "update" : "create"} redirect ${rule.pattern} -> ${rule.target}`);
      await client.setRedirect({
        name: rule.name ?? rule.pattern,
        pattern: rule.pattern,
        target: rule.target,
        rewrite: rule.rewrite,
        changeOrigin: rule.changeOrigin,
        secure: rule.secure,
        id: match?.id,
      });
    }
  }

  // 3. Worker: build + pack (with the chosen manifest) + upload.
  const pkg = (await exists(join(appDir, "package.json")))
    ? JSON.parse(await Bun.file(join(appDir, "package.json")).text())
    : {};
  if (!skipBuild && pkg.scripts?.build) {
    await sh(["bun", "run", "build"], appDir);
  }
  const tgz = await packWorker(appDir, manifestPath);
  log("upload worker");
  const up = (await client.uploadWorker(tgz)) as {
    data?: { worker?: { installedAt?: string; name?: string; version?: string } };
  };
  await rm(tgz, { force: true });
  const installedAt = up?.data?.worker?.installedAt;
  log(`installed: ${up?.data?.worker?.name}@${up?.data?.worker?.version} at ${installedAt}`);

  // 4. App-shell role.
  if (spec && installedAt) {
    if (spec.shell === "default") {
      log("set as global default shell");
      await client.setShellDir(installedAt);
    } else if (typeof spec.shell === "object") {
      log(`set shell route for ${spec.shell.perTenant}`);
      await client.setShellRoute(spec.shell.perTenant, installedAt);
    }
  }

  // 5. Verify.
  const health = (await client.health()) as { status?: string; version?: string };
  log(`health: ${health?.status} (v${health?.version})`);
  if (spec?.requiresEnv.length) {
    log(`reminder: the runtime must provide env for: ${spec.requiresEnv.join(", ")}`);
  }
  log("done.");
}

main().catch((err) => {
  process.stderr.write(`[provision] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
