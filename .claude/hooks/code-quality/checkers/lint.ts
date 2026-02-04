/**
 * Lint Checker
 * Runs language-specific linters on modified files
 */

import { spawn } from "bun";
import { relative } from "node:path";
import type { CodeQualityConfig, CheckResult } from "../types";

/**
 * Detect language from file path
 */
export function detectLanguage(filePath: string, patterns: Record<string, RegExp>): string | null {
  for (const [lang, pattern] of Object.entries(patterns)) {
    if (pattern.test(filePath)) {
      return lang;
    }
  }
  return null;
}

/**
 * Check if file should be ignored
 */
export function shouldIgnore(filePath: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(filePath));
}

/**
 * Run linter on a file
 */
export async function runLint(
  projectDir: string,
  filePath: string,
  config: CodeQualityConfig
): Promise<CheckResult | null> {
  // Get relative path
  const relativePath = filePath.startsWith(projectDir)
    ? relative(projectDir, filePath)
    : filePath;

  // Check if should ignore
  if (shouldIgnore(relativePath, config.ignorePatterns)) {
    return null;
  }

  // Detect language
  const language = detectLanguage(relativePath, config.languagePatterns);
  if (!language) {
    return null; // Unknown language, skip
  }

  // Get lint command
  const commandTemplate = config.lintCommands[language];
  if (!commandTemplate) {
    return null; // No linter configured
  }

  // Build command
  const command = commandTemplate.replace(/%FILE%/g, relativePath);
  const [cmd, ...args] = command.split(/\s+/);

  try {
    const proc = spawn({
      cmd: [cmd, ...args],
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

    // Parse errors and warnings from output
    const { errors, warnings } = parseOutput(output, language);

    return {
      success: exitCode === 0,
      checker: `lint:${language}`,
      output,
      errors,
      warnings,
    };
  } catch (error) {
    // Linter not installed or failed to run
    return {
      success: true, // Don't block if linter not available
      checker: `lint:${language}`,
      output: `Linter not available: ${error instanceof Error ? error.message : String(error)}`,
      errors: [],
      warnings: [`Linter "${cmd}" not found or failed to run`],
    };
  }
}

/**
 * Parse lint output into errors and warnings
 */
function parseOutput(
  output: string,
  language: string
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const lines = output.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    // Common patterns
    if (/error/i.test(line) && !/warning/i.test(line)) {
      errors.push(line.trim());
    } else if (/warning/i.test(line)) {
      warnings.push(line.trim());
    } else if (language === "go" && /\.go:\d+:\d+:/.test(line)) {
      // Go format: file.go:line:col: message
      errors.push(line.trim());
    } else if ((language === "typescript" || language === "javascript") && /^\s*\d+:\d+/.test(line)) {
      // ESLint format: line:col  severity  message
      if (/error/i.test(line)) {
        errors.push(line.trim());
      } else {
        warnings.push(line.trim());
      }
    }
  }

  return { errors, warnings };
}
