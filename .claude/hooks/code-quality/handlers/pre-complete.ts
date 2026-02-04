/**
 * Pre Complete Handler
 * Verifies code quality before marking a plan as done
 */

import type { HandlerContext, CheckResult } from "../types";
import { spawn } from "bun";

interface VerificationResult {
  success: boolean;
  lintResults: CheckResult[];
  buildResult?: { success: boolean; output: string };
  testResult?: { success: boolean; output: string };
}

/**
 * Run full verification before plan completion
 * Returns errors if there are blockers
 */
export async function preComplete(ctx: HandlerContext): Promise<VerificationResult> {
  const { projectDir, config } = ctx;

  const results: VerificationResult = {
    success: true,
    lintResults: [],
  };

  // Run build (required)
  const buildResult = await runBuild(projectDir);
  results.buildResult = buildResult;
  if (!buildResult.success) {
    results.success = false;
  }

  // Run lint on all files (if enabled)
  if (config.lintEnabled) {
    const lintResult = await runFullLint(projectDir);
    results.lintResults.push(lintResult);
    if (!lintResult.success) {
      results.success = false;
    }
  }

  // Run tests (if enabled)
  if (config.testEnabled) {
    const testResult = await runTests(projectDir);
    results.testResult = testResult;
    if (!testResult.success) {
      results.success = false;
    }
  }

  return results;
}

/**
 * Format verification results for display
 */
export function formatResults(results: VerificationResult): string {
  const lines: string[] = [];
  
  lines.push("=".repeat(60));
  lines.push("CODE QUALITY CHECK");
  lines.push("=".repeat(60));
  lines.push("");

  // Build
  if (results.buildResult) {
    const icon = results.buildResult.success ? "✓" : "✗";
    lines.push(`${icon} Build: ${results.buildResult.success ? "PASSED" : "FAILED"}`);
    if (!results.buildResult.success && results.buildResult.output) {
      lines.push("");
      lines.push(results.buildResult.output.slice(0, 500));
    }
  }

  // Lint
  for (const lint of results.lintResults) {
    const icon = lint.success ? "✓" : "✗";
    lines.push(`${icon} Lint: ${lint.success ? "PASSED" : "FAILED"}`);
    if (!lint.success) {
      if (lint.errors.length > 0) {
        lines.push(`   Errors (${lint.errors.length}):`);
        lint.errors.slice(0, 5).forEach((e) => lines.push(`   - ${e}`));
        if (lint.errors.length > 5) {
          lines.push(`   ... and ${lint.errors.length - 5} more`);
        }
      }
    }
  }

  // Tests
  if (results.testResult) {
    const icon = results.testResult.success ? "✓" : "✗";
    lines.push(`${icon} Tests: ${results.testResult.success ? "PASSED" : "FAILED"}`);
    if (!results.testResult.success && results.testResult.output) {
      lines.push("");
      lines.push(results.testResult.output.slice(0, 500));
    }
  }

  lines.push("");
  lines.push("=".repeat(60));
  
  if (!results.success) {
    lines.push("❌ Fix the issues above before marking the plan as done.");
    lines.push("   Use /bypass-quality to skip this check.");
  } else {
    lines.push("✅ All checks passed!");
  }
  
  lines.push("=".repeat(60));

  return lines.join("\n");
}

/**
 * Run go build
 */
async function runBuild(projectDir: string): Promise<{ success: boolean; output: string }> {
  try {
    const proc = spawn({
      cmd: ["go", "build", "./..."],
      cwd: projectDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    const exitCode = await proc.exited;
    return {
      success: exitCode === 0,
      output: (stdout + "\n" + stderr).trim(),
    };
  } catch (error) {
    return {
      success: false,
      output: `Build failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Run full lint check
 */
async function runFullLint(projectDir: string): Promise<CheckResult> {
  try {
    const proc = spawn({
      cmd: ["golangci-lint", "run", "--fast"],
      cwd: projectDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    const exitCode = await proc.exited;
    const output = (stdout + "\n" + stderr).trim();

    // Parse errors
    const errors = output
      .split("\n")
      .filter((line) => /\.go:\d+:\d+:/.test(line))
      .map((line) => line.trim());

    return {
      success: exitCode === 0,
      checker: "golangci-lint",
      output,
      errors,
      warnings: [],
    };
  } catch (error) {
    return {
      success: true, // Don't block if linter not available
      checker: "golangci-lint",
      output: `Linter not available: ${error instanceof Error ? error.message : String(error)}`,
      errors: [],
      warnings: ["golangci-lint not installed"],
    };
  }
}

/**
 * Run tests
 */
async function runTests(projectDir: string): Promise<{ success: boolean; output: string }> {
  try {
    const proc = spawn({
      cmd: ["go", "test", "./..."],
      cwd: projectDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    const exitCode = await proc.exited;
    return {
      success: exitCode === 0,
      output: (stdout + "\n" + stderr).trim(),
    };
  } catch (error) {
    return {
      success: false,
      output: `Tests failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
