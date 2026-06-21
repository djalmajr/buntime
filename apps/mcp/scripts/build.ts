const isProd = process.env.NODE_ENV === "production";

const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "bun",
  minify: isProd,
  sourcemap: isProd ? "none" : "linked",
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

// Preserve an executable shebang so the `buntime-mcp` bin works after publish.
const outPath = "./dist/index.js";
const code = await Bun.file(outPath).text();
if (!code.startsWith("#!")) {
  await Bun.write(outPath, `#!/usr/bin/env bun\n${code}`);
}

console.error("[buntime-mcp] build complete -> dist/index.js");
