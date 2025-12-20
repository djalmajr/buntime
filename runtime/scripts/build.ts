import { copyFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

const DIST_DIR = join(import.meta.dir, "../dist");
const SERVER_ENTRYPOINT = join(import.meta.dir, "../src/index.ts");
const WORKER_FILE = join(import.meta.dir, "../src/libs/pool/wrapper.ts");

function copyConfig() {
  const configSrc = join(import.meta.dir, "../buntime.jsonc");
  const configDst = join(DIST_DIR, "buntime.jsonc");
  try {
    copyFileSync(configSrc, configDst);
    console.log("Copied: buntime.jsonc -> dist/");
  } catch {
    console.warn("Warning: buntime.jsonc not found, skipping copy");
  }
}

try {
  rmSync(DIST_DIR, { force: true, recursive: true });
} catch {}

console.log("Building server...");

if (process.argv.includes("--compile")) {
  const outfile = join(DIST_DIR, "buntime");

  await Bun.$`bun build ${SERVER_ENTRYPOINT} ${WORKER_FILE} \
    --compile \
    --define 'BUNTIME_COMPILED=true' \
    --minify \
    --outfile ${outfile}`;

  copyConfig();
  console.log("Compiled: dist/buntime");

  // Test the binary (start server, wait 3s, kill)
  console.log("\nTesting binary...");
  const testProc = Bun.spawn([outfile], {
    stdio: ["inherit", "inherit", "inherit"],
  });

  // Wait 3s for startup, then kill
  await Bun.sleep(3000);
  testProc.kill();
  const testExit = await testProc.exited;

  // 143 = SIGTERM (killed), 0 = normal exit - both are OK
  if (testExit === 0 || testExit === 143) {
    console.log("\nBinary test passed!");
  } else {
    console.error("\nBinary test failed with exit code:", testExit);
  }

  process.exit(0);
}

const result = await Bun.build({
  entrypoints: [SERVER_ENTRYPOINT, WORKER_FILE],
  minify: true,
  naming: "[name].[ext]",
  outdir: DIST_DIR,
  target: "bun",
});

// Rename .js to .ts to match source extensions
renameSync(join(DIST_DIR, "index.js"), join(DIST_DIR, "index.ts"));
renameSync(join(DIST_DIR, "wrapper.js"), join(DIST_DIR, "wrapper.ts"));

copyConfig();

if (!result.success) {
  console.error("Build failed:", result.logs);
  process.exit(1);
}

console.log("Build completed successfully");
