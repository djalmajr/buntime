import { rmSync } from "node:fs";
import { join } from "node:path";
import i18next from "@zomme/bun-plugin-i18next";
import iconify from "@zomme/bun-plugin-iconify";
import tsr from "@zomme/bun-plugin-tsr";
import tailwind from "bun-plugin-tailwind";

const root = join(import.meta.dir, "..");

// Clean dist
try {
  rmSync(join(root, "dist"), { recursive: true, force: true });
} catch {}

console.log("Building project...");

const [serverResult, clientResult] = await Promise.all([
  Bun.build({
    entrypoints: [join(root, "index.ts")],
    minify: true,
    outdir: join(root, "dist"),
    splitting: true,
    target: "bun",
  }),
  Bun.build({
    entrypoints: [join(root, "client/index.html")],
    minify: true,
    outdir: join(root, "dist/client"),
    plugins: [
      tsr({ rootDirectory: "client" }),
      iconify({ dirs: ["client"] }),
      i18next({ dirs: "client" }),
      tailwind,
    ],
    publicPath: "./",
    splitting: true,
    target: "browser",
  }),
]);

if (!serverResult.success) {
  console.error("Server build failed:", serverResult.logs);
  process.exit(1);
}

if (!clientResult.success) {
  console.error("Client build failed:", clientResult.logs);
  process.exit(1);
}

console.log("Build completed successfully");
