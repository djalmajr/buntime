#!/usr/bin/env bun
/**
 * Pre-commit hook to validate version synchronization
 *
 * Ensures that:
 * - apps/runtime/package.json "version" === charts/Chart.yaml "appVersion"
 * - package.json "version" === charts/Chart.yaml "version"
 */

const ROOT_PKG_PATH = "package.json";
const RUNTIME_PKG_PATH = "apps/runtime/package.json";
const CHART_PATH = "charts/Chart.yaml";

async function getRootVersion(): Promise<string> {
  const pkg = await Bun.file(ROOT_PKG_PATH).json();
  return pkg.version;
}

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

async function getChartVersion(): Promise<string> {
  const content = await Bun.file(CHART_PATH).text();
  const match = content.match(/^version:\s*(\d+\.\d+\.\d+)/m);
  if (!match?.[1]) {
    throw new Error(`Could not find version in ${CHART_PATH}`);
  }
  return match[1];
}

async function main() {
  const rootVersion = await getRootVersion();
  const runtimeVersion = await getRuntimeVersion();
  const chartAppVersion = await getChartAppVersion();
  const chartVersion = await getChartVersion();

  let hasError = false;

  // Check 1: runtime version === chart appVersion
  if (runtimeVersion !== chartAppVersion) {
    console.error("❌ App version mismatch!\n");
    console.error(`   ${RUNTIME_PKG_PATH}: ${runtimeVersion}`);
    console.error(`   ${CHART_PATH} appVersion: ${chartAppVersion}\n`);
    hasError = true;
  }

  // Check 2: root package.json version === chart version
  if (rootVersion !== chartVersion) {
    console.error("❌ Chart version mismatch!\n");
    console.error(`   ${ROOT_PKG_PATH}: ${rootVersion}`);
    console.error(`   ${CHART_PATH} version: ${chartVersion}\n`);
    hasError = true;
  }

  if (hasError) {
    console.error("Run 'bun scripts/bump-version.ts <patch|minor|major>' to sync versions.\n");
    process.exit(1);
  }

  console.log(`✅ Versions synced: app v${runtimeVersion}, chart v${chartVersion}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
