/**
 * Git Guard Configuration
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GitGuardConfig } from "./types";

export const defaultConfig: GitGuardConfig = {
  blockedPatterns: [
    /git\s+(commit|add|push|stash|reset\s+--hard|rebase|merge|cherry-pick)/i,
  ],

  allowedPatterns: [
    /git\s+(status|diff|log|branch|show|ls-files|checkout\s+-b|fetch|pull)/i,
  ],
};

/**
 * Load configuration with optional project-level overrides
 */
export function loadConfig(projectDir: string): GitGuardConfig {
  const configPath = join(projectDir, ".claude/hooks/git-guard/config.json");

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
  defaults: GitGuardConfig,
  overrides: Partial<{
    blockedPatterns?: string[];
    allowedPatterns?: string[];
  }>
): GitGuardConfig {
  const config = { ...defaults };

  if (overrides.blockedPatterns) {
    const newPatterns = overrides.blockedPatterns.map((p) => new RegExp(p, "i"));
    config.blockedPatterns = [...defaults.blockedPatterns, ...newPatterns];
  }

  if (overrides.allowedPatterns) {
    const newPatterns = overrides.allowedPatterns.map((p) => new RegExp(p, "i"));
    config.allowedPatterns = [...defaults.allowedPatterns, ...newPatterns];
  }

  return config;
}
