#!/usr/bin/env bun

/**
 * Unified version bump script for Buntime
 *
 * Manages two independent version tracks:
 * - Chart version (Chart.yaml:version + root package.json) — always required
 * - App version (Chart.yaml:appVersion + apps/runtime/package.json) — optional, runtime-only
 *
 * Git tags (--tag) trigger Docker image builds via CI. Use --tag when the
 * image contents changed (runtime or plugin code/manifest changes).
 *
 * Usage:
 *   # Chart-only change (templates, values) — no image rebuild
 *   bun scripts/bump-version.ts --chart=patch
 *
 *   # Plugin changed (manifest, code) — needs image rebuild
 *   bun scripts/bump-version.ts --chart=patch --tag
 *
 *   # Runtime changed — needs image rebuild
 *   bun scripts/bump-version.ts --chart=patch --app=patch --tag
 *
 *   # Runtime + chart feature
 *   bun scripts/bump-version.ts --chart=minor --app=minor --tag
 *
 *   # Set specific versions
 *   bun scripts/bump-version.ts --chart=1.0.0 --app=2.0.0 --tag
 *
 * Options:
 *   --chart=patch|minor|major|x.y.z  Bump chart version (REQUIRED)
 *   --app=patch|minor|major|x.y.z    Bump app/runtime version (optional)
 *   --tag                             Create git tag v{chartVersion} (triggers Docker build)
 *   --no-commit                       Skip git commit
 *   --no-push                         Skip git push (default: push when --tag)
 */

import { parseArgs } from "node:util";
import { $ } from "bun";

const ROOT_PKG_PATH = "package.json";
const RUNTIME_PKG_PATH = "apps/runtime/package.json";
const CHART_PATH = "charts/Chart.yaml";

type BumpType = "patch" | "minor" | "major";

const BUMP_TYPES = ["patch", "minor", "major"];

function bumpVersion(current: string, type: BumpType): string {
  const parts = current.split(".").map(Number);
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;

  switch (type) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}

function isValidVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}

function resolveVersion(current: string, input: string): string {
  if (BUMP_TYPES.includes(input)) {
    return bumpVersion(current, input as BumpType);
  }
  if (isValidVersion(input)) {
    return input;
  }
  throw new Error(
    `Invalid version or bump type: "${input}". Use: patch, minor, major, or a valid semver (e.g., 1.2.3)`,
  );
}

// --- File readers ---

async function readChartVersion(): Promise<string> {
  const content = await Bun.file(CHART_PATH).text();
  const match = content.match(/^version:\s*(\d+\.\d+\.\d+)/m);
  if (!match?.[1]) throw new Error(`Could not find version in ${CHART_PATH}`);
  return match[1];
}

async function readRuntimeVersion(): Promise<string> {
  const pkg = await Bun.file(RUNTIME_PKG_PATH).json();
  return pkg.version;
}

// --- File writers ---

async function updateChartVersion(version: string): Promise<void> {
  const content = await Bun.file(CHART_PATH).text();
  const updated = content.replace(/^version:\s*\d+\.\d+\.\d+/m, `version: ${version}`);
  await Bun.write(CHART_PATH, updated);
}

async function updateRootVersion(version: string): Promise<void> {
  const pkg = await Bun.file(ROOT_PKG_PATH).json();
  pkg.version = version;
  await Bun.write(ROOT_PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`);
}

async function updateChartAppVersion(version: string): Promise<void> {
  const content = await Bun.file(CHART_PATH).text();
  const updated = content.replace(/^appVersion:\s*".*"/m, `appVersion: "${version}"`);
  await Bun.write(CHART_PATH, updated);
}

async function updateRuntimeVersion(version: string): Promise<void> {
  const pkg = await Bun.file(RUNTIME_PKG_PATH).json();
  pkg.version = version;
  await Bun.write(RUNTIME_PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`);
}

// --- Git operations ---

async function gitCommit(message: string, files: string[]): Promise<void> {
  await $`git add ${files}`.quiet();
  await $`git commit -m ${message}`.quiet();
  console.log(`  Committed: ${message}`);
}

async function gitTag(version: string): Promise<void> {
  const tag = `v${version}`;
  await $`git tag -a ${tag} -m ${`Release ${tag}`}`.quiet();
  console.log(`  Tagged: ${tag}`);
}

