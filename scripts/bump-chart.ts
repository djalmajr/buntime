#!/usr/bin/env bun
/**
 * Bump Chart.yaml version (chart infrastructure changes only)
 *
 * This script bumps the chart `version` field and syncs root package.json.
 * It does NOT create git tags (no Docker image rebuild needed).
 * The helm-publish workflow is triggered by path changes on push to main.
 *
 * Use this when modifying chart templates, values, or structure
 * without runtime/plugin changes.
 *
 * For runtime/plugin changes, use `bun scripts/bump-version.ts` instead.
 *
 * Usage:
 *   bun scripts/bump-chart.ts patch   # 0.2.6 → 0.2.7 (default for chart infra)
 *   bun scripts/bump-chart.ts minor   # 0.2.6 → 0.3.0
 *   bun scripts/bump-chart.ts major   # 0.2.6 → 1.0.0
 *   bun scripts/bump-chart.ts 1.0.0   # Set specific version
 *
 * Options:
 *   --no-commit  Skip git commit
 */

import { parseArgs } from "node:util";
import { $ } from "bun";

const ROOT_PKG_PATH = "package.json";
const CHART_PATH = "charts/Chart.yaml";

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

async function readChartVersion(): Promise<string> {
  const content = await Bun.file(CHART_PATH).text();
  const match = content.match(/^version:\s*(\d+\.\d+\.\d+)/m);
  if (!match?.[1]) {
    throw new Error(`Could not find version in ${CHART_PATH}`);
  }
  return match[1];
}

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

async function gitCommit(version: string): Promise<void> {
  await $`git add ${ROOT_PKG_PATH} ${CHART_PATH}`.quiet();
  await $`git commit -m ${`chore(chart): bump version to ${version}`}`.quiet();
  console.log(`  Committed: chore(chart): bump version to ${version}`);
}

async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      commit: { type: "boolean", default: true },
    },
    allowPositionals: true,
    allowNegative: true,
  });

  const input = positionals[0];

  if (!input) {
    console.error("Usage: bun scripts/bump-chart.ts <patch|minor|major|x.y.z>\n");
    console.error("Examples:");
    console.error("  bun scripts/bump-chart.ts patch   # For chart infra fixes");
    console.error("  bun scripts/bump-chart.ts minor   # For new chart features");
    console.error("  bun scripts/bump-chart.ts major   # For breaking chart changes");
    console.error("  bun scripts/bump-chart.ts 1.0.0   # Set specific version\n");
    console.error("Options:");
    console.error("  --no-commit  Skip git commit\n");
    console.error("Note: This only bumps the chart version, not the appVersion.");
    console.error("No git tag is created (chart-only changes don't trigger Docker builds).");
    console.error("For runtime/plugin changes, use: bun scripts/bump-version.ts");
    process.exit(1);
  }

  const currentVersion = await readChartVersion();
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

  console.log(`\nBumping chart version: ${currentVersion} → ${newVersion}\n`);

  console.log("Updating files...");

  await updateChartVersion(newVersion);
  console.log(`  ${CHART_PATH} version: ${newVersion}`);

  await updateRootVersion(newVersion);
  console.log(`  ${ROOT_PKG_PATH}: ${newVersion}`);

  if (values.commit) {
    console.log("\nGit operations...");
    await gitCommit(newVersion);
  }

  console.log(`\n✅ Chart version bumped to ${newVersion}\n`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
