#!/usr/bin/env bun
/**
 * Pre-commit hook to validate Chart.yaml version bump
 *
 * Ensures that when chart files are modified (templates/, values.yaml, etc.),
 * the Chart.yaml `version` field is also updated.
 *
 * This is separate from appVersion which tracks the runtime version.
 * - `version`: Chart version (bump when chart structure/templates change)
 * - `appVersion`: Application version (synced with apps/runtime/package.json)
 */

import { $ } from "bun";

const CHART_DIR = "charts/buntime";
const CHART_YAML = `${CHART_DIR}/Chart.yaml`;

interface StagedFiles {
  chartFiles: string[];
  chartYamlStaged: boolean;
}

/**
 * Get list of staged files in the chart directory
 */
async function getStagedChartFiles(): Promise<StagedFiles> {
  const result = await $`git diff --cached --name-only -- ${CHART_DIR}`.text();
  const files = result.trim().split("\n").filter(Boolean);

  return {
    chartFiles: files.filter((f) => f !== CHART_YAML),
    chartYamlStaged: files.includes(CHART_YAML),
  };
}

/**
 * Check if the Chart.yaml version field was changed in staged changes
 */
async function wasVersionBumped(): Promise<boolean> {
  try {
    const diff = await $`git diff --cached -- ${CHART_YAML}`.text();
    // Look for a line change in version field
    // +version: x.y.z indicates the version was updated
    return /^\+version:\s*\d+\.\d+\.\d+/m.test(diff);
  } catch {
    return false;
  }
}

/**
 * Get current chart version from Chart.yaml
 */
async function getCurrentVersion(): Promise<string> {
  const content = await Bun.file(CHART_YAML).text();
  const match = content.match(/^version:\s*(\d+\.\d+\.\d+)/m);
  return match?.[1] ?? "unknown";
}

/**
 * Suggest next version based on current
 */
function suggestNextVersion(current: string): string {
  const parts = current.split(".").map(Number);
  const patch = (parts[2] ?? 0) + 1;
  return `${parts[0]}.${parts[1]}.${patch}`;
}

async function main() {
  const { chartFiles, chartYamlStaged } = await getStagedChartFiles();

  // No chart files staged (other than possibly Chart.yaml itself)
  if (chartFiles.length === 0) {
    // If only Chart.yaml changed (manual version bump), that's fine
    if (chartYamlStaged) {
      console.log("✅ Chart.yaml version check passed (direct Chart.yaml change)");
    }
    process.exit(0);
  }

  // Chart files are staged, check if Chart.yaml version was bumped
  if (!chartYamlStaged) {
    const currentVersion = await getCurrentVersion();
    const suggestedVersion = suggestNextVersion(currentVersion);

    console.error("❌ Chart files changed without Chart.yaml version bump!\n");
    console.error("Modified chart files:");
    for (const f of chartFiles) {
      console.error(`  - ${f}`);
    }
    console.error("");
    console.error(`Current version: ${currentVersion}`);
    console.error(`Suggested version: ${suggestedVersion}\n`);
    console.error("To fix, run one of:");
    console.error("  bun scripts/bump-chart.ts patch   # Recommended for fixes");
    console.error("  bun scripts/bump-chart.ts minor   # For new features");
    console.error("  bun scripts/bump-chart.ts major   # For breaking changes\n");
    process.exit(1);
  }

  // Chart.yaml is staged, check if version was actually changed
  const versionBumped = await wasVersionBumped();

  if (!versionBumped) {
    const currentVersion = await getCurrentVersion();
    const suggestedVersion = suggestNextVersion(currentVersion);

    console.error("❌ Chart.yaml staged but version not bumped!\n");
    console.error("Modified chart files:");
    for (const f of chartFiles) {
      console.error(`  - ${f}`);
    }
    console.error("");
    console.error(`Current version: ${currentVersion}`);
    console.error(`Suggested version: ${suggestedVersion}\n`);
    console.error("To fix, run one of:");
    console.error("  bun scripts/bump-chart.ts patch");
    console.error("  bun scripts/bump-chart.ts minor");
    console.error("  bun scripts/bump-chart.ts major\n");
    process.exit(1);
  }

  console.log(`✅ Chart version bumped correctly`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
