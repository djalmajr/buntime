import { renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import i18next from "@zomme/bun-plugin-i18next";
import iconify from "@zomme/bun-plugin-iconify";
import tsr from "@zomme/bun-plugin-tsr";
import tailwind from "bun-plugin-tailwind";

const DIST_DIR = join(import.meta.dir, "../dist");
const SERVER_ENTRYPOINT = join(import.meta.dir, "../src/index.ts");
const CLIENT_ENTRYPOINT = join(import.meta.dir, "../client/index.html");
const WORKER_FILE = join(import.meta.dir, "../src/libs/pool/wrapper.ts");

try {
  rmSync(DIST_DIR, { force: true, recursive: true });
} catch {}

console.log("Building project...");

if (process.argv.includes("--compile")) {
  const outfile = join(DIST_DIR, "buntime");

  await Bun.$`bun build ${SERVER_ENTRYPOINT} ${WORKER_FILE} \
    --compile \
    --define 'BUNTIME_COMPILED=true' \
    --minify \
    --outfile ${outfile}`;

  console.log("Compiled: dist/buntime");
  process.exit(0);
}

const [serverResult, clientResult] = await Promise.all([
  Bun.build({
    entrypoints: [SERVER_ENTRYPOINT, WORKER_FILE],
    minify: true,
    naming: "[name].[ext]",
    outdir: DIST_DIR,
    target: "bun",
  }),
  Bun.build({
    entrypoints: [CLIENT_ENTRYPOINT],
    minify: true,
    outdir: "./dist",
    plugins: [i18next, iconify, tailwind, tsr],
    publicPath: "./",
    splitting: true,
    target: "browser",
  }),
]);

// Rename .js to .ts to match source extensions
renameSync(join(DIST_DIR, "index.js"), join(DIST_DIR, "index.ts"));
renameSync(join(DIST_DIR, "wrapper.js"), join(DIST_DIR, "wrapper.ts"));

if (!serverResult.success || !clientResult.success) {
  console.error("Build failed:", serverResult.logs, clientResult.logs);
  process.exit(1);
}

console.log("Build completed successfully");
