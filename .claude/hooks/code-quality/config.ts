/**
 * Code Quality Configuration
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CodeQualityConfig } from "./types";

export const defaultConfig: CodeQualityConfig = {
  // Enable/disable checkers
  lintEnabled: true,
  testEnabled: false, // Disabled by default (can be slow)

  // Lint commands by language (use %FILE% placeholder for file path)
  lintCommands: {
    go: "golangci-lint run --fast %FILE%",
    typescript: "eslint %FILE%",
    javascript: "eslint %FILE%",
  },

  // Test commands by language
  testCommands: {
    go: "go test -run '' ./...", // Quick test discovery
    typescript: "npm test -- --findRelatedTests %FILE%",
    javascript: "npm test -- --findRelatedTests %FILE%",
  },

  // File patterns for language detection
  languagePatterns: {
    go: /\.go$/,
    typescript: /\.tsx?$/,
    javascript: /\.jsx?$/,
  },

  // Ignore patterns
  ignorePatterns: [
    /node_modules/,
    /vendor/,
    /\.git/,
    /dist/,
    /build/,
    /_test\.go$/,     // Go test files
    /\.test\.[jt]sx?$/, // JS/TS test files
    /\.spec\.[jt]sx?$/,
  ],
};

/**
 * Load configuration with optional project-level overrides
 */
export function loadConfig(projectDir: string): CodeQualityConfig {
  const configPath = join(projectDir, ".claude/hooks/code-quality/config.json");

  if (existsSync(configPath)) {
    try {
      const overrides = JSON.parse(readFileSync(configPath, "utf-8"));
      return mergeConfig(defaultConfig, overrides);
    } catch {
      // Invalid config file, use defaults
    }
  }

  return { ...defaultConfig };
}

function mergeConfig(
  defaults: CodeQualityConfig,
  overrides: Partial<{
    lintEnabled?: boolean;
    testEnabled?: boolean;
    lintCommands?: Record<string, string>;
    testCommands?: Record<string, string>;
    ignorePatterns?: string[];
  }>
): CodeQualityConfig {
  const config = { ...defaults };

  if (overrides.lintEnabled !== undefined) config.lintEnabled = overrides.lintEnabled;
  if (overrides.testEnabled !== undefined) config.testEnabled = overrides.testEnabled;

  if (overrides.lintCommands) {
    config.lintCommands = { ...defaults.lintCommands, ...overrides.lintCommands };
  }
  if (overrides.testCommands) {
    config.testCommands = { ...defaults.testCommands, ...overrides.testCommands };
  }
  if (overrides.ignorePatterns) {
    const newPatterns = overrides.ignorePatterns.map((p) => new RegExp(p));
    config.ignorePatterns = [...defaults.ignorePatterns, ...newPatterns];
  }

  return config;
}
