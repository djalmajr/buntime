import { join } from "node:path";

/**
 * Set the `enabled` flag in a unit's `manifest.yaml`, preserving comments and
 * formatting. Surgically replaces an existing top-level `enabled:` line, or
 * prepends one when absent. If the unit has no manifest yet (e.g. a worker
 * shipped with only `package.json`), a `manifest.yaml` is created containing
 * just the flag.
 *
 * Shared by the plugin (`pluginDir/manifest.yaml`) and worker
 * (`workerDir/{name}/{version}/manifest.yaml`) enable/disable endpoints —
 * both treat the manifest as the source of truth for enabled state.
 */
export async function setManifestEnabled(dir: string, enabled: boolean): Promise<boolean> {
  const line = `enabled: ${enabled}`;

  for (const filename of ["manifest.yaml", "manifest.yml"]) {
    const manifestPath = join(dir, filename);
    const file = Bun.file(manifestPath);
    if (!(await file.exists())) continue;

    const content = await file.text();
    // Match a top-level `enabled:` line (no leading whitespace).
    const enabledRe = /^enabled:[^\n]*$/m;
    const next = enabledRe.test(content) ? content.replace(enabledRe, line) : `${line}\n${content}`;

    await Bun.write(manifestPath, next);
    return true;
  }

  // No manifest yet — create one with just the flag.
  await Bun.write(join(dir, "manifest.yaml"), `${line}\n`);
  return true;
}
