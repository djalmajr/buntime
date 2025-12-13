import { rmSync } from "node:fs";
import { join } from "node:path";
import tailwind from "bun-plugin-tailwind";

// Clean dist
try {
  rmSync(join(import.meta.dir, "../dist"), { recursive: true, force: true });
} catch {}

console.log("Building plugin-authn...");

const [serverResult, clientResult] = await Promise.all([
  Bun.build({
    entrypoints: ["./app/index.ts"],
    external: ["@buntime/shared", "hono", "better-auth"],
    minify: true,
    outdir: "./dist",
    splitting: true,
    target: "bun",
  }),
  Bun.build({
    entrypoints: ["./app/client/index.html"],
    minify: true,
    outdir: "./dist/client",
    plugins: [tailwind],
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
