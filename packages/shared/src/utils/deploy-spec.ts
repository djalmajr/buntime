/**
 * @module
 * Declarative deploy spec for a Buntime app, carried in the worker `manifest.yaml`
 * under a `deploy:` block. The runtime ignores it (parseWorkerConfig only reads
 * known fields), so the block is non-disruptive; tooling (the MCP provision flow)
 * reads it to provision an app's full footprint — required plugins, proxy
 * redirects, and app-shell role — in any environment.
 */

import { ValidationError } from "../errors";

/** A plugin this app requires, plus where to obtain it. */
export interface DeployPluginSpec {
  /** Plugin package name, e.g. `@scope/plugin-x`. */
  name: string;
  /**
   * Where to get the plugin to upload:
   * - a path (relative to the manifest dir, or absolute),
   * - a git ref `git+<url>#<subdir>`,
   * - a registry ref `registry:<pkg>@<version>` (future).
   */
  source: string;
}

/** A proxy redirect this app needs (applied via plugin-proxy). */
export interface DeployRedirectSpec {
  name?: string;
  pattern: string;
  target: string;
  rewrite?: string;
  changeOrigin?: boolean;
  secure?: boolean;
}

/** App-shell role: the global default, a per-tenant host, or not a shell. */
export type DeployShellSpec = "default" | "none" | { perTenant: string };

/** Normalized deploy spec extracted from a manifest `deploy:` block. */
export interface WorkerDeploySpec {
  shell: DeployShellSpec;
  plugins: DeployPluginSpec[];
  redirects: DeployRedirectSpec[];
  requiresEnv: string[];
}

/** Replace `${VAR}` occurrences from `env` (missing vars become empty string). */
export function interpolate(value: string, env: Record<string, string | undefined>): string {
  return value.replace(/\$\{(\w+)\}/g, (_, key: string) => env[key] ?? "");
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(`deploy.${field} must be a non-empty string`, "DEPLOY_SPEC_INVALID");
  }
  return value.trim();
}

/**
 * Extract and normalize the `deploy:` block from a parsed manifest object,
 * interpolating `${VAR}` in redirect fields from `env`. Returns null when the
 * manifest has no `deploy` block; throws ValidationError on a malformed block.
 */
export function parseDeploySpec(
  manifest: unknown,
  env: Record<string, string | undefined> = {},
): WorkerDeploySpec | null {
  const raw = (manifest as { deploy?: unknown } | null | undefined)?.deploy;
  if (raw === undefined || raw === null) {
    return null;
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError("deploy must be an object", "DEPLOY_SPEC_INVALID");
  }
  const d = raw as Record<string, unknown>;

  let shell: DeployShellSpec = "none";
  const rawShell = d.shell;
  if (rawShell === "default" || rawShell === "none") {
    shell = rawShell;
  } else if (
    rawShell &&
    typeof rawShell === "object" &&
    typeof (rawShell as { perTenant?: unknown }).perTenant === "string"
  ) {
    shell = { perTenant: (rawShell as { perTenant: string }).perTenant };
  } else if (rawShell !== undefined) {
    throw new ValidationError(
      "deploy.shell must be 'default', 'none', or { perTenant }",
      "DEPLOY_SPEC_INVALID",
    );
  }

  const plugins: DeployPluginSpec[] = Array.isArray(d.plugins)
    ? d.plugins.map((p, i) => {
        const o = (p ?? {}) as Record<string, unknown>;
        return {
          name: asString(o.name, `plugins[${i}].name`),
          source: asString(o.source, `plugins[${i}].source`),
        };
      })
    : [];

  const redirects: DeployRedirectSpec[] = Array.isArray(d.redirects)
    ? d.redirects.map((r, i) => {
        const o = (r ?? {}) as Record<string, unknown>;
        const out: DeployRedirectSpec = {
          pattern: interpolate(asString(o.pattern, `redirects[${i}].pattern`), env),
          target: interpolate(asString(o.target, `redirects[${i}].target`), env),
        };
        if (typeof o.name === "string") out.name = o.name;
        if (typeof o.rewrite === "string") out.rewrite = interpolate(o.rewrite, env);
        if (typeof o.changeOrigin === "boolean") out.changeOrigin = o.changeOrigin;
        if (typeof o.secure === "boolean") out.secure = o.secure;
        return out;
      })
    : [];

  const requiresEnv: string[] = Array.isArray(d.requiresEnv)
    ? d.requiresEnv.filter((x): x is string => typeof x === "string")
    : [];

  return { shell, plugins, redirects, requiresEnv };
}
