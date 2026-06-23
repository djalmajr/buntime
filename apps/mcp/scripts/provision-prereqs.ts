#!/usr/bin/env bun
/**
 * Facilitated prerequisite-plugin provisioner.
 *
 * Installs ONLY the plugins declared in a manifest's `deploy.plugins` block — no
 * worker, no redirects, no app-shell. Use it to plant a baseline set of platform
 * plugins (e.g. the @centralit prerequisites: resource-tenant, auth-token,
 * migrations) on a runtime, or to recover them after an image re-pull re-seeded
 * the built-in plugin dir (the plugins live on the uploaded PVC dir, which the
 * full app provisioner also targets — this script is the lean, plugins-only path).
 *
 * Needs only an API key with `plugins:install` + `plugins:read` (NOT workers /
 * proxy / gateway). The manifest's `deploy.redirects` and `deploy.shell` are
 * deliberately ignored. Idempotent and re-runnable.
 *
 * Usage:
 *   BUNTIME_URL=... BUNTIME_API_KEY=... \
 *     bun scripts/provision-prereqs.ts --manifest <path> \
 *       [--skip-build] [--reload-only] [--dry-run] [--env KEY=VAL ...]
 *
 * Flags:
 *   --manifest <path>  manifest carrying the `deploy.plugins[]` (required).
 *   --skip-build       do not build a plugin (requires its `dist/` to exist).
 *   --reload-only      skip build/upload; just reload + verify (recovery path).
 *   --dry-run          resolve sources and print what would happen; no API calls.
 *   --env KEY=VAL      override for `${VAR}` interpolation (parity with provision).
 *
 * `${VAR}` is interpolated from: the manifest's `env:` block, then process.env,
 * then any `--env KEY=VAL` overrides (same precedence as `provision.ts`).
 */
import { dirname, resolve } from "node:path";
import { parseDeploySpec } from "@buntime/shared/utils/deploy-spec";
import { parse as parseYaml } from "yaml";
import { RuntimeClient } from "../src/client.ts";
import { loadConfig } from "../src/config.ts";
import { provisionPlugins, resolvePluginSource, verifyLoaded } from "../src/provision-plugins.ts";

const args = process.argv.slice(2);
const skipBuild = args.includes("--skip-build");
const reloadOnly = args.includes("--reload-only");
const dryRun = args.includes("--dry-run");

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function log(message: string): void {
  process.stderr.write(`[provision-prereqs] ${message}\n`);
}

async function main(): Promise<void> {
  const manifestArg = flag("manifest");
  if (!manifestArg) {
    log("error: --manifest <path> is required");
    process.exit(1);
  }
  const manifestPath = resolve(manifestArg);
  const baseDir = dirname(manifestPath);

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

  if (!spec || spec.plugins.length === 0) {
    log("error: manifest has no deploy.plugins to provision");
    process.exit(1);
  }
  // Deliberately plugins-only: redirects and shell from the spec are ignored.
  log(`plugins: ${spec.plugins.map((p) => p.name).join(", ")}`);

  if (dryRun) {
    for (const plugin of spec.plugins) {
      const dir = await resolvePluginSource(plugin.source, baseDir, { skipBuild: true, log });
      log(`would upload ${plugin.name} <- ${dir}`);
    }
    if (spec.requiresEnv.length) {
      log(`runtime must provide env for: ${spec.requiresEnv.join(", ")}`);
    }
    log("dry-run: no changes made.");
    return;
  }

  const client = new RuntimeClient(loadConfig());
  log(`runtime: ${process.env.BUNTIME_URL}`);

  if (reloadOnly) {
    log("reload-only: skipping build/upload");
    await client.reloadPlugins();
    await verifyLoaded(client, spec.plugins, log);
  } else {
    await provisionPlugins(client, spec.plugins, baseDir, { skipBuild, log });
  }

  const health = (await client.health().catch(() => ({}))) as { status?: string; version?: string };
  log(`health: ${health?.status} (v${health?.version})`);
  if (spec.requiresEnv.length) {
    log(`reminder: the runtime must provide env for: ${spec.requiresEnv.join(", ")}`);
  }
  log("done.");
}

main().catch((err) => {
  process.stderr.write(
    `[provision-prereqs] fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
