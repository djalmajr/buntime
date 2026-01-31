#!/usr/bin/env bun
/**
 * Pre-commit hook to validate version synchronization
 *
 * Ensures that:
 * - apps/runtime/package.json "version"
 * - charts/buntime/Chart.yaml "appVersion"
 *
 * are always in sync.
 */

const RUNTIME_PKG_PATH = "apps/runtime/package.json";
const CHART_PATH = "charts/buntime/Chart.yaml";

async function getRuntimeVersion(): Promise<string> {
  const pkg = await Bun.file(RUNTIME_PKG_PATH).json();
  return pkg.version;
}

async function getChartAppVersion(): Promise<string> {
  const content = await Bun.file(CHART_PATH).text();
  const match = content.match(/^appVersion:\s*"(.*)"/m);
  if (!match?.[1]) {
    throw new Error(`Could not find appVersion in ${CHART_PATH}`);
  }
  return match[1];
}

async function main() {
  const runtimeVersion = await getRuntimeVersion();
  const chartAppVersion = await getChartAppVersion();

  if (runtimeVersion !== chartAppVersion) {
    console.error("❌ Version mismatch detected!\n");
    console.error(`   ${RUNTIME_PKG_PATH}: ${runtimeVersion}`);
    console.error(`   ${CHART_PATH} appVersion: ${chartAppVersion}\n`);
    console.error("Run 'bun scripts/bump-version.ts <patch|minor|major>' to sync versions.\n");
    process.exit(1);
  }

  console.log(`✅ Versions synced: v${runtimeVersion}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
