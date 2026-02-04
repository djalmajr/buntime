/**
 * Git Guard State
 * Simple file-based bypass flag
 */

import { existsSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Get bypass file path
 * Uses the script's directory to find .bypass file (more reliable than projectDir)
 */
function getBypassFile(_projectDir: string): string {
  // Use import.meta.dir to get the directory where this script is located
  return join(import.meta.dir, ".bypass");
}

/**
 * Set bypass flag
 */
export function setBypass(projectDir: string): void {
  const bypassFile = getBypassFile(projectDir);
  const dir = dirname(bypassFile);
  
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  
  writeFileSync(bypassFile, "1");
}

/**
 * Consume bypass flag (check and delete)
 */
export function consumeBypass(projectDir: string): boolean {
  const bypassFile = getBypassFile(projectDir);
  
  if (existsSync(bypassFile)) {
    unlinkSync(bypassFile);
    return true;
  }
  
  return false;
}
