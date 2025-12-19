import { rmSync, watch } from "node:fs";
import { join } from "node:path";
import i18next from "@zomme/bun-plugin-i18next";
import iconify from "@zomme/bun-plugin-iconify";
import tsr from "@zomme/bun-plugin-tsr";
import tailwind from "bun-plugin-tailwind";

const isWatch = process.argv.includes("--watch");

async function build() {
  // Clean dist (only on first build)
  try {
    rmSync(join(import.meta.dir, "../dist"), { recursive: true, force: true });
  } catch {}

  console.log("Building cpanel server...");

  // Build server
  const serverResult = await Bun.build({
    entrypoints: ["./index.ts"],
    external: ["@buntime/*"],
    minify: !isWatch,
    outdir: "./dist",
    target: "bun",
  });

  if (!serverResult.success) {
    console.error("Server build failed:", serverResult.logs);
    if (!isWatch) process.exit(1);
    return false;
  }

  console.log("Building cpanel client...");

  // Build client
  const clientResult = await Bun.build({
    entrypoints: ["./client/index.html"],
    minify: !isWatch,
    outdir: "./dist",
    plugins: [tsr, iconify, i18next, tailwind],
    publicPath: "./",
    splitting: true,
    target: "browser",
  });

  if (!clientResult.success) {
    console.error("Client build failed:", clientResult.logs);
    if (!isWatch) process.exit(1);
    return false;
  }

  console.log("Build completed successfully");
  return true;
}

// Initial build
await build();

// Watch mode
if (isWatch) {
  console.log("\nWatching for changes...");

  let debounce: Timer | null = null;
  const dirs = ["./client", "."];

  for (const dir of dirs) {
    watch(dir, { recursive: true }, (event, filename) => {
      if (!filename || filename.includes("dist")) return;
      if (!/\.(ts|tsx|css|html|json)$/.test(filename)) return;

      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(async () => {
        console.log(`\n[${event}] ${filename}`);
        await build();
      }, 100);
    });
  }
}
