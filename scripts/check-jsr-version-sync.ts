import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("packages/shared/package.json", "utf8"));
const jsr = JSON.parse(readFileSync("packages/shared/jsr.json", "utf8"));

if (pkg.version !== jsr.version) {
  console.error(
    `Version mismatch: package.json=${pkg.version} jsr.json=${jsr.version}`,
  );
  process.exit(1);
}
