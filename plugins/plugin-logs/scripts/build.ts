import { rmSync, watch } from "node:fs";
import { join } from "node:path";
import tailwind from "bun-plugin-tailwind";

const isWatch = process.argv.includes("--watch");

async function build() {
  // Clean dist (only on first build)
  try {
    rmSync(join(import.meta.dir, "../dist"), { recursive: true, force: true });
  } catch {}

  console.log("Building plugin-logs...");

  const [serverResult, clientResult] = await Promise.all([
    Bun.build({
      entrypoints: ["./index.ts"],
      external: ["@buntime/shared"],
      minify: !isWatch,
      outdir: "./dist",
      splitting: true,
      target: "bun",
    }),
    Bun.build({
      entrypoints: ["./client/index.html"],
      minify: !isWatch,
      outdir: "./dist/client",
      plugins: [tailwind],
      publicPath: "./",
      splitting: true,
      target: "browser",
    }),
  ]);

  if (!serverResult.success || !clientResult.success) {
    console.error("Build failed:", serverResult.logs, clientResult.logs);
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
  const dirs = ["./client", "./server", "."];

  for (const dir of dirs) {
    watch(dir, { recursive: true }, (event, filename) => {
      if (!filename || filename.includes("dist")) return;
      if (!/\.(ts|tsx|css|html)$/.test(filename)) return;

      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(async () => {
        console.log(`\n[${event}] ${filename}`);
        await build();
      }, 100);
    });
  }
}