async function gitPush(): Promise<void> {
  await $`git push origin main --follow-tags`.quiet();
  console.log("  Pushed to origin/main with tags");
}

// --- Usage ---

function printUsage(): void {
  console.error("Usage: bun scripts/bump-version.ts --chart=<bump> [--app=<bump>] [--tag]");
  console.error("");
  console.error("Required:");
  console.error("  --chart=patch|minor|major|x.y.z   Bump chart version");
  console.error("");
  console.error("Optional:");
  console.error("  --app=patch|minor|major|x.y.z     Bump app/runtime version");
  console.error("  --tag                              Create git tag (triggers Docker build)");
  console.error("  --no-commit                        Skip git commit");
  console.error("  --no-push                          Skip git push");
  console.error("");
  console.error("Examples:");
  console.error("  # Chart infra only (no image rebuild)");
  console.error("  bun scripts/bump-version.ts --chart=patch");
  console.error("");
  console.error("  # Plugin changed (image rebuild needed)");
  console.error("  bun scripts/bump-version.ts --chart=patch --tag");
  console.error("");
  console.error("  # Runtime changed (image rebuild needed)");
  console.error("  bun scripts/bump-version.ts --chart=patch --app=patch --tag");
}

// --- Main ---

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      app: { type: "string" },
      chart: { type: "string" },
      commit: { type: "boolean", default: true },
      push: { type: "boolean", default: true },
      tag: { type: "boolean", default: false },
    },
    allowNegative: true,
  });

  // Validate: --chart is required
  if (!values.chart) {
    console.error("Error: --chart is required\n");
    printUsage();
    process.exit(1);
  }

  // Warn: --app without --tag means appVersion changes but no image rebuild
  if (values.app && !values.tag) {
    console.warn(
      "⚠️  Warning: --app without --tag — appVersion will change but no Docker image will be built.",
    );
    console.warn("   Add --tag if you need to rebuild the image.\n");
  }

  // Read current versions
  const currentChartVersion = await readChartVersion();
  const currentAppVersion = await readRuntimeVersion();

  // Resolve new versions
  const newChartVersion = resolveVersion(currentChartVersion, values.chart);
  const newAppVersion = values.app ? resolveVersion(currentAppVersion, values.app) : null;

  // Print plan
  console.log("\nBumping versions:\n");
  console.log(`  Chart:  ${currentChartVersion} → ${newChartVersion}`);
  if (newAppVersion) {
    console.log(`  App:    ${currentAppVersion} → ${newAppVersion}`);
  }
  console.log(`  Tag:    ${values.tag ? `v${newChartVersion}` : "(none)"}`);
  console.log("");

  // Update files
  console.log("Updating files...");

  const files = [ROOT_PKG_PATH, CHART_PATH];

  await updateChartVersion(newChartVersion);
  console.log(`  ${CHART_PATH} version: ${newChartVersion}`);

  await updateRootVersion(newChartVersion);
  console.log(`  ${ROOT_PKG_PATH}: ${newChartVersion}`);

  if (newAppVersion) {
    files.push(RUNTIME_PKG_PATH);

    await updateRuntimeVersion(newAppVersion);
    console.log(`  ${RUNTIME_PKG_PATH}: ${newAppVersion}`);

    await updateChartAppVersion(newAppVersion);
    console.log(`  ${CHART_PATH} appVersion: ${newAppVersion}`);
  }

  // Git operations
  if (values.commit) {
    console.log("\nGit operations...");

    const commitMsg = newAppVersion
      ? `chore(release): bump to v${newChartVersion} (app v${newAppVersion})`
      : `chore(release): bump chart to v${newChartVersion}`;

    await gitCommit(commitMsg, files);

    if (values.tag) {
      await gitTag(newChartVersion);
    }

    if (values.push && values.tag) {
      await gitPush();
    }
  }

  // Summary
  const parts = [`chart v${newChartVersion}`];
  if (newAppVersion) parts.push(`app v${newAppVersion}`);
  if (values.tag) parts.push(`tag v${newChartVersion}`);

  console.log(`\n✅ Released: ${parts.join(", ")}\n`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
