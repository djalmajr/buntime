#!/usr/bin/env bun

// Generate all Helm files from plugin manifests
//
// This script runs all Helm generators:
// 1. generate-helm-values.ts - Generate values.yaml
// 2. generate-helm-configmap.ts - Generate configmap.yaml
// 3. generate-helm-questions.ts - Generate questions.yml
//
// Usage: bun scripts/generate-helm.ts

import { dirname, join } from "node:path";
import { $ } from "bun";

const SCRIPTS_DIR = dirname(import.meta.path);

async function main() {
  console.log("=== Generating Helm Files ===\n");

  const scripts = [
    "generate-helm-values.ts",
    "generate-helm-configmap.ts",
    "generate-helm-questions.ts",
  ];

  for (const script of scripts) {
    console.log(`\n--- Running ${script} ---\n`);
    const result = await $`bun ${join(SCRIPTS_DIR, script)}`.quiet();
    console.log(result.text());
  }

  console.log("\n=== All Helm files generated ===");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
