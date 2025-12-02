import { resolve } from "node:path";
import { tsrPlugin } from "bun-plugin-tsr";

// Skip if running build script (it handles TSR itself)
const isBuildScript = process.argv.some((arg) => arg.includes("build.ts"));

if (!isBuildScript) {
  const isDevMode = process.argv.some((arg) => arg === "--hot" || arg === "--watch");
  const srcDir = resolve(import.meta.dir, "../src");
  const tsr = tsrPlugin({ watch: isDevMode, config: { rootDirectory: srcDir } });
  await tsr.setup!({} as Parameters<NonNullable<typeof tsr.setup>>[0]);
}
