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

console.log("Building cpanel...");

const result = await Bun.build({
  entrypoints: ["./src/index.html"],
  minify: true,
  outdir: "./dist",
  plugins: [i18next, iconify, tailwind, tsr],
  publicPath: "./",
  splitting: true,
  target: "browser",
});

if (!result.success) {
  console.error("Build failed:", result.logs);
  process.exit(1);
}

console.log("Build completed successfully");
