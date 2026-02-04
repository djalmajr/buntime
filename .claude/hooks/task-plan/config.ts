/**
 * Task Plan Configuration
 * Default configuration with project-level overrides
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TaskPlanConfig } from "./types";

export const defaultConfig: TaskPlanConfig = {
  // Database file path relative to project root
  dbFile: ".claude/hooks/task-plan/store.db",

  // Files exempt from planning requirement (can edit without a plan)
  exemptPatterns: [
    /^\.claude\//,           // Claude config (hooks, rules, plans)
    /^\.opencode\//,         // OpenCode config
    /^\.git\//,              // Git internals
    /^\.env/,                // Environment files
    /^\.gitignore$/,         // Gitignore
    /^README\.md$/,          // README
    /^CLAUDE\.md$/,          // Claude instructions
    /^CHANGELOG\.md$/,       // Changelog
    /^LICENSE$/,             // License
    /^opencode\.json$/,      // OpenCode config
    /\.test\.[jt]sx?$/,      // JS/TS test files
    /\.spec\.[jt]sx?$/,      // JS/TS spec files
    /_test\.go$/,            // Go test files
    /\.stories\.[jt]sx?$/,   // Storybook
    /\/testdata\//,          // Test data dirs
    /\/__tests__\//,         // Jest test dirs
    /\/__mocks__\//,         // Jest mocks
  ],

  // Behavior
  warnOnUnexpectedFiles: true,
  maxStopAttempts: 2,
};

/**
 * Load configuration with optional project-level overrides
 */
export function loadConfig(projectDir: string): TaskPlanConfig {
  const configPath = join(projectDir, ".claude/hooks/task-plan/config.json");

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

/**
 * Merge user overrides with default config
 */
function mergeConfig(
  defaults: TaskPlanConfig,
  overrides: Partial<{
    dbFile?: string;
    exemptPatterns?: string[];
    warnOnUnexpectedFiles?: boolean;
    maxStopAttempts?: number;
  }>
): TaskPlanConfig {
  const config = { ...defaults };

  // Simple string overrides
  if (overrides.dbFile) config.dbFile = overrides.dbFile;

  // Boolean/number overrides
  if (overrides.warnOnUnexpectedFiles !== undefined) {
    config.warnOnUnexpectedFiles = overrides.warnOnUnexpectedFiles;
  }
  if (overrides.maxStopAttempts !== undefined) {
    config.maxStopAttempts = overrides.maxStopAttempts;
  }

  // Pattern overrides (strings to RegExp, additive)
  if (overrides.exemptPatterns) {
    const newPatterns = overrides.exemptPatterns.map((p) => new RegExp(p));
    config.exemptPatterns = [...defaults.exemptPatterns, ...newPatterns];
  }

  return config;
}
