#!/usr/bin/env bun
/**
 * Bump Chart.yaml version
 *
 * This script bumps only the chart `version` field, NOT the `appVersion`.
 * Use this when modifying chart templates, values, or structure.
 *
 * For runtime version changes, use `bun scripts/bump-version.ts` instead,
 * which syncs both runtime package.json and Chart.yaml appVersion.
 *
 * Usage:
 *   bun scripts/bump-chart.ts patch   # 0.2.6 → 0.2.7
 *   bun scripts/bump-chart.ts minor   # 0.2.6 → 0.3.0
 *   bun scripts/bump-chart.ts major   # 0.2.6 → 1.0.0
 *   bun scripts/bump-chart.ts 1.0.0   # Set specific version
 */

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

async function main() {
  const input = Bun.argv[2];

  if (!input) {
    console.error("Usage: bun scripts/bump-chart.ts <patch|minor|major|x.y.z>\n");
    console.error("Examples:");
    console.error("  bun scripts/bump-chart.ts patch   # For bug fixes");
    console.error("  bun scripts/bump-chart.ts minor   # For new features");
    console.error("  bun scripts/bump-chart.ts major   # For breaking changes");
    console.error("  bun scripts/bump-chart.ts 1.0.0   # Set specific version\n");
    console.error("Note: This only bumps the chart version, not the appVersion.");
    console.error("For runtime changes, use: bun scripts/bump-version.ts");
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

  await updateChartVersion(newVersion);
  console.log(`  Updated ${CHART_PATH}`);

  console.log(`\n✅ Chart version bumped to ${newVersion}\n`);
  console.log("Next steps:");
  console.log("  1. Stage your changes: git add charts/buntime/");
  console.log(`  2. Commit: git commit -m "chore(chart): bump version to ${newVersion}"`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
