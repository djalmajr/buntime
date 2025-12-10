import { rmSync } from "node:fs";
import { join } from "node:path";
import i18next from "@zomme/bun-plugin-i18next";
import iconify from "@zomme/bun-plugin-iconify";
import tsr from "@zomme/bun-plugin-tsr";
import tailwind from "bun-plugin-tailwind";

// Clean dist
try {
  rmSync(join(import.meta.dir, "../dist"), { recursive: true, force: true });
} catch {}

console.log("Building project...");

const [serverResult, clientResult] = await Promise.all([
  Bun.build({
    entrypoints: ["./index.ts"],
    minify: true,
    outdir: "./dist",
    splitting: true,
    target: "bun",
  }),
  Bun.build({
    entrypoints: ["./client/index.html"],
    minify: true,
    outdir: "./dist/client",
    plugins: [i18next, iconify, tailwind, tsr],
    publicPath: "./",
    splitting: true,
    target: "browser",
  }),
]);

if (!serverResult.success || !clientResult.success) {
  console.error("Build failed:", serverResult.logs, clientResult.logs);
  process.exit(1);
}

console.log("Build completed successfully");
