#!/usr/bin/env bun

/**
 * Version bump script for Buntime
 *
 * Synchronizes version between:
 * - apps/runtime/package.json (version)
 * - charts/buntime/Chart.yaml (appVersion)
 *
 * Usage:
 *   bun scripts/bump-version.ts patch   # 1.0.0 → 1.0.1
 *   bun scripts/bump-version.ts minor   # 1.0.0 → 1.1.0
 *   bun scripts/bump-version.ts major   # 1.0.0 → 2.0.0
 *   bun scripts/bump-version.ts 2.0.0   # Set specific version
 *
 * Options:
 *   --no-commit  Skip git commit
 *   --no-tag     Skip git tag
 *   --no-push    Skip git push
 */

import { parseArgs } from "node:util";
import { $ } from "bun";

const RUNTIME_PKG_PATH = "apps/runtime/package.json";
const CHART_PATH = "charts/buntime/Chart.yaml";

type BumpType = "patch" | "minor" | "major";

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

async function readRuntimeVersion(): Promise<string> {
  const pkg = await Bun.file(RUNTIME_PKG_PATH).json();
  return pkg.version;
}

async function updateRuntimeVersion(version: string): Promise<void> {
  const pkg = await Bun.file(RUNTIME_PKG_PATH).json();
  pkg.version = version;
  await Bun.write(RUNTIME_PKG_PATH, JSON.stringify(pkg, null, 2) + "\n");
}

async function updateChartAppVersion(version: string): Promise<void> {
  const content = await Bun.file(CHART_PATH).text();
  const updated = content.replace(/^appVersion:\s*".*"/m, `appVersion: "${version}"`);
  await Bun.write(CHART_PATH, updated);
}

async function gitCommit(version: string): Promise<void> {
  await $`git add ${RUNTIME_PKG_PATH} ${CHART_PATH}`.quiet();
  await $`git commit -m ${"chore: release v" + version}`.quiet();
  console.log(`  Committed: chore: release v${version}`);
}

async function gitTag(version: string): Promise<void> {
  const tag = `v${version}`;
  await $`git tag -a ${tag} -m ${"Release " + tag}`.quiet();
  console.log(`  Tagged: ${tag}`);
}

async function gitPush(): Promise<void> {
  await $`git push origin main --follow-tags`.quiet();
  console.log("  Pushed to origin/main with tags");
}

async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      commit: { type: "boolean", default: true },
      tag: { type: "boolean", default: true },
      push: { type: "boolean", default: true },
    },
    allowPositionals: true,
    allowNegative: true,
  });

  const input = positionals[0];

  if (!input) {
    console.error("Usage: bun scripts/bump-version.ts <patch|minor|major|x.y.z>");
    console.error("");
    console.error("Options:");
    console.error("  --no-commit  Skip git commit");
    console.error("  --no-tag     Skip git tag");
    console.error("  --no-push    Skip git push");
    process.exit(1);
  }

  const currentVersion = await readRuntimeVersion();
  let newVersion: string;

  if (["patch", "minor", "major"].includes(input)) {
    newVersion = bumpVersion(currentVersion, input as BumpType);
  } else if (isValidVersion(input)) {
    newVersion = input;
  } else {
    console.error(`Invalid version or bump type: ${input}`);
    console.error("Use: patch, minor, major, or a valid semver (e.g., 1.2.3)");
    process.exit(1);
  }

  console.log(`\nBumping version: ${currentVersion} → ${newVersion}\n`);

  // Update files
  console.log("Updating files...");
  await updateRuntimeVersion(newVersion);
  console.log(`  ${RUNTIME_PKG_PATH}`);
  await updateChartAppVersion(newVersion);
  console.log(`  ${CHART_PATH}`);

  // Git operations
  if (values.commit) {
    console.log("\nGit operations...");
    await gitCommit(newVersion);

    if (values.tag) {
      await gitTag(newVersion);
    }

    if (values.push) {
      await gitPush();
    }
  }

  console.log(`\n✅ Released v${newVersion}\n`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
