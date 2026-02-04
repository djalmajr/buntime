/**
 * State Management (SQLite wrapper)
 * Provides backward-compatible interface for state operations
 */

import type { TaskPlanConfig, BypassType, Plan } from "../types";
import {
  getDb,
  getActivePlan,
  setBypass as dbSetBypass,
  consumeBypass as dbConsumeBypass,
  incrementStopAttempts,
  addModifiedFile as dbAddModifiedFile,
} from "./db";

/**
 * Get the active plan (if any)
 */
export function loadActivePlan(projectDir: string, config: TaskPlanConfig): Plan | null {
  const db = getDb(projectDir, config.dbFile);
  return getActivePlan(db);
}

/**
 * Set a bypass flag on the active plan
 */
export function setBypass(
  projectDir: string,
  config: TaskPlanConfig,
  type: BypassType
): void {
  const db = getDb(projectDir, config.dbFile);
  dbSetBypass(db, type);
}

/**
 * Consume (check and reset) a bypass flag
 */
export function consumeBypass(
  projectDir: string,
  config: TaskPlanConfig,
  type: BypassType
): boolean {
  const db = getDb(projectDir, config.dbFile);
  return dbConsumeBypass(db, type);
}

/**
 * Increment stop attempts counter
 */
export function incrementStop(projectDir: string, config: TaskPlanConfig): number {
  const db = getDb(projectDir, config.dbFile);
  return incrementStopAttempts(db);
}

/**
 * Add a modified file to tracking
 */
export function addModifiedFile(
  projectDir: string,
  config: TaskPlanConfig,
  filePath: string
): void {
  const db = getDb(projectDir, config.dbFile);
  dbAddModifiedFile(db, filePath);
}
