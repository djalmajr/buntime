import { renameSync, rmSync } from "node:fs";
import { join } from "node:path";

const DIST_DIR = join(import.meta.dir, "../dist");
const ENTRYPOINT = join(import.meta.dir, "../src/index.ts");
const WORKER_FILE = join(import.meta.dir, "../src/libs/pool/wrapper.ts");

rmSync(DIST_DIR, { force: true, recursive: true });

if (process.argv.includes("--compile")) {
  const outfile = join(DIST_DIR, "buntime");

  await Bun.$`bun build ${ENTRYPOINT} ${WORKER_FILE} \
    --compile \
    --define 'BUNTIME_COMPILED=true' \
    --minify \
    --outfile ${outfile}`;

  console.log("Compiled: dist/buntime");
  process.exit(0);
}

const result = await Bun.build({
  entrypoints: [ENTRYPOINT, WORKER_FILE],
  minify: true,
  naming: "[name].[ext]",
  outdir: DIST_DIR,
  target: "bun",
});

// Rename .js to .ts to match source extensions
renameSync(join(DIST_DIR, "index.js"), join(DIST_DIR, "index.ts"));
renameSync(join(DIST_DIR, "wrapper.js"), join(DIST_DIR, "wrapper.ts"));

if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

console.log(`Build completed: ${result.outputs.length} file(s)`);
