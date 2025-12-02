import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { i18nextPlugin } from "bun-plugin-i18next";
import { iconifyPlugin } from "bun-plugin-iconify";
import { reactCompilerPlugin } from "bun-plugin-react-compiler";
import tailwind from "bun-plugin-tailwind";
import { tsrPlugin } from "bun-plugin-tsr";

const srcDir = resolve(import.meta.dir, "../src");

// Generate routes (build mode - no watch)
const tsr = tsrPlugin({ config: { rootDirectory: srcDir } });
await tsr.setup!({} as Parameters<NonNullable<typeof tsr.setup>>[0]);

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
    entrypoints: ["./src/index.html"],
    minify: true,
    outdir: "./dist",
    plugins: [
      reactCompilerPlugin(),
      tailwind,
      iconifyPlugin({ dirs: srcDir }),
      i18nextPlugin({ dirs: srcDir }),
    ],
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
